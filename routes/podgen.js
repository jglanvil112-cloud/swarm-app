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
import { enforceCaptionRules } from "../lib/captionRules.js";

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
async function falGenerate(model, prompt, imageSize = "square_hd") {
  if (!FAL_KEY) throw new Error("FAL_KEY missing — add it in Render (swarm-app service → Environment)");
  const auth = { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" };
  const sub = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST", headers: auth, body: JSON.stringify({ prompt, image_size: imageSize })
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

// ── fal retry wrapper (CEO 7/11 self-heal): one transient failure never kills a drop ──
// CEO 7/12: first attempt renders at high resolution (PODGEN_IMG_SIZE, default
// 1440px); the fallback attempt uses the safe square_hd preset so an oversized
// request can never kill a drop.
const IMG_PX = Math.max(1024, parseInt(process.env.PODGEN_IMG_SIZE || "1440", 10));
async function falGenerateRetry(model, prompt, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await falGenerate(model, prompt, i === 0 ? { width: IMG_PX, height: IMG_PX } : "square_hd"); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 4000)); }
  }
  throw last;
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
          { type: "text", text: "Check this AI-generated art for a print-on-demand store. Does it contain any trademarked logo, brand name, copyrighted character, real identifiable person/celebrity, or a near-copy of a famous existing artwork? Does it contain ANY readable words, letters, numbers, or typography (brand is picture-only)? Is it low-quality, garbled, or blurry? Reply ONLY with JSON: {\"risky\":true|false,\"reason\":\"short\"}" }
        ]}]
      })
    });
    const j = await r.json();
    const txt = (j.content || []).map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(txt);
  } catch (e) { return { risky: true, reason: "gate error — held for safety" }; }
}

// ── main pipeline ──
// CEO 7/11: themes are no longer forced Afrocentric — sports, moods, pets and
// trending topics all flow through as-is; the theme itself carries the vibe.
export async function runPodGen({ theme = "Afrocentric heritage", style = "design", dry = false } = {}) {
  const uid = ("HOJ-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)).toUpperCase();
  if (IP_BLOCK.some(t => theme.toLowerCase().includes(t))) return { ok: false, reason: "theme tripped IP blocklist", uid };
  const model = MODELS[style] || MODELS.design;
  const prompt = `Original "${theme}" themed wall-art design. Bold, high-contrast, clean print-ready composition, museum-quality digital art. FULL-BLEED edge-to-edge: the artwork fills the entire canvas with no picture frame, no border, no matting, no mockup — maximize the art to use all available space at the highest possible detail. Pure imagery with absolutely no words, letters, numbers, text, typography, signatures, or watermarks anywhere in the image. No brand names or logos, no trademarks, no copyrighted characters, no real people — 100% original artwork.`;
  if (dry) return { ok: true, dry: true, uid, model, prompt };

  const imageUrl = await falGenerateRetry(model, prompt);
  const gate = await ipVisionGate(imageUrl);
  const pass = !gate.risky;
  const status = (pass && AUTO_PUBLISH) ? "active" : "draft";

  // ── 3D + Holographic editions (CEO 7/8): every clean drop ships 3 versions ──
  const versionImages = [{ src: imageUrl }];
  const versionsIncluded = ["Classic"];
  if (pass) {
    const variants3 = [
      { label: "3D", p: prompt + " Rendered as a volumetric 3D sculptural relief with realistic depth, dimensional shadows, and studio lighting." },
      { label: "Holographic", p: prompt + " Holographic iridescent chrome finish, prismatic rainbow light refractions, futuristic luminous sheen." }
    ];
    for (const v of variants3) {
      try {
        const vUrl = await falGenerateRetry(MODELS.art, v.p);
        const vGate = await ipVisionGate(vUrl);
        if (!vGate.risky) { versionImages.push({ src: vUrl }); versionsIncluded.push(v.label); }
      } catch (e) { /* version optional — base still ships */ }
    }

    // ── Scenery previews (CEO 7/12): FRAMELESS gallery-wrapped canvas on a wall — NEVER people, NEVER a picture frame ──
    const sceneries = [
      "shown as a large frameless gallery-wrapped canvas (edges wrapped, absolutely no picture frame or border) filling a bright modern living room wall, warm natural light, completely empty room",
      "shown as a big frameless edge-to-edge canvas print (no frame, no matting) above a minimalist bedroom headboard, soft morning light, completely empty room",
      "shown as a frameless full-bleed canvas print (no frame) on a clean gallery wall with a plant and bench, bright even lighting, completely empty space"
    ];
    for (const s of sceneries) {
      try {
        const sUrl = await falGenerateRetry(MODELS.art, `Original "${theme}" themed wall-art ${s}. The artwork is maximized edge-to-edge with no picture frame anywhere. Absolutely no people, no humans, no faces, no hands, no words, letters, text, logos or watermarks anywhere.`);
        const sGate = await ipVisionGate(sUrl);
        if (!sGate.risky) versionImages.push({ src: sUrl });
      } catch (e) { /* previews optional — base still ships */ }
    }
  }

  const product = {
    title: `${theme} — Original Digital Wall Art (${uid})`,
    body_html: `<p>Original ${theme} wall art from House of Jreym — a print-ready digital download. Design ID <strong>${uid}</strong>.</p><p><strong>Includes ${versionsIncluded.length} digital version${versionsIncluded.length>1?"s":""}: ${versionsIncluded.join(", ")}.</strong> Full-bleed, frameless — the art fills the whole space at maximum quality. Preview photos show it as a frameless canvas in real rooms.</p><p><strong>Instant digital download</strong> — no physical item is shipped. For personal use only; may not be resold or redistributed.</p>`,
    vendor: "House of Jreym", product_type: "Digital Wall Art", status,
    tags: `originals, digital download, wall art, 3d, holographic, ${theme}, ${uid}`,
    images: versionImages,
    variants: [{ price: "10.99", requires_shipping: false, taxable: true, inventory_management: null }]
  };
  let productId = null, variantId = null, handle = null;
  try {
    const cr = await fetch(`${APP_URL}/api/shopify/create-product`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-approval-key": APPROVAL_SECRET },
      body: JSON.stringify({ product })
    });
    const crj = await cr.json(); productId = crj.id || null; variantId = crj.variant_id || null; handle = crj.handle || null;
  } catch (e) { /* logged below */ }

  // ── Closed loop 1: every new design is a limited edition of 250, automatically
  if (variantId) {
    try {
      await fetch(`${APP_URL}/api/shopify/inventory-cap`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-approval-key": APPROVAL_SECRET },
        body: JSON.stringify({ variant_ids: [variantId], qty: 250 })
      });
    } catch (e) { await logAgent("KWAME", `Auto-cap failed for ${uid}: ${e.message.slice(0, 80)}`, "warn"); }
  }

  // ── Closed loop 2: auto-schedule a buy-link post for the new design (IG+FB via IBRAHIM, respects 4/day cap)
  if (pass && productId) {
    try {
      const when = new Date(Date.now() + 3 * 3600e3); when.setUTCMinutes(0, 0, 0);
      const link = handle ? `houseofjreym.store/products/${handle}` : "houseofjreym.store";
      const caption = enforceCaptionRules(`NEW DROP 🔥 "${theme}" — original wall art, instant digital download. Comes in Classic, 3D & Holographic editions ✨ Limited edition of 250 (${uid}). Launch price $8.79 (was $10.99). 🛍 ${link} #HouseOfJreym #WallArt #DigitalDownload #3DArt #HolographicArt #LimitedEdition`, link); // house rules
      await supabase.from("social_posts").insert({
        platform: "all", status: "scheduled", caption, media_urls: [imageUrl], media_type: "IMAGE",
        scheduled_for: when.toISOString(), keyword: "autodrop-" + uid,
        meta: { pipeline: "podgen-autopost", product_id: productId, uid }
      });
      await logAgent("IBRAHIM", `Auto-scheduled buy-link post for ${uid} @ ${when.toISOString()}`, "info");
    } catch (e) { await logAgent("IBRAHIM", `Auto-post schedule failed for ${uid}: ${e.message.slice(0, 80)}`, "warn"); }
  }

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
// CEO 7/11: theme pool widened past Afrocentric — dogs (HOJ Pets), sports, moods.
const DEFAULT_THEMES = ["Basketball Court Legends","Regal Pet Portrait — crowned royal dog","Retro Arcade Neon Nights","Melanin Queen","Boxing Champion Spirit","Chill Lo-fi Sunset Mood","Street Graffiti Color Explosion","Golden Retriever Pet Portrait — sunny garden","Football Stadium Friday Lights","Y2K Chrome Aesthetic","Kente Heritage","Skate Park Motion Blur","Cosmic Space Dreamscape","Midnight City Dreams Mood","Black Excellence","Anime-Style Rainy City Mood"];
// Non-Afrocentric variety pool — daily slot 3 rotates through this so the feed
// always mixes sports / pop-culture vibes / moods (CEO 7/12)
const VARIETY_THEMES = ["Basketball Court Legends","Retro Arcade Neon Nights","Boxing Champion Spirit","Street Graffiti Color Explosion","Football Stadium Friday Lights","Y2K Chrome Aesthetic","Skate Park Motion Blur","Cosmic Space Dreamscape","Chill Lo-fi Sunset Mood","Anime-Style Rainy City Mood","Midnight City Dreams Mood","Vintage Muscle Car Sunset"];
const DOG_THEMES = ["Regal Pet Portrait — crowned royal dog","Golden Retriever Pet Portrait — sunny garden","French Bulldog Pet Portrait — neon pop art","Playful Puppy Pet Portrait — soft watercolor","Majestic German Shepherd Pet Portrait — mountain sunrise","Dapper Poodle Pet Portrait — renaissance style"];
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

// ── Daily auto-drop: trend-driven art generation (CEO directive: full-auto) ──────
// 08:30 UTC daily (right after NANA's 08:00 trend scout). Pulls NANA's freshest
// trend keywords as themes; falls back to DEFAULT_THEMES rotation. Each run flows
// the full closed loop: fal.ai gen → Claude-vision IP gate → Shopify publish
// (250-unit cap) → auto-scheduled IG/FB buy-link post (respects 4/day cap).
// Disable with PODGEN_DAILY=false. Volume via PODGEN_DAILY_COUNT (default 3, max 6).
import cron from "node-cron";
const DAILY_ON = process.env.PODGEN_DAILY !== "false";
const DAILY_COUNT = Math.min(6, Math.max(1, parseInt(process.env.PODGEN_DAILY_COUNT || "3", 10)));

async function latestTrendThemes(n) {
  try {
    const { data } = await supabase.from("tasks")
      .select("result, updated_at")
      .eq("task_type", "trend_research").eq("status", "completed")
      .order("updated_at", { ascending: false }).limit(1);
    const trends = data?.[0]?.result?.trends || [];
    const kws = trends.map(t => (typeof t === "string" ? t : t?.keyword))
      .filter(k => typeof k === "string" && k.trim());
    if (kws.length) return kws.slice(0, n);
  } catch (e) { console.log("[podgen daily] trend fetch failed:", e.message); }
  const day = Math.floor(Date.now() / 86400000);
  return Array.from({ length: n }, (_, i) => DEFAULT_THEMES[(day * n + i) % DEFAULT_THEMES.length]);
}

if (DAILY_ON) cron.schedule("30 8 * * *", async () => {
  try {
    const themes = await latestTrendThemes(DAILY_COUNT);
    // CEO 7/11: slot 0 is always a dog Pet Portrait (feeds the HOJ Pets section daily)
    const dayN = Math.floor(Date.now() / 86400000);
    themes[0] = DOG_THEMES[dayN % DOG_THEMES.length];
    // CEO 7/12: slot 2 is always sports/pop-culture/mood — never two Afrocentric slots
    if (themes.length >= 3) themes[2] = VARIETY_THEMES[dayN % VARIETY_THEMES.length];
    await logAgent("NANA", `Daily auto-drop starting: ${themes.join(" | ")}`, "info");
    let made = 0;
    for (let i = 0; i < themes.length; i++) {
      try { const r = await runPodGen({ theme: themes[i], style: i % 2 === 1 ? "art" : "design" }); if (r?.productId) made++; }
      catch (e) { console.log("[podgen daily]", e.message); }
    }
    await logAgent("AMARA", `Daily auto-drop complete: ${made}/${themes.length} live`, made ? "success" : "warn");
  } catch (e) { console.log("[podgen daily] fatal:", e.message); }
});
console.log("[podgen] daily auto-drop " + (DAILY_ON ? ("ON — 08:30 UTC, " + DAILY_COUNT + "/day") : "OFF"));

// GET /api/podgen/status — public config check (no secrets): confirms auto-publish state remotely
podgenRouter.get("/status",(req,res)=>res.json({auto_publish:AUTO_PUBLISH,daily_drop_on:DAILY_ON,daily_count:DAILY_COUNT,trend_drop_utc:"05:00 / 09:00 / 12:00",uptime_s:Math.round(process.uptime()),mem_mb:Math.round(process.memoryUsage().rss/1048576),ts:new Date().toISOString()}));
