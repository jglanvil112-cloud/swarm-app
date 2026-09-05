// routes/pngdrop.js — SWARM OS
// PNG / sublimation design-file lane for the HOUSEOFJREYM Etsy shop (CEO 9/4 brief:
// "sell production-ready files to other makers"). Separate from routes/podgen.js on
// purpose: podgen is picture-only wall art → Shopify; THIS lane is typography-led
// designs → transparent PNG → Etsy DRAFT via lib/etsyDraft.js.
//
//   concept -> fal.ai ideogram/v3 (text allowed) -> Claude-vision gate (IP + slogan
//   legibility) -> white-knockout PNG @300dpi + JPEG preview -> Supabase Storage
//   (hoj-assets/pngdrop/<uid>/) -> Etsy draft listing + image + digital file.
//
// SAFETY DEFAULTS:
//  - Every listing is created as DRAFT. Nothing goes active from this file.
//    Flip with POST /api/pngdrop/activate {listing_id} (gated) after eyeballing.
//  - Vision gate holds anything with a trademark / character / real person, AND
//    anything whose rendered text does not match the intended slogan (Ideogram
//    garbles letters sometimes — a misspelled file can't ship).
//  - Gate failures still upload to storage (so the image is reviewable) but skip Etsy.
//  - All mutating routes gated by APPROVAL_SECRET (same pattern as podgen).

import express from "express";
import sharp from "sharp";
import { supabase, logAgent } from "../lib/supabase.js";
import { createDraftListing, attachFileFromUrl, activateListing, getEtsyToken } from "../lib/etsyDraft.js";

export const pngdropRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_AI_KEY || process.env.fal_ai_KEY || process.env.fal_ai_key || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_KEY = process.env.ETSY_KEY || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = parseInt(process.env.ETSY_SHOP_ID) || 0;
const BUCKET = "hoj-assets";
const MODEL = process.env.PNGDROP_MODEL || "fal-ai/ideogram/v3";
const IMG_PX = parseInt(process.env.PNGDROP_PX) || 1440;
const DPI = 300;
const PRICE_SINGLE = parseFloat(process.env.PNGDROP_PRICE) || 3.99;

// ── Concept batch 1 (from etsy-digital-brief-sep2026.md). Original copy only. ──
// text = the exact slogan the image must render; the gate checks it letter-for-letter.
export const CONCEPTS = [
  { id: "faith-grace", niche: "faith", text: "Grace over grind",
    prompt: `hand-lettered boho serif quote "Grace over grind" with a single wildflower sprig, distressed cream and rust palette, screen-print grain texture, flat vector design`,
    title: "Grace Over Grind PNG, Faith Sublimation Design, Christian Shirt Png, Boho Scripture Png, Digital Download",
    tags: ["faith png","christian png","boho christian svg","scripture shirt png","grace sublimation","wildflower faith png","faith tumbler png","bible verse png","faith shirt design","inspirational png","hand lettered png","sublimation design","instant download"] },
  { id: "mental-brain", niche: "mental health", text: "Anatomy of a good day",
    prompt: `minimalist line-art human brain sprouting sage and blush wildflowers with small hand-lettered caption "Anatomy of a good day", hand-drawn ink style, subtle paper texture, centered composition`,
    title: "Mental Health PNG, Brain Flowers Sublimation, Anatomy Of A Good Day Png, Therapist Shirt Png, Digital Download",
    tags: ["mental health png","brain flowers png","therapist png","self care png","mental health shirt","floral brain svg","counselor gift png","wellness sublimation","line art png","affirmation png","psychology png","sublimation design","instant download"] },
  { id: "teacher-cardio", niche: "teacher", text: "Teaching is my cardio",
    prompt: `retro varsity arched lettering "Teaching is my cardio" with a hand-drawn apple and coffee cup, 1970s mustard and brown palette, worn screen-print texture, flat vector design`,
    title: "Teaching Is My Cardio PNG, Funny Teacher Sublimation, Retro Teacher Shirt Png, Back To School Png, Digital Download",
    tags: ["teacher png","funny teacher png","teacher sublimation","back to school png","retro teacher shirt","teacher gift png","teacher tumbler png","teacher life png","varsity teacher png","teacher appreciation","apple coffee png","sublimation design","instant download"] },
  { id: "nurse-bow", niche: "nurse", text: "Fluent in sarcasm and IV lines",
    prompt: `pink coquette ribbon bow wrapped around a hand-drawn stethoscope with script lettering "Fluent in sarcasm and IV lines", soft pastel palette, distressed grain, flat vector design`,
    title: "Nurse PNG, Coquette Bow Stethoscope Sublimation, Funny Nurse Shirt Png, Nurse Life Png, Digital Download",
    tags: ["nurse png","funny nurse png","nurse sublimation","coquette nurse png","stethoscope bow png","nurse life png","nurse gift png","nurse tumbler png","rn shirt png","nursing student png","bow sublimation","sublimation design","instant download"] },
  { id: "mom-fuel", niche: "mom", text: "Mom fuel",
    prompt: `retro 1970s diner badge reading "Mom fuel" with a steaming coffee mug and wavy checkered border, orange cream and brown palette, faded print texture, flat vector design`,
    title: "Mom Fuel PNG, Retro Mom Coffee Sublimation, Mom Life Shirt Png, Mama Tumbler Png, Digital Download",
    tags: ["mom png","mom life png","mama sublimation","mom coffee png","retro mom png","mom tumbler png","mothers day png","funny mom png","mom shirt design","coffee lover png","diner badge png","sublimation design","instant download"] },
  { id: "grad-2027", niche: "graduation", text: "Class of 2027 plot twist incoming",
    prompt: `bold graduation design with chunky serif "Class of 2027" and smaller script "plot twist incoming", laurel sprigs, gold and navy palette, clean flat vector`,
    title: "Class Of 2027 PNG, Graduation Sublimation Design, Senior 2027 Shirt Png, Grad Party Png, Digital Download",
    tags: ["class of 2027 png","graduation png","senior 2027 png","grad sublimation","graduation shirt png","grad party png","senior year png","2027 graduate png","laurel grad png","graduation gift png","grad tumbler png","sublimation design","instant download"] },
  { id: "vacay-loaded", niche: "travel", text: "Vacay mode fully loaded",
    prompt: `retro sunset stripe circle badge with palm silhouette and lettering "Vacay mode fully loaded", sun-faded teal orange and yellow, distressed halftone texture, flat vector design`,
    title: "Vacay Mode PNG, Family Vacation Sublimation, Retro Summer Trip Shirt Png, Beach Trip Png, Digital Download",
    tags: ["vacay mode png","family vacation png","summer trip png","beach shirt png","vacation sublimation","retro sunset png","family trip 2027","travel tumbler png","palm tree png","road trip png","matching family png","sublimation design","instant download"] },
  { id: "rooted-rising", niche: "heritage", text: "Rooted and rising",
    prompt: `hand-drawn baobab tree in single-line ink style over an original geometric band in gold black green and red, lettering "Rooted and rising" beneath, subtle woodcut texture, flat vector design`,
    title: "Rooted And Rising PNG, African Heritage Sublimation, Baobab Tree Shirt Png, Black History Png, Digital Download",
    tags: ["african heritage png","black history png","baobab tree png","heritage sublimation","black owned png","melanin shirt png","diaspora png","afrocentric png","black pride png","juneteenth png","heritage tumbler png","sublimation design","instant download"] },
  { id: "spooky-staff", niche: "seasonal", text: "Spooky season staff",
    prompt: `retro 1960s pumpkin badge with hand-lettered "Spooky season staff", orange black and cream palette, screen-print misregistration texture, flat vector design`,
    title: "Spooky Season Staff PNG, Halloween Teacher Nurse Sublimation, Retro Pumpkin Shirt Png, Fall Png, Digital Download",
    tags: ["halloween png","spooky season png","spooky teacher png","halloween nurse png","retro pumpkin png","fall sublimation","spooky shirt png","halloween tumbler","october png","pumpkin badge png","autumn png","sublimation design","instant download"] },
  { id: "dog-therapist", niche: "pets", text: "My dog is my therapist",
    prompt: `hand-drawn mixed-breed dog portrait wearing a wildflower collar with script lettering "My dog is my therapist", ink and watercolor texture, warm neutral palette, flat design`,
    title: "My Dog Is My Therapist PNG, Dog Mom Sublimation, Funny Dog Lover Shirt Png, Pet Tumbler Png, Digital Download",
    tags: ["dog mom png","dog lover png","funny dog png","dog sublimation","pet lover png","dog therapist png","dog shirt design","dog tumbler png","rescue dog png","wildflower dog png","pet mom png","sublimation design","instant download"] },
];

const IP_BLOCK = ["disney","marvel","pixar","nike","adidas","jordan","gucci","louis vuitton","supreme","nfl","nba","mlb","fifa",
  "olympics","star wars","harry potter","pokemon","pokémon","mickey","spider-man","batman","superman","barbie","coca-cola","pepsi",
  "celebrity","logo of","stitch","paw patrol","grinch","peeps","magical kingdom","world cup","that girl"];

function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured" }); return false; }
  const k = req.headers["x-approval-key"] || req.query.key;
  if (k !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}

// ── fal.ai queue API (same shape as podgen) ──
async function falGenerate(model, prompt, px = IMG_PX) {
  if (!FAL_KEY) throw new Error("FAL_KEY missing");
  const auth = { Authorization: "Key " + FAL_KEY, "Content-Type": "application/json" };
  const sub = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST", headers: auth, body: JSON.stringify({ prompt, image_size: { width: px, height: px } })
  });
  const j = await sub.json();
  if (!j.request_id) throw new Error("fal submit failed: " + JSON.stringify(j).slice(0, 160));
  const statusUrl = j.status_url || `https://queue.fal.run/${model}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${model}/requests/${j.request_id}`;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await (await fetch(statusUrl, { headers: auth })).json();
    if (s.status === "COMPLETED") break;
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error("fal generation failed: " + JSON.stringify(s).slice(0, 200));
  }
  const out = await (await fetch(respUrl, { headers: auth })).json();
  const img = out.images?.[0] || out.image || out.output?.[0];
  const url = img?.url || (typeof img === "string" ? img : null);
  if (!url) throw new Error("fal: no image url in result");
  return { url, w: img?.width, h: img?.height };
}
async function falGenerateRetry(model, prompt, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await falGenerate(model, prompt, i === 0 ? IMG_PX : 1200); }
    catch (e) { err = e; }
  }
  throw err;
}

// ── Claude-vision gate: IP + slogan legibility. Text is EXPECTED here (unlike podgen). ──
async function visionGate(imageUrl, expectedText) {
  if (!ANTHROPIC_KEY) return { risky: true, reason: "no vision key — held for safety" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: `This is an AI-generated design file for a sublimation/PNG Etsy shop. The design is SUPPOSED to contain exactly this text: "${expectedText}". Answer: (1) Does the rendered text match that slogan exactly, with no misspellings, duplicated words, extra letters, or garbled glyphs? (2) Does the image contain any trademarked logo, brand name, copyrighted character, licensed mascot, real identifiable person, or a near-copy of a famous artwork? (3) Is it blurry, garbled, or low quality? Reply ONLY with JSON: {"risky":true|false,"text_ok":true|false,"reason":"short"} — risky must be true if text_ok is false or (2) or (3) is yes.` }
        ]}]
      })
    });
    const j = await r.json();
    const txt = (j.content || []).map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(txt);
  } catch (e) { return { risky: true, reason: "gate error — held for safety" }; }
}

// ── White knockout → transparent PNG @300dpi. Near-white (all channels ≥ thresh) → alpha 0,
// with a soft ramp so anti-aliased edges don't go jagged. Flat/vector-style art only. ──
async function knockoutWhite(buf, thresh = 235, soft = 20) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = data.length / 4;
  for (let i = 0; i < px; i++) {
    const o = i * 4, mn = Math.min(data[o], data[o + 1], data[o + 2]);
    if (mn >= thresh) data[o + 3] = 0;
    else if (mn >= thresh - soft) data[o + 3] = Math.round(((thresh - mn) / soft) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 }).withMetadata({ density: DPI }).toBuffer();
}

async function uploadPublic(path, buf, contentType) {
  try { await supabase.storage.createBucket(BUCKET, { public: true }); } catch (e) { /* exists */ }
  const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
  if (up.error) throw new Error("storage: " + up.error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function attachListingImage(listing_id, jpegBuf, token) {
  const boundary = "----HoJPngDropImg" + Date.now().toString(36);
  const fname = `hoj_${listing_id}_preview.jpg`;
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: image/jpeg\r\n\r\n`,
    jpegBuf,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n1\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));
  const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/images`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length.toString(),
      Authorization: "Bearer " + token, "x-api-key": ETSY_KEY + (ETSY_SECRET ? ":" + ETSY_SECRET : "") },
    body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`image upload ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text).listing_image_id; } catch { return null; }
}

function buildDescription(c, uid) {
  return `${c.text} — original ${c.niche} design from House of Jreym, made for makers. Design ID ${uid}.

WHAT YOU GET
• 1 transparent-background PNG, 300 DPI, print-ready for sublimation, DTF, heat transfer, tumbler wraps, mugs, and shirts
• Instant download — no physical item is shipped

LICENSE
• Personal use and small-business commercial use on finished physical products (up to 500 units)
• Do NOT resell, share, or redistribute the file itself, digitally or in bundles

Colors may vary slightly between screens, printers, and blanks. No refunds on digital files, but message us with any issue and we'll make it right.

House of Jreym — made-by-hand files for people who make things.`;
}

// ── main pipeline ──
export async function runPngDrop(concept, { dry = false } = {}) {
  const c = typeof concept === "string" ? CONCEPTS.find(x => x.id === concept) : concept;
  if (!c) return { ok: false, reason: "unknown concept" };
  const uid = ("HOJ-PNG-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const hay = `${c.prompt} ${c.title} ${c.text}`.toLowerCase();
  if (IP_BLOCK.some(t => hay.includes(t))) return { ok: false, reason: "concept tripped IP blocklist", uid };

  const prompt = `${c.prompt}. Isolated on a pure solid flat white background, nothing else in the scene — no mockup, no shirt, no mug, no frame, no shadow, no border. Centered with generous margins. Text spelled exactly: "${c.text}". No brand names, no logos, no trademarks, no copyrighted characters, no real people — 100% original design.`;
  if (dry) return { ok: true, dry: true, uid, model: MODEL, prompt, listing: { title: c.title, tags: c.tags, price: PRICE_SINGLE } };

  const gen = await falGenerateRetry(MODEL, prompt);
  const gate = await visionGate(gen.url, c.text);
  const pass = !gate.risky;

  // Always produce + store the files so a HELD design is still reviewable in the bucket.
  const src = Buffer.from(await (await fetch(gen.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
  const png = await knockoutWhite(src);
  const preview = await sharp(src).resize(1200, 1200, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
  const folder = `pngdrop/${uid}`;
  const pngUrl = await uploadPublic(`${folder}/${c.id}.png`, png, "image/png");
  const previewUrl = await uploadPublic(`${folder}/${c.id}_preview.jpg`, preview, "image/jpeg");

  let listing_id = null, image_id = null, file = null, err = null;
  if (pass) {
    try {
      const token = await getEtsyToken();
      const d = await createDraftListing({ title: c.title, description: buildDescription(c, uid), tags: c.tags, price: PRICE_SINGLE }, token);
      listing_id = d.listing_id;
      try { image_id = await attachListingImage(listing_id, preview, token); } catch (e) { err = "image: " + e.message.slice(0, 120); }
      try { file = await attachFileFromUrl(listing_id, pngUrl, `house_of_jreym_${c.id}_${uid}.png`, token); } catch (e) { err = (err ? err + " | " : "") + "file: " + e.message.slice(0, 120); }
    } catch (e) { err = "listing: " + e.message.slice(0, 160); }
  }

  try {
    await supabase.from("agent_outputs").insert({
      agent: "AMARA", output_type: "pngdrop", status: pass ? (listing_id ? "draft" : "failed") : "held",
      payload: { uid, concept: c.id, niche: c.niche, text: c.text, gate, pngUrl, previewUrl, listing_id, image_id, file, err }
    });
  } catch (e) { /* table optional */ }
  await logAgent("AMARA", `PNGdrop ${uid} [${c.id}]: ${pass ? "PASSED gate" : "HELD [" + gate.reason + "]"} → ${listing_id ? "Etsy DRAFT " + listing_id : "no listing"}${err ? " ⚠ " + err : ""}`, pass && listing_id ? "success" : "warn");
  return { ok: true, uid, concept: c.id, gate, pngUrl, previewUrl, listing_id, image_id, file, err };
}

// GET /api/pngdrop/concepts — the batch, read-only
pngdropRouter.get("/concepts", (req, res) => res.json({ count: CONCEPTS.length, price: PRICE_SINGLE, model: MODEL, concepts: CONCEPTS.map(c => ({ id: c.id, niche: c.niche, text: c.text, title: c.title })) }));

// GET /api/pngdrop/status
pngdropRouter.get("/status", (req, res) => res.json({ model: MODEL, px: IMG_PX, dpi: DPI, price: PRICE_SINGLE, fal_key_present: !!FAL_KEY, vision_key_present: !!ANTHROPIC_KEY, etsy_shop_id: ETSY_SHOP_ID || null, bucket: BUCKET, ts: new Date().toISOString() }));

// POST /api/pngdrop/run (GATED) — body { concept: "<id>", dry?: true } or a full custom concept object
pngdropRouter.post("/run", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const c = req.body?.concept && typeof req.body.concept === "object" ? req.body.concept : (req.body?.concept || CONCEPTS[0].id);
    res.json(await runPngDrop(c, { dry: req.body?.dry === true }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pngdrop/batch (GATED) — body { ids?: [...] } default = all 10. Sequential, background.
pngdropRouter.post("/batch", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : CONCEPTS.map(c => c.id);
  res.json({ ok: true, started: ids.length, note: "generating in background (~40s each); results in agent_logs (AMARA) + hoj-assets/pngdrop/" });
  (async () => {
    let drafts = 0, held = 0;
    for (const id of ids) {
      try { const r = await runPngDrop(id); if (r.listing_id) drafts++; else held++; }
      catch (e) { held++; console.log("[pngdrop batch]", id, e.message); }
    }
    await logAgent("AMARA", `PNGdrop batch complete: ${drafts} Etsy drafts, ${held} held/failed — review drafts before activating`, "success");
  })();
});

// POST /api/pngdrop/activate (GATED) — body { listing_id } — the ONLY path to live.
pngdropRouter.post("/activate", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const lid = req.body?.listing_id;
  if (!lid) return res.status(400).json({ error: "listing_id required" });
  try { res.json(await activateListing(lid)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

console.log(`[pngdrop] armed — POST /api/pngdrop/batch (${CONCEPTS.length} concepts, ${MODEL}, Etsy DRAFT only)`);
