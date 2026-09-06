// lib/mockups.js — SWARM OS
// Product mockups for the PNG / sublimation lane (CEO 9/5: "mockups").
// Three blank product photos are generated ONCE (fal flux) and stored in
// hoj-assets/mockups/. Every design is then composited onto them with sharp
// (multiply blend, so the print sits IN the fabric instead of on top of it).
// Deterministic: the design pixels are never re-drawn by a model, so the
// slogan can't be garbled. Blanks are re-usable forever; a mockup costs $0.
//
// Zones = where the print goes on each blank, as fractions of the blank's size
// {x, y, w, h}. Override without a deploy via env MOCKUP_ZONES (JSON).

import sharp from "sharp";
import { supabase } from "./supabase.js";

const BUCKET = "hoj-assets";
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_AI_KEY || process.env.fal_ai_KEY || process.env.fal_ai_key || "";
const BLANK_MODEL = process.env.MOCKUP_BLANK_MODEL || "fal-ai/flux-pro/v1.1";

export const BLANKS = {
  tee:   { file: "mockups/blank_tee.jpg",   prompt: "Product photo of a plain blank heather-cream unisex t-shirt on a wooden hanger against a warm white plaster wall, soft natural side light, centered, front view, completely blank chest, no graphics, no text, no logos, no people, square composition" },
  sweat: { file: "mockups/blank_sweat.jpg", prompt: "Flat-lay product photo of a plain blank sand-colored crewneck sweatshirt folded neatly on a light oak table with a small eucalyptus sprig at the corner, top-down view, soft daylight, centered, completely blank front, no graphics, no text, no logos, no people, square composition" },
  mug:   { file: "mockups/blank_mug.jpg",   prompt: "Product photo of a plain white ceramic 11oz coffee mug on a light wood table with a linen napkin and blurred window light behind, handle to the right, front face fully visible and completely blank, no graphics, no text, no logos, no people, square composition" },
};

const DEFAULT_ZONES = {
  tee:   { x: 0.33, y: 0.30, w: 0.34, h: 0.34 },
  sweat: { x: 0.34, y: 0.30, w: 0.32, h: 0.30 },
  mug:   { x: 0.33, y: 0.38, w: 0.28, h: 0.28 },
};
export function zones() {
  try { return { ...DEFAULT_ZONES, ...JSON.parse(process.env.MOCKUP_ZONES || "{}") }; } catch { return DEFAULT_ZONES; }
}

function publicUrl(path) { return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }

async function falGenerate(model, prompt, px = 1200) {
  if (!FAL_KEY) throw new Error("FAL_KEY missing");
  const auth = { Authorization: "Key " + FAL_KEY, "Content-Type": "application/json" };
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: auth, body: JSON.stringify({ prompt, image_size: { width: px, height: px } }) });
  const j = await sub.json();
  if (!j.request_id) throw new Error("fal submit failed: " + JSON.stringify(j).slice(0, 160));
  const statusUrl = j.status_url || `https://queue.fal.run/${model}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${model}/requests/${j.request_id}`;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await (await fetch(statusUrl, { headers: auth })).json();
    if (s.status === "COMPLETED") break;
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error("fal failed: " + JSON.stringify(s).slice(0, 200));
  }
  const out = await (await fetch(respUrl, { headers: auth })).json();
  const img = out.images?.[0] || out.image || out.output?.[0];
  const url = img?.url || (typeof img === "string" ? img : null);
  if (!url) throw new Error("fal: no image url");
  return url;
}

// Generate + store the blanks. Safe to re-run: only regenerates what's missing unless force=true.
export async function ensureBlanks({ force = false, only = null } = {}) {
  const made = {}, existing = {};
  for (const [key, b] of Object.entries(BLANKS)) {
    if (only && only !== key) continue;
    if (!force) {
      const head = await fetch(publicUrl(b.file), { method: "HEAD" }).catch(() => null);
      if (head && head.ok) { existing[key] = publicUrl(b.file); continue; }
    }
    const url = await falGenerate(BLANK_MODEL, b.prompt);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const jpg = await sharp(buf).resize(1600, 1600, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    const up = await supabase.storage.from(BUCKET).upload(b.file, jpg, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error("storage: " + up.error.message);
    made[key] = publicUrl(b.file);
  }
  return { made, existing };
}

// White → alpha knockout (same as pngdrop) for designs that arrive as flat JPEGs.
export async function knockoutWhite(buf, thresh = 235, soft = 20) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (mn >= thresh) data[i + 3] = 0;
    else if (mn >= thresh - soft) data[i + 3] = Math.round(((thresh - mn) / soft) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function withOpacity(png, a) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * a);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// Composite one design (transparent PNG buffer) onto one blank. Returns JPEG buffer.
export async function composite(designPng, blankKey) {
  const b = BLANKS[blankKey]; if (!b) throw new Error("unknown blank " + blankKey);
  const z = zones()[blankKey];
  const blankBuf = Buffer.from(await (await fetch(publicUrl(b.file) + "?v=" + Date.now())).arrayBuffer());
  const base = sharp(blankBuf); const meta = await base.metadata();
  const W = meta.width, H = meta.height;
  const bw = Math.round(W * z.w), bh = Math.round(H * z.h);
  // trim transparent margins so the artwork fills the zone, then fit inside it
  const art = await sharp(designPng).trim().resize(bw, bh, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const am = await sharp(art).metadata();
  const left = Math.round(W * z.x + (bw - am.width) / 2), top = Math.round(H * z.y + (bh - am.height) / 2);
  // multiply = ink soaks into fabric; a faint "over" pass keeps light ink colors from vanishing into the cloth
  const out = await base
    .composite([
      { input: art, left, top, blend: "multiply" },
      { input: await withOpacity(art, 0.35), left, top, blend: "over" },
    ])
    .jpeg({ quality: 90 }).toBuffer();
  return out;
}

// All three mockups for one design. Returns [{key, buf}].
export async function mockupSet(designPng, keys = Object.keys(BLANKS)) {
  const out = [];
  for (const k of keys) {
    try { out.push({ key: k, buf: await composite(designPng, k) }); }
    catch (e) { out.push({ key: k, error: e.message }); }
  }
  return out;
}

// ── Wall-art room scenes (CEO 9/5: re-cover the 55 wall-art listings) ────────
// Blanks are interiors with a large EMPTY wall; the frame is drawn by us, so no
// per-blank calibration is needed — any clear wall works.
export const ROOMS = {
  living:  { file: "mockups/room_living.jpg",  prompt: "Interior photo of a bright modern living room, a low neutral linen sofa centered, a large completely empty plain off-white wall above it, wooden floor, a small plant at the side, soft daylight from a window, straight-on eye-level view, no artwork, no frames, no text, no people, square composition" },
  bedroom: { file: "mockups/room_bedroom.jpg", prompt: "Interior photo of a calm bedroom, a neatly made bed with beige linen centered, a large completely empty plain warm-white wall above the headboard, wooden bedside table with a lamp, soft morning light, straight-on eye-level view, no artwork, no frames, no text, no people, square composition" },
  office:  { file: "mockups/room_office.jpg",  prompt: "Interior photo of a minimalist home office, a light oak desk with a closed laptop and a small plant centered, a large completely empty plain white wall above the desk, soft natural light, straight-on eye-level view, no artwork, no frames, no text, no people, square composition" },
  hall:    { file: "mockups/room_hall.jpg",    prompt: "Interior photo of a stylish entryway, a slim walnut console table with a ceramic vase centered, a large completely empty plain sage-grey wall above it, herringbone wood floor, soft light, straight-on eye-level view, no artwork, no frames, no text, no people, square composition" },
  nook:    { file: "mockups/room_nook.jpg",    prompt: "Interior photo of a cozy reading corner, a caramel leather armchair and a floor lamp at the side, a large completely empty plain cream wall behind, a wool rug, warm afternoon light, straight-on eye-level view, no artwork, no frames, no text, no people, square composition" },
};
export const ROOM_ZONE = { x: 0.30, y: 0.12, w: 0.40, h: 0.44 }; // where the framed art hangs

export async function ensureRoomBlanks({ force = false } = {}) {
  const made = {}, existing = {};
  for (const [key, b] of Object.entries(ROOMS)) {
    if (!force) {
      const head = await fetch(publicUrl(b.file), { method: "HEAD" }).catch(() => null);
      if (head && head.ok) { existing[key] = publicUrl(b.file); continue; }
    }
    const url = await falGenerate(BLANK_MODEL, b.prompt);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const jpg = await sharp(buf).resize(1600, 1600, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    const up = await supabase.storage.from(BUCKET).upload(b.file, jpg, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error("storage: " + up.error.message);
    made[key] = publicUrl(b.file);
  }
  return { made, existing };
}

// Art (any image buffer) → framed print (white matte, thin black frame, soft shadow) on a room blank.
export async function roomComposite(artBuf, roomKey) {
  const b = ROOMS[roomKey]; if (!b) throw new Error("unknown room " + roomKey);
  const blankBuf = Buffer.from(await (await fetch(publicUrl(b.file) + "?v=" + Date.now())).arrayBuffer());
  const base = sharp(blankBuf); const meta = await base.metadata(); const W = meta.width, H = meta.height;
  const zw = Math.round(W * ROOM_ZONE.w), zh = Math.round(H * ROOM_ZONE.h);
  const matte = Math.round(zw * 0.045), frame = Math.round(zw * 0.018);
  const inner = await sharp(artBuf).resize(zw - 2 * (matte + frame), zh - 2 * (matte + frame), { fit: "inside" }).jpeg({ quality: 92 }).toBuffer();
  const im = await sharp(inner).metadata();
  const framed = await sharp(inner)
    .extend({ top: matte, bottom: matte, left: matte, right: matte, background: "#fbfaf7" })
    .extend({ top: frame, bottom: frame, left: frame, right: frame, background: "#171717" })
    .png().toBuffer();
  const fm = await sharp(framed).metadata();
  const left = Math.round(W * ROOM_ZONE.x + (zw - fm.width) / 2), top = Math.round(H * ROOM_ZONE.y + (zh - fm.height) / 2);
  const shadow = await sharp({ create: { width: fm.width, height: fm.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } } })
    .extend({ top: 60, bottom: 60, left: 60, right: 60, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(16).png().toBuffer();
  return base.composite([
    { input: shadow, left: left - 60 + 6, top: top - 60 + 14 },
    { input: framed, left, top },
  ]).jpeg({ quality: 90 }).toBuffer();
}
