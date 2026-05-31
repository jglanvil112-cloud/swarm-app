// server.js — SWARM OS v5.0 — Autonomous Commerce Operating System
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { shopifyRouter } from "./routes/shopify.js";
import { etsyRouter    } from "./routes/etsy.js";
import { printifyRouter } from "./routes/printify.js";
import { tasksRouter   } from "./routes/tasks.js";
import { supabase, recordHealth } from "./lib/supabase.js";
import "./workers/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public")));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPERBASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPERBAS_KEY || "";

app.use("/api/shopify",  shopifyRouter);
app.use("/api/etsy",     etsyRouter);
app.use("/api/printify", printifyRouter);
app.use("/api/tasks",    tasksRouter);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok", service: "SWARM OS", version: "5.0.0",
    timestamp: new Date().toISOString(),
    env: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai:    !!process.env.OPENAI_API_KEY,
      shopify:   !!process.env.SHOPIFY_DOMAIN,
      etsy:      !!process.env.ETSY_API_KEY,
      supabase:  !!(SUPABASE_URL && SUPABASE_KEY),
      printify:  !!process.env.PRINTIFY_API_KEY,
    },
    features: { autonomous_workers: true, task_queue: true, oauth_shopify: true, oauth_etsy: true, memory_system: true, monitoring: true },
  });
});

app.get("/api/health/anthropic", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ status: "fail", reason: "ANTHROPIC_API_KEY not set" });
    const start = Date.now();
    const r = await anthropic.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "ping" }] });
    const latency = Date.now() - start;
    await recordHealth("anthropic", "ok", latency);
    res.json({ status: "ok", model: r.model, latency_ms: latency });
  } catch (err) { await recordHealth("anthropic","fail",null,{error:err.message}); res.status(500).json({ status: "fail", reason: err.message }); }
});

app.get("/api/health/openai", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ status: "fail", reason: "OPENAI_API_KEY not set" });
    const start = Date.now();
    const r = await openai.chat.completions.create({ model: "gpt-4o-mini", max_tokens: 5, messages: [{ role: "user", content: "ping" }] });
    const latency = Date.now() - start;
    await recordHealth("openai", "ok", latency);
    res.json({ status: "ok", model: r.model, latency_ms: latency });
  } catch (err) { await recordHealth("openai","fail",null,{error:err.message}); res.status(500).json({ status: "fail", reason: err.message }); }
});

app.get("/api/health/supabase", async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ status: "fail", reason: "SUPABASE_URL or SUPABASE_KEY not set" });
    const start = Date.now();
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY } });
    const latency = Date.now() - start;
    if (r.ok) { await recordHealth("supabase","ok",latency); res.json({ status: "ok", supabaseUrl: SUPABASE_URL, latency_ms: latency }); }
    else { const txt = await r.text(); res.status(500).json({ status: "fail", httpStatus: r.status, detail: txt.slice(0,100) }); }
  } catch (err) { res.status(500).json({ status: "fail", reason: err.message }); }
});

const SWARM_SYSTEM = `You are SWARM OS the autonomous AI command center for House of Jreym, a print-on-demand brand. 12 agents run 24/7: NANA (trends), KOFI (supply chain), AMARA (marketing), KWAME (sales), FATIMA (customer service), SEUN (analytics), AISHA (SEO), IBRAHIM (social), ZARA (inventory), DELE (pricing), IMANI (ads), ABENA (finance). OUTPUT: Tactical bullets, reference agents, under 150 words.`;

app.post("/api/swarm", async (req, res) => {
  try {
    const { prompt, history = [], userMessage } = req.body;
    const content = prompt || userMessage || "";
    if (!content) return res.status(400).json({ error: "No message provided." });
    const messages = [...history.filter(m => m.role && m.content), { role: "user", content }];
    const response = await anthropic.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: SWARM_SYSTEM, messages });
    res.json({ reply: response.content[0].text, agent: "SWARM OS", model: response.model });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/openai", async (req, res) => {
  try {
    if (!openai) return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    const { prompt, messages: msgHistory = [], model = "gpt-4o-mini" } = req.body;
    const content = prompt || "";
    if (!content) return res.status(400).json({ error: "No prompt provided." });
    const messages = [...msgHistory.filter(m => m.role && m.content), { role: "user", content }];
    const r = await openai.chat.completions.create({ model, max_tokens: 1024, messages });
    res.json({ reply: r.choices[0].message.content, model: r.model, agent: "SWARM-X OPENAI" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const SPORTS_PROMPT = `You are SWARM-X Quantum Edge elite AI sports betting analyst. Return ONLY valid JSON array: id,sport,game,betType,pick,odds,statsEdge,injuryEdge,oddsEdge,trendEdge,trapRisk,confidence,risk,action,reasons,redFlags. action: STRONG PLAY|LEAN|SMALL BET|PASS.`;

app.post("/api/swarm/analyze", async (req, res) => {
  try {
    const { prompt, bankroll } = req.body;
    const userMsg = `Analyze: ${prompt}${bankroll ? `. Bankroll: $${bankroll}.` : ""}`;
    const response = await anthropic.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 2048, system: SPORTS_PROMPT, messages: [{ role: "user", content: userMsg }] });
    const raw = response.content[0].text.trim().replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
    let plays;
    try { plays = JSON.parse(raw); if (!Array.isArray(plays)) plays = [plays]; }
    catch { return res.status(500).json({ error: "Parse failed", raw: raw.slice(0,200) }); }
    const ts = Date.now();
    plays = plays.map((p,i) => ({ ...p, id: ts+i }));
    res.json({ plays, agent: "SWARM-X QUANTUM EDGE", model: response.model });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/health", (req, res) => res.json({ status: "SWARM OS v5.0 ONLINE" }));
app.get("*", (req, res) => { res.sendFile(path.join(__dirname, "dist", "index.html")); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SWARM OS v5.0 port ${PORT}`);
  console.log(`Anthropic:${process.env.ANTHROPIC_API_KEY?"OK":"MISSING"} OpenAI:${process.env.OPENAI_API_KEY?"OK":"MISSING"} Supabase:${SUPABASE_URL?"OK":"MISSING"}`);
});
