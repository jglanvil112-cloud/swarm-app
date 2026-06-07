import express from "express";
import { logAgent, supabase } from "../lib/supabase.js";
export const instagramRouter = express.Router();

const APP_URL = process.env.APP_URL || "https://swarm-app-3nch.onrender.com";
const IG_APP_ID     = "1018858183882731";
const IG_APP_SECRET = "faf388b0ba788c5d20e949d8973f2a07";
const IG_REDIRECT   = APP_URL + "/api/instagram/callback";

// Helper: get live token from Supabase (falls back to env var)
async function getLiveToken() {
  try {
    const { data } = await supabase.from("social_credentials")
      .select("access_token").eq("platform", "instagram").single();
    if (data?.access_token) return data.access_token;
  } catch {}
  return process.env.INSTAGRAM_ACCESS_TOKEN || "";
}

async function getLiveUserId() {
  try {
    const { data } = await supabase.from("social_credentials")
      .select("page_id,account_id").eq("platform", "instagram").single();
    if (data?.page_id) return data.page_id;
  } catch {}
  return process.env.INSTAGRAM_USER_ID || "17841436491512867";
}

// ─── OAUTH FLOW ───────────────────────────────────────────────────────────────

// GET /api/instagram/auth — start IG OAuth, redirect to Instagram login
instagramRouter.get("/auth", (req, res) => {
  const scopes = [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
    "instagram_business_content_publish",
    "instagram_business_manage_insights"
  ].join(",");
  const url = `https://www.instagram.com/oauth/authorize?client_id=${IG_APP_ID}&redirect_uri=${encodeURIComponent(IG_REDIRECT)}&response_type=code&scope=${scopes}`;
  res.redirect(url);
});

// GET /api/instagram/callback — Instagram OAuth callback, exchanges code for token
instagramRouter.get("/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/social_dashboard.html?error=${encodeURIComponent(error)}`);
  if (!code)  return res.redirect("/social_dashboard.html?error=no_ig_code");

  try {
    // Exchange code for short-lived token
    const r = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: IG_REDIRECT,
        code
      })
    });
    const shortData = await r.json();
    if (shortData.error_type || shortData.error_message) {
      throw new Error(`Short-token exchange failed: ${shortData.error_message}`);
    }

    // Exchange for long-lived token (60 days)
    const ll = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortData.access_token}`);
    const llData = await ll.json();
    const finalToken = llData.access_token || shortData.access_token;
    const expiresIn  = llData.expires_in  || 5183944; // 60 days
    const expiresAt  = new Date(Date.now() + expiresIn * 1000).toISOString();
    const userId     = shortData.user_id?.toString() || "17841436491512867";

    // Get username
    const me = await fetch(`https://graph.instagram.com/v21.0/${userId}?fields=id,username&access_token=${finalToken}`);
    const meData = await me.json();

    // Save to Supabase
    await supabase.from("social_credentials").upsert({
      platform: "instagram",
      access_token: finalToken,
      page_id: userId,
      account_id: userId,
      username: meData.username || "houseofjreym",
      connected: true,
      token_expires_at: expiresAt,
      meta: { app_id: IG_APP_ID, user_id: userId },
      updated_at: new Date().toISOString()
    }, { onConflict: "platform" });

    await logAgent("IBRAHIM", `Instagram OAuth connected: @${meData.username || "houseofjreym"}`, "success");
    res.redirect(`/social_dashboard.html?instagram=connected&user=${encodeURIComponent(meData.username || "houseofjreym")}`);
  } catch (e) {
    console.error("[IG] callback error:", e.message);
    await logAgent("IBRAHIM", "Instagram OAuth callback failed: " + e.message, "error");
    res.redirect("/social_dashboard.html?error=" + encodeURIComponent(e.message));
  }
});

// POST /api/instagram/token — paste a token directly (bypasses OAuth)
instagramRouter.post("/token", async (req, res) => {
  const { access_token, user_id } = req.body;
  if (!access_token) return res.status(400).json({ error: "access_token required" });
  try {
    // Try to exchange for long-lived token first
    let finalToken = access_token;
    let expiresAt  = new Date(Date.now() + 5183944000).toISOString();
    try {
      const ll = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${access_token}`);
      const llData = await ll.json();
      if (llData.access_token) { finalToken = llData.access_token; expiresAt = new Date(Date.now() + (llData.expires_in || 5183944) * 1000).toISOString(); }
    } catch {}

    // Verify token and get username
    const uid = user_id || "17841436491512867";
    const me = await fetch(`https://graph.instagram.com/v21.0/${uid}?fields=id,username&access_token=${finalToken}`);
    const meData = await me.json();
    if (meData.error) throw new Error("Token invalid: " + meData.error.message);

    await supabase.from("social_credentials").upsert({
      platform: "instagram", access_token: finalToken,
      page_id: meData.id || uid, account_id: meData.id || uid,
      username: meData.username || "houseofjreym",
      connected: true, token_expires_at: expiresAt,
      meta: { app_id: IG_APP_ID }, updated_at: new Date().toISOString()
    }, { onConflict: "platform" });

    await logAgent("IBRAHIM", `Instagram token saved: @${meData.username}`, "success");
    res.json({ ok: true, username: meData.username, expires_at: expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POSTING ──────────────────────────────────────────────────────────────────

instagramRouter.post("/post", async (req, res) => {
  try {
    const { image_url, caption } = req.body;
    if (!image_url || !caption) return res.status(400).json({ error: "image_url and caption required" });
    const token  = await getLiveToken();
    const userId = await getLiveUserId();
    const base   = "https://graph.facebook.com/v21.0";
    const c = await fetch(`${base}/${userId}/media`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url, caption, access_token: token }) });
    const container = await c.json();
    if (container.error) { await logAgent("INSTAGRAM","error",container.error.message); return res.status(500).json({ error: container.error.message }); }
    const p = await fetch(`${base}/${userId}/media_publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creation_id: container.id, access_token: token }) });
    const published = await p.json();
    if (published.error) { await logAgent("INSTAGRAM","error",published.error.message); return res.status(500).json({ error: published.error.message }); }
    await logAgent("INSTAGRAM","success",`Posted: ${published.id}`);
    return res.json({ success: true, post_id: published.id });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// GET /api/instagram/test — verify token works
instagramRouter.get("/test", async (req, res) => {
  try {
    const token  = await getLiveToken();
    const userId = await getLiveUserId();
    const r = await fetch(`https://graph.instagram.com/v21.0/${userId}?fields=id,username,followers_count,media_count&access_token=${token}`);
    const data = await r.json();
    if (data.error) return res.status(401).json({ connected: false, error: data.error.message });
    res.json({ connected: true, ...data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/instagram/auth-url — returns the OAuth URL for the frontend to use
instagramRouter.get("/auth-url", (req, res) => {
  const scopes = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights";
  const url = `https://www.instagram.com/oauth/authorize?client_id=${IG_APP_ID}&redirect_uri=${encodeURIComponent(IG_REDIRECT)}&response_type=code&scope=${scopes}`;
  res.json({ url, redirect_uri: IG_REDIRECT });
});

// POST /api/instagram/refresh — refresh a long-lived token (before 60 days expire)
instagramRouter.post("/refresh", async (req, res) => {
  try {
    const token = await getLiveToken();
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    const expiresAt = new Date(Date.now() + (data.expires_in || 5183944) * 1000).toISOString();
    await supabase.from("social_credentials").update({ access_token: data.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() }).eq("platform", "instagram");
    await logAgent("IBRAHIM", "Instagram token refreshed", "success");
    res.json({ ok: true, expires_at: expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
