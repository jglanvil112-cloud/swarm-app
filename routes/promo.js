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
// Broader pet-title matcher (CEO 7/15): catches every pet-art variant so none
// slips onto Etsy or out of the pet section. Portrait-scoped + paw emoji only,
// so it never false-matches general art that merely mentions a pet in passing.
const PET_TITLE_RE = /pet portrait|dog portrait|cat portrait|puppy portrait|kitten portrait|🐾/i;
const isPetTitle = s => PET_TITLE_RE.test(String(s || ""));
// CEO 7/15: strip the word "Magic" from all public-facing text (titles/tags/desc)
// on both the pet store and Etsy. "Black Girl Magic"/"Melanin Magic" are remapped.
const MAGIC_RE = /\bmagical\b|\bmagic\b/i;
const scrubMagic = s => String(s || "")
  .replace(/black girl magic/gi, "Black Girl Power").replace(/melanin magic/gi, "Melanin")
  .replace(/\bmagical\b/gi, "").replace(/\bmagic\b/gi, "")
  .replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/,\s*,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").trim();
const hasMagic = s => MAGIC_RE.test(String(s || ""));
// Description-safe scrubs: same word remaps, but no whitespace/punctuation
// collapsing — preserves HTML markup (Shopify body_html) and paragraph
// newlines (Etsy descriptions).
const scrubMagicDesc = s => String(s || "")
  .replace(/black girl magic/gi, "Black Girl Power").replace(/melanin magic/gi, "Melanin")
  .replace(/\bmagical\b/gi, "").replace(/\bmagic\b/gi, "")
  .replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.])/g, "$1");
const RESTOCK_QTY = parseInt(process.env.PROMO_RESTOCK_QTY || "250");
const ETSY_SHOP_URL = `https://www.etsy.com/shop/${process.env.SHOP_NAME || "HOUSEOFJREYM"}`;

let promoState = { collection_id: null, collection_handle: null, pet_collection_handle: null, physical_collection_handle: null, catalog_handle: null, nav: null, price_rule_id: null, code_ok: false, last_ensure: null, last_check: null, last_restock: null, last_drop: null, etsy_sync: null, last_motion: null, floor: null, last_pet_promo: null };

// Section description shown on the storefront collection page: what it is,
// the deal, and the Etsy mirror. Same brand name as the website.
// BODY_MARK versions the descriptions — bump it and every section refreshes on
// the next ensure. v3 adds the cross-section link buttons (CEO 7/11).
const BODY_MARK = "<!-- hoj-v4 -->";
const SECTION_BUTTONS = `<p><a href="/collections/digital-art-instant-downloads"><strong>🎨 DIGITAL ART →</strong></a> &nbsp;|&nbsp; <a href="/collections/hoj-pets-digital-art-instant-downloads"><strong>🐾 PET ART DOWNLOADS →</strong></a> &nbsp;|&nbsp; <a href="/collections/all"><strong>🛒 PET SUPPLIES →</strong></a></p>`;
const SECTION_BODY = `${BODY_MARK}${SECTION_BUTTONS}<p>Original digital wall art from House of Jreym — instant downloads. Every clean drop includes Classic, 3D, and Holographic editions plus room-scene previews.</p><p><strong>🎁 THE DEAL: spend $${MIN_SPEND}, get ANY one digital piece FREE</strong> — use code <strong>${PROMO_CODE}</strong> at checkout.</p><p>Prefer Etsy? Shop our digital originals at <a href="${ETSY_SHOP_URL}">${ETSY_SHOP_URL.replace("https://www.", "")}</a>.</p>`;
const PET_SECTION_BODY = `${BODY_MARK}${SECTION_BUTTONS}<p>HOJ Pets — original dog & pet portrait digital art from House of Jreym. Instant downloads only: Classic, 3D, and Holographic editions of every clean drop, with room-scene previews.</p><p><strong>🎁 THE DEAL: spend $${MIN_SPEND}, get ANY one digital piece FREE</strong> — use code <strong>${PROMO_CODE}</strong> at checkout.</p><p>Prefer Etsy? Shop our digital originals at <a href="${ETSY_SHOP_URL}">${ETSY_SHOP_URL.replace("https://www.", "")}</a>.</p>`;
const PHYSICAL_SECTION_BODY = `${BODY_MARK}${SECTION_BUTTONS}<p>Wearables and physical goods from House of Jreym — made to order and shipped to you.</p><p><strong>🎁 Every $${MIN_SPEND} you spend unlocks a FREE digital art piece of your choice</strong> — use code <strong>${PROMO_CODE}</strong> at checkout.</p>`;
const CATALOG_BODY = `${BODY_MARK}${SECTION_BUTTONS}<p>House of Jreym pet supplies — grooming, comfort & care products, shipped to you. <strong>Looking for our pet portrait art?</strong> Those are instant downloads in the <a href="/collections/hoj-pets-digital-art-instant-downloads">🐾 PET ART DOWNLOADS</a> section — kept separate from these physical items.</p><p><strong>🎁 Every $${MIN_SPEND} you spend unlocks a FREE digital art piece of your choice</strong> — code <strong>${PROMO_CODE}</strong> at checkout.</p>`;

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

  // Keep the section description current (versioned via BODY_MARK)
  if (!(col.body_html || "").includes(BODY_MARK)) {
    const ur = await fetch(`${base(shop)}/smart_collections/${col.id}.json`, {
      method: "PUT", headers: hdrs(token),
      body: JSON.stringify({ smart_collection: { id: col.id, body_html: SECTION_BODY } })
    });
    if (ur.ok) await logAgent("IMANI", `Section refreshed: deal + Etsy link + section buttons live on /collections/${col.handle}`, "success");
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

  // CEO 7/15: /collections/all is the ITEM catalog — PHYSICAL products ONLY.
  // Digital pet art is a separate downloadable section (HOJ Pets), no longer
  // mixed into the item listings. Non-pet art lives on its own page + Etsy.
  const catalogCol = await ensureSmartCollection(token, shop, {
    title: "Catalog", handle: "all", published: true, disjunctive: false,
    body_html: CATALOG_BODY,
    rules: [{ column: "type", relation: "not_equals", condition: DIGITAL_TYPE }]
  });
  if (catalogCol) {
    promoState.catalog_handle = catalogCol.handle;
    // If an older catalog still carries the pet-digital OR-rule (or is disjunctive),
    // rewrite it to physical-only so downloads aren't mixed into the item section.
    const stillMixed = catalogCol.disjunctive || (catalogCol.rules || []).some(r => r.column === "title" && r.relation === "contains" && r.condition === PET_MARK);
    if (stillMixed) {
      const cu = await fetch(`${base(shop)}/smart_collections/${catalogCol.id}.json`, {
        method: "PUT", headers: hdrs(token),
        body: JSON.stringify({ smart_collection: { id: catalogCol.id, disjunctive: false, rules: [{ column: "type", relation: "not_equals", condition: DIGITAL_TYPE }] } })
      });
      if (cu.ok) await logAgent("IMANI", "Item catalog de-mixed: /collections/all = physical products only (digital pet art moved to its own PET ART DOWNLOADS section)", "success");
    }
    if (catalogCol.handle !== "all") await logAgent("IMANI", `Catalog takeover FAILED — handle "${catalogCol.handle}" (another collection owns /collections/all)`, "warn");
    else await logAgent("IMANI", `Item catalog live: /collections/all = physical items only; pet downloads in their own section`, "success");
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
// Also refreshes an existing collection's description when BODY_MARK is stale.
async function ensureSmartCollection(token, shop, def) {
  const cl = await (await fetch(`${base(shop)}/smart_collections.json?title=${encodeURIComponent(def.title)}`, { headers: hdrs(token) })).json();
  let col = (cl.smart_collections || [])[0] || null;
  if (!col) {
    const cr = await (await fetch(`${base(shop)}/smart_collections.json`, {
      method: "POST", headers: hdrs(token), body: JSON.stringify({ smart_collection: def })
    })).json();
    col = cr.smart_collection || null;
    if (col) await logAgent("IMANI", `Created storefront section "${def.title}" (/collections/${col.handle})`, "success");
  } else if (def.body_html && def.body_html.includes(BODY_MARK) && !(col.body_html || "").includes(BODY_MARK)) {
    const ur = await fetch(`${base(shop)}/smart_collections/${col.id}.json`, {
      method: "PUT", headers: hdrs(token),
      body: JSON.stringify({ smart_collection: { id: col.id, body_html: def.body_html } })
    });
    if (ur.ok) await logAgent("IMANI", `Section description refreshed on /collections/${col.handle}`, "info");
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
  { title: "Pet Art Downloads", url: "/collections/hoj-pets-digital-art-instant-downloads" },
  { title: "Pet Supplies", url: "/collections/all" }
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
// Boot tick + HOURLY cron at :20. For each ACTIVE "Digital Wall Art" product
// with no Etsy twin yet: create draft listing → upload up to 4 preview pics
// (editions + room scenes) → attach the art as the digital download file →
// activate. Latch per product via agent_logs "ETSYSYNC:<shopify_id>" so
// nothing ever lists twice.
const ETSY_KEY2 = process.env.ETSY_KEY || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET2 = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID2 = parseInt(process.env.ETSY_SHOP_ID) || 66171116;
const ETSY_BASE2 = "https://openapi.etsy.com/v3/application";
const ETSY_PRICE = parseFloat(process.env.ETSY_SYNC_PRICE || "7.99");
const eAuth = t => ({ Authorization: "Bearer " + t, "x-api-key": ETSY_KEY2 + (ETSY_SECRET2 ? ":" + ETSY_SECRET2 : ""), "Content-Type": "application/json" });

async function getEtsyAccessToken() {
  try {
    const { data } = await supabase.from("oauth_tokens").select("access_token,refresh_token,expires_at").eq("platform", "etsy").single();
    if (data?.access_token && (!data.expires_at || new Date(data.expires_at) > new Date(Date.now() + 60000))) return data.access_token;
    // Self-heal (CEO 7/11): refresh expired tokens right here instead of waiting
    // for the Etsy drip jobs — no tick ever skips for a stale token.
    const rt = data?.refresh_token || process.env.ETSY_REFRESH_TOKEN;
    if (rt) {
      const r = await fetch("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: ETSY_KEY2, refresh_token: rt })
      });
      const d = await r.json();
      if (d.access_token) {
        await supabase.from("oauth_tokens").upsert({ platform: "etsy", access_token: d.access_token, refresh_token: d.refresh_token || rt, expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "platform" });
        return d.access_token;
      }
    }
  } catch (e) { /* fall through */ }
  return null;
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

async function etsySyncTick(maxPerTick = 4) {
  const out = { listed: 0, checked: 0, at: new Date().toISOString() };
  if (!ETSY_SHOP_ID2) return { ...out, error: "no ETSY_SHOP_ID" };
  const et = await getEtsyAccessToken();
  if (!et) return { ...out, error: "no fresh etsy token (refresh failed)" };
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { ...out, error: "no shopify auth" };

  const pr = await fetch(`${base(shop)}/products.json?product_type=${encodeURIComponent(DIGITAL_TYPE)}&status=active&limit=250&fields=id,title,body_html,tags,image,images`, { headers: hdrs(token) });
  const pj = await pr.json();
  if (!pr.ok) return { ...out, error: JSON.stringify(pj).slice(0, 120) };
  const products = pj.products || [];
  out.checked = products.length;

  const { data: logs } = await supabase.from("agent_logs").select("message").like("message", "ETSYSYNC:%").limit(1000);
  const synced = new Set((logs || []).map(l => (l.message.match(/^ETSYSYNC:(\d+)/) || [])[1]).filter(Boolean));
  // CEO 7/15: Etsy carries the GENERAL art gallery only. Pet portraits live ONLY
  // on the HOJ pet storefront — never mirror a pet piece to Etsy.
  const isPet = p => isPetTitle(p.title) || isPetTitle(p.tags);
  out.skipped_pet = products.filter(isPet).length;
  const todo = products.filter(p => !synced.has(String(p.id)) && p.image?.src && !isPet(p)).slice(0, maxPerTick);
  if (!todo.length) return out;

  let returnPolicyId = 1;
  try {
    const rp = await (await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/return-policies`, { headers: eAuth(et) })).json();
    const pol = rp.results || rp;
    if (Array.isArray(pol) && pol.length) returnPolicyId = pol[0].return_policy_id; else if (pol.return_policy_id) returnPolicyId = pol.return_policy_id;
  } catch (e) { /* default stands */ }

  for (const p of todo) {
    try {
      const desc = scrubMagic(String(p.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000))
        + "\n\nInstant digital download — no physical item is shipped. For personal use only.";
      // Etsy tag rules: letters/numbers/spaces/hyphens only — strip em-dashes & symbols.
      // CEO 7/15: scrub the word "Magic" out of every tag before it's listed.
      const tags = [...new Set(scrubMagic(String(p.tags || "")).split(",")
        .map(x => scrubMagic(x).replace(/[^A-Za-z0-9' -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20).trim())
        .filter(x => x.length > 1))].slice(0, 13);
      const cr = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings`, {
        method: "POST", headers: eAuth(et),
        body: JSON.stringify({ title: scrubMagic(String(p.title)).slice(0, 140), description: desc, price: ETSY_PRICE, quantity: 999, who_made: "i_did", when_made: (process.env.ETSY_WHEN_MADE || "2020_2026"), is_supply: false, taxonomy_id: 2078, tags, state: "draft", type: "download", is_digital: true })
      });
      const listing = await cr.json();
      if (!cr.ok || !listing.listing_id) { await logAgent("AISHA", `Etsy auto-list create failed for ${p.id}: ${JSON.stringify(listing).slice(0, 120)}`, "error"); continue; }
      const lid = listing.listing_id;

      // Upload up to 4 preview pics (editions + room scenes) — first doubles as the download file
      const srcs = (p.images && p.images.length ? p.images.map(im => im.src) : [p.image.src]).filter(Boolean).slice(0, 4);
      for (let i = 0; i < srcs.length; i++) {
        try {
          const imgRes = await fetch(srcs[i], { signal: AbortSignal.timeout(30000) });
          if (!imgRes.ok) continue;
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const mime = imgRes.headers.get("content-type") || "image/jpeg";
          const ext = mime.includes("png") ? "png" : "jpg";
          const iu = await etsyMultipart(et, `/shops/${ETSY_SHOP_ID2}/listings/${lid}/images`, "image", buf, `hoj_${lid}_${i + 1}.${ext}`, mime, { rank: String(i + 1) });
          if (!iu.ok) await logAgent("AISHA", `Etsy image ${i + 1} upload failed for ${lid} (${iu.status})`, "warn");
          if (i === 0) {
            const fu = await etsyMultipart(et, `/shops/${ETSY_SHOP_ID2}/listings/${lid}/files`, "file", buf, `HOJ-full-res.${ext}`, mime, { name: `HOJ-full-res.${ext}`, rank: "1" });
            if (!fu.ok) await logAgent("AISHA", `Etsy file attach failed for ${lid} (${fu.status})`, "warn");
          }
          await new Promise(r => setTimeout(r, 250));
        } catch (e) { /* image optional — listing still activates */ }
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

// ── IMANI Motion Studio (CEO 7/12): daily AI video, DIFFERENT piece per page ──
// Every day at 16:30 UTC (12:30pm ET): pick two different recent art pieces,
// animate each with fal.ai image-to-video (slow cinematic push-in, no people),
// then schedule an Instagram REEL with one piece and a Facebook video with the
// other — so the pages never show the same thing. Latched per day.
const FAL_KEY2 = process.env.FAL_KEY || process.env.FAL_AI_KEY || "";
// Seedance (ByteDance — the CapCut AI family) via fal, forced HD (CEO 7/12)
const MOTION_MODEL = process.env.MOTION_MODEL || "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";

async function falVideo(imageUrl, prompt) {
  if (!FAL_KEY2) throw new Error("FAL_KEY missing");
  const auth = { Authorization: `Key ${FAL_KEY2}`, "Content-Type": "application/json" };
  const sub = await fetch(`https://queue.fal.run/${MOTION_MODEL}`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ prompt, image_url: imageUrl, duration: "5", resolution: "1080p", aspect_ratio: "9:16" })
  });
  const j = await sub.json();
  if (!j.request_id) throw new Error("fal video submit failed: " + JSON.stringify(j).slice(0, 140));
  const statusUrl = j.status_url || `https://queue.fal.run/${MOTION_MODEL}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${MOTION_MODEL}/requests/${j.request_id}`;
  for (let i = 0; i < 96; i++) { // videos render slowly — up to ~8 min
    await new Promise(r => setTimeout(r, 5000));
    const st = await (await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY2}` } })).json();
    if (st.status === "COMPLETED") break;
    if (st.status === "FAILED" || st.status === "ERROR") throw new Error("fal video generation failed");
  }
  const out = await (await fetch(respUrl, { headers: { Authorization: `Key ${FAL_KEY2}` } })).json();
  const url = out.video?.url || out.video_url || out.videos?.[0]?.url;
  if (!url) throw new Error("fal video: no url in result");
  // HD quality check: a real 1080p clip is multi-MB — tiny/failed renders never post
  try {
    const head = await fetch(url, { method: "HEAD" });
    const bytes = parseInt(head.headers.get("content-length") || "0");
    if (bytes && bytes < 400000) throw new Error(`video too small (${Math.round(bytes / 1024)}KB) — failed HD check`);
  } catch (e) { if (/HD check/.test(e.message)) throw e; /* HEAD unsupported — let it pass */ }
  return url;
}

async function motionTick() {
  const day = new Date().toISOString().slice(0, 10);
  const MARK = "MOTION:" + day;
  try {
    const { data, error } = await supabase.from("agent_logs").select("id").eq("message", MARK).limit(1);
    if (error || (data && data.length)) return { skipped: "already ran today" };
  } catch (e) { return { skipped: "latch check failed" }; }
  await logAgent("IMANI", MARK, "info"); // latch before spending

  const { token, shop } = await shopAuth();
  if (!token || !shop) return { error: "no shopify auth" };
  const pr = await fetch(`${base(shop)}/products.json?product_type=${encodeURIComponent(DIGITAL_TYPE)}&status=active&limit=50&fields=id,title,handle,image`, { headers: hdrs(token) });
  const pj = await pr.json();
  const pool = (pj.products || []).filter(p => p.image?.src);
  if (pool.length < 2) return { error: "not enough art with images" };

  // rotate through the catalog by day so the pair is fresh every day
  const dayIdx = Math.floor(Date.now() / 86400000);
  const pick = [pool[dayIdx % pool.length], pool[(dayIdx + 7) % pool.length]];
  if (pick[0].id === pick[1].id) pick[1] = pool[(dayIdx + 1) % pool.length];

  const motionPrompt = "Slow cinematic camera push-in on this frameless wall artwork, subtle parallax and depth, gentle warm light shift, elegant gallery ambience. No picture frame, no people, no humans, no hands, no text or captions.";
  const results = [];
  const plans = [
    { p: pick[0], platform: "instagram", media_type: "REEL", meta: { pipeline: "motion", is_reel: true },
      cap: t => `This piece MOVES 🎬 "${t}" — original wall art brought to life. Own it as an instant digital download in Classic, 3D & Holographic editions.` },
    { p: pick[1], platform: "facebook", media_type: "VIDEO", meta: { pipeline: "motion" },
      cap: t => `Watch "${t}" come alive on the wall 🖼️ Original art, instant digital download — Classic, 3D & Holographic editions included.` }
  ];
  for (const plan of plans) {
    try {
      const title = String(plan.p.title).split("—")[0].trim();
      const videoUrl = await falVideo(plan.p.image.src, motionPrompt);
      const link = `houseofjreym.store/products/${plan.p.handle}`;
      const caption = enforceCaptionRules(`${plan.cap(title)} 🛍 ${link}\n\n#HouseOfJreym #WallArt #DigitalDownload #3DArt #HolographicArt`, link);
      const when = new Date(Date.now() + 10 * 60000);
      const { error } = await supabase.from("social_posts").insert({
        platform: plan.platform, status: "scheduled", caption,
        media_urls: [videoUrl], media_type: plan.media_type,
        scheduled_for: when.toISOString(), keyword: "motion-" + day + "-" + plan.platform,
        created_by: "IMANI", meta: { ...plan.meta, product_id: plan.p.id }
      });
      if (error) throw new Error(error.message);
      results.push({ platform: plan.platform, product: title, ok: true });
      await logAgent("IMANI", `🎬 Motion ${plan.platform.toUpperCase()}: "${title}" video scheduled for ${when.toISOString().slice(11, 16)}Z`, "success");
    } catch (e) {
      results.push({ platform: plan.platform, ok: false, error: e.message.slice(0, 100) });
      await logAgent("IMANI", `Motion ${plan.platform} failed: ${e.message.slice(0, 120)}`, "warn");
    }
  }
  promoState.last_motion = { at: new Date().toISOString(), results };
  return { ok: true, results };
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

// ── CEO 7/15 one-shot: INSTANT SHOWCASE — 2 premium HQ art drops + immediate ──
// Etsy mirror, so BOTH storefronts (Shopify + Etsy) get fresh top-tier product
// on this deploy. Each piece runs the full podgen loop (3 editions, room scenes,
// watermark previews, clean delivery). Latched via agent_logs so it fires once.
const SHOWCASE_MARKER = "CEO showcase 2026-07-15: 2-piece premium instant drop fired";
async function fireInstantShowcaseOnce() {
  try {
    const { data, error } = await supabase.from("agent_logs").select("id").eq("message", SHOWCASE_MARKER).limit(1);
    if (error || (data && data.length)) return; // already fired (or can't verify — don't risk duplicates)
  } catch (e) { return; }
  await logAgent("IMANI", SHOWCASE_MARKER, "info"); // latch BEFORE generating
  const themes = [
    "Black Excellence — regal golden-hour family portrait, museum-grade, ultra-detailed",
    "Optical-illusion cosmic lion — photorealistic with a surreal plot twist"
  ];
  try { // upgrade the 2nd slot to NANA's freshest trend keyword when available
    const { data: t } = await supabase.from("tasks").select("result").eq("task_type", "trend_research")
      .eq("status", "completed").order("updated_at", { ascending: false }).limit(1);
    const kw = (t?.[0]?.result?.trends || []).map(x => (typeof x === "string" ? x : x?.keyword))
      .find(k => typeof k === "string" && k.trim());
    if (kw) themes[1] = kw.trim();
  } catch (e) { /* fallback theme stands */ }
  let made = 0; const ids = [];
  for (const theme of themes) {
    try { const r = await runPodGen({ theme, style: "art" }); if (r?.productId) { made++; ids.push(r.productId); } }
    catch (e) { console.log("[showcase]", e.message); }
  }
  // Immediately mirror the new actives to Etsy so both storefronts get them NOW.
  let etsy = null;
  try { etsy = await etsySyncTick(); promoState.etsy_sync = etsy; } catch (e) { console.log("[showcase etsy]", e.message); }
  promoState.last_showcase = { at: new Date().toISOString(), made, ids, etsy };
  await logAgent("IMANI", `Instant showcase: ${made}/2 premium products created + Etsy mirror run`, made ? "success" : "warn");
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
    `DEAL ALERT 💰 Spend $${MIN_SPEND} at House of Jreym and take ANY digital art piece FREE — your pick, Classic, 3D, or Holographic edition. Original art, instant download, yours forever. Use code ${PROMO_CODE} at checkout. ✨ #HouseOfJreym #WallArt #DigitalDownload #FreeArt #ArtDeals`,
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

// ── Product floor (CEO 7/12): HOJ always has >= 100 buyable digital products ──
// Counts ACTIVE Digital Wall Art; if under the floor, fires podgen to top up.
// Runs at boot (8 min) + daily. Uses a diverse theme pool (not just Afrocentric).
const FLOOR_MIN = parseInt(process.env.PRODUCT_FLOOR || "100", 10);
const FLOOR_THEMES = ["Basketball Court Legends","Regal Pet Portrait — crowned royal dog","Retro Arcade Neon Nights","Boxing Champion Spirit","Street Graffiti Color Explosion","Golden Retriever Pet Portrait — sunny garden","Football Stadium Friday Lights","Y2K Chrome Aesthetic","Skate Park Motion Blur","Cosmic Space Dreamscape","Midnight City Dreams Mood","Anime-Style Rainy City Mood","Vintage Muscle Car Sunset","French Bulldog Pet Portrait — neon pop art","Surfer Sunset Wave Mood","Mountain Hiking Adventure Vibe"];

async function ensureProductFloor() {
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { error: "no shopify auth" };
  // Count active digital products
  const r = await fetch(`${base(shop)}/products/count.json?product_type=${encodeURIComponent(DIGITAL_TYPE)}&status=active`, { headers: hdrs(token) });
  const j = await r.json();
  const count = j.count || 0;
  if (count >= FLOOR_MIN) { promoState.floor = { count, min: FLOOR_MIN, topped: 0, at: new Date().toISOString() }; return { ok: true, count, topped: 0 }; }
  // Top up — but cap each run at 8 so we never blow the fal budget in one shot
  const need = Math.min(8, FLOOR_MIN - count);
  await logAgent("IMANI", `Product floor: ${count}/${FLOOR_MIN} buyable — generating ${need} to top up`, "warn");
  const dayN = Math.floor(Date.now() / 86400000);
  let made = 0;
  for (let i = 0; i < need; i++) {
    try { const rr = await runPodGen({ theme: FLOOR_THEMES[(dayN + i) % FLOOR_THEMES.length], style: i % 2 ? "art" : "design" }); if (rr?.productId) made++; }
    catch (e) { console.log("[floor]", e.message); }
  }
  promoState.floor = { count: count + made, min: FLOOR_MIN, topped: made, at: new Date().toISOString() };
  await logAgent("IMANI", `Product floor top-up: +${made} (now ~${count + made}/${FLOOR_MIN})`, made ? "success" : "warn");
  return { ok: true, count: count + made, topped: made };
}

// ── Trending pet-product promotion (CEO 7/12): rotate buy-link posts for the ──
// physical pet supplies so the store's real products get promoted daily too.
async function promotePetProductsTick(count = 1) {
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { error: "no shopify auth" };
  const r = await fetch(`${base(shop)}/products.json?product_type=Pet%20Supplies&status=active&limit=50&fields=id,title,handle,image,variants`, { headers: hdrs(token) });
  let items = (await r.json()).products || [];
  if (!items.length) { // fallback: any non-digital active product that ships
    const r2 = await fetch(`${base(shop)}/products.json?status=active&limit=100&fields=id,title,handle,image,product_type,variants`, { headers: hdrs(token) });
    items = ((await r2.json()).products || []).filter(p => p.product_type !== DIGITAL_TYPE && p.image?.src);
  }
  items = items.filter(p => p.image?.src);
  if (!items.length) return { ok: true, promoted: 0, note: "no physical products yet" };
  // CEO 7/15: post SEVERAL distinct trending pet products per run (staggered
  // slots) so the pet feed ramps toward quota fast instead of one-a-day.
  const dayN = Math.floor(Date.now() / 86400000);
  const n = Math.min(Math.max(1, count), items.length);
  let promoted = 0;
  for (let i = 0; i < n; i++) {
    const p = items[(dayN + i) % items.length];
    const link = `houseofjreym.store/products/${p.handle}`;
    const price = p.variants?.[0]?.price ? `$${p.variants[0].price}` : "";
    const caption = enforceCaptionRules(`🐾 Trending in the shop: ${String(p.title).split("—")[0].trim()} ${price ? "— " + price : ""}. Treat your pet to the good stuff. 🛍 ${link} #PetCare #DogsOfInstagram #CatsOfInstagram #PetProducts #HouseOfJreym`, link);
    const when = new Date(Date.now() + (30 + i * 90) * 60000); when.setUTCMinutes(0, 0, 0);
    const { error } = await supabase.from("social_posts").insert({
      platform: "all", status: "scheduled", caption, media_urls: [p.image.src], media_type: "IMAGE",
      scheduled_for: when.toISOString(), keyword: "petpromo-" + p.id + "-" + when.toISOString().slice(0, 13), created_by: "IMANI",
      meta: { pipeline: "pet-promo", product_id: p.id }
    });
    if (error) { await logAgent("IMANI", `Pet promo insert failed: ${error.message}`, "warn"); continue; }
    promoted++;
    promoState.last_pet_promo = { at: new Date().toISOString(), product: p.title };
  }
  if (promoted) await logAgent("IMANI", `🐾 ${promoted} trending pet-product promo(s) scheduled`, "success");
  return { ok: true, promoted };
}

// ── CEO 7/15 one-shot: Etsy DE-PET sweep ─────────────────────────────────────
// Deactivate any pet-portrait listing already mirrored to Etsy BEFORE the de-mix
// fix, so Etsy carries the general art gallery only. Idempotent + latched.
const DEPET_MARKER = "CEO 2026-07-15b: Etsy pet-portrait de-mix sweep done";
async function sweepEtsyPetListings() {
  const out = { ok: true, checked: 0, deactivated: 0, ids: [], failed: [] };
  const et = await getEtsyAccessToken();
  if (!et) return { ok: false, error: "no fresh etsy token" };
  const formHdr = { Authorization: "Bearer " + et, "x-api-key": ETSY_KEY2 + (ETSY_SECRET2 ? ":" + ETSY_SECRET2 : ""), "Content-Type": "application/x-www-form-urlencoded" };
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings/active?limit=100&offset=${offset}`, { headers: eAuth(et) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { out.error = JSON.stringify(j).slice(0, 120); break; }
    const results = j.results || [];
    out.checked += results.length;
    for (const l of results) {
      if (!isPetTitle(l.title) && !isPetTitle((l.tags || []).join(" "))) continue;
      const lid = l.listing_id;
      let done = false;
      // Etsy v3 updateListing — try PATCH then PUT (state=inactive), form-encoded.
      for (const method of ["PATCH", "PUT"]) {
        try {
          const ur = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings/${lid}`, { method, headers: formHdr, body: new URLSearchParams({ state: "inactive" }) });
          if (ur.ok) { done = true; break; }
        } catch (e) { /* try next method */ }
      }
      if (done) { out.deactivated++; out.ids.push(lid); await logAgent("AISHA", `Etsy de-pet: deactivated pet listing ${lid} "${String(l.title).slice(0, 40)}"`, "success"); }
      else { out.failed.push(lid); await logAgent("AISHA", `Etsy de-pet: could not deactivate ${lid}`, "warn"); }
    }
    if (results.length < 100) break;
  }
  return out;
}
async function sweepEtsyPetListingsOnce() {
  try {
    const { data, error } = await supabase.from("agent_logs").select("id").eq("message", DEPET_MARKER).limit(1);
    if (error || (data && data.length)) return; // already swept (or can't verify — don't re-run)
  } catch (e) { return; }
  const r = await sweepEtsyPetListings();
  await logAgent("AISHA", DEPET_MARKER, r.ok ? "info" : "warn");
  if (r.ok) await logAgent("AISHA", `Etsy de-pet sweep: ${r.deactivated} pet listing(s) deactivated, ${r.checked} checked`, r.deactivated ? "success" : "info");
}

// ── CEO 7/15 one-shot: DE-MAGIC sweep ────────────────────────────────────────
// Strip the word "Magic" (incl. "Black Girl Magic" → "Black Girl Power") from
// every EXISTING Shopify product + Etsy listing title/tags. Latched + /demagic.
const DEMAGIC_MARKER = "CEO 2026-07-18: de-magic sweep v2 (titles+tags+descriptions) done";
async function sweepMagic() {
  const out = { ok: true, shopify: { checked: 0, fixed: 0 }, etsy: { checked: 0, fixed: 0 } };
  const { token, shop } = await shopAuth();
  if (token && shop) {
    try {
      const pr = await fetch(`${base(shop)}/products.json?limit=250&fields=id,title,tags,body_html`, { headers: hdrs(token) });
      const products = (await pr.json()).products || [];
      out.shopify.checked = products.length;
      for (const p of products) {
        if (!hasMagic(p.title) && !hasMagic(p.tags) && !hasMagic(p.body_html)) continue;
        const ur = await fetch(`${base(shop)}/products/${p.id}.json`, { method: "PUT", headers: hdrs(token), body: JSON.stringify({ product: { id: p.id, title: scrubMagic(p.title), tags: scrubMagic(p.tags), body_html: scrubMagicDesc(p.body_html) } }) });
        if (ur.ok) { out.shopify.fixed++; await logAgent("AISHA", `De-magic: scrubbed Shopify product ${p.id}`, "success"); }
      }
    } catch (e) { out.shopify.error = e.message.slice(0, 120); }
  }
  try {
    const et = await getEtsyAccessToken();
    if (et) {
      const formHdr = { Authorization: "Bearer " + et, "x-api-key": ETSY_KEY2 + (ETSY_SECRET2 ? ":" + ETSY_SECRET2 : ""), "Content-Type": "application/x-www-form-urlencoded" };
      for (let offset = 0; offset < 1000; offset += 100) {
        const r = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings/active?limit=100&offset=${offset}`, { headers: eAuth(et) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { out.etsy.error = JSON.stringify(j).slice(0, 120); break; }
        const results = j.results || [];
        out.etsy.checked += results.length;
        for (const l of results) {
          const tagStr = (l.tags || []).join(",");
          if (!hasMagic(l.title) && !hasMagic(tagStr) && !hasMagic(l.description)) continue;
          const newDesc = scrubMagicDesc(l.description);
          const newTitle = scrubMagic(l.title).slice(0, 140);
          const newTags = [...new Set(scrubMagic(tagStr).split(",").map(x => x.replace(/[^A-Za-z0-9' -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20).trim()).filter(x => x.length > 1))].slice(0, 13).join(",");
          let done = false;
          for (const method of ["PATCH", "PUT"]) {
            try {
              const ur = await fetch(`${ETSY_BASE2}/shops/${ETSY_SHOP_ID2}/listings/${l.listing_id}`, { method, headers: formHdr, body: new URLSearchParams({ title: newTitle, tags: newTags, ...(newDesc ? { description: newDesc } : {}) }) });
              if (ur.ok) { done = true; break; }
            } catch (e) { /* try next */ }
          }
          if (done) { out.etsy.fixed++; await logAgent("AISHA", `De-magic: scrubbed Etsy listing ${l.listing_id}`, "success"); }
        }
        if (results.length < 100) break;
      }
    }
  } catch (e) { out.etsy.error = e.message.slice(0, 120); }
  return out;
}
async function sweepMagicOnce() {
  try {
    const { data, error } = await supabase.from("agent_logs").select("id").eq("message", DEMAGIC_MARKER).limit(1);
    if (error || (data && data.length)) return;
  } catch (e) { return; }
  const r = await sweepMagic();
  await logAgent("AISHA", DEMAGIC_MARKER, "info");
  await logAgent("AISHA", `De-magic sweep: Shopify ${r.shopify.fixed} fixed, Etsy ${r.etsy.fixed} fixed`, "success");
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
// GET /api/promo/sections — PUBLIC spillover checker. Reads each section's live
// rules + product mix and returns pass/fail flags for every spillover direction.
// Open in a browser to confirm the pet store is clean. ?fix=1 re-runs the
// catalog de-mix (rewrites /collections/all to physical-only) on the spot.
promoRouter.get("/sections", async (req, res) => {
  try {
    const { token, shop } = await shopAuth();
    if (!token || !shop) return res.status(503).json({ error: "no shopify auth" });
    const wanted = {
      "digital-art-instant-downloads": "General Digital Art (Etsy-facing)",
      "hoj-pets-digital-art-instant-downloads": "Pet Art Downloads",
      "physical-goods-shipped-to-you": "Physical Goods",
      "all": "Item Catalog (Pet Supplies)"
    };
    const cl = await (await fetch(`${base(shop)}/smart_collections.json?limit=250`, { headers: hdrs(token) })).json();
    const out = {};
    let catalogCol = null;
    for (const c of cl.smart_collections || []) {
      if (!wanted[c.handle]) continue;
      if (c.handle === "all") catalogCol = c;
      const cj = await (await fetch(`${base(shop)}/collections/${c.id}/products.json?limit=250&fields=id,title,product_type`, { headers: hdrs(token) })).json();
      const prods = cj.products || [];
      out[c.handle] = {
        name: wanted[c.handle], disjunctive: c.disjunctive, rules: c.rules,
        product_count: prods.length,
        digital: prods.filter(p => p.product_type === DIGITAL_TYPE).length,
        physical: prods.filter(p => p.product_type !== DIGITAL_TYPE).length,
        pet_titled: prods.filter(p => isPetTitle(p.title)).length,
        sample: prods.slice(0, 6).map(p => `${p.title} [${p.product_type}]`)
      };
    }
    // Optional on-the-spot fix: force the item catalog to physical-only.
    let fixed = null;
    if (req.query.fix && catalogCol && (catalogCol.disjunctive || (catalogCol.rules || []).some(r => r.relation === "contains"))) {
      const cu = await fetch(`${base(shop)}/smart_collections/${catalogCol.id}.json`, {
        method: "PUT", headers: hdrs(token),
        body: JSON.stringify({ smart_collection: { id: catalogCol.id, disjunctive: false, rules: [{ column: "type", relation: "not_equals", condition: DIGITAL_TYPE }] } })
      });
      fixed = cu.ok ? "item catalog rewritten to physical-only" : "fix failed";
    }
    const cat = out["all"] || {}, pet = out["hoj-pets-digital-art-instant-downloads"] || {}, gen = out["digital-art-instant-downloads"] || {};
    res.json({
      checks: {
        "item_catalog_physical_only (no art in pet items)": (cat.digital || 0) === 0,
        "pet_downloads_pet_only (no physical/general spill)": (pet.physical || 0) === 0,
        "general_art_no_pet (no pet spill into Etsy gallery)": (pet ? (gen.pet_titled || 0) === 0 : true)
      },
      fixed, sections: out
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
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
// POST /api/promo/pet-now (GATED) — push N trending pet-product promos immediately
promoRouter.post("/pet-now", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await promotePetProductsTick(parseInt(req.body?.count) || 3)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/promo/etsy-depet (GATED) — deactivate any pet-portrait Etsy listing now
promoRouter.post("/etsy-depet", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await sweepEtsyPetListings()); } catch (e) { res.status(500).json({ error: e.message }); }
});
// GET/POST /api/promo/demagic — strip "Magic" from all existing Shopify + Etsy items
promoRouter.all("/demagic", async (req, res) => {
  try { res.json(await sweepMagic()); } catch (e) { res.status(500).json({ error: e.message }); }
});
// GET/POST /api/promo/decollage — CEO 2026-07-18: remove the theme-boilerplate
// "This season Best Seller" Collage section from the shared collection template
// (renders on Pet Art Downloads + every other collection page). Idempotent.
promoRouter.all("/decollage", async (req, res) => {
  const out = { ok: false, theme: null, removed: [], note: null };
  try {
    const { token, shop } = await shopAuth();
    if (!token || !shop) return res.status(503).json({ ...out, error: "no shopify auth" });
    const th = await (await fetch(`${base(shop)}/themes.json?role=main`, { headers: hdrs(token) })).json();
    const theme = (th.themes || [])[0];
    if (!theme) return res.status(502).json({ ...out, error: th.errors ? JSON.stringify(th.errors).slice(0, 160) : "no main theme (token may lack read_themes scope)" });
    out.theme = { id: theme.id, name: theme.name };
    const key = "templates/collection.json";
    const ar = await fetch(`${base(shop)}/themes/${theme.id}/assets.json?asset[key]=${encodeURIComponent(key)}`, { headers: hdrs(token) });
    const aj = await ar.json().catch(() => ({}));
    if (!ar.ok || !aj.asset?.value) return res.status(502).json({ ...out, error: aj.errors ? JSON.stringify(aj.errors).slice(0, 160) : "asset read failed (token may lack read_themes scope)" });
    const tpl = JSON.parse(aj.asset.value);
    for (const [k, v] of Object.entries(tpl.sections || {})) {
      if (k === "main") continue;
      if (/collage/i.test(k) || /collage/i.test(String(v?.type || ""))) { out.removed.push(k); delete tpl.sections[k]; }
    }
    if (!out.removed.length) { out.ok = true; out.note = "no collage section present — already clean"; return res.json(out); }
    tpl.order = (tpl.order || []).filter(k => !out.removed.includes(k));
    const pr = await fetch(`${base(shop)}/themes/${theme.id}/assets.json`, {
      method: "PUT", headers: hdrs(token),
      body: JSON.stringify({ asset: { key, value: JSON.stringify(tpl, null, 2) } })
    });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok) return res.status(502).json({ ...out, error: pj.errors ? JSON.stringify(pj.errors).slice(0, 160) : "asset write failed (token may lack write_themes scope)" });
    out.ok = true;
    await logAgent("IMANI", `De-collage: removed section(s) ${out.removed.join(", ")} from ${key} on theme ${theme.id}`, "success");
    res.json(out);
  } catch (e) { res.status(500).json({ ...out, error: e.message.slice(0, 160) }); }
});
// POST /api/promo/showcase-now (GATED) — generate 2 premium HQ art drops + Etsy mirror now
promoRouter.post("/showcase-now", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const themes = Array.isArray(req.body?.themes) && req.body.themes.length ? req.body.themes.slice(0, 4) : null;
    let made = 0; const ids = [];
    for (const theme of themes || ["Black Excellence — museum-grade regal portrait", "Optical-illusion cosmic lion — photorealistic plot twist"]) {
      try { const r = await runPodGen({ theme, style: "art" }); if (r?.productId) { made++; ids.push(r.productId); } } catch (e) { /* next */ }
    }
    let etsy = null; try { etsy = await etsySyncTick(); promoState.etsy_sync = etsy; } catch (e) { /* sync self-heals hourly */ }
    res.json({ ok: true, made, ids, etsy });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
// One-shot INSTANT SHOWCASE (latched): 2 premium HQ drops + immediate Etsy mirror
setTimeout(() => { fireInstantShowcaseOnce().catch(e => console.log("[showcase]", e.message)); }, 55000);
// One-shot Etsy DE-PET sweep (latched): pull any pet portrait already on Etsy
setTimeout(() => { sweepEtsyPetListingsOnce().catch(e => console.log("[etsy depet]", e.message)); }, 240000);
// One-shot DE-MAGIC sweep (latched): strip "Magic" from existing Shopify + Etsy items
setTimeout(() => { sweepMagicOnce().catch(e => console.log("[demagic]", e.message)); }, 300000);
// Etsy auto-list: boot tick at 6 min (after the drop finishes), then HOURLY at :20
setTimeout(() => { etsySyncTick().then(r => { promoState.etsy_sync = r; }).catch(e => console.log("[etsy sync]", e.message)); }, 360000);
cron.schedule("0 20 * * * *", () => {
  etsySyncTick().then(r => { promoState.etsy_sync = r; }).catch(e => console.log("[etsy sync]", e.message));
});
// Motion studio: daily 16:30 UTC (12:30pm ET) + latched boot tick 9 min after start
cron.schedule("0 30 16 * * *", () => { motionTick().catch(e => console.log("[motion]", e.message)); });
setTimeout(() => { motionTick().catch(e => console.log("[motion]", e.message)); }, 540000);
// Product floor: boot tick at 8 min, then daily 07:00 UTC — keep >= 100 buyable
setTimeout(() => { ensureProductFloor().catch(e => console.log("[floor]", e.message)); }, 480000);
cron.schedule("0 0 7 * * *", () => { ensureProductFloor().catch(e => console.log("[floor]", e.message)); });
// Trending pet-product promo (CEO 7/15): fire IMMEDIATELY on boot (3 min) with a
// burst of 3, then every 6 hours (2 each) — pet supplies ramp toward quota fast
// instead of a single 19:00 post.
setTimeout(() => { promotePetProductsTick(3).catch(e => console.log("[pet promo]", e.message)); }, 180000);
cron.schedule("0 0 */6 * * *", () => { promotePetProductsTick(2).catch(e => console.log("[pet promo]", e.message)); });
// Daily 15:00 UTC (11am ET): re-ensure assets (self-heal restocks/deal), then boost check
cron.schedule("0 0 15 * * *", () => {
  ensurePromoAssets().catch(e => console.log("[promo] ensure:", e.message))
    .then(() => checkAndBoost()).catch(e => console.log("[promo] check:", e.message));
});
console.log(`[promo] armed — ${PROMO_CODE}: spend $${MIN_SPEND} → free digital piece; boost check daily 15:00 UTC`);
