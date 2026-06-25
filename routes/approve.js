// routes/approve.js — SWARM OS
// The human gate for the Canva pipeline. Guarded by APPROVAL_SECRET (x-approval-key
// header). Fails CLOSED: if APPROVAL_SECRET is unset, every write returns 503 so
// nothing can be approved by accident.
//
//   GET  /api/approve/queue                 -> pending listings + draft social posts
//   POST /api/approve/listing { id, decision:"approve"|"reject" }
//   POST /api/approve/social  { id, decision:"approve"|"reject" }
//
// Mounted public in server.js (its own secret is the guard, not API_SECRET).

import express from "express";
import { supabase, logAgent } from "../lib/supabase.js";

export const approveRouter = express.Router();

function guard(req, res) {
  const secret = process.env.APPROVAL_SECRET;
  if (!secret) { res.status(503).json({ error: "approval not configured — set APPROVAL_SECRET in Render" }); return false; }
  const key = req.headers["x-approval-key"] || req.query.key;
  if (key !== secret) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}

// Queue view — read-only listing of what's awaiting a decision.
approveRouter.get("/queue", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const out = { listings: [], social: [] };
    try {
      const { data } = await supabase.from("publish_queue").select("*").eq("status", "queued").order("created_at", { ascending: false }).limit(50);
      out.listings = data || [];
    } catch (e) { out.listings_error = e.message; }
    try {
      const { data } = await supabase.from("social_posts").select("id,caption,media_urls,media_type,scheduled_for,status,keyword,meta")
        .eq("status", "draft").order("created_at", { ascending: false }).limit(50);
      out.social = data || [];
    } catch (e) { out.social_error = e.message; }
    res.json({ ...out, counts: { listings: out.listings.length, social: out.social.length } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approve / reject a queued Etsy listing draft.
approveRouter.post("/listing", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { id, decision } = req.body || {};
    if (!id || !["approve", "reject"].includes(decision)) return res.status(400).json({ error: "id and decision (approve|reject) required" });
    const next = decision === "approve" ? "approved" : "rejected";
    const { data, error } = await supabase.from("publish_queue")
      .update({ status: next }).eq("id", id).eq("status", "queued").select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "no queued row with that id" });
    await logAgent("KWAME", `Queue #${id} ${next} by approver`, "info");
    res.json({ ok: true, id, status: next, listing_id: data.listing_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approve a draft social post (-> 'scheduled', IBRAHIM publishes at scheduled_for) or reject (-> 'cancelled').
approveRouter.post("/social", async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { id, decision } = req.body || {};
    if (!id || !["approve", "reject"].includes(decision)) return res.status(400).json({ error: "id and decision (approve|reject) required" });
    const next = decision === "approve" ? "scheduled" : "cancelled";
    const { data, error } = await supabase.from("social_posts")
      .update({ status: next, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft").select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "no draft post with that id" });
    await logAgent("IBRAHIM", `Social post #${id} ${next} by approver`, "info");
    res.json({ ok: true, id, status: next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
