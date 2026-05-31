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

// HEALTH CHECKS
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "SWARM-X Quantum Edge", version: "3.0.0", timestamp: new Date().toISOString() });
});

app.get("/api/health/render", (req, res) => {
    res.json({ status: "ok", host: req.hostname, port: process.env.PORT || 4000, uptime: Math.floor(process.uptime()) + "s", env: process.env.RENDER ? "render" : "local" });
});

app.get("/api/health/anthropic", async (req, res) => {
    try {
          if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ status: "fail", reason: "ANTHROPIC_API_KEY not set" });
          const r = await client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "ping" }] });
          res.json({ status: "ok", model: r.model });
    } catch (err) { res.status(500).json({ status: "fail", reason: err.message }); }
});

app.get("/api/health/supabase", async (req, res) => {
    try {
          const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
          if (!url || !key) return res.status(500).json({ status: "fail", reason: "SUPABASE_URL or SUPABASE_ANON_KEY not set" });
              const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
          r.ok ? res.json({ status: "ok", supabaseUrl: url }) : res.status(500).json({ status: "fail", httpStatus: r.status });
    } catch (err) { res.status(500).json({ status: "fail", reason: err.message }); }
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SWARM_SYSTEM_PROMPT = `You are the Architect Core of SWARM-X, a scalable autonomous multi-agent system.
Your purpose is to help the user build, automate, research, organize, analyze, and execute digital workflows.
OUTPUT FORMAT always structure responses as:
🎯 OBJECTIVE
📋 PLAN  
⚡ ACTIONS
⚠️ RISKS
🔜 NEXT STEPS
Be concise but highly intelligent. Remain safe, lawful, transparent, and human-approved at all times.`;

const SPORTS_ANALYST_PROMPT = `You are SWARM-X Quantum Edge — an elite AI sports betting analyst with 5 specialized sub-agents:

1. STATS AGENT — analyzes team/player statistical edges
2. INJURY AGENT — evaluates lineup and injury impact  
3. ODDS AGENT — reads line movement, sharp money, market signals
4. TREND AGENT — identifies situational and historical trends
5. TRAP DETECTOR — identifies public traps and square bets

When given a bet or game, analyze it through ALL 5 agents and return ONLY valid JSON in this exact format (no markdown, no explanation, just the JSON array):

[
  {
    "id": 1,
    "sport": "NBA",
    "game": "Team A vs Team B",
    "betType": "Moneyline",
    "pick": "Team A ML",
    "odds": "-135",
    "statsEdge": 75,
    "injuryEdge": 70,
    "oddsEdge": 68,
    "trendEdge": 72,
    "trapRisk": 25,
    "confidence": 74,
    "risk": "Low",
    "action": "STRONG PLAY",
    "reasons": ["reason 1", "reason 2", "reason 3"],
    "redFlags": ["flag 1", "flag 2"]
  }
]

Rules:
- statsEdge, injuryEdge, oddsEdge, trendEdge are 0-100 scores
- trapRisk is 0-100 (higher = more dangerous trap)
- confidence = weighted: stats*0.3 + injury*0.2 + odds*0.25 + trend*0.15 - trap*0.1
- action must be exactly one of: "STRONG PLAY", "LEAN", "SMALL BET", "PASS"
- STRONG PLAY: confidence >= 75 AND trapRisk < 45
- LEAN: confidence >= 65 AND trapRisk < 60
- SMALL BET: confidence >= 60 AND trapRisk < 70
- PASS: anything else
- risk: "Low" if trapRisk < 40, "Medium" if 40-69, "High" if 70+
- reasons: 3 bullet points why to bet it
- redFlags: 2-3 concerns about the bet
- Return ONLY the JSON array. No text before or after.`;

// MAIN SWARM CHAT ENDPOINT
app.post("/api/swarm", async (req, res) => {
  try {
    const { prompt, history = [] } = req.body;
    const messages = [...history, { role: "user", content: prompt }];
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8096,
      system: SWARM_SYSTEM_PROMPT,
      messages,
    });
    res.json({
      reply: response.content[0].text,
      agent: "SWARM-X ARCHITECT CORE",
      model: "claude-sonnet-4-5",
    });
  } catch (err) {
    console.error("SWARM-X ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// SPORTS ANALYSIS ENDPOINT
app.post("/api/swarm/analyze", async (req, res) => {
  try {
    const { prompt, bankroll } = req.body;

    const userMessage = `Analyze this bet for me: ${prompt}${bankroll ? `. My bankroll is $${bankroll}.` : ""}
    
    Use all 5 agents (Stats, Injury, Odds, Trend, Trap Detector) to evaluate this. Return the JSON analysis array.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: SPORTS_ANALYST_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = response.content[0].text.trim();
    
    // Strip markdown if present
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    let plays;
    try {
      plays = JSON.parse(clean);
      if (!Array.isArray(plays)) plays = [plays];
    } catch {
      // If JSON parse fails, return error
      return res.status(500).json({ error: "Agent analysis failed to parse. Try again." });
    }

    // Add unique IDs
    const timestamp = Date.now();
    plays = plays.map((p, i) => ({ ...p, id: timestamp + i }));

    res.json({ plays, agent: "SWARM-X QUANTUM EDGE", model: "claude-sonnet-4-5" });

  } catch (err) {
    console.error("SPORTS ANALYSIS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "SWARM-X QUANTUM EDGE ONLINE", version: "3.0.0" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SWARM-X Quantum Edge running on port ${PORT}`);
});
