// routes/etsy.js — Etsy OAuth v3 (PKCE) + integration
import express from "express";
import crypto from "crypto";
import { supabase, logAgent, enqueueTask } from "../lib/supabase.js";
export const etsyRouter = express.Router();

const ETSY_KEY    = process.env.ETSY_API_KEY    || "";
const ETSY_SECRET = process.env.ETSY_SECRET_KEY || "";
const ETSY_SHOP   = process.env.SHOP_NAME       || "HOUSEOFJREYM";
const APP_URL     = process.env.APP_URL         || "https://swarm-app-3nch.onrender.com";
const REDIRECT_URI = `${APP_URL}/api/etsy/allback`;
const oauthStates = new Map();

async function getEtsyToken() {
  const { data } = await supabase.from("oauth_tokens").select("access_token,refresh_token,expires_at").eq("platform","etsy").single();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return await refreshEtsyToken(data.refresh_token);
  return data.access_token;
}

async function refreshEtsyToken(refreshToken) {
  const r = await fetch("https://api.etsy.com/v3/public/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: ETSY_KEY, refresh_token: refreshToken }) });
  const data = await r.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  await supabase.from("oauth_tokens").upsert({ platform: "etsy", access_token: data.access_token, refresh_token: data.refresh_token, expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "platform" });
  return data.access_token;
}

function etsyAuthHeaders(token) { return { "Authorization": `Bearer ${token}`, "x-api-key": ETSY_KEY, "Content-Type": "application/json" }; }
function etsyPublicHeaders() { return { "x-api-key": ETSY_KEY }; }

// OAuth PKCE Step 1
etsyRouter.get("/auth", (req, res) => {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.set(state, { codeVerifier, createdAt: Date.now() });
  const scopes = "listings_r listings_w listings_d transactions_r transactions_w billing_r profile_r shops_r shops_w".split(" ").join("%20");
  res.redirect(`https://www.etsy.com/oauth/connect?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&client_id=${ETSY_KEY}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`);
});

// OAuth PKCE Step 2
etsyRouter.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  const stored = oauthStates.get(state);
  if (!stored) return res.status(403).json({ error: "Invalid state" });
  oauthStates.delete(state);
  try {
    const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: ETSY_KEY, redirect_uri: REDIRECT_URI, code, code_verifier: stored.codeVerifier }) });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(500).json({ error: "Etsy token exchange failed", detail: tokenData });
    await supabase.from("oauth_tokens").upsert({ platform: "etsy", access_token: tokenData.access_token, refresh_token: tokenData.refresh_token, expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "platform" });
    await logAgent("AISHA", "Etsy OAuth completed", "success");
    res.redirect(`/swarm_shop_os_v5.html?etsy=connected`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

etsyRouter.get("/shop", async (req, res) => {
  try {
    const token = await getEtsyToken();
    const headers = token ? etsyAuthHeaders(token) : etsyPublicHeaders();
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}`, { headers });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Etsy ${r.status}`, detail: e.slice(0,300) }); }
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

etsyRouter.get("/listings", async (req, res) => {
  try {
    const token = await getEtsyToken();
    const headers = token ? etsyAuthHeaders(token) : etsyPublicHeaders();
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}/listings/active?limit=${req.query.limit||25}&includes=Images`, { headers });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Etsy ${r.status}`, detail: e.slice(0,300) }); }
    const data = await r.json();
    if (data.results?.length) {
      for (const l of data.results) {
        await supabase.from("products").upsert({ external_id: String(l.listing_id), platform: "etsy", title: l.title, description: l.description?.slice(0,1000), tags: l.tags||[], price: l.price ? l.price.amount/l.price.divisor : 0, status: l.state, updated_at: new Date().toISOString() }, { onConflict: "external_id,platform" });
      }
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

etsyRouter.post("/listings", async (req, res) => {
  const task = await enqueueTask({ agent: "AISHA", task_type: "seo_generation", payload: { ...req.body.listing, action: "create_listing", requires_approval: true }, priority: 2 });
  res.json({ queued: true, task_id: task.id, message: "Listing queued for approval before publishing" });
});

etsyRouter.patch("/listings/:id", async (req, res) => {
  try {
    const token = await getEtsyToken();
    if (!token) return res.status(401).json({ error: "Etsy not authenticated — visit /api/etsy/auth" });
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}/listings/${req.params.id}`, { method: "PATCH", headers: etsyAuthHeaders(token), body: JSON.stringify(req.body) });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

etsyRouter.get("/orders", async (req, res) => {
  try {
    const token = await getEtsyToken();
    if (!token) return res.status(401).json({ error: "Etsy not authenticated" });
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}/receipts?limit=25`, { headers: etsyAuthHeaders(token) });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Etsy ${r.status}`, detail: e.slice(0,300) }); }
    const data = await r.json();
    if (data.results?.length) {
      for (const o of data.results) {
        await supabase.from("revenue_events").upsert({ platform: "etsy", order_id: String(o.receipt_id), amount: parseFloat(o.grandtotal?.amount||0)/100, recorded_at: new Date(o.create_timestamp*1000).toISOString() }, { onConflict: "order_id" });
      }
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

etsyRouter.get("/reviews", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}/reviews?limit=10`, { headers: etsyPublicHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: `Etsy ${r.status}` });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
