// routes/podgen.js — SWARM OS
// Full-auto POD digital-art generator (design-approval REMOVED per CEO; the gate is the checkpoint):
//   theme -> branded prompt -> fal.ai image -> Claude-vision IP/quality gate ->
//   unique-ID'd digital product on Shopify (tagged "originals").
//
// SAFETY DEFAULTS:
//  - Vision IP gate: anything with a trademark/logo/copyrighted character/real person or
//    low quality -> held as DRAFT, never auto-published.
//  - PODGEN_AUTO_PUBLISH (env): false by default -> clean designs land as DRAFT so the first
//    batch is eyeball-able. Set it to "true" in Render to go fully hands-off (active listings).
//    (This is a single global switch, NOT per-design approval.)

import express from "express";
import { supabase, logAgent } from "../lib/supabase.js";

export const podgenRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_AI_KEY || process.env.fal_ai_KEY || process.env.fal_ai_key || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const APP_URL = process.env.APP_URL || "https://swarm-app-3nch.onrender.com";
const AUTO_PUBLISH = process.env.PODGEN_AUTO_PUBLISH === "true";

// fal model routing by design style
const MODELS = {
  design: "fal-ai/recraft-v3",    // branded design assets (default)
  text:   "fal-ai/ideogram/v3",   // typography / affirmations / quotes
  art:    "fal-ai/flux-pro/v1.1",  // general illustration
};

const IP_BLOCK = ["disney","marvel","pixar","nike","adidas","jordan","gucci","louis vuitton","supreme",
  "nfl","nba","mlb","fifa","olympics","star wars","harry potter","pokemon","pokémon","mickey",
  "spider-man","batman","superman","barbie","coca-cola","pepsi","celebrity","logo of"];

function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured" }); return false; }
  const k = req.headers["x-approval-key"] || req.query.key;
  if (k !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}

// ── fal.ai generation via queue API (submit -> poll status -> fetch result) ──
async function falGenerate(model, prompt) {
  if (!FAL_KEY) throw new Error("FAL_KEY missing — add it in Render (swarm-app service → Environment)");
  const auth = { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" };
  const sub = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST", headers: auth, body: JSON.stringify({ prompt, image_size: "square_hd" })
  });
  const j = await sub.json();
  if (!j.request_id) throw new Error("fal submit failed: " + JSON.stringify(j).slice(0, 160));
  const statusUrl = j.status_url || `https://queue.fal.run/${model}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${model}/requests/${j.request_id}`;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await (await fetch(statusUrl, { headers: { "Authorization": `Key ${FAL_KEY}` } })).json();
    if (s.status === "COMPLETED") break;
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error("fal generation failed");
  }
  const out = await (await fetch(respUrl, { headers: { "Authorization": `Key ${FAL_KEY}` } })).json();
  const url = out.images?.[0]?.url || out.image?.url;
  if (!url) throw new Error("fal: no image url in result");
  return url;
}

// ── Claude-vision IP / quality gate (the load-bearing safeguard for unreviewed gen) ──
async function ipVisionGate(imageUrl) {
  if (!ANTHROPIC_KEY) return { risky: true, reason: "no vision key — held for safety" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: "Check this AI-generated art for a print-on-demand store. Does it contain any trademarked logo, brand name, copyrighted character, real identifiable person/celebrity, or a near-copy of a famous existing artwork? Is it low-quality, garbled, or blurry? Reply ONLY with JSON: {\"risky\":true|false,\"reason\":\"short\"}" }
        ]}]
      })
    });
    const j = await r.json();
    const txt = (j.content || []).map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(txt);
  } catch (e) { return { risky: true, reason: "gate error — held for safety" }; }
}

// ── main pipeline ──
export async function runPodGen({ theme = "Afrocentric heritage", style = "design", dry = false } = {}) {
  const uid = ("HOJ-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)).toUpperCase();
  if (IP_BLOCK.some(t => theme.toLowerCase().includes(t))) return { ok: false, reason: "theme tripped IP blocklist", uid };
  const model = MODELS[style] || MODELS.design;
  const prompt = `Original Afrocentric ${theme} wall-art design for the brand House of Jreym. Bold, culturally rooted, high-contrast, clean print-ready composition. Absolutely no brand logos, trademarks, copyrighted characters, or real people — 100% original artwork.`;
  if (dry) return { ok: true, dry: true, uid, model, prompt };

  const imageUrl = await falGenerate(model, prompt);
  const gate = await ipVisionGate(imageUrl);
  const pass = !gate.risky;
  const status = (pass && AUTO_PUBLISH) ? "active" : "draft";

  const product = {
    title: `Afrocentric ${theme} — Original Digital Wall Art (${uid})`,
    body_html: `<p>Original Afrocentric ${theme} wall art from House of Jreym — a print-ready digital download. Design ID <strong>${uid}</strong>.</p><p><strong>Instant digital download</strong> — no physical item is shipped. For personal use only; may not be resold or redistributed.</p>`,
    vendor: "House of Jreym", product_type: "Digital Wall Art", status,
    tags: `originals, afrocentric, digital download, ${theme}, ${uid}`,
    images: [{ src: imageUrl }],
    variants: [{ price: "10.99", requires_shipping: false, taxable: true, inventory_management: null }]
  };
  let productId = null;
  try {
    const cr = await fetch(`${APP_URL}/api/shopify/create-product`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-approval-key": APPROVAL_SECRET },
      body: JSON.stringify({ product })
    });
    const crj = await cr.json(); productId = crj.id || null;
  } catch (e) { /* logged below */ }

  await logAgent("AMARA", `PODgen ${uid}: ${pass ? "PASSED gate" : "HELD [" + gate.reason + "]"} → ${status} product ${productId || "(create failed)"}`, pass ? "success" : "warn");
  return { ok: true, uid, gate, status, productId, imageUrl };
}

// POST /api/podgen/run (GATED) — body { theme?, style?: design|text|art, dry?: true }
podgenRouter.post("/run", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await runPodGen({ theme: req.body?.theme, style: req.body?.style, dry: req.body?.dry === true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/podgen/batch (GATED) — generate a catalog in the background. body { count?, themes? }
const DEFAULT_THEMES = ["Juneteenth Celebration","Melanin Queen","Kente Heritage","Sankofa Wisdom","Black Excellence","Ankara Bloom","Afro Muse","Diaspora Roots","Golden Heritage","Naija Pride","Black Love","Ancestral Power"];
podgenRouter.post("/batch", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const count = Math.min(20, Math.max(1, req.body?.count || 12));
  const themes = (req.body?.themes && req.body.themes.length) ? req.body.themes : DEFAULT_THEMES;
  res.json({ ok: true, started: count, note: "generating in background (~45s each)" });
  (async () => {
    let made = 0;
    for (let i = 0; i < count; i++) {
      try { const r = await runPodGen({ theme: themes[i % themes.length], style: i % 3 === 1 ? "text" : "design" }); if (r?.productId) made++; }
      catch (e) { console.log("[batch]", e.message); }
    }
    await logAgent("AMARA", `Batch complete: ${made}/${count} designs created`, "success");
  })();
});

console.log("[podgen] armed — POST /api/podgen/run (fal.ai gen + Claude-vision IP gate). AUTO_PUBLISH=" + AUTO_PUBLISH);
