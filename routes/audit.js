// routes/audit.js — House of Jreym Delivery Health Monitor (read-only audit + daily cron)
// Routes:
//   GET /api/audit/digital-delivery[?format=text][?max=N]  -> per-listing file audit
//   GET /api/audit/order-health                            -> paid-but-incomplete orders
//   GET /api/audit/monitor[?deep=true][?save=true]         -> combined health report
// A self-registered cron runs the deep monitor daily at 08:00 UTC and saves to Supabase
// (agent_outputs, agent="AUDIT", output_type="delivery_health_report").
// Read-only against Etsy. Never edits or deletes listings/orders.
import express from "express";
import cron from "node-cron";
import { supabase, saveAgentOutput } from "../lib/supabase.js";

export const auditRouter = express.Router();

const ETSY_KEY = process.env.ETSY_KEY || "";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = parseInt(process.env.ETSY_SHOP_ID) || 0;
const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ALLOWED_EXT = ["zip", "pdf", "png", "jpg", "jpeg", "svg"];
const MAX_BYTES = 20 * 1024 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getEtsyToken() {
  const { data, error } = await supabase
    .from("oauth_tokens").select("access_token").eq("platform", "etsy").single();
  if (!error && data?.access_token) return data.access_token;
  return process.env.ETSY_ACCESS_TOKEN || null;
}
function authH(t) {
  return { Authorization: "Bearer " + t, "x-api-key": ETSY_KEY + (ETSY_SECRET ? ":" + ETSY_SECRET : ""), "Content-Type": "application/json" };
}
async function resolveShopId(t) {
  if (ETSY_SHOP_ID) return ETSY_SHOP_ID;
  const uid = t.split(".")[0];
  const r = await fetch(ETSY_BASE + "/users/" + uid + "/shops", { headers: authH(t) });
  return ((await r.json()).results?.[0] || {})?.shop_id;
}
function ext(n = "") { const m = String(n).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }

async function getActive(t, shopId, cap) {
  const out = []; let offset = 0; const limit = 100;
  while (true) {
    const r = await fetch(ETSY_BASE + "/shops/" + shopId + "/listings/active?limit=" + limit + "&offset=" + offset, { headers: authH(t) });
    if (!r.ok) throw new Error("active " + r.status + ": " + (await r.text()).slice(0, 160));
    const batch = (await r.json()).results || [];
    out.push(...batch);
    if (batch.length < limit || (cap && out.length >= cap)) break;
    offset += limit; await sleep(300);
  }
  return cap ? out.slice(0, cap) : out;
}
async function countByState(t, shopId, state) {
  const r = await fetch(ETSY_BASE + "/shops/" + shopId + "/listings?state=" + state + "&limit=1", { headers: authH(t) });
  if (!r.ok) return null;
  return (await r.json()).count ?? null;
}
async function getFiles(t, shopId, id) {
  const r = await fetch(ETSY_BASE + "/shops/" + shopId + "/listings/" + id + "/files", { headers: authH(t) });
  if (r.status === 404) return [];
  if (r.status === 429) return { __error: "429 quota" };
  if (!r.ok) return { __error: String(r.status) };
  return (await r.json()).results || [];
}

// ---- order health: paid-but-incomplete digital orders ("stuck") -----------
async function orderHealth(t, shopId) {
  const r = await fetch(ETSY_BASE + "/shops/" + shopId + "/receipts?limit=100&was_paid=true", { headers: authH(t) });
  if (r.status === 403) return { available: false, reason: "receipts scope (transactions_r) not granted" };
  if (!r.ok) return { available: false, reason: "etsy " + r.status };
  const rows = (await r.json()).results || [];
  const stuck = [];
  for (const rc of rows) {
    const paid = rc.is_paid === true;
    const completed = rc.status === "Completed" || rc.is_shipped === true;
    if (paid && !completed) {
      stuck.push({ receipt_id: rc.receipt_id, buyer: rc.name, status: rc.status, total: rc.grandtotal?.amount / (rc.grandtotal?.divisor || 100) });
    }
  }
  return { available: true, checked: rows.length, stuck_count: stuck.length, stuck };
}

// ---- core delivery audit --------------------------------------------------
async function deliveryAudit(t, shopId, cap) {
  const listings = await getActive(t, shopId, cap);
  const R = { total: listings.length, delivery_risk: [], missing_files: [], needs_correction: [], duplicates: [], quota_errors: 0 };
  const titles = {};
  for (const L of listings) {
    const id = L.listing_id, title = L.title || "", type = L.listing_type;
    const price = L.price ? L.price.amount / (L.price.divisor || 100) : null;
    const key = title.trim().toLowerCase(); (titles[key] = titles[key] || []).push(id);
    if (type === "download" || type === "both") {
      const files = await getFiles(t, shopId, id); await sleep(220);
      if (files.__error) { if (files.__error.startsWith("429")) R.quota_errors++; }
      else if (files.length === 0) {
        R.missing_files.push({ listing_id: id, title, price });
        R.delivery_risk.push({ listing_id: id, title, reason: "digital listing, 0 files" });
      } else for (const f of files) {
        if (ext(f.filename) && !ALLOWED_EXT.includes(ext(f.filename))) R.needs_correction.push({ listing_id: id, issue: "file type ." + ext(f.filename) });
        if (f.filesize_bytes > MAX_BYTES) R.needs_correction.push({ listing_id: id, issue: "file >20MB" });
      }
    }
    if (price === null || price <= 0) R.needs_correction.push({ listing_id: id, issue: "bad price " + price });
  }
  for (const [k, ids] of Object.entries(titles)) if (ids.length > 1) R.duplicates.push({ title: k, listing_ids: ids });
  return R;
}

// ---- combined monitor (what the cron + /monitor run) ----------------------
async function runMonitor({ deep = false, save = false, cap = 0 } = {}) {
  const t = await getEtsyToken();
  if (!t) throw new Error("No Etsy token (oauth_tokens.platform=etsy). Re-auth at /api/etsy/auth");
  const shopId = await resolveShopId(t);
  if (!shopId) throw new Error("Could not resolve shop_id — set ETSY_SHOP_ID");

  const active = await getActive(t, shopId, cap);
  const titles = {};
  for (const L of active) { const k = (L.title || "").trim().toLowerCase(); (titles[k] = titles[k] || []).push(L.listing_id); }
  const duplicates = Object.entries(titles).filter(([, ids]) => ids.length > 1).map(([title, listing_ids]) => ({ title, listing_ids }));

  const [inactive, draft, expired] = await Promise.all([
    countByState(t, shopId, "inactive"), countByState(t, shopId, "draft"), countByState(t, shopId, "expired"),
  ]);
  const orders = await orderHealth(t, shopId).catch(e => ({ available: false, reason: e.message }));

  let files = { scanned: false, missing_files: [], delivery_risk: [], quota_errors: 0, note: "deep file scan runs in the daily 08:00 UTC cron" };
  if (deep) {
    const da = await deliveryAudit(t, shopId, cap);
    files = { scanned: true, missing_files: da.missing_files, delivery_risk: da.delivery_risk, needs_correction: da.needs_correction, quota_errors: da.quota_errors };
  }

  const prices = active.map(L => L.price ? L.price.amount / (L.price.divisor || 100) : 0).filter(p => p > 0);
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

  let score = 100;
  score -= (files.missing_files?.length || 0) * 4;
  score -= duplicates.length;
  score -= (orders.stuck_count || 0) * 5;

  const report = {
    audited_at: new Date().toISOString(), shop_id: shopId,
    total_listings_active: active.length,
    inactive_listings: inactive, draft_listings: draft, expired_listings: expired,
    missing_files_count: files.scanned ? files.missing_files.length : "deferred-to-daily-cron",
    delivery_risk_count: files.scanned ? files.delivery_risk.length : "deferred-to-daily-cron",
    duplicate_clusters: duplicates.length,
    duplicate_detail: duplicates,
    stuck_orders: orders,
    etsy_api_errors: files.quota_errors || 0,
    avg_price: +avg.toFixed(2),
    revenue_at_risk: ((files.missing_files?.length || 0) + (orders.stuck_count || 0)) * +avg.toFixed(2),
    health_score: Math.max(0, Math.round(score)),
    file_scan: files,
  };

  if (save) {
    try { await saveAgentOutput("AUDIT", "delivery_health_report", report); report.saved_to_supabase = true; }
    catch (e) { report.saved_to_supabase = false; report.save_error = e.message; }
  }
  return report;
}

// ---- routes ---------------------------------------------------------------
auditRouter.get("/digital-delivery", async (req, res) => {
  try {
    const t = await getEtsyToken(); if (!t) return res.status(401).json({ error: "no etsy token" });
    const shopId = await resolveShopId(t);
    const cap = req.query.max ? parseInt(req.query.max) : 0;
    const da = await deliveryAudit(t, shopId, cap);
    res.json({ shop_id: shopId, audited_at: new Date().toISOString(), ...da });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
auditRouter.get("/order-health", async (req, res) => {
  try {
    const t = await getEtsyToken(); if (!t) return res.status(401).json({ error: "no etsy token" });
    const shopId = await resolveShopId(t);
    res.json({ shop_id: shopId, ...(await orderHealth(t, shopId)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
auditRouter.get("/monitor", async (req, res) => {
  try {
    const report = await runMonitor({ deep: req.query.deep === "true", save: req.query.save === "true", cap: req.query.max ? parseInt(req.query.max) : 0 });
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- daily self-registered monitor (deep scan + persist) ------------------
cron.schedule("0 8 * * *", () => {
  runMonitor({ deep: true, save: true })
    .then(r => console.log("[DELIVERY-MONITOR] saved · score " + r.health_score + " · missing " + r.missing_files_count + " · stuck " + (r.stuck_orders?.stuck_count ?? "?")))
    .catch(e => console.error("[DELIVERY-MONITOR] failed:", e.message));
});
console.log("[DELIVERY-MONITOR] daily cron registered (08:00 UTC) ✅");
