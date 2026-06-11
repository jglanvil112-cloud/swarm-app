// routes/audit.js — House of Jreym digital-delivery audit (read-only)
// Mounted at /api/audit. Changes nothing in the shop; flags fixes for approval.
//   GET /api/audit/digital-delivery            -> JSON report (7 sections)
//   GET /api/audit/digital-delivery?format=text -> plain-text report
//   GET /api/audit/digital-delivery?max=20      -> cap listings (quota-safe test run)
import express from "express";
import { supabase } from "../lib/supabase.js";

export const auditRouter = express.Router();

const ETSY_KEY = process.env.ETSY_KEY || "";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = parseInt(process.env.ETSY_SHOP_ID) || 0;
const ETSY_BASE = "https://openapi.etsy.com/v3/application";

const ALLOWED_EXT = ["zip", "pdf", "png", "jpg", "jpeg", "svg"];
const MAX_BYTES = 20 * 1024 * 1024;

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
  const d = await r.json();
  return (d.results?.[0] || d)?.shop_id;
}
function ext(n = "") { const m = String(n).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getAllActive(t, shopId, cap) {
  const out = []; let offset = 0; const limit = 100;
  while (true) {
    const r = await fetch(ETSY_BASE + "/shops/" + shopId + "/listings/active?limit=" + limit + "&offset=" + offset, { headers: authH(t) });
    if (!r.ok) throw new Error("active " + r.status + ": " + (await r.text()).slice(0, 200));
    const j = await r.json(); const batch = j.results || [];
    out.push(...batch);
    if (batch.length < limit || (cap && out.length >= cap)) break;
    offset += limit; await sleep(300);
  }
  return cap ? out.slice(0, cap) : out;
}
async function getFiles(t, shopId, id) {
  const r = await fetch(ETSY_BASE + "/shops/" + shopId + "/listings/" + id + "/files", { headers: authH(t) });
  if (r.status === 404) return [];
  if (r.status === 429) return { __error: "429 quota" };
  if (!r.ok) return { __error: String(r.status) };
  return (await r.json()).results || [];
}

async function runAudit(cap) {
  const t = await getEtsyToken();
  if (!t) throw new Error("No Etsy token (oauth_tokens.platform=etsy). Re-auth at /api/etsy/auth");
  const shopId = await resolveShopId(t);
  if (!shopId) throw new Error("Could not resolve shop_id — set ETSY_SHOP_ID");
  const listings = await getAllActive(t, shopId, cap);

  const R = {
    shop_id: shopId, audited_at: new Date().toISOString(), total_listings: listings.length,
    section1_delivery_risk: [], section2_missing_files: [], section3_needs_correction: [],
    section4_revenue_risk: {}, section5_immediate_fixes: [], section6_health_score: 0,
    section7_automation: [], duplicates: [], quota_errors: 0,
  };
  const titles = {};

  for (const L of listings) {
    const id = L.listing_id, title = L.title || "", type = L.listing_type;
    const price = L.price ? L.price.amount / (L.price.divisor || 100) : null;
    const key = title.trim().toLowerCase(); (titles[key] = titles[key] || []).push(id);
    const isDigital = type === "download" || type === "both";

    if (isDigital) {
      const files = await getFiles(t, shopId, id); await sleep(200);
      if (files.__error) {
        if (files.__error.startsWith("429")) R.quota_errors++;
        R.section3_needs_correction.push({ listing_id: id, title, issue: "files check failed (" + files.__error + ")" });
      } else if (files.length === 0) {
        R.section2_missing_files.push({ listing_id: id, title, price });
        R.section1_delivery_risk.push({ listing_id: id, title, reason: "digital listing, 0 files -> will not auto-deliver" });
      } else {
        for (const f of files) {
          const e = ext(f.filename);
          if (e && !ALLOWED_EXT.includes(e)) R.section3_needs_correction.push({ listing_id: id, title, issue: "unexpected file type ." + e });
          if (f.filesize_bytes > MAX_BYTES) R.section3_needs_correction.push({ listing_id: id, title, issue: "file over 20MB: " + f.filename });
        }
      }
    } else {
      R.section3_needs_correction.push({ listing_id: id, title, issue: "listed PHYSICAL — confirm intended, else convert to digital" });
    }
    if (price === null || price <= 0) R.section3_needs_correction.push({ listing_id: id, title, issue: "bad price: " + price });
    const tags = L.tags || [];
    if (tags.length < 13) R.section3_needs_correction.push({ listing_id: id, title, issue: tags.length + "/13 tags" });
  }

  for (const [k, ids] of Object.entries(titles)) if (ids.length > 1) R.duplicates.push({ title: k, listing_ids: ids });

  const prices = listings.map(L => L.price ? L.price.amount / (L.price.divisor || 100) : 0).filter(p => p > 0);
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  R.section4_revenue_risk = {
    at_risk_listings: R.section1_delivery_risk.length, avg_price: +avg.toFixed(2),
    est_risk_per_failed_order: +avg.toFixed(2),
    note: "Each at-risk listing that takes an order = failed delivery: refund + lost review + possible Purchase-Protection case.",
  };
  let score = 100;
  score -= R.section2_missing_files.length * 4;
  score -= R.section3_needs_correction.length * 0.5;
  score -= R.duplicates.length;
  R.section6_health_score = Math.max(0, Math.round(score));

  if (R.section2_missing_files.length) R.section5_immediate_fixes.push("Attach correct deliverable + set Instant Download on " + R.section2_missing_files.length + " listing(s) with 0 files (manual: file mapping).");
  R.section5_immediate_fixes.push("Open 'In the works' orders: Shop Manager > Orders > New > Complete order > upload file.");
  if (R.quota_errors) R.section5_immediate_fixes.push("Etsy daily API quota hit on " + R.quota_errors + " listing(s) — re-run after midnight UTC reset for complete coverage.");
  R.section7_automation = [
    "Cron this endpoint daily; alert if section2_missing_files is non-empty.",
    "Publish-time guard: reject any digital listing where files.length === 0.",
    "Build slug -> hoj-assets map so a future ?fix=true can auto-attach the RIGHT file.",
    "Etsy OAuth token auto-refresh so audits never fail on expiry.",
  ];
  return R;
}

function toText(r) {
  const L = [];
  L.push("HOUSE OF JREYM — DIGITAL DELIVERY AUDIT", "shop " + r.shop_id + " · " + r.audited_at, "Total listings audited: " + r.total_listings, "");
  L.push("S1 Delivery risk: " + r.section1_delivery_risk.length);
  r.section1_delivery_risk.forEach(x => L.push("  • " + x.listing_id + " — " + x.title));
  L.push("S2 Missing files: " + r.section2_missing_files.length);
  r.section2_missing_files.forEach(x => L.push("  • " + x.listing_id + " — " + x.title));
  L.push("S3 Needs correction: " + r.section3_needs_correction.length);
  r.section3_needs_correction.slice(0, 60).forEach(x => L.push("  • " + x.listing_id + " — " + x.issue));
  L.push("S4 Revenue risk: " + r.section4_revenue_risk.at_risk_listings + " at-risk · ~$" + r.section4_revenue_risk.est_risk_per_failed_order + "/failed order");
  L.push("S5 Immediate fixes:"); r.section5_immediate_fixes.forEach(x => L.push("  • " + x));
  L.push("S6 Health score: " + r.section6_health_score + "/100");
  L.push("S7 Automation:"); r.section7_automation.forEach(x => L.push("  • " + x));
  L.push("", "Duplicates: " + r.duplicates.length + " · Quota errors: " + r.quota_errors);
  return L.join("\n");
}

auditRouter.get("/digital-delivery", async (req, res) => {
  try {
    const cap = req.query.max ? parseInt(req.query.max) : 0;
    const r = await runAudit(cap);
    if (req.query.format === "text") res.type("text/plain").send(toText(r));
    else res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
