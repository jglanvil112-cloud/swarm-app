// routes/mockups.js — SWARM OS
// Product-mockup photos for PNG listings on Etsy (CEO 9/5).
//   GET  /api/mockups/status                 — blanks present? zones in use?
//   POST /api/mockups/blanks   (GATED)       — generate the 3 blank product photos (once; ~$0.15 fal)
//   GET  /api/mockups/preview?listing_id=X&blank=tee — one composited JPEG, for eyeballing zones
//   POST /api/mockups/apply    (GATED)       — body { listing_id } or { all: true }
//        pulls the listing's primary image (the flat design), knocks out white,
//        composites tee/sweat/mug, uploads them as listing images: tee → rank 1
//        (the thumbnail buyers see), flat design stays, sweat + mug after.
// Idempotent: a listing that already has 4+ images is skipped unless force=true.

import express from "express";
import sharp from "sharp";
import { logAgent } from "../lib/supabase.js";
import { getEtsyToken } from "../lib/etsyDraft.js";
import { ensureBlanks, composite, knockoutWhite, zones, BLANKS } from "../lib/mockups.js";

export const mockupsRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_KEY = process.env.ETSY_KEY || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = parseInt(process.env.ETSY_SHOP_ID) || 0;
const ORDER = [["tee", 1], ["sweat", 3], ["mug", 4]]; // rank 2 = the flat design already there

function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured" }); return false; }
  const k = req.headers["x-approval-key"] || req.query.key;
  if (k !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}
const authH = t => ({ Authorization: "Bearer " + t, "x-api-key": ETSY_KEY + (ETSY_SECRET ? ":" + ETSY_SECRET : "") });

async function listingImages(lid, t) {
  const r = await fetch(`${ETSY_BASE}/listings/${lid}/images`, { headers: authH(t) });
  const j = await r.json().catch(() => ({}));
  return (j.results || []).sort((a, b) => (a.rank || 0) - (b.rank || 0));
}

async function designPngFromListing(lid, t) {
  const imgs = await listingImages(lid, t);
  if (!imgs.length) throw new Error("listing has no images");
  // the flat design is the image that was uploaded first (lowest listing_image_id), not necessarily rank 1
  const flat = [...imgs].sort((a, b) => a.listing_image_id - b.listing_image_id)[0];
  const buf = Buffer.from(await (await fetch(flat.url_fullxfull)).arrayBuffer());
  return { png: await knockoutWhite(buf), count: imgs.length, flatId: flat.listing_image_id };
}

async function uploadImage(lid, jpeg, rank, t) {
  const boundary = "----HoJMockup" + Date.now().toString(36);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="hoj_${lid}_mockup_${rank}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    jpeg,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n${rank}\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));
  const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${lid}/images`, {
    method: "POST", headers: { ...authH(t), "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length.toString() }, body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`image ${r.status}: ${text.slice(0, 160)}`);
  try { return JSON.parse(text).listing_image_id; } catch { return null; }
}

// Active + draft listings in this shop whose title marks them as PNG designs.
async function pngListings(t) {
  const out = [];
  for (const state of ["active", "draft"]) {
    let offset = 0;
    for (let page = 0; page < 10; page++) {
      const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings?state=${state}&limit=100&offset=${offset}`, { headers: authH(t) });
      const j = await r.json().catch(() => ({}));
      const rows = j.results || [];
      rows.filter(l => /\bPNG\b/i.test(l.title) && /Digital Download/i.test(l.title)).forEach(l => out.push({ listing_id: l.listing_id, title: l.title, state }));
      if (rows.length < 100) break; offset += 100;
    }
  }
  return out;
}

export async function applyMockups(lid, { force = false, keys = ORDER } = {}) {
  const t = await getEtsyToken(); if (!t) throw new Error("no Etsy token");
  const { png, count, flatId } = await designPngFromListing(lid, t);
  if (count >= 4 && !force) return { listing_id: lid, skipped: "already has mockups" };
  const done = [], errors = [];
  for (const [key, rank] of keys) {
    try { const jpg = await composite(png, key); done.push({ key, rank, image_id: await uploadImage(lid, jpg, rank, t) }); }
    catch (e) { errors.push({ key, error: e.message.slice(0, 140) }); }
  }
  // demote stray images (e.g. wall-art rollout frames) behind ours: re-post with listing_image_id + a high rank
  try {
    const after = await listingImages(lid, t);
    const ours = new Set([flatId, ...done.map(d => d.image_id)].filter(Boolean));
    let rank = 10;
    for (const im of after) if (!ours.has(im.listing_image_id)) {
      await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${lid}/images`, { method: "POST", headers: { ...authH(t), "Content-Type": "application/json" }, body: JSON.stringify({ listing_image_id: im.listing_image_id, rank: rank++ }) }).catch(() => {});
    }
  } catch (e) { /* cosmetic */ }
  await logAgent("AMARA", `Mockups ${lid}: ${done.map(d => d.key).join("+") || "none"}${errors.length ? " ⚠ " + errors.map(e => e.key + ":" + e.error.slice(0, 40)).join("; ") : ""}`, errors.length ? "warn" : "success");
  return { listing_id: lid, done, errors };
}

mockupsRouter.get("/status", async (req, res) => {
  const present = {};
  for (const [k, b] of Object.entries(BLANKS)) {
    const u = (await import("../lib/supabase.js")).supabase.storage.from("hoj-assets").getPublicUrl(b.file).data.publicUrl;
    const h = await fetch(u, { method: "HEAD" }).catch(() => null); present[k] = !!(h && h.ok) ? u : null;
  }
  res.json({ blanks: present, zones: zones(), order: ORDER });
});

mockupsRouter.post("/blanks", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await ensureBlanks({ force: req.body?.force === true, only: req.body?.only || null })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Eyeball one composite without touching Etsy. ?listing_id=...&blank=tee
mockupsRouter.get("/preview", async (req, res) => {
  try {
    const t = await getEtsyToken(); const { png } = await designPngFromListing(req.query.listing_id, t);
    const jpg = await composite(png, req.query.blank || "tee");
    res.set("Content-Type", "image/jpeg").send(jpg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

mockupsRouter.get("/listings", async (req, res) => {
  try { const t = await getEtsyToken(); const l = await pngListings(t); res.json({ count: l.length, listings: l }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// body { listing_id } → sync; body { all: true } → background over every PNG listing
mockupsRouter.post("/apply", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const force = req.body?.force === true;
  if (req.body?.listing_id) {
    try { return res.json(await applyMockups(req.body.listing_id, { force })); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (!req.body?.all) return res.status(400).json({ error: "listing_id or all:true required" });
  const t = await getEtsyToken(); const targets = await pngListings(t);
  res.json({ ok: true, started: targets.length, note: "compositing in background (~10s each)" });
  (async () => {
    let ok = 0, skip = 0, bad = 0;
    for (const l of targets) {
      try { const r = await applyMockups(l.listing_id, { force }); if (r.skipped) skip++; else if (r.errors?.length && !r.done?.length) bad++; else ok++; }
      catch (e) { bad++; console.log("[mockups all]", l.listing_id, e.message); }
      await new Promise(r => setTimeout(r, 1500)); // be gentle with Etsy's rate limit
    }
    await logAgent("AMARA", `Mockups batch: ${ok} done, ${skip} skipped, ${bad} failed`, bad ? "warn" : "success");
  })();
});

console.log("[mockups] armed — POST /api/mockups/blanks then /api/mockups/apply {all:true}");
