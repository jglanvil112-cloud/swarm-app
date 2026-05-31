import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public")));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPERBASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPERBAS_KEY || "";

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "SWARM-X Quantum Edge",
    version: "4.1.0",
    timestamp: new Date().toISOString(),
    env: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai:    !!process.env.OPENAI_API_KEY,
      shopify:   !!process.env.SHOPIFY_DOMAIN,
      etsy:      !!process.env.ETSY_API_KEY,
      supabase:  !!(SUPABASE_URL && SUPABASE_KEY),
    },
  });
});

app.get("/api/health/anthropic", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY)
      return res.status(500).json({ status: "fail", reason: "ANTHROPIC_API_KEY not set" });
    const r = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 10,
      messages: [{ role: "user", content: "ping" }],
    });
    res.json({ status: "ok", model: r.model });
  } catch (err) { res.status(500).json({ status: "fail", reason: err.message }); }
});

app.get("/api/health/openai", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ status: "fail", reason: "OPENAI_API_KEY not set" });
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini", max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    res.json({ status: "ok", model: r.model });
  } catch (err) { res.status(500).json({ status: "fail", reason: err.message }); }
});

app.get("/api/health/supabase", async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY)
      return res.status(500).json({
        status: "fail",
        reason: "SUPABASE_URL or SUPABASE_KEY not set",
        checked: ["SUPABASE_URL","SUPERBASE_URL","SUPABASE_KEY","SUPERBAS_KEY","SUPABASE_ANON_KEY"],
      });
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY } });
    if (r.ok) {
      res.json({ status: "ok", supabaseUrl: SUPABASE_URL });
    } else {
      const txt = await r.text();
      res.status(500).json({ status: "fail", httpStatus: r.status, detail: txt.slice(0,100) });
    }
  } catch (err) { res.status(500).json({ status: "fail", reason: err.message }); }
});

app.post("/api/openai", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    const { prompt, messages: msgHistory = [], model = "gpt-4o-mini" } = req.body;
    const content = prompt || "";
    if (!content) return res.status(400).json({ error: "No prompt provided." });
    const messages = [
      ...msgHistory.filter(m => m.role && m.content),
      { role: "user", content },
    ];
    const r = await openai.chat.completions.create({ model, max_tokens: 1024, messages });
    res.json({ reply: r.choices[0].message.content, model: r.model, agent: "SWARM-X OPENAI" });
  } catch (err) {
    console.error("OPENAI ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function shopifyHeaders() {
  return {
    "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_CLIENT_SECRET || "",
    "Content-Type": "application/json",
  };
}
function shopifyBase() {
  const domain = (process.env.SHOPIFY_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${domain}/admin/api/2024-01`;
}

app.get("/api/shopify/products", async (req, res) => {
  try {
    const r = await fetch(`${shopifyBase()}/products.json?limit=50&fields=id,title,variants,status,image`, { headers: shopifyHeaders() });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: e.slice(0,200) }); }
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/shopify/orders", async (req, res) => {
  try {
    const r = await fetch(`${shopifyBase()}/orders.json?limit=50&status=any&fields=id,total_price,financial_status,created_at,line_items`, { headers: shopifyHeaders() });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Shopify ${r.status}`, detail: e.slice(0,200) }); }
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/shopify/store", async (req, res) => {
  try {
    const r = await fetch(`${shopifyBase()}/shop.json`, { headers: shopifyHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: `Shopify ${r.status}` });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const ETSY_KEY  = process.env.ETSY_API_KEY || "";
const ETSY_SHOP = process.env.SHOP_NAME || "HOUSEOFJREYM";

app.get("/api/etsy/shop", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}`, { headers: { "x-api-key": ETSY_KEY } });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Etsy ${r.status}`, detail: e.slice(0,200) }); }
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/etsy/listings", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}/listings/active?limit=10`, { headers: { "x-api-key": ETSY_KEY } });
    if (!r.ok) { const e = await r.text(); return res.status(r.status).json({ error: `Etsy ${r.status}`, detail: e.slice(0,200) }); }
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/etsy/reviews", async (req, res) => {
  try {
    const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP}/reviews?limit=5`, { headers: { "x-api-key": ETSY_KEY } });
    if (!r.ok) return res.status(r.status).json({ error: `Etsy ${r.status}` });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const SWARM_SYSTEM_PROMPT = `You are SWARM OS the AI command center for House of Jreym, a print-on-demand and digital goods business. You have 12 active agents: NANA (trends), KOFI (supply chain), AMARA (marketing), KWAME (sales ops), FATIMA (customer service), SEUN (analytics), AISHA (SEO), IBRAHIM (social media), ZARA (inventory), DELE (pricing), IMANI (paid ads), ABENA (finance). OUTPUT FORMAT: tactical bulletin with bullet points. Reference relevant agent names. Be specific and data-driven. Keep responses under 150 words.`;

app.post("/api/swarm", async (req, res) => {
  try {
    const { prompt, history = [], userMessage } = req.body;
    const content = prompt || userMessage || "";
    if (!content) return res.status(400).json({ error: "No message provided." });
    const messages = [
      ...history.filter(m => m.role && m.content),
      { role: "user", content },
    ];
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 1024,
      system: SWARM_SYSTEM_PROMPT, messages,
    });
    res.json({ reply: response.content[0].text, agent: "SWARM OS", model: response.model });
  } catch (err) {
    console.error("SWARM ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const SPORTS_ANALYST_PROMPT = `You are SWARM-X Quantum Edge an elite AI sports betting analyst. Analyze bets and return ONLY valid JSON array with fields: id, sport, game, betType, pick, odds, statsEdge, injuryEdge, oddsEdge, trendEdge, trapRisk, confidence, risk, action, reasons, redFlags. action must be one of: STRONG PLAY, LEAN, SMALL BET, PASS. Return ONLY JSON, no markdown.`;

app.post("/api/swarm/analyze", async (req, res) => {
  try {
    const { prompt, bankroll } = req.body;
    const userMsg = `Analyze: ${prompt}${bankroll ? `. Bankroll: $${bankroll}.` : ""}`;
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 2048,
      system: SPORTS_ANALYST_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });
    const raw = response.content[0].text.trim().replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
    let plays;
    try { plays = JSON.parse(raw); if (!Array.isArray(plays)) plays = [plays]; }
    catch { return res.status(500).json({ error: "Parse failed", raw: raw.slice(0,200) }); }
    const ts = Date.now();
    plays = plays.map((p,i) => ({ ...p, id: ts+i }));
    res.json({ plays, agent: "SWARM-X QUANTUM EDGE", model: response.model });
  } catch (err) {
    console.error("SPORTS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "SWARM-X v4.1 ONLINE" }));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SWARM-X v4.1 on port ${PORT}`);
  console.log(`Anthropic : ${process.env.ANTHROPIC_API_KEY ? "SET" : "NOT SET"}`);
  console.log(`OpenAI    : ${process.env.OPENAI_API_KEY    ? "SET" : "NOT SET"}`);
  console.log(`Supabase  : ${SUPABASE_URL || "NOT SET"} / key=${SUPABASE_KEY ? "SET" : "NOT SET"}`);
  console.log(`Shopify   : ${process.env.SHOPIFY_DOMAIN || "NOT SET"}`);
  console.log(`Etsy      : ${process.env.ETSY_API_KEY ? "SET" : "NOT SET"}`);
});
