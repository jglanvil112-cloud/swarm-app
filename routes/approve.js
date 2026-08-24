// routes/approve.js — explicit human approval gate for Etsy and social publishing
import express from "express";
import { supabase, logAgent } from "../lib/supabase.js";
import { requireApprovalSecret } from "../lib/security.js";
import { listListingFiles } from "../lib/etsyDraft.js";

export const approveRouter = express.Router();
approveRouter.use(requireApprovalSecret);

approveRouter.get("/queue", async (_req, res) => {
  try {
    const out = { listings: [], social: [] };

    const { data: listings, error: listingError } = await supabase
      .from("publish_queue")
      .select("*")
      .in("status", ["queued", "blocked_missing_file"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (listingError) out.listings_error = listingError.message;
    else out.listings = listings || [];

    const { data: social, error: socialError } = await supabase
      .from("social_posts")
      .select("id,caption,media_urls,media_type,scheduled_for,status,keyword,meta")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(50);
    if (socialError) out.social_error = socialError.message;
    else out.social = social || [];

    res.json({
      ...out,
      counts: { listings: out.listings.length, social: out.social.length },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

approveRouter.post("/listing", async (req, res) => {
  try {
    const { id, decision } = req.body || {};
    if (!id || !["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "id and decision (approve|reject) required" });
    }

    const { data: row, error: readError } = await supabase
      .from("publish_queue")
      .select("*")
      .eq("id", id)
      .in("status", ["queued", "blocked_missing_file"])
      .single();
    if (readError || !row) return res.status(404).json({ error: "approval row not found" });

    if (decision === "approve") {
      const files = await listListingFiles(row.listing_id);
      if (!files.length && process.env.ALLOW_PUBLISH_WITHOUT_FILE !== "true") {
        await supabase
          .from("publish_queue")
          .update({
            status: "blocked_missing_file",
            error: "Cannot approve digital listing without an attached file",
          })
          .eq("id", id);
        await logAgent("KWAME", `Approval blocked for queue #${id}: missing digital file`, "warn");
        return res.status(409).json({
          error: "digital file required before approval",
          id,
          listing_id: row.listing_id,
        });
      }
    }

    const next = decision === "approve" ? "approved" : "rejected";
    const meta = {
      ...(row.meta || {}),
      approval: {
        decision,
        decided_at: new Date().toISOString(),
      },
    };
    const { data, error } = await supabase
      .from("publish_queue")
      .update({ status: next, error: null, meta })
      .eq("id", id)
      .in("status", ["queued", "blocked_missing_file"])
      .select()
      .single();
    if (error) throw error;

    await logAgent("KWAME", `Queue #${id} ${next} by human approver`, "info");
    res.json({ ok: true, id, status: next, listing_id: data.listing_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

approveRouter.post("/social", async (req, res) => {
  try {
    const { id, decision } = req.body || {};
    if (!id || !["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "id and decision (approve|reject) required" });
    }

    const next = decision === "approve" ? "scheduled" : "cancelled";
    const { data, error } = await supabase
      .from("social_posts")
      .update({
        status: next,
        approved_by: decision === "approve" ? "CEO" : null,
        approved_at: decision === "approve" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "draft social post not found" });

    await logAgent("IBRAHIM", `Social post #${id} ${next} by human approver`, "info");
    res.json({ ok: true, id, status: next });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
