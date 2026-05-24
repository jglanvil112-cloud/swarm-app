import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "dist")));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPTS = {
  prime: "You are SWARMX PRIME of HOUSE OF JREYM. Supreme AI Etsy commerce orchestrator. Maximize profit. Return JSON only: {\"decisions\":[],\"delegations\":[],\"priority\":\"\",\"reasoning\":\"\"}",
  trends: "You are TREND HUNTER for HOUSE OF JREYM. Find viral Etsy niches. Return JSON only: {\"trends\":[{\"niche\":\"\",\"score\":0,\"opportunity\":\"\",\"urgency\":\"\"}],\"topNiche\":\"\",\"action\":\"\"}",
  products: "You are PRODUCT FORGE. Create Etsy print-on-demand products. Return JSON only: {\"products\":[{\"title\":\"\",\"type\":\"\",\"niche\":\"\",\"pricePoint\":\"\",\"estimatedRevenue\":\"\"}]}",
  seo: "You are SEO AGENT. Optimize Etsy listings. Return JSON only: {\"title\":\"\",\"tags\":[],\"description\":\"\",\"primaryKeyword\":\"\",\"rankingScore\":0}",
  design: "You are DESIGN AGENT. Create Midjourney prompts. Return JSON only: {\"midjourneyPrompt\":\"\",\"colorPalette\":[],\"styleNotes\":\"\",\"mockupAngles\":[]}",
  listing: "You are LISTING AGENT. Create Etsy listings. Return JSON only: {\"listingData\":{\"title\":\"\",\"price\":0,\"description\":\"\",\"tags\":[]},\"pricingStrategy\":\"\",\"action\":\"\"}",
  analytics: "You are ANALYTICS AGENT. Track performance metrics. Return JSON only: {\"insights\":[],\"topPerformers\":[],\"underperformers\":[],\"recommendations\":[],\"revenueProjection\":\"\"}",
  evolution: "You are EVOLUTION AGENT. Kill losers scale winners. Return JSON only: {\"kill\":[],\"scale\":[],\"iterate\":[],\"newDirections\":[],\"evolutionScore\":0}",
  customer: "You are CUSTOMER SERVICE AGENT. Handle buyer messages for 5-star reviews. Return JSON only: {\"response\":\"\",\"tone\":\"\",\"action\":\"\",\"reviewStrategy\":\"\"}",
  compliance: "You are COMPLIANCE AGENT. Check Etsy TOS and copyright. Return JSON only: {\"status\":\"clear\",\"risks\":[],\"recommendations\":[],\"tosCompliant\":true}",
};

app.post("/api/agents/:agent", async (req, res) => {
  try {
    const sys = PROMPTS[req.params.agent];
    if (!sys) return res.status(404).json({ error: "Unknown agent: " + req.params.agent });
    const msg = req.body.mission || req.body.message || req.body.niche || req.body.product || "Run your daily optimization";
    const r = await claude.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: sys,
      messages: [{ role: "user", content: msg }],
    });
    const text = r.content[0].text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try {
      res.json({ agent: req.params.agent, result: JSON.parse(text) });
    } catch {
      res.json({ agent: req.params.agent, result: { raw: text } });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/pipeline/full", async (req, res) => {
  try {
    const niche = req.body.niche || "general gifts";
    const run = async (agent, msg) => {
      const r = await claude.messages.create({
        model: "claude-sonnet-4-5", max_tokens: 1024,
        system: PROMPTS[agent],
        messages: [{ role: "user", content: msg }],
      });
      const t = r.content[0].text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try { return JSON.parse(t); } catch { return { raw: t }; }
    };
    const trends = await run("trends", "Find top opportunities in: " + niche);
    const products = await run("products", "Create products for: " + (trends.topNiche || niche));
    const seo = await run("seo", "Optimize: " + (products.products?.[0]?.title || niche));
    const design = await run("design", "Design brief for: " + niche);
    const listing = await run("listing", "Create listing for: " + niche);
    const prime = await run("prime", "Review and approve: " + JSON.stringify({ trends, products, seo }));
    res.json({ success: true, pipeline: { trends, products, seo, design, listing, prime } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/swarm/analyze", async (req, res) => {
  try {
    const sys = "You are SWARMX Quantum Edge sports betting analyzer with 5 agents: Stats, Injury, Odds, Trend, Trap Detector. Analyze the given bet. Return ONLY a JSON array with no markdown: [{\"id\":1,\"sport\":\"\",\"game\":\"\",\"betType\":\"\",\"pick\":\"\",\"odds\":\"\",\"statsEdge\":75,\"injuryEdge\":70,\"oddsEdge\":68,\"trendEdge\":72,\"trapRisk\":25,\"confidence\":74,\"risk\":\"Low\",\"action\":\"LEAN\",\"reasons\":[],\"redFlags\":[]}]";
    const r = await claude.messages.create({
      model: "claude-sonnet-4-5", max_tokens: 2048,
      system: sys,
      messages: [{ role: "user", content: "Analyze this bet: " + req.body.prompt + ". Bankroll: $" + (req.body.bankroll || 1000) }],
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
      model: "claude-sonnet-4-5", max_tokens: 4096,
      system: "You are SWARMX PRIME of HOUSE OF JREYM, an autonomous AI Etsy commerce empire. Help the user maximize profit.",
      messages: [...(req.body.history || []), { role: "user", content: req.body.prompt }],
    });
    res.json({ reply: r.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// ── PRINTIFY API ROUTES ───────────────────────────────────────────────────────
const PRINTIFY_KEY = process.env.PRINTIFY_API_KEY;

app.get('/api/printify/shops', async (req, res) => {
  try {
    const r = await fetch('https://api.printify.com/v1/shops.json', {
      headers: { 'Authorization': 'Bearer ' + PRINTIFY_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/printify/products', async (req, res) => {
  try {
    const r = await fetch('https://api.printify.com/v1/shops/' + req.query.shopId + '/products.json', {
      headers: { 'Authorization': 'Bearer ' + PRINTIFY_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/printify/catalog', async (req, res) => {
  try {
    const r = await fetch('https://api.printify.com/v1/catalog/blueprints.json', {
      headers: { 'Authorization': 'Bearer ' + PRINTIFY_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ETSY API ROUTES ──────────────────────────────────────────────────────────
const ETSY_KEY = process.env.ETSY_API_KEY;
const SHOP_NAME = 'HOUSEOFJREYM';

app.get('/api/etsy/shop', async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}`, {
      headers: { 'x-api-key': ETSY_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/etsy/listings', async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}/listings/active?limit=25`, {
      headers: { 'x-api-key': ETSY_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/etsy/stats', async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP_NAME}/receipts?limit=25`, {
      headers: { 'x-api-key': ETSY_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (req, res) => {
  res.json({ status: "HOUSE OF JREYM ONLINE", agents: 10, version: "4.0.0" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("HOUSE OF JREYM running on port " + PORT));
