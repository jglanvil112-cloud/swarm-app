// routes/promo.js — SWARM OS promo engine (CEO 7/10)
//
//  1) DIGITAL SECTION: ensures a "Digital Art — Instant Downloads" smart
//     collection exists on the Shopify store (auto-includes every product with
//     product_type "Digital Wall Art" — all podgen drops land there).
//     Storefront section URL: houseofjreym.store/collections/<handle>
//  2) THE DEAL: ensures discount code FREEART50 exists — spend $50, get ANY
//     one digital piece FREE (100% off one item from the digital collection,
//     minimum purchase $50).
//  3) BOOST ENGINE (IMANI): daily 15:00 UTC sales check. If the trailing
//     7-day paid revenue is under PROMO_WEEKLY_TARGET (env, default $150) and
//     no promo post ran in the last 3 days, IMANI auto-schedules a promo post
//     (IG+FB via the normal pipeline, house caption rules enforced).
//
//  Env (optional): PROMO_WEEKLY_TARGET (default "150"), PROMO_MIN_SPEND
//  (default "50"), PROMO_CODE (default "FREEART50").
//
//  Everything is idempotent — ensure runs on boot and never duplicates.

import express from "express";
import cron from "node-cron";
import { supabase, logAgent } from "../lib/supabase.js";
import { enforceCaptionRules } from "../lib/captionRules.js";

export const promoRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const PROMO_CODE = process.env.PROMO_CODE || "FREEART50";
const MIN_SPEND = process.env.PROMO_MIN_SPEND || "50";
const WEEKLY_TARGET = parseFloat(process.env.PROMO_WEEKLY_TARGET || "150");
const COLLECTION_TITLE = "Digital Art — Instant Downloads";
const DIGITAL_TYPE = "Digital Wall Art";

let promoState = { collection_id: null, collection_handle: null, price_rule_id: null, code_ok: false, last_ensure: null, last_check: null };

function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured" }); return false; }
  const k = req.headers["x-approval-key"] || req.query.key;
  if (k !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}

async function shopAuth() {
  const { data } = await supabase.from("oauth_tokens").select("access_token,shop").eq("platform", "shopify")
    .order("updated_at", { ascending: false }).limit(1);
  const s = Array.isArray(data) && data[0];
  return { token: s?.access_token || process.env.SHOPIFY_ACCESS_TOKEN, shop: (s?.shop || process.env.SHOPIFY_DOMAIN || "").replace(/^https?:\/\//, "") };
}
const base = shop => `https://${shop}/admin/api/2024-01`;
const hdrs = t => ({ "X-Shopify-Access-Token": t, "Content-Type": "application/json" });

// ── 1+2) Ensure the digital section + the deal exist (idempotent) ────────────
export async function ensurePromoAssets() {
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { ok: false, error: "no shopify auth" };

  // Smart collection: every Digital Wall Art product, automatically
  let col = null;
  const cl = await (await fetch(`${base(shop)}/smart_collections.json?title=${encodeURIComponent(COLLECTION_TITLE)}`, { headers: hdrs(token) })).json();
  col = (cl.smart_collections || [])[0] || null;
  if (!col) {
    const cr = await (await fetch(`${base(shop)}/smart_collections.json`, {
      method: "POST", headers: hdrs(token),
      body: JSON.stringify({ smart_collection: {
        title: COLLECTION_TITLE, published: true, disjunctive: false,
        body_html: "<p>Original Afrocentric digital wall art from House of Jreym — instant downloads. Every clean drop includes Classic, 3D, and Holographic editions.</p>",
        rules: [{ column: "type", relation: "equals", condition: DIGITAL_TYPE }]
      }})
    })).json();
    col = cr.smart_collection || null;
    if (col) await logAgent("IMANI", `Created storefront section "${COLLECTION_TITLE}" (/collections/${col.handle})`, "success");
  }
  if (!col) return { ok: false, error: "collection create failed" };
  promoState.collection_id = col.id; promoState.collection_handle = col.handle;

  // Price rule: spend $MIN_SPEND -> 1 item from the digital collection 100% off
  let rule = null;
  const rl = await (await fetch(`${base(shop)}/price_rules.json?limit=250`, { headers: hdrs(token) })).json();
  rule = (rl.price_rules || []).find(r => r.title === PROMO_CODE) || null;
  if (!rule) {
    const rr = await (await fetch(`${base(shop)}/price_rules.json`, {
      method: "POST", headers: hdrs(token),
      body: JSON.stringify({ price_rule: {
        title: PROMO_CODE,
        target_type: "line_item", target_selection: "entitled",
        allocation_method: "each", allocation_limit: 1,
        value_type: "percentage", value: "-100.0",
        customer_selection: "all",
        entitled_collection_ids: [col.id],
        prerequisite_to_entitlement_purchase: { prerequisite_amount: MIN_SPEND },
        prerequisite_to_entitlement_quantity_ratio: { entitled_quantity: 1 },
        starts_at: new Date().toISOString()
      }})
    })).json();
    rule = rr.price_rule || null;
    if (rule) await logAgent("IMANI", `Created deal: spend $${MIN_SPEND} → 1 free digital piece (rule ${rule.id})`, "success");
    else await logAgent("IMANI", `Price rule create failed: ${JSON.stringify(rr).slice(0, 160)}`, "error");
  }
  if (!rule) return { ok: false, error: "price rule failed", collection: col.handle };
  promoState.price_rule_id = rule.id;

  // Discount code on the rule
  const dl = await (await fetch(`${base(shop)}/price_rules/${rule.id}/discount_codes.json`, { headers: hdrs(token) })).json();
  let code = (dl.discount_codes || []).find(d => d.code === PROMO_CODE) || null;
  if (!code) {
    const dc = await (await fetch(`${base(shop)}/price_rules/${rule.id}/discount_codes.json`, {
      method: "POST", headers: hdrs(token), body: JSON.stringify({ discount_code: { code: PROMO_CODE } })
    })).json();
    code = dc.discount_code || null;
    if (code) await logAgent("IMANI", `Discount code ${PROMO_CODE} is LIVE`, "success");
  }
  promoState.code_ok = !!code;
  promoState.last_ensure = new Date().toISOString();
  return { ok: true, collection: { id: col.id, handle: col.handle, url: `houseofjreym.store/collections/${col.handle}` }, price_rule_id: rule.id, code: PROMO_CODE, deal: `Spend $${MIN_SPEND}, get 1 free digital piece` };
}

// ── Promo post (through the normal social pipeline + house caption rules) ────
async function schedulePromoPost(delayHours = 2) {
  const link = promoState.collection_handle ? `houseofjreym.store/collections/${promoState.collection_handle}` : "houseofjreym.store";
  const when = new Date(Date.now() + delayHours * 3600e3); when.setUTCMinutes(0, 0, 0);
  const caption = enforceCaptionRules(
    `DEAL ALERT 💰 Spend $${MIN_SPEND} at House of Jreym and take ANY digital art piece FREE — your pick, Classic, 3D, or Holographic edition. Original Afrocentric art, instant download, yours forever. Use code ${PROMO_CODE} at checkout. ✊🏾✨ #HouseOfJreym #AfrocentricArt #BlackArt #DigitalDownload #FreeArt #ArtDeals`,
    link
  );
  // reuse latest owned artwork already in the posting pipeline for the visual
  let imageUrl = null;
  try {
    const { data } = await supabase.from("social_posts").select("media_urls").not("media_urls", "is", null).order("created_at", { ascending: false }).limit(1);
    imageUrl = data?.[0]?.media_urls?.[0] || null;
  } catch (e) { /* non-fatal */ }
  const { data: post, error } = await supabase.from("social_posts").insert({
    platform: "all", status: "scheduled", caption,
    media_urls: imageUrl ? [imageUrl] : null, media_type: "IMAGE",
    scheduled_for: when.toISOString(), keyword: "promo-" + PROMO_CODE.toLowerCase(),
    created_by: "IMANI", meta: { pipeline: "promo-boost", code: PROMO_CODE, min_spend: MIN_SPEND }
  }).select().single();
  if (error) { await logAgent("IMANI", `Promo post insert failed: ${error.message}`, "error"); return { ok: false, error: error.message }; }
  await logAgent("IMANI", `Promo post scheduled for ${when.toISOString()} — code ${PROMO_CODE}`, "success");
  return { ok: true, id: post.id, scheduled_for: when.toISOString() };
}

// ── 3) Boost engine: run the promo when sales need a push ────────────────────
export async function checkAndBoost() {
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { ok: false, error: "no shopify auth" };
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const r = await fetch(`${base(shop)}/orders.json?status=any&financial_status=paid&created_at_min=${encodeURIComponent(since)}&limit=250&fields=total_price`, { headers: hdrs(token) });
  const j = await r.json();
  if (!r.ok) return { ok: false, error: JSON.stringify(j).slice(0, 160) };
  const revenue = (j.orders || []).reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  promoState.last_check = { at: new Date().toISOString(), revenue_7d: +revenue.toFixed(2), target: WEEKLY_TARGET };

  if (revenue >= WEEKLY_TARGET) {
    await logAgent("IMANI", `Sales check: $${revenue.toFixed(2)} / $${WEEKLY_TARGET} weekly target — no boost needed`, "info");
    return { ok: true, boosted: false, revenue_7d: +revenue.toFixed(2), target: WEEKLY_TARGET };
  }
  // below target — has a promo post gone out in the last 3 days?
  const threeDaysAgo = new Date(Date.now() - 3 * 86400e3).toISOString();
  const { data: recent } = await supabase.from("social_posts").select("id")
    .eq("keyword", "promo-" + PROMO_CODE.toLowerCase()).gte("created_at", threeDaysAgo).limit(1);
  if (recent && recent.length) {
    return { ok: true, boosted: false, reason: "promo already running (posted <3d ago)", revenue_7d: +revenue.toFixed(2) };
  }
  await logAgent("IMANI", `Sales at $${revenue.toFixed(2)} vs $${WEEKLY_TARGET} target — deploying ${PROMO_CODE} boost`, "warn");
  const post = await schedulePromoPost(2);
  return { ok: true, boosted: true, revenue_7d: +revenue.toFixed(2), target: WEEKLY_TARGET, post };
}

// ── Endpoints ────────────────────────────────────────────────────────────────
// GET /api/promo/status — public config/state view
promoRouter.get("/status", (req, res) => res.json({
  deal: `Spend $${MIN_SPEND}, get 1 FREE digital piece of choice`, code: PROMO_CODE,
  collection: promoState.collection_handle ? `houseofjreym.store/collections/${promoState.collection_handle}` : "(pending ensure)",
  weekly_target: WEEKLY_TARGET, boost_cron: "daily 15:00 UTC", state: promoState
}));
// POST /api/promo/ensure (GATED) — force-create collection + deal now
promoRouter.post("/ensure", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await ensurePromoAssets()); } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/promo/check (GATED) — run the sales check right now
promoRouter.post("/check", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await checkAndBoost()); } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/promo/post-now (GATED) — push a promo post immediately (2h slot)
promoRouter.post("/post-now", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await schedulePromoPost(req.body?.delay_hours ?? 2)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Boot: ensure section + deal exist (idempotent, waits for server/token warmup)
setTimeout(() => { ensurePromoAssets().catch(e => console.log("[promo] ensure:", e.message)); }, 25000);
// Daily boost check — 15:00 UTC (11am ET), node-cron v4 six-field pattern
cron.schedule("0 0 15 * * *", () => { checkAndBoost().catch(e => console.log("[promo] check:", e.message)); });
console.log(`[promo] armed — ${PROMO_CODE}: spend $${MIN_SPEND} → free digital piece; boost check daily 15:00 UTC`);
