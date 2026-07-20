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
import sharp from "sharp";
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

// ── HOJ watermark (CEO 7/15): subtle tiled wordmark on all PUBLIC images so
// screenshots can't be passed off as originals. The buyer's DOWNLOAD stays clean
// (delivery reads the clean URL from a hidden <!--CLEAN:...--> tag in the body).
// GET /api/podgen/wm?u=<image-url> — fetches, stamps, returns JPEG. Shopify and
// the socials point at this proxy; if anything fails it 302s to the clean image
// so a product/post is never blocked by a watermark hiccup.
const WM = u => `${APP_URL}/api/podgen/wm?u=${encodeURIComponent(u)}`;
podgenRouter.get("/wm", async (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).send("u required");
  try {
    const buf = Buffer.from(await (await fetch(u, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
    const img = sharp(buf); const meta = await img.metadata();
    const w = meta.width || 1200, h = meta.height || 1200, fs = Math.round(w / 24);
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><pattern id="p" width="${Math.round(w/2)}" height="${Math.round(h/3)}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
        <text x="8" y="${fs+8}" font-family="Arial, sans-serif" font-size="${fs}" fill="#ffffff" fill-opacity="0.09" font-weight="bold">HOUSE OF JREYM</text>
      </pattern></defs>
      <rect width="${w}" height="${h}" fill="url(#p)"/>
      <text x="${Math.round(w/2)}" y="${h-14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(fs*0.7)}" fill="#ffffff" fill-opacity="0.30" font-weight="bold" stroke="#000000" stroke-opacity="0.15" stroke-width="0.5">houseofjreym.store</text>
    </svg>`;
    const out = await img.composite([{ input: Buffer.from(svg), blend: "over" }]).jpeg({ quality: 92 }).toBuffer();
    res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=86400").send(out);
  } catch (e) { res.redirect(302, u); } // self-heal: never block on a watermark failure
});

// ── fal.ai generation via queue API (submit -> poll status -> fetch result) ──
async function falGenerate(model, prompt, imageSize = { width: 1200, height: 1200 }) {
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
  const img = out.images?.[0] || out.image || {};
  const url = img.url;
  if (!url) throw new Error("fal: no image url in result");
  return { url, w: img.width || 0, h: img.height || 0 };
}

// ── fal retry wrapper (CEO 7/11 self-heal): one transient failure never kills a drop ──
// CEO 7/12: first attempt renders at high resolution (PODGEN_IMG_SIZE, default
// 1440px); the fallback attempt uses the safe square_hd preset so an oversized
// request can never kill a drop.
const IMG_PX = Math.max(1152, parseInt(process.env.PODGEN_IMG_SIZE || "1440", 10)); // request size — never below ~1080
const MIN_HQ = 1080; // CEO 7/13: nothing under 1080p is ever posted
async function falGenerateRetry(model, prompt, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const px = i === 0 ? IMG_PX : 1200; return await falGenerate(model, prompt, { width: px, height: px }); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 4000)); }
  }
  throw last;
}
// short side of a fal result (falls back to requested size if the API omits dims)
const shortSide = r => Math.min(r.w || IMG_PX, r.h || IMG_PX);

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
  const prompt = `Original "${theme}" wall art — PHOTOREALISTIC, hyper-realistic, ultra-detailed, cinematic lighting and true-to-life depth, WITH A SURPRISING CREATIVE PLOT-TWIST element that makes the scene unexpected and scroll-stopping. Gallery quality, print-ready. FULL-BLEED edge-to-edge: fills the entire canvas with no picture frame, no border, no matting, no mockup — maximized to use all space at the highest possible detail. Absolutely no words, letters, numbers, text, typography, signatures, or watermarks anywhere. No brand names or logos, no trademarks, no copyrighted characters, no real identifiable people — 100% original artwork.`;
  if (dry) return { ok: true, dry: true, uid, model, prompt };

  const baseGen = await falGenerateRetry(model, prompt);
  const imageUrl = baseGen.url;
  const hiRes = shortSide(baseGen) >= MIN_HQ; // CEO 7/13: only >=1080p is postable
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
        const vGen = await falGenerateRetry(MODELS.art, v.p);
        const vGate = await ipVisionGate(vGen.url);
        if (!vGate.risky && shortSide(vGen) >= MIN_HQ) { versionImages.push({ src: vGen.url }); versionsIncluded.push(v.label); }
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
        const sGen = await falGenerateRetry(MODELS.art, `Photorealistic ultra-detailed "${theme}" wall art ${s}. Cinematic and lifelike, maximized edge-to-edge with no picture frame anywhere. Absolutely no people, no humans, no faces, no hands, no words, letters, text, logos or watermarks anywhere.`);
        const sGate = await ipVisionGate(sGen.url);
        if (!sGate.risky && shortSide(sGen) >= MIN_HQ) versionImages.push({ src: sGen.url });
      } catch (e) { /* previews optional — base still ships */ }
    }
  }

  // CLEAN originals stay hidden in the body for zero-touch delivery; Shopify pulls
  // the PUBLIC images through the watermark proxy so the storefront is stamped.
  const cleanList = versionImages.map(v => v.src).join("|");
  // CEO 7/15: strip the word "Magic" from all public-facing text (title/tags/desc).
  const scrubMagic = s => String(s || "")
    .replace(/black girl magic/gi, "Black Girl Power").replace(/melanin magic/gi, "Melanin")
    .replace(/\bmagical\b/gi, "").replace(/\bmagic\b/gi, "")
    .replace(/\s{2,}/g, " ").replace(/\s+—/g, " —").replace(/,\s*,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  const cleanTheme = scrubMagic(theme);
  const product = {
    title: `${cleanTheme} — Original Digital Wall Art (${uid})`,
    body_html: `<p>Original ${cleanTheme} wall art from House of Jreym — a print-ready digital download. Design ID <strong>${uid}</strong>.</p><p><strong>Includes ${versionsIncluded.length} digital version${versionsIncluded.length>1?"s":""}: ${versionsIncluded.join(", ")}.</strong> Full-bleed, frameless — the art fills the whole space at maximum quality. Preview photos show it as a frameless canvas in real rooms.</p><p><strong>Instant digital download</strong> — no physical item is shipped. For personal use only; may not be resold or redistributed.</p><!--CLEAN:${cleanList}-->`,
    vendor: "House of Jreym", product_type: "Digital Wall Art", status,
    tags: scrubMagic(`originals, digital download, wall art, 3d, holographic, ${cleanTheme}, ${uid}`),
    images: versionImages.map(v => ({ src: WM(v.src) })),
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

  // ── Closed loop 2: auto-schedule a buy-link post — ONLY if the art is >=1080p (CEO 7/13)
  if (pass && hiRes && productId) {
    try {
      const when = new Date(Date.now() + 3 * 3600e3); when.setUTCMinutes(0, 0, 0);
      const link = handle ? `houseofjreym.store/products/${handle}` : "houseofjreym.store";
      const caption = enforceCaptionRules(`NEW DROP 🔥 "${theme}" — original wall art, instant digital download. Comes in Classic, 3D & Holographic editions ✨ Limited edition of 250 (${uid}). Launch price $8.79 (was $10.99). 🛍 ${link} #HouseOfJreym #WallArt #DigitalDownload #3DArt #HolographicArt #LimitedEdition`, link); // house rules
      await supabase.from("social_posts").insert({
        platform: "all", status: "scheduled", caption, media_urls: [WM(imageUrl)], media_type: "IMAGE",
        scheduled_for: when.toISOString(), keyword: "autodrop-" + uid,
        meta: { pipeline: "podgen-autopost", product_id: productId, uid }
      });
      await logAgent("IBRAHIM", `Auto-scheduled buy-link post for ${uid} @ ${when.toISOString()}`, "info");
    } catch (e) { await logAgent("IBRAHIM", `Auto-post schedule failed for ${uid}: ${e.message.slice(0, 80)}`, "warn"); }
  }

  await logAgent("AMARA", `PODgen ${uid}: ${pass ? "PASSED gate" : "HELD [" + gate.reason + "]"}${hiRes ? "" : " [SUB-1080p — no auto-post]"} → ${status} product ${productId || "(create failed)"}`, pass ? "success" : "warn");
  return { ok: true, uid, gate, status, productId, imageUrl, hiRes };
}

// POST /api/podgen/run (GATED) — body { theme?, style?: design|text|art, dry?: true }
podgenRouter.post("/run", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await runPodGen({ theme: req.body?.theme, style: req.body?.style, dry: req.body?.dry === true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/podgen/batch (GATED) — generate a catalog in the background. body { count?, themes? }
// CEO 7/11: theme pool widened past Afrocentric — dogs (HOJ Pets), sports, moods.
const DEFAULT_THEMES = ["Optical Illusion Op-Art Hypnotic","Regal Pet Portrait — crowned royal dog","Melanin Queen — radiant joy","Mid-Century Modern Abstract Shapes","Kente Heritage Celebration","Impossible Geometry Escher-Style Illusion","Black Joy & Community","Minimalist Botanical Line Art","Afrocentric Royalty & Excellence","Golden Retriever Pet Portrait — sunny garden","Retro Wavy Checkerboard Pop","Sankofa Wisdom","Abstract Geometric Bauhaus","Quirky Animal Bathroom Humor Poster","Ankara Bloom Vibrance","Golden Art-Nouveau Floral"];
// Trending-alternatives pool inspired by Etsy digital-print best-sellers + optical
// illusions (CEO 7/15) — used to keep the catalog fresh and competitive.
const TREND_THEMES = ["Optical Illusion Op-Art Hypnotic","Impossible Geometry Escher-Style Illusion","Mid-Century Modern Abstract Shapes","Retro Wavy Checkerboard Pop","Minimalist Botanical Line Art","Vintage Newspaper Collage Aesthetic","Quirky Animal Bathroom Humor Poster","Abstract Geometric Bauhaus","Golden Art-Nouveau Floral","Surreal Melting Dreamscape","Anaglyph 3D Depth Illusion","Moody Abstract Ink Wash"];
// Positive Afrocentric pool — daily slot 1 pulls from here so >=30% (~33%) of the
// feed stays proudly Afrocentric (CEO 7/13).
const AFRO_THEMES = ["Melanin Queen — radiant joy","Kente Heritage Celebration","Black Joy & Community","Afrocentric Royalty & Excellence","Sankofa Wisdom","Ankara Bloom Vibrance","Black Excellence & Pride","Diaspora Roots & Unity"];
// Non-Afrocentric variety pool — sports / pop-culture vibes / moods (CEO 7/12)
const VARIETY_THEMES = ["Optical Illusion Op-Art Hypnotic","Basketball Court Legends","Impossible Geometry Escher-Style Illusion","Mid-Century Modern Abstract Shapes","Boxing Champion Spirit","Retro Wavy Checkerboard Pop","Minimalist Botanical Line Art","Y2K Chrome Aesthetic","Abstract Geometric Bauhaus","Quirky Animal Bathroom Humor Poster","Golden Art-Nouveau Floral","Vintage Newspaper Collage Aesthetic","Cosmic Space Dreamscape","Anime-Style Rainy City Mood","Surreal Melting Dreamscape","Vintage Muscle Car Sunset"];
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
    // Balanced daily mix (CEO 7/13): slot0 dog (pets), slot1 positive Afrocentric
    // (guarantees >=30% / ~33% Afrocentric), slot2 sports/pop-culture/mood variety.
    const dayN = Math.floor(Date.now() / 86400000);
    themes[0] = DOG_THEMES[dayN % DOG_THEMES.length];
    if (themes.length >= 2) themes[1] = AFRO_THEMES[dayN % AFRO_THEMES.length];
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

// ── TRENDING DROP (CEO 2026-07-20) ───────────────────────────────────────────
// 24-theme mix balancing the brand's Afrocentric core (>=1/3), optical illusions,
// this month's culture theme, and 2026's best-selling wall-art aesthetics
// (sophisticated neutrals, romantic pastels, botanical line art, bold contrast,
// contemporary folk, mid-century, AI-surreal). All original + IP-safe.
export const TRENDING_2026_MIX = [
  // Afrocentric core (8)
  "Afrocentric Royalty & Excellence — regal golden portrait",
  "Melanin Queen — radiant joy in golden light",
  "Kente Heritage Celebration — royal color geometry",
  "Sankofa Wisdom — ancestral symbol in gold",
  "Black Joy & Community — vibrant togetherness",
  "Diaspora Roots & Unity — constellation of heritage",
  "Ankara Bloom Vibrance — bold pattern florals",
  "Nubian Elegance — timeless profile in bronze and gold",
  // Optical illusion / AI-surreal (5)
  "Optical Illusion Op-Art Hypnotic — mind-bending depth",
  "Impossible Geometry Escher-Style Illusion",
  "Anamorphic 3D Pop-Out Depth Illusion",
  "Surreal Melting Dreamscape — AI surrealism",
  "Hypnotic Moire Wave Pattern — motion in stillness",
  // 2026 best-selling aesthetics (7)
  "Sophisticated Neutrals — beige and cream line-art minimalism",
  "Romantic Pastel Abstract — lavender and mint softness",
  "Botanical Line Art — elegant minimalist greenery",
  "Bold Color Contrast Abstract — primary energy",
  "Contemporary Folk Geometry — brocade motifs reimagined",
  "Mid-Century Modern Abstract Shapes — retro palette",
  "Coastal Serenity Landscape — sunlit ocean calm",
  // Global culture uplift (4) — July = Global Unity Summer
  "Global Unity Summer — every culture in uplifting light",
  "Caribbean Carnival Joy — vibrant celebration of life",
  "Lunar Festival Lanterns — radiant night of hope",
  "Mexican Talavera Sunburst — heritage in full color",
];

// Generate N products sequentially (each: fal.ai gen -> IP gate -> Shopify publish
// watermarked in Classic/3D/Holographic -> 250-cap -> auto buy-link post; Etsy
// mirror ticks pick them up). Runs in the background so callers return instantly.
export async function bulkTrendDrop({ count = 24, themes = null } = {}) {
  const pool = (themes && themes.length) ? themes : TRENDING_2026_MIX;
  let made = 0, held = 0, failed = 0;
  for (let i = 0; i < count; i++) {
    const theme = pool[i % pool.length];
    const style = i % 3 === 0 ? "art" : (i % 3 === 1 ? "design" : "text");
    try {
      const r = await runPodGen({ theme, style });
      if (r && r.productId) made++; else held++;
    } catch (e) { failed++; console.log("[trend-drop]", e.message); }
    if ((i + 1) % 6 === 0) await logAgent("AMARA", `Trend drop progress: ${made} live / ${i + 1} attempted`, "info");
  }
  await logAgent("AMARA", `Trend drop complete: ${made} live, ${held} held, ${failed} failed (of ${count})`, made ? "success" : "warn");
  return { count, made, held, failed };
}

// GET/POST /api/podgen/trend-drop?count=24&key=<APPROVAL_SECRET> — on-demand bulk drop.
// Key-gated (fal.ai costs money); runs in background, returns immediately.
podgenRouter.all("/trend-drop", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const count = Math.min(40, Math.max(1, parseInt(req.query.count || (req.body && req.body.count) || "24", 10)));
  res.json({ ok: true, started: count, note: "generating in background (~1-2 min each); watch /api/podgen/status and the shop" });
  bulkTrendDrop({ count }).catch(e => console.log("[trend-drop fatal]", e.message));
});
