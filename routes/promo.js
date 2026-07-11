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
//  4) CEO 7/11: HOJ Pets digital-only section + physical goods section split
//     away from digital; one-shot 3-piece drop off top sellers + trend.
//  5) CEO 7/11 pt2: /collections/all takeover (site catalog = physical + pet
//     digital only) + nav links for the new sections.
//  6) CEO 7/11 pt3: AISHA Etsy auto-list — every active Shopify digital drop
//     mirrors to Etsy automatically (image + download file + activate).
//
//  Env (optional): PROMO_WEEKLY_TARGET (default "150"), PROMO_MIN_SPEND
//  (default "50"), PROMO_CODE (default "FREEART50"), ETSY_SYNC_PRICE ("7.99").
//
//  Everything is idempotent — ensure runs on boot and never duplicates.

import express from "express";
import cron from "node-cron";
import { supabase, logAgent } from "../lib/supabase.js";
import { enforceCaptionRules } from "../lib/captionRules.js";
import { runPodGen } from "./podgen.js";

export const promoRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const PROMO_CODE = process.env.PROMO_CODE || "FREEART50";
const MIN_SPEND = process.env.PROMO_MIN_SPEND || "50";
const WEEKLY_TARGET = parseFloat(process.env.PROMO_WEEKLY_TARGET || "150");
const COLLECTION_TITLE = "Digital Art — Instant Downloads";
const ALL_COLLECTION_TITLE = "All Products (SWARM system)";
const PET_COLLECTION_TITLE = "HOJ Pets — Digital Art (Instant Downloads)";
const PHYSICAL_COLLECTION_TITLE = "Physical Goods — Shipped to You";
const DIGITAL_TYPE = "Digital Wall Art";
const PET_MARK = "Pet Portrait"; // pet digital drops carry this phrase in the title — that's what routes them to the pets section
const RESTOCK_QTY = parseInt(process.env.PROMO_RESTOCK_QTY || "250");
const ETSY_SHOP_URL = `https://www.etsy.com/shop/${process.env.SHOP_NAME || "HOUSEOFJREYM"}`;

let promoState = { collection_id: null, collection_handle: null, pet_collection_handle: null, physical_collection_handle: null, catalog_handle: null, nav: null, price_rule_id: null, code_ok: false, last_ensure: null, last_check: null, last_restock: null, last_drop: null, etsy_sync: null };

// Section description shown on the storefront collection page: what it is,
// the deal, and the Etsy mirror. Same brand name as the website.
const SECTION_BODY = `<p>Original Afrocentric digital wall art from House of Jreym — instant downloads. Every clean drop includes Classic, 3D, and Holographic editions.</p><p><strong>🎁 THE DEAL: spend $${MIN_SPEND}, get ANY one digital piece FREE</strong> — use code <strong>${PROMO_CODE}</strong> at checkout.</p><p>Prefer Etsy? Shop our digital originals at <a href="${ETSY_SHOP_URL}">${ETSY_SHOP_URL.replace("https://www.", "")}</a>.</p>`;
const PET_SECTION_BODY = `<p>HOJ Pets — original pet portrait digital art from House of Jreym. Instant downloads only: Classic, 3D, and Holographic editions of every clean drop.</p><p><strong>🎁 THE DEAL: spend $${MIN_SPEND}, get ANY one digital piece FREE</strong> — use code <strong>${PROMO_CODE}</strong> at checkout.</p><p>Prefer Etsy? Shop our digital originals at <a href="${ETSY_SHOP_URL}">${ETSY_SHOP_URL.replace("https://www.", "")}</a>.</p>`;
const PHYSICAL_SECTION_BODY = `<p>Wearables and physical goods from House of Jreym — made to order and shipped to you.</p><p><strong>🎁 Every $${MIN_SPEND} you spend unlocks a FREE digital art piece of your choice</strong> — use code <strong>${PROMO_CODE}</strong> at checkout.</p>`;

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
        body_html: SECTION_BODY,
        rules: [{ column: "type", relation: "equals", condition: DIGITAL_TYPE }]
      }})
    })).json();
    col = cr.smart_collection || null;
    if (col) await logAgent("IMANI", `Created storefront section "${COLLECTION_TITLE}" (/collections/${col.handle})`, "success");
  }
  if (!col) return { ok: false, error: "collection create failed" };
  promoState.collection_id = col.id; promoState.collection_handle = col.handle;

  // Keep the section description current: deal messaging + Etsy shop link
  if (!(col.body_html || "").includes(PROMO_CODE)) {
    const ur = await fetch(`${base(shop)}/smart_collections/${col.id}.json`, {
      method: "PUT", headers: hdrs(token),
      body: JSON.stringify({ smart_collection: { id: col.id, body_html: SECTION_BODY } })
    });
    if (ur.ok) await logAgent("IMANI", `Section refreshed: $${MIN_SPEND} deal + Etsy link now live on /collections/${col.handle}`, "success");
  }

  // Main digital section excludes pet art — pet pieces live ONLY in HOJ Pets (CEO 7/11)
  if (!(col.rules || []).some(r => r.column === "title" && r.relation === "not_contains")) {
    const rr2 = await fetch(`${base(shop)}/smart_collections/${col.id}.json`, {
      method: "PUT", headers: hdrs(token),
      body: JSON.stringify({ smart_collection: { id: col.id, disjunctive: false, rules: [
        { column: "type", relation: "equals", condition: DIGITAL_TYPE },
        { column: "title", relation: "not_contains", condition: PET_MARK }
      ]}})
    });
    if (rr2.ok) await logAgent("IMANI", `Main digital section now excludes "${PET_MARK}" pieces (pets get their own section)`, "info");
  }

  // HOJ Pets — pet-related digital art ONLY (CEO 7/11)
  const petCol = await ensureSmartCollection(token, shop, {
    title: PET_COLLECTION_TITLE, published: true, disjunctive: false,
    body_html: PET_SECTION_BODY,
    rules: [
      { column: "type", relation: "equals", condition: DIGITAL_TYPE },
      { column: "title", relation: "contains", condition: PET_MARK }
    ]
  });
  if (petCol) promoState.pet_collection_handle = petCol.handle;

  // Physical goods — everything that ships, separated away from the digital sections (CEO 7/11)
  const physCol = await ensureSmartCollection(token, shop, {
    title: PHYSICAL_COLLECTION_TITLE, published: true, disjunctive: false,
    body_html: PHYSICAL_SECTION_BODY,
    rules: [{ column: "type", relation: "not_equals", condition: DIGITAL_TYPE }]
  });
  if (physCol) promoState.physical_collection_handle = physCol.handle;

  // CEO 7/11 pt2: /collections/all takeover — the site's main Catalog shows
  // physical pet products + PET digital art only (disjunctive OR rules). The
  // non-pet Afrocentric art lives on its own section page + Etsy, never mixed
  // into the pet storefront's catalog again.
  const catalogCol = await ensureSmartCollection(token, shop, {
    title: "Catalog", handle: "all", published: true, disjunctive: true,
    body_html: `<p>House of Jreym pet care — grooming, comfort, and original pet portrait digital art.</p><p><strong>🎁 Every $${MIN_SPEND} you spend unlocks a FREE digital art piece</strong> — code <strong>${PROMO_CODE}</strong> at checkout.</p>`,
    rules: [
      { column: "type", relation: "not_equals", condition: DIGITAL_TYPE },
      { column: "title", relation: "contains", condition: PET_MARK }
    ]
  });
  if (catalogCol) {
    promoState.catalog_handle = catalogCol.handle;
    if (catalogCol.handle !== "all") await logAgent("IMANI", `Catalog takeover FAILED — handle "${catalogCol.handle}" (another collection owns /collections/all)`, "warn");
    else await logAgent("IMANI", `Catalog takeover live: /collections/all = physical + pet digital only (art de-mixed)`, "success");
  }

  // Nav links for the new sections (best effort — needs online-store navigation scope)
  try { promoState.nav = await ensureNavLinks(token, shop); }
  catch (e) { promoState.nav = { ok: false, error: e.message.slice(0, 120) }; }

  // Heal sold-out digital variants (failed exclusivity caps leave 0 stock and
  // the whole section shows "Sold out" — restock to the edition size).
  try { promoState.last_restock = await restockDigitalProducts(token, shop); }
  catch (e) { promoState.last_restock = { error: e.message.slice(0, 120) }; }

  // Price rule: spend $MIN_SPEND -> 1 item from the digital collection 100% off.
  // Shopify's spend-X-get-Y validator demands an ITEM prerequisite alongside the
  // quantity ratio ("item_prerequisites: must have at least one item prerequisite
  // if the prerequisite_to_entitlement_quantity_ratio is defined"), so the $50
  // spend is counted against an all-products smart collection (hidden).
  const allCol = await ensureAllProductsCollection(token, shop);
  if (!allCol) return { ok: false, error: "all-products collection failed", collection: col.handle };
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
        prerequisite_collection_ids: [allCol.id],
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

  // Free-piece entitlement covers BOTH digital sections (main + HOJ Pets)
  if (petCol && !(rule.entitled_collection_ids || []).includes(petCol.id)) {
    const eu = await fetch(`${base(shop)}/price_rules/${rule.id}.json`, {
      method: "PUT", headers: hdrs(token),
      body: JSON.stringify({ price_rule: { id: rule.id, entitled_collection_ids: [col.id, petCol.id] } })
    });
    if (eu.ok) await logAgent("IMANI", `${PROMO_CODE} free piece can now also be picked from HOJ Pets`, "info");
  }

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

// ── Generic idempotent smart-collection ensure (find by title, else create) ──
async function ensureSmartCollection(token, shop, def) {
  const cl = await (await fetch(`${base(shop)}/smart_collections.json?title=${encodeURIComponent(def.title)}`, { headers: hdrs(token) })).json();
  let col = (cl.smart_collections || [])[0] || null;
  if (!col) {
    const cr = await (await fetch(`${base(shop)}/smart_collections.json`, {
      method: "POST", headers: hdrs(token), body: JSON.stringify({ smart_collection: def })
    })).json();
    col = cr.smart_collection || null;
    if (col) await logAgent("IMANI", `Created storefront section "${def.title}" (/collections/${col.handle})`, "success");
  }
  return col;
}

// ── Hidden all-products collection (price-rule prerequisite target) ──────────
async function ensureAllProductsCollection(token, shop) {
  return ensureSmartCollection(token, shop, {
    title: ALL_COLLECTION_TITLE, published: false, disjunctive: false,
    rules: [{ column: "variant_price", relation: "greater_than", condition: "0" }]
  });
}

// ── Nav: append "Digital Art" + "HOJ Pets" links to the main menu (GraphQL) ──
// Best effort: if the Shopify token lacks the online-store navigation scope,
// this logs a warning and the links get added by hand in admin instead.
const NAV_LINKS = [
  { title: "Digital Art", url: "/collections/digital-art-instant-downloads" },
  { title: "HOJ Pets", url: "/collections/hoj-pets-digital-art-instant-downloads" }
];
async function ensureNavLinks(token, shop) {
  const gql = async (query, variables) => (await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
    method: "POST", headers: hdrs(token), body: JSON.stringify({ query, variables })
  })).json();
  const q = await gql(`{ menus(first: 25) { nodes { id handle title items { id title type url resourceId items { id title type url resourceId } } } } }`);
  const menus = q?.data?.menus?.nodes || [];
  if (!menus.length) return { ok: false, error: (q?.errors?.[0]?.message || "no menus (missing navigation scope?)").slice(0, 140) };
  const menu = menus.find(m => m.handle === "main-menu") || menus[0];
  const have = new Set((menu.items || []).map(i => (i.url || i.title || "").toLowerCase()));
  const missing = NAV_LINKS.filter(l => !have.has(l.url.toLowerCase()) && !have.has(l.title.toLowerCase()));
  if (!missing.length) return { ok: true, added: 0, menu: menu.handle };
  const strip = it => {
    const o = { id: it.id, title: it.title, type: it.type };
    if (it.url) o.url = it.url;
    if (it.resourceId) o.resourceId = it.resourceId;
    if (it.items && it.items.length) o.items = it.items.map(strip);
    return o;
  };
  const items = (menu.items || []).map(strip).concat(missing.map(l => ({ title: l.title, type: "HTTP", url: l.url })));
  const m = await gql(
    `mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
       menuUpdate(id: $id, title: $title, items: $items) { menu { id } userErrors { field message } } }`,
    { id: menu.id, title: menu.title, items }
  );
  const errs = m?.data?.menuUpdate?.userErrors || [];
  if (m?.errors?.length || errs.length) {
    const msg = (m?.errors?.[0]?.message || errs[0]?.message || "unknown").slice(0, 140);
    await logAgent("IMANI", `Nav menu update failed (${msg}) — add links manually: Online Store → Navigation → Main menu`, "warn");
    return { ok: false, error: msg };
  }
  await logAgent("IMANI", `Nav menu updated: added ${missing.map(l => l.title).join(" + ")} to ${menu.handle}`, "success");
  return { ok: true, added: missing.length, menu: menu.handle };
}

// ── AISHA Etsy auto-list: every Shopify digital drop mirrors to Etsy ─────────
// Cron (every 2h at :10) + boot tick. For each ACTIVE "Digital Wall Art"
// product with no Etsy twin yet: create draft listing → upload the art as the
// listing image AND as the digital download file → activate. Latch per product
// via agent_logs "ETSYSYNC:<shopify_id>" so nothing ever lists twice.
const ETSY_KEY2 = process.env.ETSY_KEY || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET2 = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID2 = parseInt(process.env.ETSY_SHOP_ID) || 66171116;
const ETSY_BASE2 = "https://openapi.etsy.com/v3/application";
const ETSY_PRICE = parseFloat(process.env.ETSY_SYNC_PRICE || "7.99");
const eAuth = t => ({ Authorization: "Bearer " + t, "x-api-key": ETSY_KEY2 + (ETSY_SECRET2 ? ":" + ETSY_SECRET2 : ""), "Content-Type": "application/json" });

async function getEtsyAccessToken() {
  try {
    const { data } = await supabase.from("oauth_tokens").select("access_token,expires_at").eq("platform", "etsy").single();
    if (data?.access_token && (!data.expires_at || new Date(data.expires_at) > new Date(Date.now() + 60000))) return data.access_token;
  } catch (e) { /* fall through */ }
  return null; // expired/missing — the Etsy drip jobs refresh it; next tick picks it up
}

async function etsyMultipart(t, path, field, buf, fname, mime, extra = {}) {
  const boundary = "----HoJSync" + Math.random().toString(36).slice(2);
  const parts = [`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fname}"\r\nContent-Type: ${mime}\r\n\r\n`, buf];
  for (const [k, v] of Object.entries(extra)) parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}`);
  parts.push(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));
  const r = await fetch(ETSY_BASE2 + path, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length.toString(), Authorization: "Bearer " + t, "x-api-key": ETSY_KEY2 + (ETSY_SECRET2 ? ":" + ETSY_SECRET2 : "") },
    body
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

async function etsySyncTick(maxPerTick = 3) {
  const out = { listed: 0, checked: 0, at: new Date().toISOString() };
  if (!ETSY_SHOP_ID2) return { ...out, error: "no ETSY_SHOP_ID" };
  const et = await getEtsyAccessToken();
  if (!et) return { ...out, error: "no fresh etsy token (drips will refresh)" };
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { ...out, error: "no shopify auth" };

  const pr = await fetch(`${base(shop)}/products.json?product_type=${encodeURIComponent(DIGITAL_TYPE)}&status=active&limit=250&fields=id,title,body_html,tags,image`, { headers: hdrs(token) });
  const pj = await pr.json();
  if (!pr.ok) return { ...out, error: JSON.stringify(pj).slice(0, 120) };
  const products = pj.products || [];
  out.checked = products.length;

  const { data: logs } = await supabase.from("agent_logs").select("message").like("message", "ETSYSYNC:%").limit(1000);
  const synced = new Set((logs || []).map(l => (l.message.match(/^ETSYSYNC:(\d+)/) || [])[1]).filter(Boolean));
  const todo = products.filter(p => !synced.has(String(p.id)) && p.image?.src).slice(0, maxPerTick);
  if (!todo.length) return out;

  let returnPolicyId = 1;
  try {
    const rp = await (await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/return-policies`, { headers: eAuth(et) })).json();
    const pol = rp.results || rp;
    if (Array.isArray(pol) && pol.length) returnPolicyId = pol[0].return_policy_id; else if (pol.return_policy_id) returnPolicyId = pol.return_policy_id;
  } catch (e) { /* default stands */ }

  for (const p of todo) {
    try {
      const desc = String(p.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000)
        + "\n\nInstant digital download — no physical item is shipped. For personal use only.";
      const tags = String(p.tags || "").split(",").map(x => x.trim().slice(0, 20)).filter(Boolean).slice(0, 13);
      const cr = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings`, {
        method: "POST", headers: eAuth(et),
        body: JSON.stringify({ title: String(p.title).slice(0, 140), description: desc, price: ETSY_PRICE, quantity: 999, who_made: "i_did", when_made: (process.env.ETSY_WHEN_MADE || "2020_2026"), is_supply: false, taxonomy_id: 2078, tags, state: "draft", type: "download", is_digital: true })
      });
      const listing = await cr.json();
      if (!cr.ok || !listing.listing_id) { await logAgent("AISHA", `Etsy auto-list create failed for ${p.id}: ${JSON.stringify(listing).slice(0, 120)}`, "error"); continue; }
      const lid = listing.listing_id;

      // artwork bytes = listing image + digital download file
      const imgRes = await fetch(p.image.src, { signal: AbortSignal.timeout(30000) });
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const mime = imgRes.headers.get("content-type") || "image/jpeg";
        const ext = mime.includes("png") ? "png" : "jpg";
        const iu = await etsyMultipart(et, `/shops/${ETSY_SHOP_ID2}/listings/${lid}/images`, "image", buf, `hoj_${lid}.${ext}`, mime, { rank: "1" });
        if (!iu.ok) await logAgent("AISHA", `Etsy image upload failed for ${lid} (${iu.status})`, "warn");
        const fu = await etsyMultipart(et, `/shops/${ETSY_SHOP_ID2}/listings/${lid}/files`, "file", buf, `HOJ-full-res.${ext}`, mime, { name: `HOJ-full-res.${ext}`, rank: "1" });
        if (!fu.ok) await logAgent("AISHA", `Etsy file attach failed for ${lid} (${fu.status})`, "warn");
      }

      const act = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings/${lid}`, { method: "PATCH", headers: eAuth(et), body: JSON.stringify({ state: "active", return_policy_id: returnPolicyId }) });
      const actD = await act.json().catch(() => ({}));
      const live = act.ok && actD.state === "active";
      await logAgent("AISHA", `ETSYSYNC:${p.id} → ${lid} ${live ? "ACTIVE" : "draft (activate failed)"} — ${String(p.title).slice(0, 60)}`, live ? "success" : "warn");
      if (live) out.listed++;
      await new Promise(r => setTimeout(r, 400)); // rate-limit breathing room
    } catch (e) { await logAgent("AISHA", `Etsy auto-list error for ${p.id}: ${e.message.slice(0, 100)}`, "error"); }
  }
  if (out.listed) await logAgent("AISHA", `Etsy auto-list tick: ${out.listed} new listing(s) live at $${ETSY_PRICE}`, "success");
  return out;
}

// ── CEO 7/11 one-shot: 3-piece drop off top sellers + freshest trend ─────────
// Fires ONCE (agent_logs marker is the latch), 40s after boot. Each piece runs
// the full podgen loop: fal.ai gen → vision IP gate → Shopify product with 3
// edition images (Classic/3D/Holographic) → 250-unit cap → auto buy-link post.
// Theme 1 seeds the HOJ Pets section ("Pet Portrait" in the title routes it).
const DROP_MARKER = "CEO drop 2026-07-11: 3-piece top-seller/trend batch fired";
async function fireCeoDropOnce() {
  try {
    const { data, error } = await supabase.from("agent_logs").select("id").eq("message", DROP_MARKER).limit(1);
    if (error || (data && data.length)) return; // already fired (or can't verify — don't risk duplicates)
  } catch (e) { return; }
  await logAgent("IMANI", DROP_MARKER, "info"); // latch BEFORE generating
  const themes = ["Regal Pet Portrait — crowned royal dog", "Black Excellence", "Black Art History Portrait"];
  try { // slot 2 upgrades to NANA's freshest trend keyword when available
    const { data: t } = await supabase.from("tasks").select("result").eq("task_type", "trend_research")
      .eq("status", "completed").order("updated_at", { ascending: false }).limit(1);
    const kw = (t?.[0]?.result?.trends || []).map(x => (typeof x === "string" ? x : x?.keyword))
      .find(k => typeof k === "string" && k.trim());
    if (kw) themes[1] = kw.trim();
  } catch (e) { /* fallback theme stands */ }
  const styles = ["art", "design", "design"];
  let made = 0;
  for (let i = 0; i < themes.length; i++) {
    try { const r = await runPodGen({ theme: themes[i], style: styles[i] }); if (r?.productId) made++; }
    catch (e) { console.log("[promo drop]", e.message); }
  }
  promoState.last_drop = { at: new Date().toISOString(), made, themes };
  await logAgent("IMANI", `CEO 3-piece drop done: ${made}/3 created (${themes.join(" | ")}) — 3 editions each, 250-cap, buy-link posts scheduled`, made ? "success" : "warn");
}

// ── Restock sweep: no digital product may ever read "Sold out" ───────────────
// The limited-edition cap (KWAME) enables tracking then sets stock to 250; when
// the set step fails the variant is left tracked at 0 and the storefront shows
// "Sold out". This sweep finds tracked digital variants at <=0 and restores the
// edition size. Idempotent; runs inside ensurePromoAssets.
async function restockDigitalProducts(token, shop, qty = RESTOCK_QTY) {
  const out = { checked: 0, restocked: 0, failed: 0, at: new Date().toISOString() };
  const pr = await fetch(`${base(shop)}/products.json?product_type=${encodeURIComponent(DIGITAL_TYPE)}&limit=250&fields=id,variants`, { headers: hdrs(token) });
  const pj = await pr.json();
  if (!pr.ok) return { ...out, error: JSON.stringify(pj).slice(0, 120) };
  const items = [];
  for (const p of pj.products || []) for (const v of p.variants || [])
    if (v.inventory_management === "shopify" && v.inventory_item_id) items.push(v.inventory_item_id);
  out.checked = items.length;
  if (!items.length) return out;

  const levels = [];
  for (let i = 0; i < items.length; i += 50) {
    const lr = await fetch(`${base(shop)}/inventory_levels.json?inventory_item_ids=${items.slice(i, i + 50).join(",")}&limit=250`, { headers: hdrs(token) });
    const lj = await lr.json();
    if (lr.ok) levels.push(...(lj.inventory_levels || []));
  }
  const byItem = new Map();
  for (const l of levels) if (!byItem.has(l.inventory_item_id)) byItem.set(l.inventory_item_id, l);
  let locId = levels.find(l => l.location_id)?.location_id || null;
  if (!locId) {
    const locJ = await (await fetch(`${base(shop)}/locations.json`, { headers: hdrs(token) })).json();
    locId = locJ.locations?.[0]?.id || null;
  }
  if (!locId) return { ...out, error: "no location" };

  for (const item of items) {
    const lvl = byItem.get(item);
    if (lvl && lvl.available !== null && lvl.available > 0) continue; // healthy
    try {
      if (!lvl) await fetch(`${base(shop)}/inventory_levels/connect.json`, { method: "POST", headers: hdrs(token), body: JSON.stringify({ location_id: locId, inventory_item_id: item }) });
      const sr = await fetch(`${base(shop)}/inventory_levels/set.json`, { method: "POST", headers: hdrs(token), body: JSON.stringify({ location_id: lvl?.location_id || locId, inventory_item_id: item, available: qty }) });
      sr.ok ? out.restocked++ : out.failed++;
    } catch (e) { out.failed++; }
  }
  if (out.restocked || out.failed)
    await logAgent("IMANI", `Digital restock sweep: ${out.restocked} sold-out variant(s) back to ${qty}${out.failed ? `, ${out.failed} failed` : ""}`, out.failed ? "warn" : "success");
  return out;
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
  pets_collection: promoState.pet_collection_handle ? `houseofjreym.store/collections/${promoState.pet_collection_handle}` : "(pending ensure)",
  physical_collection: promoState.physical_collection_handle ? `houseofjreym.store/collections/${promoState.physical_collection_handle}` : "(pending ensure)",
  etsy_shop: ETSY_SHOP_URL,
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

// Boot: ensure section + deal exist (idempotent, waits for server/token warmup).
// Retries every 5 min (up to 4 tries) so a cold token or Shopify hiccup at boot
// can't leave the deal dead until the next deploy.
const bootEnsure = async (attempt = 1) => {
  try {
    const r = await ensurePromoAssets();
    if (!r.ok && attempt < 4) setTimeout(() => bootEnsure(attempt + 1), 300000);
    else if (!r.ok) console.log("[promo] ensure gave up:", r.error);
  } catch (e) {
    console.log("[promo] ensure:", e.message);
    if (attempt < 4) setTimeout(() => bootEnsure(attempt + 1), 300000);
  }
};
setTimeout(() => bootEnsure(), 25000);
// One-shot CEO drop (latched — safe across restarts/redeploys)
setTimeout(() => { fireCeoDropOnce().catch(e => console.log("[promo drop]", e.message)); }, 40000);
// Etsy auto-list: boot tick at 6 min (after the drop finishes), then every 2h at :10
setTimeout(() => { etsySyncTick().then(r => { promoState.etsy_sync = r; }).catch(e => console.log("[etsy sync]", e.message)); }, 360000);
cron.schedule("0 10 */2 * * *", () => {
  etsySyncTick().then(r => { promoState.etsy_sync = r; }).catch(e => console.log("[etsy sync]", e.message));
});
// Daily 15:00 UTC (11am ET): re-ensure assets (self-heal restocks/deal), then boost check
cron.schedule("0 0 15 * * *", () => {
  ensurePromoAssets().catch(e => console.log("[promo] ensure:", e.message))
    .then(() => checkAndBoost()).catch(e => console.log("[promo] check:", e.message));
});
console.log(`[promo] armed — ${PROMO_CODE}: spend $${MIN_SPEND} → free digital piece; boost check daily 15:00 UTC`);
