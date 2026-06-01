// server.js — SWARM OS v5.1 — security, OpenAI fallback, stats API
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
import { supabase, recordHealth } from "./lib/supabase.js";
import "./workers/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// FIX 5: Restrict CORS to known origins
const ALLOWED_ORIGINS = ["https://swarm-app-3nch.onrender.com","http://localhost:5173","http://localhost:4000"];
app.use(cors({ origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null,true) : cb(new Error("CORS blocked")) }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public")));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let openai = null;
try { if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); } catch(e) {}

const SUPABASE_URL = process.env.SUPABASE_URL || "https://cufrxwpmxglgiquntlca.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPERBAS_KEY || "";

// FIX 5: API key auth middleware (skip if API_SECRET not set yet)
const API_SECRET = process.env.API_SECRET;
app.use("/api/", (req, res, next) => {
  if (req.path.startsWith("/health") || req.path === "/stats") return next();
    if (!API_SECRET) return next();
      const key = req.headers["x-api-key"] || req.query.api_key;
        if (key !== API_SECRET) return res.status(401).json({ error: "Unauthorized" });
          next();
          });

          // FIX 5: Rate limiting 100 req/min per IP on swarm endpoints
          const rateLimiter = new Map();
          app.use("/api/swarm", (req, res, next) => {
            const ip = req.ip; const now = Date.now();
              const w = rateLimiter.get(ip) || { count:0, reset:now+60000 };
                if (now > w.reset) { w.count=0; w.reset=now+60000; }
                  w.count++; rateLimiter.set(ip, w);
                    if (w.count > 100) return res.status(429).json({ error: "Rate limit exceeded" });
                      next();
                      });

                      app.use("/api/shopify", shopifyRouter);
                      app.use("/api/etsy", etsyRouter);
                      app.use("/api/printify", printifyRouter);
                      app.use("/api/tasks", tasksRouter);

                      app.get("/api/health", (req, res) => res.json({
                        status:"ok", service:"SWARM OS", version:"5.1.0", timestamp:new Date().toISOString(),
                          env:{ anthropic:!!process.env.ANTHROPIC_API_KEY, openai:!!process.env.OPENAI_API_KEY, shopify:!!process.env.SHOPIFY_DOMAIN, etsy:!!process.env.ETSY_API_KEY, supabase:!!(SUPABASE_URL&&SUPABASE_KEY), printify:!!process.env.PRINTIFY_API_KEY },
                            features:{ autonomous_workers:true, task_queue:true, retry_system:true, rate_limiting:true, openai_fallback:true }
                            }));

                            app.get("/api/health/anthropic", async (req, res) => {
                              try {
                                  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ status:"fail", reason:"key missing" });
                                      const start = Date.now();
                                          const r = await anthropic.messages.create({ model:"claude-haiku-4-5-20251001", max_tokens:10, messages:[{role:"user",content:"ping"}] });
                                              await recordHealth("anthropic","ok",Date.now()-start);
                                                  res.json({ status:"ok", model:r.model, latency_ms:Date.now()-start });
                                                    } catch(err) { await recordHealth("anthropic","fail",null,{error:err.message}); res.status(500).json({status:"fail",reason:err.message}); }
                                                    });

                                                    app.get("/api/health/openai", async (req, res) => {
                                                      if (!openai) return res.json({ status:"degraded", reason:"No key — Anthropic handles all AI" });
                                                        try {
                                                            const start = Date.now();
                                                                const r = await openai.chat.completions.create({ model:"gpt-4o-mini", max_tokens:5, messages:[{role:"user",content:"ping"}] });
                                                                    await recordHealth("openai","ok",Date.now()-start);
                                                                        res.json({ status:"ok", model:r.model, latency_ms:Date.now()-start });
                                                                          } catch(err) {
                                                                              const deg = err.status===429||err.message?.includes("quota");
                                                                                  await recordHealth("openai",deg?"degraded":"fail",null,{error:err.message});
                                                                                      res.json({ status:deg?"degraded":"fail", reason:err.message, fallback:"Anthropic claude-haiku" });
                                                                                        }
                                                                                        });

                                                                                        app.get("/api/health/supabase", async (req, res) => {
                                                                                          try {
                                                                                              const start = Date.now();
                                                                                                  const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers:{ apikey:SUPABASE_KEY } });
                                                                                                      const lat = Date.now()-start;
                                                                                                          if (r.ok) { await recordHealth("supabase","ok",lat); res.json({status:"ok",latency_ms:lat}); }
                                                                                                              else res.status(500).json({status:"fail"});
                                                                                                                } catch(err) { res.status(500).json({status:"fail",reason:err.message}); }
                                                                                                                });

                                                                                                                // FIX 6: Real-time stats endpoint for dashboard
                                                                                                                app.get("/api/stats", async (req, res) => {
                                                                                                                  try {
                                                                                                                      const [c,p,r,f,logs] = await Promise.all([
                                                                                                                            supabase.from("tasks").select("*",{count:"exact",head:true}).eq("status","completed"),
                                                                                                                                  supabase.from("tasks").select("*",{count:"exact",head:true}).eq("status","pending"),
                                                                                                                                        supabase.from("tasks").select("*",{count:"exact",head:true}).eq("status","running"),
                                                                                                                                              supabase.from("tasks").select("*",{count:"exact",head:true}).eq("status","failed"),
                                                                                                                                                    supabase.from("agent_logs").select("agent,message,level,created_at").order("created_at",{ascending:false}).limit(20),
                                                                                                                                                        ]);
                                                                                                                                                            res.json({ tasks:{completed:c.count,pending:p.count,running:r.count,failed:f.count}, recentLogs:logs.data||[], timestamp:new Date().toISOString() });
                                                                                                                                                              } catch(err) { res.status(500).json({error:err.message}); }
                                                                                                                                                              });

                                                                                                                                                              const SWARM_SYSTEM = `You are SWARM OS the autonomous AI command center for House of Jreym. 12 agents run 24/7: NANA (trends), KOFI (supply chain), AMARA (marketing), KWAME (sales), FATIMA (customer service), SEUN (analytics), AISHA (SEO), IBRAHIM (social), ZARA (inventory), DELE (pricing), IMANI (ads), ABENA (finance). OUTPUT: Tactical bullets, under 150 words.`;

                                                                                                                                                              app.post("/api/swarm", async (req, res) => {
                                                                                                                                                                try {
                                                                                                                                                                    const { prompt, history=[], userMessage } = req.body;
                                                                                                                                                                        const content = prompt||userMessage||"";
                                                                                                                                                                            if (!content) return res.status(400).json({error:"No message"});
                                                                                                                                                                                const messages = [...history.filter(m=>m.role&&m.content), {role:"user",content}];
                                                                                                                                                                                    const response = await anthropic.messages.create({ model:"claude-haiku-4-5-20251001", max_tokens:1024, system:SWARM_SYSTEM, messages });
                                                                                                                                                                                        res.json({ reply:response.content[0].text, agent:"SWARM OS", model:response.model });
                                                                                                                                                                                          } catch(err) { res.status(500).json({error:err.message}); }
                                                                                                                                                                                          });

                                                                                                                                                                                          // FIX 2: OpenAI with Anthropic fallback on quota error
                                                                                                                                                                                          app.post("/api/openai", async (req, res) => {
                                                                                                                                                                                            const { prompt, messages:hist=[], model="gpt-4o-mini" } = req.body;
                                                                                                                                                                                              const content = prompt||"";
                                                                                                                                                                                                if (!content) return res.status(400).json({error:"No prompt"});
                                                                                                                                                                                                  const messages = [...hist.filter(m=>m.role&&m.content), {role:"user",content}];
                                                                                                                                                                                                    if (openai) {
                                                                                                                                                                                                        try {
                                                                                                                                                                                                              const r = await openai.chat.completions.create({ model, max_tokens:1024, messages });
                                                                                                                                                                                                                    return res.json({ reply:r.choices[0].message.content, model:r.model, agent:"OPENAI" });
                                                                                                                                                                                                                        } catch(err) {
                                                                                                                                                                                                                              if (!err.message?.includes("quota")&&!err.message?.includes("429")) return res.status(500).json({error:err.message});
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                      try {
                                                                                                                                                                                                                                          const r = await anthropic.messages.create({ model:"claude-haiku-4-5-20251001", max_tokens:1024, messages });
                                                                                                                                                                                                                                              res.json({ reply:r.content[0].text, model:r.model, agent:"ANTHROPIC_FALLBACK", fallback:true });
                                                                                                                                                                                                                                                } catch(err) { res.status(500).json({error:err.message}); }
                                                                                                                                                                                                                                                });

                                                                                                                                                                                                                                                const SPORTS = `You are SWARM-X Quantum Edge sports betting analyst. Return ONLY valid JSON array with fields: id,sport,game,betType,pick,odds,confidence,risk,action,reasons. action: STRONG PLAY|LEAN|SMALL BET|PASS.`;
                                                                                                                                                                                                                                                app.post("/api/swarm/analyze", async (req, res) => {
                                                                                                                                                                                                                                                  try {
                                                                                                                                                                                                                                                      const { prompt, bankroll } = req.body;
                                                                                                                                                                                                                                                          const r = await anthropic.messages.create({ model:"claude-haiku-4-5-20251001", max_tokens:2048, system:SPORTS, messages:[{role:"user",content:`Analyze: ${prompt}${bankroll?`. Bankroll: $${bankroll}`:""}`}] });
                                                                                                                                                                                                                                                              const raw = r.content[0].text.trim().replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
                                                                                                                                                                                                                                                                  let plays; try { plays=JSON.parse(raw); if(!Array.isArray(plays)) plays=[plays]; } catch{ return res.status(500).json({error:"Parse failed"}); }
                                                                                                                                                                                                                                                                      res.json({ plays:plays.map((p,i)=>({...p,id:Date.now()+i})), agent:"SWARM-X", model:r.model });
                                                                                                                                                                                                                                                                        } catch(err) { res.status(500).json({error:err.message}); }
                                                                                                                                                                                                                                                                        });

                                                                                                                                                                                                                                                                        app.get("/health", (req,res) => res.json({status:"SWARM OS v5.1 ONLINE"}));
                                                                                                                                                                                                                                                                        app.get("*", (req,res) => res.sendFile(path.join(__dirname,"dist","index.html")));

                                                                                                                                                                                                                                                                        const PORT = process.env.PORT||4000;
                                                                                                                                                                                                                                                                        app.listen(PORT, () => console.log(`SWARM OS v5.1 :${PORT} | Anthropic:${process.env.ANTHROPIC_API_KEY?"OK":"MISSING"} Supabase:${SUPABASE_URL?"OK":"MISSING"}`));
                                                                                                                                                                                                                                                                        