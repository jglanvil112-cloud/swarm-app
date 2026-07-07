// routes/delivery.js — SWARM OS zero-touch digital delivery
// Every 5 min: find paid orders containing digital products that haven't been
// delivered, email the buyer their download links via Resend, tag the order
// "file-delivered" so it's never sent twice.
//
// Requires (Render env): RESEND_API_KEY  (resend.com — free tier)
// Optional: RESEND_FROM  (default: House of Jreym <onboarding@resend.dev>)
//   NOTE: to email real customers, verify your domain (houseofjreym.store) in
//   Resend and set RESEND_FROM to e.g. "House of Jreym <downloads@houseofjreym.store>".
//   Without a verified domain, Resend only delivers to the account owner's email.

import express from "express";
import cron from "node-cron";
import dns from "node:dns/promises";
import { supabase, logAgent } from "../lib/supabase.js";

export const deliveryRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "House of Jreym <downloads@houseofjreym.store>";
const RESEND_FALLBACK_FROM = "House of Jreym <onboarding@resend.dev>";
const DIGITAL_MATCH = /\(HOJ-|Mary Jane Flats|Low Top Sneaker/i;

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

async function productDownloadLinks(shop, token, productIds) {
  const links = {};
  for (const id of productIds) {
    try {
      const r = await fetch(`${base(shop)}/products/${id}.json?fields=id,title,image,images`, { headers: hdrs(token) });
      const j = await r.json();
      const src = j.product?.image?.src || j.product?.images?.[0]?.src;
      if (src) links[id] = { title: j.product.title, url: src };
    } catch (e) { /* skip */ }
  }
  return links;
}

async function sendResend(to, subject, html) {
  if (!RESEND_KEY) throw new Error("RESEND_API_KEY missing");
  async function attempt(from) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    const j = await r.json();
    return { ok: r.ok, status: r.status, j };
  }
  let res = await attempt(RESEND_FROM);
  if (!res.ok && /domain is not verified|not verified|validation_error/i.test(JSON.stringify(res.j))) {
    res = await attempt(RESEND_FALLBACK_FROM); // self-heals: domain sender takes over once verified
  }
  if (!res.ok) throw new Error("Resend " + res.status + ": " + JSON.stringify(res.j).slice(0, 200));
  return res.j.id;
}

export async function runDelivery() {
  const { token, shop } = await shopAuth();
  if (!token || !shop) return { ok: false, error: "no shopify auth" };
  const r = await fetch(`${base(shop)}/orders.json?status=any&financial_status=paid&limit=50&fields=id,name,email,tags,line_items`, { headers: hdrs(token) });
  const j = await r.json();
  if (!r.ok) return { ok: false, error: JSON.stringify(j).slice(0, 200) };
  const orders = (j.orders || []).filter(o => !((o.tags || "").includes("file-delivered")));
  let sent = 0, results = [];
  for (const o of orders) {
    const digital = (o.line_items || []).filter(li => DIGITAL_MATCH.test(li.title || ""));
    if (!digital.length || !o.email) continue;
    const links = await productDownloadLinks(shop, token, [...new Set(digital.map(d => d.product_id).filter(Boolean))]);
    const items = digital.map(d => links[d.product_id]).filter(Boolean);
    if (!items.length) continue;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
        <h2 style="letter-spacing:.08em">HOUSE OF JREYM</h2>
        <p>Thank you for your order <b>${o.name}</b>! Your digital art is ready — download links below (save the full-size file):</p>
        ${items.map(it => `<p style="margin:14px 0"><b>${it.title.split("—")[0].trim()}</b><br/><a href="${it.url}" style="color:#1a6fba">⬇ Download full-resolution file</a></p>`).join("")}
        <p style="font-size:12px;color:#666">For personal use only — may not be resold or redistributed. Questions? Just reply to this email.</p>
      </div>`;
    try {
      await sendResend(o.email, `Your House of Jreym downloads — order ${o.name}`, html);
      await fetch(`${base(shop)}/orders/${o.id}.json`, { method: "PUT", headers: hdrs(token), body: JSON.stringify({ order: { id: o.id, tags: ((o.tags || "") + ", file-delivered").replace(/^, /, "") } }) });
      sent++; results.push(`✅ ${o.name} → ${o.email.slice(0, 3)}…`);
      await logAgent("DELE", `Delivered digital files for order ${o.name}`, "success");
    } catch (e) {
      results.push(`❌ ${o.name}: ${e.message.slice(0, 80)}`);
      await logAgent("DELE", `Delivery FAILED for ${o.name}: ${e.message.slice(0, 120)}`, "error");
    }
  }
  return { ok: true, checked: orders.length, sent, results };
}

// GET /api/delivery/dns-check — diagnose domain DNS (ns, txt, mx for verification)
deliveryRouter.get("/dns-check", async (req, res) => {
  const name = (req.query.name || "houseofjreym.store").toString();
  const out = {};
  try { out.ns = await dns.resolveNs(name); } catch (e) { out.ns = e.code; }
  try { out.dkim_txt = await dns.resolveTxt(`resend._domainkey.${name}`); } catch (e) { out.dkim_txt = e.code; }
  try { out.send_txt = await dns.resolveTxt(`send.${name}`); } catch (e) { out.send_txt = e.code; }
  try { out.send_mx = await dns.resolveMx(`send.${name}`); } catch (e) { out.send_mx = e.code; }
  res.json(out);
});

// GET /api/delivery/status — config check
deliveryRouter.get("/status", (req, res) => res.json({ resend_configured: !!RESEND_KEY, from: RESEND_FROM, poll: "every 5 min" }));
// GET /api/delivery/domain-records (GATED) — full DNS records for domain verification
deliveryRouter.get("/domain-records", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const list = await (await fetch("https://api.resend.com/domains", { headers: { "Authorization": `Bearer ${RESEND_KEY}` } })).json();
    const dom = (list.data || []).find(d => /houseofjreym/i.test(d.name)) || (list.data || [])[0];
    if (!dom) return res.status(404).json({ error: "no domain in Resend" });
    const full = await (await fetch(`https://api.resend.com/domains/${dom.id}`, { headers: { "Authorization": `Bearer ${RESEND_KEY}` } })).json();
    res.json({ id: dom.id, name: full.name, status: full.status, records: full.records });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/delivery/verify-domain (GATED) — ask Resend to verify
deliveryRouter.post("/verify-domain", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const list = await (await fetch("https://api.resend.com/domains", { headers: { "Authorization": `Bearer ${RESEND_KEY}` } })).json();
    const dom = (list.data || []).find(d => /houseofjreym/i.test(d.name));
    if (!dom) return res.status(404).json({ error: "no domain" });
    const v = await (await fetch(`https://api.resend.com/domains/${dom.id}/verify`, { method: "POST", headers: { "Authorization": `Bearer ${RESEND_KEY}` } })).json();
    res.json(v);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/delivery/run (GATED) — manual sweep
deliveryRouter.post("/run", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await runDelivery()); } catch (e) { res.status(500).json({ error: e.message }); }
});

cron.schedule("*/5 * * * *", () => { if (RESEND_KEY) runDelivery().catch(e => console.log("[delivery]", e.message)); });
console.log("[delivery] armed — 5-min paid-order sweep. RESEND=" + (RESEND_KEY ? "configured" : "MISSING KEY"));
