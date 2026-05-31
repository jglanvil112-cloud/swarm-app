// routes/shopify.js — Shopify OAuth + Admin API
import express from "express";
import crypto from "crypto";
import { supabase, logAgent, enqueueTask } from "../lib/supabase.js";
export const shopifyRouter = express.Router();

const SHOPIFY_API_KEY    = process.env.SHOPIFY_CLIENT_ID     || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const APP_URL            = process.env.APP_URL || "https://swarm-app-3nch.onrender.com";
const SHOPIFY_SCOPES     = "read_products,write_products,read_orders,write_orders,read_inventory,write_inventory,read_customers,write_customers";

async function getStoredToken() {
  const { data } = await supabase.from("oauth_tokens").select("access_token,shop").eq("platform","shopify").single();
  return data;
}
function shopifyHeaders(token) {
  return { "X-Shopify-Access-Token": token || process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_CLIENT_SECRET || "", "Content-Type": "application/json" };
}
function shopifyBase(shop) {
  const domain = (shop || process.env.SHOPIFY_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${domain}/admin/api/2024-01`;
}

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
    await supabase.from("oauth_tokens").upsert({ platform: "shopify", access_token: tokenData.access_token, scope: tokenData.scope, shop, updated_at: new Date().toISOString() }, { onConflict: "platform" });
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
        await supabase.from("products").upsert({ external_id: String(p.id), platform: "shopify", title: p.title, tags: p.tags ? p.tags.split(",").map(t=>t.trim()) : [], price: parseFloat(p.variants?.[0]?.price||0), status: p.status, updated_at: new Date().toISOString() }, { onConflict: "external_id,platform" }).catch(()=>{});
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
          await supabase.from("revenue_events").upsert({ platform: "shopify", order_id: String(o.id), amount: parseFloat(o.total_price), recorded_at: o.created_at }, { onConflict: "order_id" }).catch(()=>{});
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
