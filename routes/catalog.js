// routes/catalog.js — SWARM OS
// Etsy catalog hygiene (CEO 9/5: "4 pages of the same thing").
//   GET  /api/catalog/dupes                — read-only: duplicate clusters + which listing_ids would be deactivated
//   POST /api/catalog/dedup (GATED)        — body { dry: true } = report only (default); { dry: false } = DEACTIVATE extras
// Rule: group active listings by design core (title with the HOJ id + filler words stripped).
// In each cluster keep ONE — most views, then most favorites, then oldest id — and set the rest
// to state "inactive". Inactive is reversible from Shop Manager; nothing is ever deleted here.
// PNG lane listings are ignored (they have their own pipeline).

import express from "express";
import { logAgent } from "../lib/supabase.js";
import { getEtsyToken } from "../lib/etsyDraft.js";
import { ensureRoomBlanks, roomComposite, ROOMS } from "../lib/mockups.js";

const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";

export const catalogRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_KEY = process.env.ETSY_KEY || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = parseInt(process.env.ETSY_SHOP_ID) || 0;
const authH = t => ({ Authorization: "Bearer " + t, "x-api-key": ETSY_KEY + (ETSY_SECRET ? ":" + ETSY_SECRET : ""), "Content-Type": "application/json" });

function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured" }); return false; }
  const k = req.headers["x-approval-key"] || req.query.key;
  if (k !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}

export const coreOf = s => String(s || "").toLowerCase()
  .replace(/\(hoj-[^)]*\)/g, "")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(original|digital|wall|art|download|printable|afrocentric|instant|decor|print|prints)\b/g, "")
  .replace(/\s+/g, " ").trim();

async function activeListings(t) {
  const out = [];
  for (let off = 0; off < 1000; off += 100) {
    const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings?state=active&limit=100&offset=${off}`, { headers: authH(t) });
    const j = await r.json().catch(() => ({})); const rows = j.results || [];
    rows.forEach(l => out.push({ id: l.listing_id, title: l.title, views: l.views || 0, favs: l.num_favorers || 0, created: l.original_creation_timestamp || 0 }));
    if (rows.length < 100) break;
  }
  return out;
}

export async function findDupes() {
  const t = await getEtsyToken(); if (!t) throw new Error("no Etsy token");
  const all = await activeListings(t);
  const wall = all.filter(l => !/\bPNG\b/i.test(l.title));
  const groups = {};
  wall.forEach(l => { const k = coreOf(l.title) || "(blank)"; (groups[k] = groups[k] || []).push(l); });
  const clusters = [], deactivate = [];
  for (const [core, v] of Object.entries(groups)) {
    if (v.length < 2) continue;
    const sorted = [...v].sort((a, b) => b.views - a.views || b.favs - a.favs || a.created - b.created || a.id - b.id);
    const keep = sorted[0], extras = sorted.slice(1);
    extras.forEach(e => deactivate.push(e.id));
    clusters.push({ core, count: v.length, keep: { id: keep.id, views: keep.views, favs: keep.favs }, deactivate: extras.map(e => e.id) });
  }
  clusters.sort((a, b) => b.count - a.count);
  return { total_active: all.length, wall_art: wall.length, png_lane: all.length - wall.length, distinct_designs: Object.keys(groups).length, clusters, deactivate_count: deactivate.length, deactivate };
}

catalogRouter.get("/dupes", async (req, res) => {
  try { res.json(await findDupes()); } catch (e) { res.status(500).json({ error: e.message }); }
});

catalogRouter.post("/dedup", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try {
    const plan = await findDupes();
    if (req.body?.dry !== false) return res.json({ dry: true, ...plan });
    const t = await getEtsyToken();
    const done = [], failed = [];
    for (const lid of plan.deactivate) {
      try {
        const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${lid}`, { method: "PATCH", headers: authH(t), body: JSON.stringify({ state: "inactive" }) });
        if (r.ok) done.push(lid); else failed.push({ lid, status: r.status, body: (await r.text()).slice(0, 100) });
      } catch (e) { failed.push({ lid, error: e.message.slice(0, 100) }); }
      await new Promise(r => setTimeout(r, 400));
    }
    await logAgent("AISHA", `Catalog dedup: deactivated ${done.length} duplicate listings across ${plan.clusters.length} designs${failed.length ? " ⚠ " + failed.length + " failed" : ""}`, failed.length ? "warn" : "success");
    res.json({ dry: false, deactivated: done.length, failed, clusters: plan.clusters.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RE-COVER: wall-art listings get room-scene covers (rotating scenes) ─────────────────────────
async function listingImages(lid, t) {
  const r = await fetch(`${ETSY_BASE}/listings/${lid}/images`, { headers: authH(t) });
  const j = await r.json().catch(() => ({}));
  return (j.results || []);
}
async function uploadImage(lid, jpeg, rank, t) {
  const boundary = "----HoJRoom" + Date.now().toString(36);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="hoj_${lid}_room_${rank}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    jpeg,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n${rank}\r\n--${boundary}\r\nContent-Disposition: form-data; name="alt_text"\r\n\r\nhoj_room_${rank}\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));
  const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${lid}/images`, {
    method: "POST", headers: { Authorization: "Bearer " + t, "x-api-key": ETSY_KEY + (ETSY_SECRET ? ":" + ETSY_SECRET : ""), "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length.toString() }, body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`image ${r.status}: ${text.slice(0, 120)}`);
  try { return JSON.parse(text).listing_image_id; } catch { return null; }
}

// The original artwork is the FIRST image ever uploaded to the listing (lowest listing_image_id).
// Rollout frames / old covers came later, so they have higher ids.
export async function recoverListing(lid, idx, { t } = {}) {
  t = t || await getEtsyToken();
  const imgs = await listingImages(lid, t);
  if (!imgs.length) return { listing_id: lid, skipped: "no images" };
  if (imgs.some(i => /^hoj_room_/.test(i.alt_text || ""))) return { listing_id: lid, skipped: "already re-covered" };
  const art = [...imgs].sort((a, b) => a.listing_image_id - b.listing_image_id)[0];
  const artBuf = Buffer.from(await (await fetch(art.url_fullxfull)).arrayBuffer());
  const keys = Object.keys(ROOMS);
  const a = keys[idx % keys.length], b = keys[(idx + 2) % keys.length]; // two different scenes per listing, neighbours differ
  const done = [], errors = [];
  for (const [key, rank] of [[a, 1], [b, 2]]) {
    try { const jpg = await roomComposite(artBuf, key); done.push({ key, rank, image_id: await uploadImage(lid, jpg, rank, t) }); }
    catch (e) { errors.push({ key, error: e.message.slice(0, 120) }); }
  }
  // art itself stays as image 3; push everything else (old frames) to the back
  try {
    const after = await listingImages(lid, t);
    const ours = new Set([art.listing_image_id, ...done.map(d => d.image_id)]);
    await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${lid}/images`, { method: "POST", headers: authH(t), body: JSON.stringify({ listing_image_id: art.listing_image_id, rank: 3 }) }).catch(() => {});
    let rank = 10;
    for (const im of after) if (!ours.has(im.listing_image_id))
      await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${lid}/images`, { method: "POST", headers: authH(t), body: JSON.stringify({ listing_image_id: im.listing_image_id, rank: rank++ }) }).catch(() => {});
  } catch (e) { /* cosmetic */ }
  return { listing_id: lid, done, errors };
}

catalogRouter.post("/room-blanks", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await ensureRoomBlanks({ force: req.body?.force === true })); } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/catalog/room-preview?listing_id=X&room=living — one composited JPEG, no Etsy writes
catalogRouter.get("/room-preview", async (req, res) => {
  try {
    const t = await getEtsyToken(); const imgs = await listingImages(req.query.listing_id, t);
    const art = [...imgs].sort((a, b) => a.listing_image_id - b.listing_image_id)[0];
    const buf = Buffer.from(await (await fetch(art.url_fullxfull)).arrayBuffer());
    res.set("Content-Type", "image/jpeg").send(await roomComposite(buf, req.query.room || "living"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/catalog/recover (GATED) — { listing_id } sync, or { all: true } background over all wall-art listings
catalogRouter.post("/recover", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const t = await getEtsyToken();
  if (req.body?.listing_id) { try { return res.json(await recoverListing(req.body.listing_id, 0, { t })); } catch (e) { return res.status(500).json({ error: e.message }); } }
  if (!req.body?.all) return res.status(400).json({ error: "listing_id or all:true" });
  const all = (await activeListings(t)).filter(l => !/\bPNG\b/i.test(l.title)).sort((a, b) => a.id - b.id);
  res.json({ ok: true, started: all.length, note: "re-covering in background (~15s each)" });
  (async () => {
    let ok = 0, skip = 0, bad = 0;
    for (let i = 0; i < all.length; i++) {
      try { const r = await recoverListing(all[i].id, i, { t }); if (r.skipped) skip++; else if (r.done?.length) ok++; else bad++; }
      catch (e) { bad++; console.log("[recover]", all[i].id, e.message); }
      await new Promise(r => setTimeout(r, 1500));
    }
    await logAgent("AMARA", `Wall-art re-cover: ${ok} done, ${skip} skipped, ${bad} failed`, bad ? "warn" : "success");
  })();
});

// ── RETITLE: buyer-language titles + 13 tags, internal IDs out ────────────────────────────────
const TAG_OK = s => String(s || "").toLowerCase().replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20).trim();
async function draftSeo(title, description) {
  if (!OPENAI_KEY) throw new Error("OPENAI key missing");
  const prompt = `You write Etsy SEO for a digital wall-art shop (instant download printable art). Current title: "${title}". Description excerpt: "${String(description || "").replace(/<[^>]+>/g, " ").slice(0, 400)}".
Write a NEW title and 13 tags. Rules: title 90-135 characters, 3-5 comma-separated buyer search phrases, the most-searched phrase FIRST, describe the subject and style concretely (e.g. "Black Woman Portrait Print", "Boho Botanical Line Art", "Mid Century Abstract"), end with "Digital Download". No internal codes, no parentheses, no repeated words, no the word "original", no emoji. Tags: 13 unique multi-word phrases, each under 20 characters, lowercase, none identical to a title phrase, cover subject + style + room + occasion + "digital download". Reply ONLY with JSON: {"title":"...","tags":["...",...]}`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENAI_KEY },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 400, temperature: 0.4, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || "openai " + r.status);
  const out = JSON.parse(String(j.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim());
  let t = String(out.title || "").replace(/\(hoj-[^)]*\)/gi, "").replace(/\s+/g, " ").replace(/\b(\w+)( \1\b)+/gi, "$1").trim().slice(0, 140);
  if (!/digital download/i.test(t)) t = (t.replace(/[,\s]+$/, "") + ", Digital Download").slice(0, 140);
  const tags = [...new Set((out.tags || []).map(TAG_OK).filter(x => x.length > 2))].slice(0, 13);
  if (tags.length < 13) for (const f of ["digital download", "printable wall art", "instant download", "wall art print", "home decor print", "printable art", "gallery wall art", "modern wall art", "art print download", "living room art", "bedroom wall art", "office wall art", "gift for her"]) { if (tags.length >= 13) break; if (!tags.includes(f)) tags.push(f); }
  return { title: t, tags };
}

// POST /api/catalog/retitle (GATED) — { dry: true } shows 5 samples; { dry: false } rewrites every wall-art listing (background)
catalogRouter.post("/retitle", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const t = await getEtsyToken();
  const all = (await activeListings(t)).filter(l => !/\bPNG\b/i.test(l.title));
  if (req.body?.dry !== false) {
    const samples = [];
    for (const l of all.slice(0, 5)) { try { samples.push({ id: l.id, before: l.title, after: await draftSeo(l.title, "") }); } catch (e) { samples.push({ id: l.id, error: e.message }); } }
    return res.json({ dry: true, would_rewrite: all.length, samples });
  }
  res.json({ ok: true, started: all.length, note: "rewriting titles + tags in background (~4s each)" });
  (async () => {
    let ok = 0, bad = 0;
    for (const l of all) {
      try {
        const seo = await draftSeo(l.title, "");
        const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${l.id}`, { method: "PATCH", headers: authH(t), body: JSON.stringify({ title: seo.title, tags: seo.tags }) });
        if (r.ok) ok++; else { bad++; console.log("[retitle]", l.id, r.status, (await r.text()).slice(0, 100)); }
      } catch (e) { bad++; console.log("[retitle]", l.id, e.message); }
      await new Promise(r => setTimeout(r, 800));
    }
    await logAgent("AISHA", `Wall-art retitle: ${ok} rewritten, ${bad} failed`, bad ? "warn" : "success");
  })();
});

// POST /api/catalog/set-titles (GATED) — { items:[{id,title,tags}] } hand-written titles, no AI
catalogRouter.post("/set-titles", async (req, res) => {
  if (!requireApproval(req, res)) return;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "items[] required" });
  const t = await getEtsyToken(); const done = [], failed = [];
  for (const it of items) {
    const body = {}; if (it.title) body.title = String(it.title).slice(0, 140); if (Array.isArray(it.tags)) body.tags = it.tags.map(TAG_OK).filter(Boolean).slice(0, 13);
    try {
      const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${it.id}`, { method: "PATCH", headers: authH(t), body: JSON.stringify(body) });
      if (r.ok) done.push(it.id); else failed.push({ id: it.id, status: r.status, body: (await r.text()).slice(0, 120) });
    } catch (e) { failed.push({ id: it.id, error: e.message.slice(0, 100) }); }
    await new Promise(r => setTimeout(r, 500));
  }
  await logAgent("AISHA", `Catalog set-titles: ${done.length} updated${failed.length ? " ⚠ " + failed.length + " failed" : ""}`, failed.length ? "warn" : "success");
  res.json({ updated: done, failed });
});

console.log("[catalog] armed — GET /api/catalog/dupes, POST /api/catalog/dedup {dry:false}");
