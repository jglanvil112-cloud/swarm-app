// routes/shopify.js — Shopify OAuth + Admin API
import express from "express";
import crypto from "crypto";
import cron from "node-cron";
import { supabase, logAgent, enqueueTask } from "../lib/supabase.js";
export const shopifyRouter = express.Router();

const SHOPIFY_API_KEY    = process.env.SHOPIFY_CLIENT_ID     || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const APP_URL            = process.env.APP_URL || "https://swarm-app-3nch.onrender.com";
const SHOPIFY_SCOPES     = "read_products,write_products,read_orders,write_orders,read_inventory,write_inventory,read_customers,write_customers,read_content,write_content";

async function getStoredToken() {
  // Robust read: handle 0, 1, or duplicate shopify rows. The OAuth upsert uses
  // onConflict:"platform" which needs a unique index that may be missing, so
  // duplicates can accumulate and .single() would throw. Take the newest row.
  const { data } = await supabase.from("oauth_tokens")
    .select("access_token,shop,updated_at").eq("platform","shopify")
    .order("updated_at", { ascending: false }).limit(1);
  return Array.isArray(data) && data.length ? data[0] : null;
}
function shopifyHeaders(token) {
  return { "X-Shopify-Access-Token": token || process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_CLIENT_SECRET || "", "Content-Type": "application/json" };
}
function shopifyBase(shop) {
  const domain = (shop || process.env.SHOPIFY_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${domain}/admin/api/2024-01`;
}

// ── Approval gate for write operations (same secret as routes/approve.js) ──
const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured — set APPROVAL_SECRET" }); return false; }
  const key = req.headers["x-approval-key"] || req.query.key;
  if (key !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}
async function resolveShopAuth() {
  const stored = await getStoredToken();
  return { token: stored?.access_token || process.env.SHOPIFY_ACCESS_TOKEN, shop: stored?.shop || process.env.SHOPIFY_DOMAIN };
}

// PUT /api/shopify/products/:id — update product metadata (GATED). Whitelisted fields only.
shopifyRouter.put("/products/:id", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const { token, shop } = await resolveShopAuth();
    const src = req.body || {};
    const product = { id: Number(req.params.id) };
    for (const f of ["title", "product_type", "tags", "body_html", "status", "vendor"]) {
      if (src[f] !== undefined) product[f] = src[f];
    }
    const r = await fetch(`${shopifyBase(shop)}/products/${req.params.id}.json`, { method: "PUT", headers: shopifyHeaders(token), body: JSON.stringify({ product }) });
    const txt = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: txt.slice(0, 400) });
    await logAgent("AMARA", `Updated Shopify product ${req.params.id}`, "success");
    res.json(JSON.parse(txt));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/shopify/create-product (GATED) — directly create a product (images pulled by URL)
shopifyRouter.post("/create-product", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const { token, shop } = await resolveShopAuth();
    const p = req.body.product || req.body;
    const r = await fetch(`${shopifyBase(shop)}/products.json`, {
      method: "POST", headers: shopifyHeaders(token), body: JSON.stringify({ product: p })
    });
    const txt = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: txt.slice(0, 400) });
    const j = JSON.parse(txt);
    await logAgent("KWAME", `Created product: ${p.title || "(untitled)"}`, "success");
    res.json({ ok: true, id: j.product?.id, handle: j.product?.handle, images: (j.product?.images || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POD auto-filing: tag Printify products "originals" + rebrand vendor ──────
// Runs on a cron so every new POD product self-files into the "House of Jreym
// Originals" smart collection (condition: tag = originals). Uses product scope,
// which works today (no content scope needed).
async function tagOriginals() {
  const { token, shop } = await resolveShopAuth();
  const r = await fetch(`${shopifyBase(shop)}/products.json?limit=250&fields=id,vendor,tags`, { headers: shopifyHeaders(token) });
  const j = await r.json();
  let tagged = 0;
  for (const p of (j.products || [])) {
    const isPOD = (p.vendor || "").toLowerCase() === "printify";
    const tags = (typeof p.tags === "string" ? p.tags.split(",").map(t => t.trim()) : (p.tags || [])).filter(Boolean);
    if (isPOD && !tags.map(t => t.toLowerCase()).includes("originals")) {
      const up = await fetch(`${shopifyBase(shop)}/products/${p.id}.json`, {
        method: "PUT", headers: shopifyHeaders(token),
        body: JSON.stringify({ product: { id: p.id, tags: [...tags, "originals"].join(", "), vendor: "House of Jreym" } })
      });
      if (up.ok) tagged++;
    }
  }
  if (tagged) await logAgent("KWAME", `Filed ${tagged} POD product(s) into "originals"`, "success");
  return tagged;
}
// POST /api/shopify/tag-originals (GATED) — manual trigger
shopifyRouter.post("/tag-originals", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json({ ok: true, tagged: await tagOriginals() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Hourly cron: auto-file any newly-published POD products
cron.schedule("30 * * * *", () => { tagOriginals().catch(e => console.log("[tag-originals] cron:", e.message)); });

// GET /api/shopify/pages — list existing pages (read-only, for verification).
shopifyRouter.get("/pages", async (req, res) => {
  try {
    const { token, shop } = await resolveShopAuth();
    const r = await fetch(`${shopifyBase(shop)}/pages.json?limit=250`, { headers: shopifyHeaders(token) });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: JSON.stringify(j).slice(0, 300) });
    res.json({ count: (j.pages || []).length, pages: (j.pages || []).map(p => ({ id: p.id, title: p.title, handle: p.handle, published: !!p.published_at })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/shopify/pages — create a content page (GATED). For policy / about pages.
shopifyRouter.post("/pages", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const { token, shop } = await resolveShopAuth();
    const { title, body_html = "", published = true } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const r = await fetch(`${shopifyBase(shop)}/pages.json`, { method: "POST", headers: shopifyHeaders(token), body: JSON.stringify({ page: { title, body_html, published } }) });
    const txt = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: txt.slice(0, 400) });
    await logAgent("AMARA", `Created Shopify page: ${title}`, "success");
    res.json(JSON.parse(txt));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// OAuth Step 1
shopifyRouter.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).json({ error: "shop required" });
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${APP_URL}/api/shopify/callback`;
  res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SHOPIFY_SCOPES}&redirect_uri=${redirectUri}&state=${state}`);
});

// OAuth Step 2
shopifyRouter.get("/callback", async (req, res) => {
  const { code, shop, hmac } = req.query;
  const params = Object.entries(req.query).filter(([k]) => k !== "hmac").sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("&");
  const computed = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(params).digest("hex");
  if (computed !== hmac) return res.status(403).json({ error: "Invalid HMAC" });
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }) });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(500).json({ error: "Token exchange failed", detail: tokenData });
    // Persist reliably without depending on a unique index existing on `platform`
    // (the old onConflict:"platform" upsert silently no-op'd when that index was missing).
    await supabase.from("oauth_tokens").delete().eq("platform", "shopify");
    await supabase.from("oauth_tokens").insert({ platform: "shopify", access_token: tokenData.access_token, scope: tokenData.scope, shop, updated_at: new Date().toISOString() });
    await logAgent("KOFI", `Shopify OAuth completed for ${shop}`, "success");
    res.redirect(`/swarm_shop_os_v5.html?shopify=connected&shop=${shop}`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

shopifyRouter.post("/webhooks/order-created", express.raw({ type: "application/json" }), async (req, res) => {
  res.sendStatus(200);
  const order = JSON.parse(req.body);
  await enqueueTask({ agent: "SEUN", task_type: "analytics_report", payload: { data: { new_order: order }, period: "realtime" }, priority: 1 });
});

shopifyRouter.get("/products", async (req, res) => {
  try {
    const stored = await getStoredToken();
    const token = stored?.access_token || process.env.SHOPIFY_ACCESS_TOKEN;
    const shop  = stored?.shop || process.env.SHOPIFY_DOMAIN;
    const r = await fetch(`${shopifyBase(shop)}/products.json?limit=50&fields=id,title,variants,status,image,tags`, { headers: shopifyHeaders(token) });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: e.slice(0,300) }); }
    const data = await r.json();
    if (data.products?.length) {
      for (const p of data.products) {
        await supabase.from("products").upsert({ external_id: String(p.id), platform: "shopify", title: p.title, tags: p.tags ? p.tags.split(",").map(t=>t.trim()) : [], price: parseFloat(p.variants?.[0]?.price||0), status: p.status, updated_at: new Date().toISOString() }, { onConflict: "external_id,platform" });
      }
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

shopifyRouter.get("/orders", async (req, res) => {
  try {
    const stored = await getStoredToken();
    const token = stored?.access_token || process.env.SHOPIFY_ACCESS_TOKEN;
    const shop  = stored?.shop || process.env.SHOPIFY_DOMAIN;
    const r = await fetch(`${shopifyBase(shop)}/orders.json?limit=50&status=any&fields=id,order_number,total_price,financial_status,created_at,line_items`, { headers: shopifyHeaders(token) });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: e.slice(0,300) }); }
    const data = await r.json();
    if (data.orders?.length) {
      for (const o of data.orders) {
        if (o.financial_status === "paid") {
          await supabase.from("revenue_events").upsert({ platform: "shopify", order_id: String(o.id), amount: parseFloat(o.total_price), recorded_at: o.created_at }, { onConflict: "order_id" });
        }
      }
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

shopifyRouter.get("/store", async (req, res) => {
  try {
    const stored = await getStoredToken();
    const r = await fetch(`${shopifyBase(stored?.shop)}/shop.json`, { headers: shopifyHeaders(stored?.access_token) });
    if (!r.ok) return res.status(r.status).json({ error: `Shopify ${r.status}` });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

shopifyRouter.post("/products", async (req, res) => {
  const task = await enqueueTask({ agent: "KWAME", task_type: "sales_optimization", payload: { action: "create_product", product: req.body.product, requires_approval: true }, priority: 2 });
  res.json({ queued: true, task_id: task.id, message: "Product queued for approval" });
});
