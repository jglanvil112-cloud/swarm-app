import express from "express";
import cron from "node-cron";
import { supabase, saveAgentOutput, logAgent } from "../lib/supabase.js";
import { getEtsyToken } from "../lib/etsyDraft.js";
import { scoreListingQuality } from "../lib/seo.js";
import { fetchWithRetry } from "../lib/security.js";

export const metricsRouter = express.Router();

const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_KEY = process.env.ETSY_KEY || process.env.ETSY_API_KEY || "";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = Number(process.env.ETSY_SHOP_ID) || 0;

function xkey() {
  return ETSY_SECRET ? `${ETSY_KEY}:${ETSY_SECRET}` : ETSY_KEY;
}

function authH(token) {
  return { Authorization: `Bearer ${token}`, "x-api-key": xkey() };
}

function moneyValue(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const amount = Number(value.amount);
  const divisor = Number(value.divisor) || 100;
  return Number.isFinite(amount) ? amount / divisor : 0;
}

async function getActiveListings(token) {
  const out = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const response = await fetchWithRetry(
      `${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/active?limit=${limit}&offset=${offset}`,
      { headers: authH(token) },
      { retries: 2, timeoutMs: 15_000 },
    );
    if (!response.ok) throw new Error(`Etsy listings ${response.status}`);
    const json = await response.json();
    const batch = json.results || [];
    out.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset >= 1000) break;
  }
  return out;
}

async function getRecentReceipts(token) {
  const response = await fetchWithRetry(
    `${ETSY_BASE}/shops/${ETSY_SHOP_ID}/receipts?limit=100&was_paid=true`,
    { headers: authH(token) },
    { retries: 2, timeoutMs: 15_000 },
  );
  if (response.status === 403) return { available: false, receipts: [] };
  if (!response.ok) throw new Error(`Etsy receipts ${response.status}`);
  const json = await response.json();
  return { available: true, receipts: json.results || [] };
}

function buildRevenueByListing(receipts) {
  const byListing = new Map();
  let totalRevenue = 0;
  let allocatedRevenue = 0;

  for (const receipt of receipts) {
    const receiptTotal = moneyValue(receipt.grandtotal || receipt.total_price || receipt.total);
    totalRevenue += receiptTotal;
    const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : [];
    if (!transactions.length) continue;

    const transactionValues = transactions.map((tx) => {
      const quantity = Math.max(1, Number(tx.quantity) || 1);
      return Math.max(0, moneyValue(tx.price) * quantity);
    });
    const transactionTotal = transactionValues.reduce((sum, value) => sum + value, 0);

    transactions.forEach((tx, index) => {
      const listingId = String(tx.listing_id || tx.product_id || "");
      if (!listingId) return;
      const fallbackShare = receiptTotal / transactions.length;
      const revenue = transactionTotal > 0 ? transactionValues[index] : fallbackShare;
      allocatedRevenue += revenue;
      const row = byListing.get(listingId) || { orders: 0, units: 0, revenue: 0 };
      row.orders += 1;
      row.units += Math.max(1, Number(tx.quantity) || 1);
      row.revenue += revenue;
      byListing.set(listingId, row);
    });
  }

  return { byListing, totalRevenue, allocatedRevenue };
}

export async function syncEtsyPerformance() {
  if (!ETSY_KEY || !ETSY_SHOP_ID) throw new Error("Etsy metrics config missing");
  const token = await getEtsyToken();
  if (!token) throw new Error("Etsy token missing");

  const [listings, receiptResult] = await Promise.all([
    getActiveListings(token),
    getRecentReceipts(token).catch((error) => ({ available: false, receipts: [], error: error.message })),
  ]);
  const revenue = buildRevenueByListing(receiptResult.receipts || []);

  let updated = 0;
  const rows = [];
  for (const listing of listings) {
    const listingId = String(listing.listing_id);
    const sale = revenue.byListing.get(listingId) || { orders: 0, units: 0, revenue: 0 };
    const views = Number(listing.views) || 0;
    const favorites = Number(listing.num_favorers) || 0;
    const performance = {
      views,
      favorites,
      favorite_rate: views ? Number((favorites / views).toFixed(4)) : 0,
      orders: sale.orders,
      units: sale.units,
      revenue: Number(sale.revenue.toFixed(2)),
      revenue_per_100_views: views ? Number(((sale.revenue / views) * 100).toFixed(2)) : 0,
      synced_at: new Date().toISOString(),
    };
    performance.quality_score = scoreListingQuality({
      title: listing.title || "",
      tags: listing.tags || [],
      description: listing.description || "",
      performance,
    });

    const price = moneyValue(listing.price);
    const { error } = await supabase.from("products").upsert({
      external_id: listingId,
      platform: "etsy",
      title: listing.title || "",
      description: String(listing.description || "").slice(0, 3000),
      tags: listing.tags || [],
      price,
      status: listing.state || "active",
      performance,
      ai_score: performance.quality_score / 100,
      updated_at: new Date().toISOString(),
    }, { onConflict: "external_id,platform" });
    if (!error) updated++;
    rows.push({ listing_id: listingId, title: listing.title, ...performance });
  }

  const ranked = [...rows].sort((a, b) =>
    (b.revenue_per_100_views - a.revenue_per_100_views) ||
    (b.favorite_rate - a.favorite_rate) ||
    (b.views - a.views),
  );

  const summary = {
    synced_at: new Date().toISOString(),
    active_listings: listings.length,
    products_updated: updated,
    receipts_available: receiptResult.available,
    receipt_count: receiptResult.receipts?.length || 0,
    total_receipt_revenue: Number(revenue.totalRevenue.toFixed(2)),
    allocated_listing_revenue: Number(revenue.allocatedRevenue.toFixed(2)),
    top_performers: ranked.slice(0, 10),
    low_signal: ranked.filter((row) => row.views >= 20 && row.orders === 0).slice(-10),
  };

  await saveAgentOutput("SEUN", "etsy_performance_sync", summary);
  await logAgent("SEUN", `Etsy metrics synced: ${updated}/${listings.length} active listings`, "success");
  return summary;
}

metricsRouter.get("/etsy", async (_req, res) => {
  try { res.json(await syncEtsyPerformance()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

metricsRouter.get("/etsy/current", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("external_id,title,price,status,performance,updated_at")
      .eq("platform", "etsy")
      .order("updated_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    res.json({ products: data || [], count: data?.length || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (process.env.ENABLE_ETSY_METRICS_CRON !== "false") {
  cron.schedule("20 */6 * * *", () => {
    syncEtsyPerformance().catch((error) => console.error("[ETSY-METRICS]", error.message));
  });
  console.log("[ETSY-METRICS] 6-hour performance sync registered");
}
