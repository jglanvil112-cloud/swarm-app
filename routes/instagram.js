// routes/instagram.js — Instagram OAuth, token maintenance, and publishing
import express from "express";
import crypto from "crypto";
import { logAgent, supabase } from "../lib/supabase.js";
import { fetchWithRetry } from "../lib/security.js";

export const instagramRouter = express.Router();

const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "https://swarm-app-3nch.onrender.com").replace(/\/$/, "");
const IG_APP_ID = process.env.INSTAGRAM_APP_ID || "";
const IG_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || "";
const IG_REDIRECT = `${APP_URL}/api/instagram/callback`;
const IG_GRAPH = "https://graph.instagram.com/v21.0";

function assertOAuthConfig() {
  if (!IG_APP_ID || !IG_APP_SECRET) throw new Error("INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are required");
}

async function getLiveCredentials() {
  const { data } = await supabase
    .from("social_credentials")
    .select("access_token,page_id,account_id,username,token_expires_at")
    .eq("platform", "instagram")
    .single();
  return data || null;
}

async function getLiveToken() {
  const stored = await getLiveCredentials();
  return stored?.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || "";
}

async function resolveIgId(token) {
  if (!token) return null;
  const response = await fetchWithRetry(`${IG_GRAPH}/me?fields=user_id,id,username&access_token=${encodeURIComponent(token)}`, {}, {
    retries: 1,
    timeoutMs: 10_000,
  });
  if (!response.ok) return null;
  const data = await response.json();
  return String(data.user_id || data.id || "") || null;
}

async function resolveUserId(token) {
  const stored = await getLiveCredentials();
  return stored?.page_id || stored?.account_id || await resolveIgId(token) || process.env.INSTAGRAM_USER_ID || null;
}

async function saveInstagramCredential({ accessToken, userId, username, expiresAt }) {
  const { error } = await supabase.from("social_credentials").upsert({
    platform: "instagram",
    access_token: accessToken,
    page_id: userId || null,
    account_id: userId || null,
    username: username || null,
    connected: true,
    token_expires_at: expiresAt || null,
    meta: { app_id: IG_APP_ID },
    updated_at: new Date().toISOString(),
  }, { onConflict: "platform" });
  if (error) throw new Error(error.message);
}

async function exchangeLongLivedToken(shortToken) {
  assertOAuthConfig();
  const response = await fetchWithRetry(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`,
    {},
    { retries: 2, timeoutMs: 12_000 },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || `long-lived token exchange ${response.status}`);
  return {
    accessToken: data.access_token || shortToken,
    expiresAt: new Date(Date.now() + Number(data.expires_in || 5183944) * 1000).toISOString(),
  };
}

async function createOAuthState() {
  const state = `ig_${crypto.randomBytes(20).toString("hex")}`;
  const { error } = await supabase.from("oauth_states").insert({
    state,
    verifier: "instagram-oauth",
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Instagram OAuth state save failed: ${error.message}`);
  return state;
}

async function consumeOAuthState(state) {
  if (!state) return false;
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("oauth_states")
    .select("state,created_at")
    .eq("state", state)
    .gte("created_at", cutoff)
    .single();
  if (error || !data) return false;
  await supabase.from("oauth_states").delete().eq("state", state);
  return true;
}

function oauthUrl(state) {
  const scopes = [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ].join(",");
  const params = new URLSearchParams({
    client_id: IG_APP_ID,
    redirect_uri: IG_REDIRECT,
    response_type: "code",
    scope: scopes,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

instagramRouter.get("/auth", async (_req, res) => {
  try {
    assertOAuthConfig();
    res.redirect(oauthUrl(await createOAuthState()));
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

instagramRouter.get("/auth-url", async (_req, res) => {
  try {
    assertOAuthConfig();
    const state = await createOAuthState();
    res.json({ url: oauthUrl(state), redirect_uri: IG_REDIRECT });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// Public OAuth callback. Server routing leaves only this Instagram path unauthenticated.
instagramRouter.get("/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.redirect(`/swarm_shop_os_v7.html?error=${encodeURIComponent(String(oauthError))}`);
  if (!code || !(await consumeOAuthState(String(state || "")))) {
    return res.status(403).send("Invalid or expired Instagram OAuth state");
  }

  try {
    assertOAuthConfig();
    const tokenResponse = await fetchWithRetry("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: IG_REDIRECT,
        code: String(code),
      }),
    }, { retries: 2, timeoutMs: 12_000 });
    const shortData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !shortData.access_token) {
      throw new Error(shortData.error_message || `short-token exchange ${tokenResponse.status}`);
    }

    const longLived = await exchangeLongLivedToken(shortData.access_token);
    const userId = String(shortData.user_id || await resolveIgId(longLived.accessToken) || "");
    if (!userId) throw new Error("Could not resolve Instagram user id");

    const meResponse = await fetchWithRetry(
      `${IG_GRAPH}/${encodeURIComponent(userId)}?fields=id,username&access_token=${encodeURIComponent(longLived.accessToken)}`,
      {},
      { retries: 1, timeoutMs: 10_000 },
    );
    const me = await meResponse.json().catch(() => ({}));
    await saveInstagramCredential({
      accessToken: longLived.accessToken,
      userId,
      username: me.username || null,
      expiresAt: longLived.expiresAt,
    });
    await logAgent("IBRAHIM", `Instagram OAuth connected${me.username ? `: @${me.username}` : ""}`, "success");
    res.redirect(`/swarm_shop_os_v7.html?instagram=connected${me.username ? `&user=${encodeURIComponent(me.username)}` : ""}`);
  } catch (error) {
    await logAgent("IBRAHIM", `Instagram OAuth callback failed: ${error.message}`, "error");
    res.redirect(`/swarm_shop_os_v7.html?error=${encodeURIComponent(error.message)}`);
  }
});

instagramRouter.post("/token", async (req, res) => {
  const { access_token, user_id } = req.body || {};
  if (!access_token) return res.status(400).json({ error: "access_token required" });
  try {
    const longLived = IG_APP_SECRET
      ? await exchangeLongLivedToken(access_token).catch(() => ({
          accessToken: access_token,
          expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
        }))
      : { accessToken: access_token, expiresAt: new Date(Date.now() + 60 * 86400000).toISOString() };
    const resolvedId = user_id || await resolveIgId(longLived.accessToken);
    if (!resolvedId) throw new Error("Token could not resolve an Instagram account");

    const meResponse = await fetchWithRetry(
      `${IG_GRAPH}/${encodeURIComponent(resolvedId)}?fields=id,username&access_token=${encodeURIComponent(longLived.accessToken)}`,
      {},
      { retries: 1, timeoutMs: 10_000 },
    );
    const me = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || me.error) throw new Error(me.error?.message || "Instagram token verification failed");

    await saveInstagramCredential({
      accessToken: longLived.accessToken,
      userId: String(me.id || resolvedId),
      username: me.username || null,
      expiresAt: longLived.expiresAt,
    });
    await logAgent("IBRAHIM", `Instagram token saved${me.username ? `: @${me.username}` : ""}`, "success");
    res.json({ ok: true, username: me.username || null, expires_at: longLived.expiresAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

instagramRouter.post("/post", async (req, res) => {
  try {
    const { image_url, caption } = req.body || {};
    if (!image_url || !caption) return res.status(400).json({ error: "image_url and caption required" });
    const token = await getLiveToken();
    if (!token) return res.status(401).json({ error: "Instagram not connected" });
    const userId = await resolveUserId(token);
    if (!userId) throw new Error("Instagram user id unavailable");

    const createResponse = await fetchWithRetry(`${IG_GRAPH}/${userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url, caption, media_type: "IMAGE", access_token: token }),
    }, { retries: 2, timeoutMs: 15_000 });
    const container = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || !container.id) throw new Error(container.error?.message || "Instagram media container failed");

    let ready = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const statusResponse = await fetchWithRetry(
        `${IG_GRAPH}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
        {},
        { retries: 1, timeoutMs: 10_000 },
      );
      const status = await statusResponse.json().catch(() => ({}));
      if (status.status_code === "FINISHED") { ready = true; break; }
      if (status.status_code === "ERROR" || status.status === "ERROR") {
        throw new Error("Instagram container processing failed");
      }
    }
    if (!ready) throw new Error("Instagram container still processing after 20 seconds");

    const publishResponse = await fetchWithRetry(`${IG_GRAPH}/${userId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: token }),
    }, { retries: 2, timeoutMs: 15_000 });
    const published = await publishResponse.json().catch(() => ({}));
    if (!publishResponse.ok || !published.id) throw new Error(published.error?.message || "Instagram publish failed");

    await logAgent("INSTAGRAM", `Published Instagram post ${published.id}`, "success");
    res.json({ success: true, post_id: published.id });
  } catch (error) {
    await logAgent("INSTAGRAM", `Publish failed: ${error.message}`, "error");
    res.status(500).json({ error: error.message });
  }
});

instagramRouter.get("/test", async (_req, res) => {
  try {
    const token = await getLiveToken();
    if (!token) return res.status(401).json({ connected: false, error: "Instagram not connected" });
    const userId = await resolveUserId(token);
    const response = await fetchWithRetry(
      `${IG_GRAPH}/${userId}?fields=id,username,followers_count,media_count&access_token=${encodeURIComponent(token)}`,
      {},
      { retries: 1, timeoutMs: 10_000 },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) return res.status(401).json({ connected: false, error: data.error?.message || `HTTP ${response.status}` });
    res.json({ connected: true, ...data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

instagramRouter.post("/refresh", async (_req, res) => {
  try {
    const token = await getLiveToken();
    if (!token) return res.status(401).json({ error: "Instagram not connected" });
    const response = await fetchWithRetry(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
      {},
      { retries: 2, timeoutMs: 12_000 },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || !data.access_token) throw new Error(data.error?.message || "Instagram refresh failed");
    const expiresAt = new Date(Date.now() + Number(data.expires_in || 5183944) * 1000).toISOString();
    await supabase
      .from("social_credentials")
      .update({ access_token: data.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq("platform", "instagram");
    await logAgent("IBRAHIM", "Instagram token refreshed", "success");
    res.json({ ok: true, expires_at: expiresAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
