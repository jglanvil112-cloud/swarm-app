import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
global.WebSocket = WebSocket;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "dist")));

// ── CLIENTS ───────────────────────────────────────────────────────────────────
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── CONFIG ────────────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-5-20250929";
const PRINTIFY_KEY = process.env.PRINTIFY_API_KEY;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
let SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || null;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const ETSY_KEY = process.env.ETSY_API_KEY;
const SHOP_NAME = "HOUSEOFJREYM";

// ── AGENT PROMPTS ─────────────────────────────────────────────────────────────
const PROMPTS = {
  prime: `You are SWARMX PRIME of HOUSE OF JREYM. Supreme AI commerce orchestrator. You receive results from all sub-agents, review past memory, and make final decisions. Maximize profit across Etsy and Shopify. Return JSON only: {"decisions":[],"delegations":[],"priority":"","reasoning":"","nextActions":[],"revenueTarget":""}`,

  trends: `You are TREND HUNTER for HOUSE OF JREYM. Find viral Etsy and Shopify niches using current signals. Always build on past trend data. Return JSON only: {"trends":[{"niche":"","score":0,"opportunity":"","urgency":"","platform":""}],"topNiche":"","action":"","weeklyFocus":""}`,

  products: `You are PRODUCT FORGE for HOUSE OF JREYM. Create print-on-demand products for Etsy and Shopify. Return JSON only: {"products":[{"title":"","type":"","niche":"","pricePoint":"","estimatedRevenue":"","platform":"etsy|shopify|both"}]}`,

  seo: `You are SEO AGENT for HOUSE OF JREYM. Optimize listings for Etsy search and Shopify SEO. Return JSON only: {"title":"","tags":[],"description":"","primaryKeyword":"","rankingScore":0,"shopifyMetaTitle":"","shopifyMetaDescription":""}`,

  design: `You are DESIGN AGENT. Create Midjourney prompts for HOUSE OF JREYM products. Return JSON only: {"midjourneyPrompt":"","colorPalette":[],"styleNotes":"","mockupAngles":[]}`,

  listing: `You are LISTING AGENT. Create optimized Etsy and Shopify listings. Return JSON only: {"listingData":{"title":"","price":0,"description":"","tags":[]},"pricingStrategy":"","shopifyPrice":0,"action":""}`,

  analytics: `You are ANALYTICS AGENT for HOUSE OF JREYM. Analyze Etsy and Shopify performance. Identify patterns and revenue drivers. Return JSON only: {"insights":[],"topPerformers":[],"underperformers":[],"recommendations":[],"revenueProjection":"","hourlyTrend":"up|down|flat"}`,

  evolution: `You are EVOLUTION AGENT. Kill losers, scale winners across Etsy and Shopify. Return JSON only: {"kill":[],"scale":[],"iterate":[],"newDirections":[],"evolutionScore":0,"platformShift":""}`,

  customer: `You are CUSTOMER SERVICE AGENT for HOUSE OF JREYM. Handle buyer messages for 5-star reviews. Return JSON only: {"response":"","tone":"","action":"","reviewStrategy":"","escalate":false}`,

  compliance: `You are COMPLIANCE AGENT. Check Etsy TOS, Shopify policies, and copyright for HOUSE OF JREYM. Return JSON only: {"status":"clear","risks":[],"recommendations":[],"tosCompliant":true,"shopifyCompliant":true}`,

  marketing: `You are MARKETING AGENT for HOUSE OF JREYM. Run multi-platform campaigns to maximize reach on Etsy and drive traffic to houseofjreym.store. Create compelling blog content for Shopify, social captions, and email hooks. Return JSON only: {"campaigns":[{"platform":"","content":"","targetAudience":"","estimatedReach":0}],"campaignReach":0,"topChannel":"","shopifyBlogPost":{"title":"","bodyHtml":"","tags":[]},"socialCaptions":{"instagram":"","tiktok":"","pinterest":""},"action":"","recommendations":[]}`,
};

// ── SUPABASE MEMORY ────────────────────────────────────────────────────────────
async function saveMemory(agent, data) {
  const { error } = await supabase
    .from("agent_memory")
    .upsert({ agent, data, updated_at: new Date().toISOString() }, { onConflict: "agent" });
  if (error) console.error(`[Memory] Save error for ${agent}:`, error.message);
}

async function loadMemory(agent) {
  const { data, error } = await supabase
    .from("agent_memory")
    .select("data")
    .eq("agent", agent)
    .single();
  if (error) return null;
  return data?.data || null;
}

async function loadAllMemory() {
  const { data, error } = await supabase.from("agent_memory").select("*");
  if (error) return {};
  return Object.fromEntries((data || []).map((r) => [r.agent, r.data]));
}

// ── SHOPIFY HELPERS ───────────────────────────────────────────────────────────
async function shopifyFetch(endpoint, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01${endpoint}`, opts);
  return r.json();
}

async function postShopifyBlog(title, bodyHtml, tags = []) {
  if (!SHOPIFY_TOKEN) return null;
  const blogs = await shopifyFetch("/blogs.json");
  const blogId = blogs.blogs?.[0]?.id;
  if (!blogId) { console.warn("[Shopify] No blog found"); return null; }
  const result = await shopifyFetch(`/blogs/${blogId}/articles.json`, "POST", {
    article: { title, body_html: bodyHtml, tags: tags.join(","), published: true },
  });
  console.log(`[Shopify] Blog posted: ${title}`);
  return result;
}

// ── CORE AGENT RUNNER ─────────────────────────────────────────────────────────
async function runAgent(agentName, userMessage, previousMemory = null) {
  const prompt = PROMPTS[agentName];
  if (!prompt) throw new Error("Unknown agent: " + agentName);

  const memory = previousMemory ?? await loadMemory(agentName);
  const systemPrompt = memory
    ? `${prompt}\n\nYour last run memory: ${JSON.stringify(memory)}. Build on this — don't repeat, evolve.`
    : prompt;

  const r = await claude.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = r.content[0].text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    await saveMemory(agentName, parsed);
    return parsed;
  } catch {
    return { raw };
  }
}

// ── SALES SNAPSHOT ─────────────────────────────────────────────────────────────
async function takeSalesSnapshot() {
  try {
    const [shopifyRes, etsyRes] = await Promise.allSettled([
      shopifyFetch("/orders.json?status=any&limit=50&fields=total_price,created_at,line_items"),
      fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}/receipts?limit=25`, {
        headers: { "x-api-key": ETSY_KEY },
      }).then((r) => r.json()),
    ]);

    const shopifyOrders = shopifyRes.status === "fulfilled" ? shopifyRes.value?.orders || [] : [];
    const etsyReceipts = etsyRes.status === "fulfilled" ? etsyRes.value?.results || [] : [];

    const shopifyRevenue = shopifyOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const etsyRevenue = etsyReceipts.reduce((s, r) => s + parseFloat(r.grandtotal?.amount || 0) / 100, 0);

    const snapshot = {
      snapshot_at: new Date().toISOString(),
      hour: new Date().getHours(),
      shopify_orders: shopifyOrders.length,
      shopify_revenue: parseFloat(shopifyRevenue.toFixed(2)),
      etsy_orders: etsyReceipts.length,
      etsy_revenue: parseFloat(etsyRevenue.toFixed(2)),
      total_revenue: parseFloat((shopifyRevenue + etsyRevenue).toFixed(2)),
    };

    await supabase.from("sales_snapshots").insert(snapshot);
    console.log(`[Snapshot] $${snapshot.total_revenue} total | ${snapshot.shopify_orders + snapshot.etsy_orders} orders`);
    return snapshot;
  } catch (e) {
    console.error("[Snapshot] Error:", e.message);
    return null;
  }
}

// ── AUTONOMOUS PIPELINE ────────────────────────────────────────────────────────
async function runAutonomousPipeline() {
  console.log("🤖 [Pipeline] SWARMX AUTONOMOUS PIPELINE STARTING...");
  try {
    const mem = await loadAllMemory();

    // Stage 1: Intelligence gathering
    const trends = await runAgent("trends", "Find top Etsy + Shopify opportunities right now.", mem.trends);
    const analytics = await runAgent("analytics", `Analyze HOUSE OF JREYM performance. Past data: ${JSON.stringify(mem.analytics)}`, mem.analytics);

    // Stage 2: Creation (informed by Stage 1)
    const products = await runAgent("products", `Create products for niche: "${trends.topNiche}". Analytics say: ${JSON.stringify(analytics.topPerformers)}`, mem.products);
    const seo = await runAgent("seo", `Optimize for: ${products.products?.[0]?.title || trends.topNiche}`, mem.seo);
    const design = await runAgent("design", `Design for niche: "${trends.topNiche}"`, mem.design);
    const listing = await runAgent("listing", `Create listing: ${products.products?.[0]?.title}. SEO data: ${JSON.stringify(seo)}`, mem.listing);

    // Stage 3: Marketing (informed by everything)
    const marketing = await runAgent(
      "marketing",
      `Create campaigns for: "${trends.topNiche}". Top products: ${JSON.stringify(products.products?.slice(0, 2))}. Analytics: ${JSON.stringify(analytics.insights)}`,
      mem.marketing
    );

    // Stage 4: Evolution + Compliance
    const evolution = await runAgent("evolution", `Scale winners, kill losers. Analytics: ${JSON.stringify(analytics)}`, mem.evolution);
    const compliance = await runAgent("compliance", `Review products: ${JSON.stringify(products.products?.slice(0, 3))}`, mem.compliance);

    // Stage 5: PRIME reviews all
    const prime = await runAgent(
      "prime",
      `Review all outputs and issue final orders: ${JSON.stringify({ trends, analytics, products, seo, listing, marketing, evolution, compliance })}`,
      mem.prime
    );

    // Post to Shopify blog if marketing generated content
    if (marketing.shopifyBlogPost?.title && SHOPIFY_TOKEN) {
      await postShopifyBlog(
        marketing.shopifyBlogPost.title,
        marketing.shopifyBlogPost.bodyHtml,
        marketing.shopifyBlogPost.tags
      );
    }

    // Log full pipeline run to Supabase
    await supabase.from("pipeline_runs").insert({
      run_at: new Date().toISOString(),
      trends, analytics, products, seo, design, listing, marketing, evolution, compliance, prime,
    });

    console.log("✅ [Pipeline] AUTONOMOUS PIPELINE COMPLETE");
    return { trends, analytics, products, seo, design, listing, marketing, evolution, compliance, prime };
  } catch (e) {
    console.error("[Pipeline] Error:", e.message);
    throw e;
  }
}

// ── CRON JOBS ──────────────────────────────────────────────────────────────────
// Every hour — sales snapshot
cron.schedule("0 * * * *", () => {
  console.log("[Cron] Hourly sales snapshot");
  takeSalesSnapshot();
});

// Daily at 8:00 AM UTC — full autonomous pipeline
cron.schedule("0 8 * * *", () => {
  console.log("[Cron] Daily autonomous pipeline");
  runAutonomousPipeline();
});

// ── ROUTES: AGENTS ─────────────────────────────────────────────────────────────
app.post("/api/agents/:agent", async (req, res) => {
  try {
    if (!PROMPTS[req.params.agent])
      return res.status(404).json({ error: "Unknown agent: " + req.params.agent });
    const msg = req.body.mission || req.body.message || req.body.niche || req.body.product || "Run your daily optimization";
    const result = await runAgent(req.params.agent, msg);
    res.json({ agent: req.params.agent, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTES: PIPELINE ──────────────────────────────────────────────────────────
app.post("/api/pipeline/full", async (req, res) => {
  try {
    const result = await runAutonomousPipeline();
    res.json({ success: true, pipeline: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/pipeline/trigger", (req, res) => {
  res.json({ status: "Pipeline triggered — running in background" });
  runAutonomousPipeline();
});

app.get("/api/pipeline/history", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("run_at, prime, marketing, analytics, trends")
      .order("run_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    res.json({ runs: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTES: SPORTS BETTING ────────────────────────────────────────────────────
app.post("/api/swarm/analyze", async (req, res) => {
  try {
    const sys = `You are SWARMX Quantum Edge sports betting analyzer with 5 agents: Stats, Injury, Odds, Trend, Trap Detector. Analyze the given bet. Return ONLY a JSON array with no markdown: [{"id":1,"sport":"","game":"","betType":"","pick":"","odds":"","statsEdge":75,"injuryEdge":70,"oddsEdge":68,"trendEdge":72,"trapRisk":25,"confidence":74,"risk":"Low","action":"LEAN","reasons":[],"redFlags":[]}]`;
    const r = await claude.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: sys,
      messages: [{ role: "user", content: `Analyze this bet: ${req.body.prompt}. Bankroll: $${req.body.bankroll || 1000}` }],
    });
    const text = r.content[0].text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let plays = JSON.parse(text);
    if (!Array.isArray(plays)) plays = [plays];
    res.json({ plays: plays.map((p, i) => ({ ...p, id: Date.now() + i })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/swarm", async (req, res) => {
  try {
    const r = await claude.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: "You are SWARMX PRIME of HOUSE OF JREYM, an autonomous AI Etsy + Shopify commerce empire. Help the user maximize profit.",
      messages: [...(req.body.history || []), { role: "user", content: req.body.prompt }],
    });
    res.json({ reply: r.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTES: MEMORY ────────────────────────────────────────────────────────────
app.get("/api/memory", async (req, res) => {
  try {
    res.json(await loadAllMemory());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/memory/:agent", async (req, res) => {
  try {
    res.json({ agent: req.params.agent, memory: await loadMemory(req.params.agent) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/memory/:agent", async (req, res) => {
  try {
    await supabase.from("agent_memory").delete().eq("agent", req.params.agent);
    res.json({ cleared: req.params.agent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTES: SALES GRAPHS ──────────────────────────────────────────────────────
app.get("/api/sales/hourly", async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("sales_snapshots")
      .select("snapshot_at, hour, shopify_revenue, etsy_revenue, total_revenue, shopify_orders, etsy_orders")
      .gte("snapshot_at", since)
      .order("snapshot_at", { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ snapshots: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sales/daily", async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("sales_snapshots")
      .select("snapshot_at, shopify_revenue, etsy_revenue, total_revenue, shopify_orders, etsy_orders")
      .gte("snapshot_at", since)
      .order("snapshot_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Roll up to daily max values
    const byDay = {};
    for (const row of data || []) {
      const day = row.snapshot_at.slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, shopify_revenue: 0, etsy_revenue: 0, total_revenue: 0, orders: 0 };
      if (row.total_revenue > byDay[day].total_revenue) {
        byDay[day].shopify_revenue = row.shopify_revenue;
        byDay[day].etsy_revenue = row.etsy_revenue;
        byDay[day].total_revenue = row.total_revenue;
      }
      byDay[day].orders += (row.shopify_orders || 0) + (row.etsy_orders || 0);
    }
    res.json({ daily: Object.values(byDay) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sales/snapshot", async (req, res) => {
  try {
    const snapshot = await takeSalesSnapshot();
    res.json(snapshot || { error: "Snapshot failed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTES: SHOPIFY ───────────────────────────────────────────────────────────
app.get("/api/shopify/orders", async (req, res) => {
  try {
    res.json(await shopifyFetch("/orders.json?status=any&limit=50"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/shopify/products", async (req, res) => {
  try {
    res.json(await shopifyFetch("/products.json?limit=50"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/shopify/blog", async (req, res) => {
  try {
    const { title, bodyHtml, tags } = req.body;
    res.json(await postShopifyBlog(title, bodyHtml, tags));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTES: PRINTIFY ──────────────────────────────────────────────────────────
app.get("/api/printify/shops", async (req, res) => {
  try {
    const r = await fetch("https://api.printify.com/v1/shops.json", {
      headers: { Authorization: "Bearer " + PRINTIFY_KEY },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/printify/products", async (req, res) => {
  try {
    const r = await fetch(`https://api.printify.com/v1/shops/${req.query.shopId}/products.json`, {
      headers: { Authorization: "Bearer " + PRINTIFY_KEY },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/printify/catalog", async (req, res) => {
  try {
    const r = await fetch("https://api.printify.com/v1/catalog/blueprints.json", {
      headers: { Authorization: "Bearer " + PRINTIFY_KEY },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTES: ETSY ──────────────────────────────────────────────────────────────
app.get("/api/etsy/shop", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}`, {
      headers: { "x-api-key": ETSY_KEY },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/etsy/listings", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}/listings/active?limit=25`, {
      headers: { "x-api-key": ETSY_KEY },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/etsy/stats", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}/receipts?limit=25`, {
      headers: { "x-api-key": ETSY_KEY },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HEALTH & CATCH-ALL ────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "HOUSE OF JREYM ONLINE",
    version: "5.0.0",
    agents: Object.keys(PROMPTS).length,
    model: MODEL,
    autonomous: true,
    schedule: { pipeline: "daily 8am UTC", snapshot: "hourly" },
  });
});

// ── SHOPIFY OAUTH ─────────────────────────────────────────────────────────────
app.get("/auth/shopify", (req, res) => {
  const scopes = "read_orders,read_products,write_products,read_analytics,read_inventory";
  const redirectUri = `${process.env.APP_URL || "https://swarm-app-3nch.onrender.com"}/auth/shopify/callback`;
  const authUrl = `https://${SHOPIFY_DOMAIN}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${redirectUri}`;
  res.redirect(authUrl);
});

app.get("/auth/shopify/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided");
  try {
    const r = await fetch(`https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code }),
    });
    const data = await r.json();
    if (data.access_token) {
      SHOPIFY_TOKEN = data.access_token;
      await supabase.from("agent_memory").upsert({ agent: "shopify_token", data: { token: data.access_token }, updated_at: new Date().toISOString() }, { onConflict: "agent" });
      console.log("[Shopify OAuth] Token saved:", data.access_token.slice(0, 10) + "...");
      res.send("<h1>✅ Shopify Connected!</h1><p>Token saved. You can close this tab.</p>");
    } else {
      res.status(400).send("OAuth failed: " + JSON.stringify(data));
    }
  } catch (e) {
    res.status(500).send("OAuth error: " + e.message);
  }
});

app.get("/api/shopify/status", (req, res) => {
  res.json({ connected: !!SHOPIFY_TOKEN, domain: SHOPIFY_DOMAIN });
});


app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 HOUSE OF JREYM v5.0 · ${Object.keys(PROMPTS).length} agents · AUTONOMOUS · port ${PORT}`)
);
