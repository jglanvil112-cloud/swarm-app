// server.js — SWARM OS v5.2 — fix: Unauthorized whitelist, /api/outputs, shopify/etsy health
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
import { supabase, recordHealth, getRecentOutputs } from "./lib/supabase.js";
import "./workers/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

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

// AUTH MIDDLEWARE — dashboard routes are always public (no API key needed)
const API_SECRET = process.env.API_SECRET;
const PUBLIC_API_PREFIXES = ["/health", "/stats", "/outputs", "/swarm", "/shopify", "/etsy", "/tasks", "/printify", "/pipeline", "/social", "/instagram", "/ibrahim", "/admin"];
  
app.use("/api/", (req, res, next) => {
  const isPublic = PUBLIC_API_PREFIXES.some(p => req.path === p || req.path.startsWith(p + "/") || req.path.startsWith("/health"));
    if (isPublic) return next();
      if (!API_SECRET) return next();
        const key = req.headers["x-api-key"] || req.query.api_key;
          if (key !== API_SECRET) return res.status(401).json({ error: "Unauthorized" });
            next();
            });

            // Rate limiting on heavy AI endpoints only
            const rateLimiter = new Map();
            app.use("/api/swarm/analyze", (req, res, next) => {
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
app.use("/api/pipeline", pipelineRouter);
app.use("/api/social", socialRouter);
app.use("/api/instagram", instagramRouter);
app.use("/api/ibrahim", ibrahimRouter);

                        // Agent outputs — feeds dashboard AMARA output panel
                        app.get("/api/outputs", async (req, res) => {
                          try {
                              const limit = parseInt(req.query.limit) || 20;
                                  const outputs = await getRecentOutputs(limit);
                                      res.json({ outputs, count: outputs.length, timestamp: new Date().toISOString() });
                                        } catch(err) { res.status(500).json({ error: err.message }); }
                                        });

                                        app.get("/api/health", (req, res) => res.json({
                                          status:"ok", service:"SWARM OS", version:"5.2.0", timestamp:new Date().toISOString(),
                                            env:{ anthropic:!!process.env.ANTHROPIC_API_KEY, openai:!!process.env.OPENAI_API_KEY, shopify:!!process.env.SHOPIFY_DOMAIN, etsy:!!process.env.ETSY_API_KEY, supabase:!!(SUPABASE_URL&&SUPABASE_KEY), printify:!!process.env.PRINTIFY_API_KEY },
                                              features:{ autonomous_workers:true, task_queue:true, retry_system:true, rate_limiting:true, openai_fallback:true, outputs_api:true }
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

                                                                                                                                  // Shopify health — checks token from Supabase agent_memory first, then env
                                                                                                                                  app.get("/api/health/shopify", async (req, res) => {
                                                                                                                                    try {
                                                                                                                                        let token = process.env.SHOPIFY_ACCESS_TOKEN || "";
                                                                                                                                            const { data } = await supabase.from("agent_memory").select("value").eq("key","shopify_access_token").single().catch(() => ({ data: null }));
                                                                                                                                                if (data?.value) token = data.value;
                                                                                                                                                    const domain = process.env.SHOPIFY_DOMAIN || process.env.SHOPIFY_STORE || "";
                                                                                                                                                        if (!token || !domain) return res.json({ status:"needs_token", reason: !token ? "no access token" : "no domain configured" });
                                                                                                                                                            const r = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, { headers:{ "X-Shopify-Access-Token": token }, signal: AbortSignal.timeout(8000) });
                                                                                                                                                                if (r.ok) { await recordHealth("shopify","ok",null); res.json({ status:"ok", domain }); }
                                                                                                                                                                    else { await recordHealth("shopify","fail",null,{http:r.status}); res.json({ status:"needs_token", http: r.status }); }
                                                                                                                                                                      } catch(err) { res.json({ status:"fail", reason: err.message }); }
                                                                                                                                                                      });

                                                                                                                                                                      // Etsy health check
                                                                                                                                                                      app.get("/api/health/etsy", async (req, res) => {
                                                                                                                                                                        try {
                                                                                                                                                                            const key = process.env.ETSY_API_KEY || "";
                                                                                                                                                                                if (!key) return res.json({ status:"needs_token", reason:"ETSY_API_KEY not set" });
                                                                                                                                                                                    const r = await fetch(`https://openapi.etsy.com/v3/application/openapi-ping`, { headers:{ "x-api-key": key }, signal: AbortSignal.timeout(8000) });
                                                                                                                                                                                        if (r.ok) { await recordHealth("etsy","ok",null); res.json({ status:"ok" }); }
                                                                                                                                                                                            else { await recordHealth("etsy","fail",null,{http:r.status}); res.json({ status:"needs_token", http: r.status }); }
                                                                                                                                                                                              } catch(err) { res.json({ status:"fail", reason: err.message }); }
                                                                                                                                                                                              });

                                                                                                                                                                                              
// ── ADMIN: pause/resume any social post ──────────────────────────────
app.post("/api/admin/post-status", async (req, res) => {
  try {
    const { post_id, status } = req.body;
    if (!post_id || !status) return res.status(400).json({ error: "post_id and status required" });
    const allowed = ["paused","scheduled","draft","cancelled","failed"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
    const { data, error } = await supabase
      .from("social_posts")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", post_id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, post_id, new_status: status, post: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
                                                                                                                                                                                                                                                                                                                                        const r = await anthropic.messages.create({ model:"claude-haiku-4-5-20251001", max_tokens:2048, system:SPORTS, messages:[{role:"user",content:`Analyz: ${prompt}${bankroll?`. Bankroll: $${bankroll}`:""}`}] });
                                                                                                                                                                                                                                                                                                                                            const raw = r.content[0].text.trim().replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
                                                                                                                                                                                                                                                                                                                                                let plays; try { plays=JSON.parse(raw); if(!Array.isArray(plays)) plays=[plays]; } catch{ return res.status(500).json({error:"Parse failed"}); }
                                                                                                                                                                                                                                                                                                                                                    res.json({ plays:plays.map((p,i)=>({...p,id:Date.now()+i})), agent:"SWARM-X", model:r.model });
                                                                                                                                                                                                                                                                                                                                                      } catch(err) { res.status(500).json({error:err.message}); }
                                                                                                                                                                                                                                                                                                                                                      });

                                                                                                                                                                                                                                                                                                                                                      app.get("/health", (req,res) => res.json({status:"SWARM OS v5.2 ONLINE"}));
                                                                                                                                                                                                                                                                                                                                                      app.get("*", (req,res) => res.sendFile(path.join(__dirname,"dist","index.html")));

                                                                                                                                                                                                                                                                                                                                                      const PORT = process.env.PORT||4000;
                                                                                                                                                                                                                                                                                                                                                      app.listen(PORT, () => console.log(`SWARM OS v5.2 :${PORT} | Anthropic:${process.env.ANTHROPIC_API_KEY?"OK":"MISSING"} Supabase:${SUPABASE_URL?"OK":"MISSING"}`));
