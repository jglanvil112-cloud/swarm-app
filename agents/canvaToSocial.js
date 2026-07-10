// agents/canvaToSocial.js — SWARM OS
// Hands a Canva design to IBRAHIM's existing Instagram publisher — correctly.
// IBRAHIM's runAutoPublish() drains social_posts where status='scheduled'. So we
// insert a GATED row at status='draft' using the REAL table schema
// (platform singular, media_urls array). Approval flips it draft->scheduled, and
// IBRAHIM picks it up at the scheduled time. Nothing posts until you approve.
//
// Task payload: { imageUrl | designId, caption, scheduledFor?, keyword?, isReel? }

import { supabase, saveAgentOutput, logAgent } from "../lib/supabase.js";
import { enforceCaptionRules } from "../lib/captionRules.js";
import { exportAndRehost, canvaAvailable } from "../lib/canva.js";

export async function handleCanvaToSocial(task) {
  const p = task?.payload || {};
  let imageUrl = p.imageUrl || null;

  if (!imageUrl && p.designId && canvaAvailable()) {
    const ex = await exportAndRehost(p.designId, { format: "png" });
    if (ex.available) imageUrl = ex.imageUrl;   // durable URL — won't expire mid-queue
  }
  if (!imageUrl) throw new Error("canvaToSocial: need imageUrl or canva designId");

  const { data: row, error } = await supabase.from("social_posts").insert({
    platform: "instagram",
    caption: enforceCaptionRules(p.caption || ""), // house rules: link + 250w cap
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    media_urls: [imageUrl],
    media_type: p.isReel ? "REEL" : "IMAGE",
    status: "draft",                                  // ← gated; approval -> 'scheduled'
    scheduled_for: p.scheduledFor || new Date(Date.now() + 3600_000).toISOString(),
    keyword: p.keyword || null,
    created_by: "KOFI",
    meta: { source: "canva", design_id: p.designId || null },
    updated_at: new Date().toISOString(),             // ← required: no DB default (matches social.js)
  }).select().single();
  if (error) throw new Error("canvaToSocial insert: " + error.message);

  await saveAgentOutput("KOFI", "canva_to_social", { social_post_id: row.id, status: "draft", image_url: imageUrl });
  await logAgent("KOFI", `Canva→social post #${row.id} queued as DRAFT (approve to schedule)`, "info", null, task.id);
  return { social_post_id: row.id, status: "draft", image_url: imageUrl };
}
