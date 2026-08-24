// routes/audit.js — read-only Etsy delivery and order-health monitor
import express from "express";
import cron from "node-cron";
import { saveAgentOutput } from "../lib/supabase.js";
import { getEtsyToken } from "../lib/etsyDraft.js";
import { fetchWithRetry } from "../lib/security.js";

export const auditRouter = express.Router();

const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_KEY = process.env.ETSY_KEY || process.env.ETSY_API_KEY || "";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = Number(process.env.ETSY_SHOP_ID) || 0;
const ALLOWED_EXT = new Set(["zip", "pdf", "png", "jpg", "jpeg", "svg"]);
const MAX_BYTES = Number(process.env.ETSY_MAX_FILE_BYTES) || 20 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function xkey() {
  return ETSY_SECRET ? `${ETSY_KEY}:${ETSY_SECRET}` : ETSY_KEY;
}

function authH(token) {
  return {
    Authorization: `Bearer ${token}`,
    "x-api-key": xkey(),
    "Content-Type": "application/json",
  };
}

function extension(filename = "") {
  return String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function priceValue(price) {
  if (!price) return 0;
  const amount = Number(price.amount);
  const divisor = Number(price.divisor) || 100;
  return Number.isFinite(amount) ? amount / divisor : 0;
}

async function resolveShopId(token) {
  if (ETSY_SHOP_ID) return ETSY_SHOP_ID;
  const uid = String(token).split(".")[0];
  const response = await fetchWithRetry(`${ETSY_BASE}/users/${uid}/shops`, {
    headers: authH(token),
  }, { retries: 2, timeoutMs: 10_000 });
  if (!response.ok) throw new Error(`Etsy shop lookup ${response.status}`);
  const json = await response.json();
  return (json.results?.[0] || json)?.shop_id || 0;
}

async function getActive(token, shopId, cap = 0) {
  const out = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const response = await fetchWithRetry(
      `${ETSY_BASE}/shops/${shopId}/listings/active?limit=${limit}&offset=${offset}`,
      { headers: authH(token) },
      { retries: 2, timeoutMs: 15_000 },
    );
    if (!response.ok) throw new Error(`Etsy active listings ${response.status}`);
    const batch = (await response.json()).results || [];
    out.push(...batch);
    if (batch.length < limit || (cap && out.length >= cap)) break;
    offset += limit;
    await sleep(250);
  }
  return cap ? out.slice(0, cap) : out;
}

async function countByState(token, shopId, state) {
  const response = await fetchWithRetry(
    `${ETSY_BASE}/shops/${shopId}/listings?state=${encodeURIComponent(state)}&limit=1`,
    { headers: authH(token) },
    { retries: 1, timeoutMs: 10_000 },
  );
  if (!response.ok) return null;
  return (await response.json()).count ?? null;
}

async function getFiles(token, shopId, listingId) {
  const response = await fetchWithRetry(
    `${ETSY_BASE}/shops/${shopId}/listings/${listingId}/files`,
    { headers: authH(token) },
    { retries: 1, timeoutMs: 10_000 },
  );
  if (response.status === 404) return [];
  if (response.status === 429) return { __error: "429 quota" };
  if (!response.ok) return { __error: String(response.status) };
  return (await response.json()).results || [];
}

async function orderHealth(token, shopId) {
  const response = await fetchWithRetry(
    `${ETSY_BASE}/shops/${shopId}/receipts?limit=100&was_paid=true`,
    { headers: authH(token) },
    { retries: 2, timeoutMs: 15_000 },
  );
  if (response.status === 403) {
    return { available: false, reason: "receipts scope (transactions_r) not granted" };
  }
  if (!response.ok) return { available: false, reason: `etsy ${response.status}` };

  const receipts = (await response.json()).results || [];
  const stuck = [];
  for (const receipt of receipts) {
    const paid = receipt.is_paid === true;
    const completed = receipt.status === "Completed" || receipt.is_shipped === true;
    if (paid && !completed) {
      // Intentionally omit buyer name/email/address from operational output and logs.
      stuck.push({
        receipt_id: receipt.receipt_id,
        status: receipt.status,
        total: priceValue(receipt.grandtotal),
        created_timestamp: receipt.create_timestamp || null,
      });
    }
  }
  return { available: true, checked: receipts.length, stuck_count: stuck.length, stuck };
}

async function deliveryAudit(token, shopId, cap = 0) {
  const listings = await getActive(token, shopId, cap);
  const report = {
    total: listings.length,
    delivery_risk: [],
    missing_files: [],
    needs_correction: [],
    duplicates: [],
    quota_errors: 0,
  };
  const titles = {};

  for (const listing of listings) {
    const id = listing.listing_id;
    const title = listing.title || "";
    const type = listing.listing_type || listing.type || "";
    const price = priceValue(listing.price) || null;
    const key = title.trim().toLowerCase();
    (titles[key] ||= []).push(id);

    if (type === "download" || type === "both") {
      const files = await getFiles(token, shopId, id);
      await sleep(220);
      if (files.__error) {
        if (files.__error.startsWith("429")) report.quota_errors++;
      } else if (!files.length) {
        report.missing_files.push({ listing_id: id, title, price });
        report.delivery_risk.push({ listing_id: id, title, reason: "digital listing has 0 files" });
      } else {
        for (const file of files) {
          const ext = extension(file.filename || file.name);
          const size = Number(file.filesize_bytes || file.filesize || file.size) || 0;
          if (ext && !ALLOWED_EXT.has(ext)) {
            report.needs_correction.push({ listing_id: id, issue: `unsupported file type .${ext}` });
          }
          if (size > MAX_BYTES) {
            report.needs_correction.push({ listing_id: id, issue: `file exceeds ${MAX_BYTES} bytes` });
          }
        }
      }
    }

    if (price === null || price <= 0) {
      report.needs_correction.push({ listing_id: id, issue: `bad price ${price}` });
    }
  }

  for (const [title, listingIds] of Object.entries(titles)) {
    if (listingIds.length > 1) report.duplicates.push({ title, listing_ids: listingIds });
  }
  return report;
}

export async function runDeliveryMonitor({ deep = false, save = false, cap = 0 } = {}) {
  if (!ETSY_KEY) throw new Error("ETSY_KEY is not configured");
  const token = await getEtsyToken();
  if (!token) throw new Error("No Etsy token; re-authenticate through the protected /api/etsy/auth route");
  const shopId = await resolveShopId(token);
  if (!shopId) throw new Error("Could not resolve Etsy shop_id");

  const active = await getActive(token, shopId, cap);
  const titleMap = {};
  for (const listing of active) {
    const key = String(listing.title || "").trim().toLowerCase();
    (titleMap[key] ||= []).push(listing.listing_id);
  }
  const duplicates = Object.entries(titleMap)
    .filter(([, ids]) => ids.length > 1)
    .map(([title, listing_ids]) => ({ title, listing_ids }));

  const [inactive, draft, expired, orders] = await Promise.all([
    countByState(token, shopId, "inactive"),
    countByState(token, shopId, "draft"),
    countByState(token, shopId, "expired"),
    orderHealth(token, shopId).catch((error) => ({ available: false, reason: error.message })),
  ]);

  let files = {
    scanned: false,
    missing_files: [],
    delivery_risk: [],
    needs_correction: [],
    quota_errors: 0,
    note: "deep file scan deferred",
  };
  if (deep) {
    const detail = await deliveryAudit(token, shopId, cap);
    files = { scanned: true, ...detail };
  }

  const prices = active.map((listing) => priceValue(listing.price)).filter((price) => price > 0);
  const avgPrice = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : 0;
  const missingCount = files.scanned ? files.missing_files.length : 0;
  const stuckCount = orders.stuck_count || 0;
  const correctionCount = files.needs_correction?.length || 0;
  const score = Math.max(0, Math.round(
    100 - missingCount * 4 - stuckCount * 5 - duplicates.length - correctionCount * 2,
  ));

  const report = {
    audited_at: new Date().toISOString(),
    shop_id: shopId,
    total_listings_active: active.length,
    inactive_listings: inactive,
    draft_listings: draft,
    expired_listings: expired,
    missing_files_count: files.scanned ? files.missing_files.length : "deferred",
    delivery_risk_count: files.scanned ? files.delivery_risk.length : "deferred",
    duplicate_clusters: duplicates.length,
    duplicate_detail: duplicates,
    stuck_orders: orders,
    etsy_api_errors: files.quota_errors || 0,
    avg_price: Number(avgPrice.toFixed(2)),
    revenue_at_risk: Number(((missingCount + stuckCount) * avgPrice).toFixed(2)),
    health_score: score,
    file_scan: files,
  };

  if (save) {
    const saved = await saveAgentOutput("AUDIT", "delivery_health_report", report);
    report.saved_to_supabase = Boolean(saved);
  }
  return report;
}

auditRouter.get("/digital-delivery", async (req, res) => {
  try {
    const token = await getEtsyToken();
    if (!token) return res.status(401).json({ error: "no Etsy token" });
    const shopId = await resolveShopId(token);
    const max = Math.max(0, Math.min(500, Number(req.query.max) || 0));
    res.json({
      shop_id: shopId,
      audited_at: new Date().toISOString(),
      ...(await deliveryAudit(token, shopId, max)),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

auditRouter.get("/order-health", async (_req, res) => {
  try {
    const token = await getEtsyToken();
    if (!token) return res.status(401).json({ error: "no Etsy token" });
    const shopId = await resolveShopId(token);
    res.json({ shop_id: shopId, ...(await orderHealth(token, shopId)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

auditRouter.get("/monitor", async (req, res) => {
  try {
    res.json(await runDeliveryMonitor({
      deep: req.query.deep === "true",
      save: req.query.save === "true",
      cap: Math.max(0, Math.min(500, Number(req.query.max) || 0)),
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

cron.schedule("0 8 * * *", () => {
  runDeliveryMonitor({ deep: true, save: true })
    .then((report) => console.log(`[DELIVERY-MONITOR] score ${report.health_score} · missing ${report.missing_files_count} · stuck ${report.stuck_orders?.stuck_count ?? 0}`))
    .catch((error) => console.error("[DELIVERY-MONITOR]", error.message));
});

console.log("[DELIVERY-MONITOR] daily deep audit registered (08:00 UTC)");
