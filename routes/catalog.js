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

console.log("[catalog] armed — GET /api/catalog/dupes, POST /api/catalog/dedup {dry:false}");
