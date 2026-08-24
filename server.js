// server.js — House of Jreym SWARM OS production entrypoint
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { shopifyRouter } from "./routes/shopify.js";
import { etsyRouter } from "./routes/etsy.js";
import { printifyRouter } from "./routes/printify.js";
import { tasksRouter } from "./routes/tasks.js";
import { pipelineRouter } from "./routes/pipeline.js";
import { socialRouter } from "./routes/social.js";
import { instagramRouter } from "./routes/instagram.js";
import { ibrahimRouter } from "./routes/ibrahim.js";
import { auditRouter } from "./routes/audit.js";
import { approveRouter } from "./routes/approve.js";
import { trendingRouter } from "./routes/trending.js";
import { podgenRouter } from "./routes/podgen.js";
import { deliveryRouter } from "./routes/delivery.js";
import { promoRouter } from "./routes/promo.js";
import { metricsRouter } from "./routes/metrics.js";
import { supabase, recordHealth, getRecentOutputs } from "./lib/supabase.js";
import { requireApiSecret } from "./lib/security.js";
import "./workers/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const APP_VERSION = process.env.APP_VERSION || "6.0.0";

app.set("trust proxy", 1);

const defaultOrigins = [
  "https://swarm-app-3nch.onrender.com",
  "http://localhost:5173",
  "http://localhost:4000",
];
const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("CORS blocked"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "x-approval-key", "Authorization", "apikey"],
  credentials: true,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "swarm_shop_os_v7.html")));
app.use(express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public")));

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || "";

function getAnthropic() {
  return process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
}

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  try { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
  catch { return null; }
}

function etsyAccessGuard(req, res, next) {
  const publicGetPaths = new Set(["/callback", "/listings", "/reviews"]);
  if (req.method === "GET" && publicGetPaths.has(req.path)) return next();
  return requireApiSecret(req, res, next);
}

function instagramAccessGuard(req, res, next) {
  if (req.method === "GET" && req.path === "/callback") return next();
  return requireApiSecret(req, res, next);
}

function shopifyAccessGuard(req, res, next) {
  // OAuth callback must remain reachable by Shopify. The legacy order webhook is
  // intentionally not public until it has raw-body HMAC verification; hourly order
  // sync remains the supported fallback.
  if (req.method === "GET" && req.path === "/callback") return next();
  return requireApiSecret(req, res, next);
}

// Administrative and cost-bearing routers fail closed behind API_SECRET.
app.use("/api/tasks", requireApiSecret, tasksRouter);
app.use("/api/pipeline", requireApiSecret, pipelineRouter);
app.use("/api/audit", requireApiSecret, auditRouter);
app.use("/api/trending", requireApiSecret, trendingRouter);
app.use("/api/podgen", requireApiSecret, podgenRouter);
app.use("/api/delivery", requireApiSecret, deliveryRouter);
app.use("/api/promo", requireApiSecret, promoRouter);
app.use("/api/printify", requireApiSecret, printifyRouter);
app.use("/api/metrics", requireApiSecret, metricsRouter);
app.use("/api/social", requireApiSecret, socialRouter);
app.use("/api/ibrahim", requireApiSecret, ibrahimRouter);
app.use("/api/etsy", etsyAccessGuard, etsyRouter);
app.use("/api/instagram", instagramAccessGuard, instagramRouter);
app.use("/api/shopify", shopifyAccessGuard, shopifyRouter);

// Approval is deliberately separate from API_SECRET and fails closed inside the router.
app.use("/api/approve", approveRouter);

const aiRate = new Map();
function aiRateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const max = Number(process.env.AI_REQUESTS_PER_MINUTE) || 30;
  const current = aiRate.get(key) || { count: 0, reset: now + windowMs };
  if (now > current.reset) {
    current.count = 0;
    current.reset = now + windowMs;
  }
  current.count += 1;
  aiRate.set(key, current);
  if (current.count > max) return res.status(429).json({ error: "Rate limit exceeded" });
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "SWARM OS",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    env: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      shopify: Boolean(process.env.SHOPIFY_DOMAIN),
      etsy: Boolean(process.env.ETSY_KEY || process.env.ETSY_API_KEY),
      instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
      supabase: Boolean(SUPABASE_URL && SUPABASE_KEY),
      printify: Boolean(process.env.PRINTIFY_API_KEY),
      api_secret: Boolean(process.env.API_SECRET),
      approval_secret: Boolean(process.env.APPROVAL_SECRET),
    },
    controls: {
      human_etsy_approval: true,
      file_required_before_publish: process.env.ALLOW_PUBLISH_WITHOUT_FILE !== "true",
      autonomous_product_drops: process.env.AUTONOMOUS_PRODUCT_DROPS === "true",
      public_shopify_webhooks: false,
    },
  });
});

app.get("/api/health/anthropic", async (_req, res) => {
  const anthropic = getAnthropic();
  if (!anthropic) return res.status(503).json({ status: "fail", reason: "key missing" });
  try {
    const started = Date.now();
    const response = await anthropic.messages.create({
      model: process.env.AGENT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    });
    await recordHealth("anthropic", "ok", Date.now() - started);
    res.json({ status: "ok", model: response.model, latency_ms: Date.now() - started });
  } catch (error) {
    await recordHealth("anthropic", "fail", null, { error: error.message });
    res.status(500).json({ status: "fail", reason: error.message });
  }
});

app.get("/api/health/openai", async (_req, res) => {
  const openai = getOpenAI();
  if (!openai) return res.json({ status: "degraded", reason: "OpenAI key not configured" });
  try {
    const started = Date.now();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    await recordHealth("openai", "ok", Date.now() - started);
    res.json({ status: "ok", model: response.model, latency_ms: Date.now() - started });
  } catch (error) {
    const degraded = error.status === 429 || /quota/i.test(error.message || "");
    await recordHealth("openai", degraded ? "degraded" : "fail", null, { error: error.message });
    res.json({ status: degraded ? "degraded" : "fail", reason: error.message });
  }
});

app.get("/api/health/supabase", async (_req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ status: "fail", reason: "Supabase not configured" });
    const started = Date.now();
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_KEY },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - started;
    if (!response.ok) return res.status(500).json({ status: "fail", http: response.status });
    await recordHealth("supabase", "ok", latency);
    res.json({ status: "ok", latency_ms: latency });
  } catch (error) {
    res.status(500).json({ status: "fail", reason: error.message });
  }
});

app.get("/api/health/shopify", async (_req, res) => {
  try {
    let token = process.env.SHOPIFY_ACCESS_TOKEN || "";
    let domain = process.env.SHOPIFY_DOMAIN || process.env.SHOPIFY_STORE || "";
    try {
      const { data: rows } = await supabase
        .from("oauth_tokens")
        .select("access_token,shop")
        .eq("platform", "shopify")
        .limit(1);
      if (rows?.[0]?.access_token) token = rows[0].access_token;
      if (rows?.[0]?.shop) domain = rows[0].shop;
    } catch {}
    domain = String(domain).replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!token || !domain) return res.json({ status: "needs_token" });
    const response = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
      headers: { "X-Shopify-Access-Token": token },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.json({ status: "needs_token", http: response.status });
    res.json({ status: "ok", domain });
  } catch (error) {
    res.json({ status: "fail", reason: error.message });
  }
});

app.get("/api/health/etsy", async (_req, res) => {
  try {
    const key = process.env.ETSY_KEY || process.env.ETSY_API_KEY || "";
    const secret = process.env.ETSY_SECRET || "";
    if (!key) return res.json({ status: "needs_token", reason: "ETSY_KEY not set" });
    const response = await fetch("https://openapi.etsy.com/v3/application/openapi-ping", {
      headers: { "x-api-key": secret ? `${key}:${secret}` : key },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.json({ status: "needs_token", http: response.status });
    res.json({ status: "ok" });
  } catch (error) {
    res.json({ status: "fail", reason: error.message });
  }
});

app.get("/api/outputs", requireApiSecret, async (req, res) => {
  try {
    const outputs = await getRecentOutputs(req.query.limit);
    res.json({ outputs, count: outputs.length, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/stats", requireApiSecret, async (_req, res) => {
  try {
    const [completed, pending, running, failed, logs] = await Promise.all([
      supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "running"),
      supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "failed"),
      supabase.from("agent_logs").select("agent,message,level,created_at").order("created_at", { ascending: false }).limit(20),
    ]);
    res.json({
      tasks: {
        completed: completed.count,
        pending: pending.count,
        running: running.count,
        failed: failed.count,
      },
      recentLogs: logs.data || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/admin/post-status", requireApiSecret, async (req, res) => {
  try {
    const { post_id, status } = req.body || {};
    if (!post_id || !status) return res.status(400).json({ error: "post_id and status required" });
    const allowed = ["paused", "scheduled", "draft", "cancelled", "failed"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
    const { data, error } = await supabase
      .from("social_posts")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", post_id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, post_id, new_status: status, post: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const SWARM_SYSTEM = "You are SWARM OS, the House of Jreym commerce command center. Give concise, evidence-aware operational recommendations. Do not claim actions were taken unless tool or database results confirm them.";
app.post("/api/swarm", requireApiSecret, aiRateLimit, async (req, res) => {
  const anthropic = getAnthropic();
  if (!anthropic) return res.status(503).json({ error: "Anthropic not configured" });
  try {
    const { prompt, history = [], userMessage } = req.body || {};
    const content = prompt || userMessage || "";
    if (!content) return res.status(400).json({ error: "No message" });
    const messages = [
      ...history.filter((message) => message?.role && typeof message.content === "string").slice(-20),
      { role: "user", content },
    ];
    const response = await anthropic.messages.create({
      model: process.env.AGENT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SWARM_SYSTEM,
      messages,
    });
    res.json({ reply: response.content?.[0]?.text || "", agent: "SWARM OS", model: response.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/openai", requireApiSecret, aiRateLimit, async (req, res) => {
  const openai = getOpenAI();
  if (!openai) return res.status(503).json({ error: "OpenAI not configured" });
  try {
    const { prompt, messages: history = [], model = "gpt-4o-mini" } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "No prompt" });
    const messages = [...history.slice(-20), { role: "user", content: prompt }];
    const response = await openai.chat.completions.create({ model, max_tokens: 1024, messages });
    res.json({ reply: response.choices?.[0]?.message?.content || "", model: response.model, agent: "OPENAI" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const SPORTS_SYSTEM = "You are SWARM-X sports analysis. Return JSON only. Never present uncertain outcomes as guaranteed.";
app.post("/api/swarm/analyze", requireApiSecret, aiRateLimit, async (req, res) => {
  const anthropic = getAnthropic();
  if (!anthropic) return res.status(503).json({ error: "Anthropic not configured" });
  try {
    const { prompt, bankroll } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "No prompt" });
    const response = await anthropic.messages.create({
      model: process.env.AGENT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: SPORTS_SYSTEM,
      messages: [{ role: "user", content: `Analyze: ${prompt}${bankroll ? `. Bankroll: $${bankroll}` : ""}` }],
    });
    const raw = (response.content?.[0]?.text || "").trim().replace(/```json\n?/g, "").replace(/```\n?/g, "");
    let plays;
    try { plays = JSON.parse(raw); }
    catch { return res.status(500).json({ error: "Parse failed" }); }
    res.json({ plays: Array.isArray(plays) ? plays : [plays], agent: "SWARM-X", model: response.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (_req, res) => res.json({ status: `SWARM OS ${APP_VERSION} ONLINE` }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`SWARM OS ${APP_VERSION} :${PORT} | API guard:${process.env.API_SECRET ? "ON" : "DISABLED"}`);
});

const KEEPALIVE_URL = `${(process.env.RENDER_EXTERNAL_URL || "https://swarm-app-3nch.onrender.com").replace(/\/$/, "")}/api/health`;
setInterval(() => {
  fetch(KEEPALIVE_URL, { signal: AbortSignal.timeout(8000) }).catch(() => {});
}, 13 * 60 * 1000);
