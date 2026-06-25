// agents/canvaToEtsy.js — SWARM OS
// Orchestrates the full Canva→Etsy DRAFT path. Nothing goes live here: it creates a
// draft and drops a publish_queue row at status 'queued'. KWAME (agents/publisher.js)
// only activates rows a human flipped to 'approved' via the approval endpoint.
//
// Task payload (any of):
//   { designId }                      -> export from Canva, vision-brief the image
//   { imageUrl, brief? }              -> use a direct image url; brief optional
//   { brief, fileUrl? }               -> brief provided; fileUrl is the high-res to attach
//   { price? }                        -> optional price override

import { supabase, saveAgentOutput, logAgent } from "../lib/supabase.js";
import { exportAndRehost, canvaAvailable } from "../lib/canva.js";
import { briefFromImage } from "../lib/visionBrief.js";
import { buildListingCopy } from "../lib/designMeta.js";
import { createDraftListing, attachFileFromUrl, replaceLowResFiles } from "../lib/etsyDraft.js";

export async function handleCanvaToEtsy(task) {
  const p = task?.payload || {};
  const log = [];

  // 1. Resolve an image URL + (optional) high-res file URL.
  let imageUrl = p.imageUrl || null;
  let fileUrl  = p.fileUrl  || null;
  let designId = p.designId || null;

  if (designId && canvaAvailable()) {
    const ex = await exportAndRehost(designId, { format: "png" });
    if (ex.available) { imageUrl = imageUrl || ex.imageUrl; fileUrl = fileUrl || ex.imageUrl; log.push(`canva export rehosted -> ${ex.imageUrl?.slice(0, 60)}`); }
  }

  // 2. Get a brief — from the payload, or generate one FROM THE IMAGE (the gap-closer).
  let brief = p.brief || null;
  if (!brief) {
    if (!imageUrl) throw new Error("canvaToEtsy: need a brief, imageUrl, or canva designId");
    brief = await briefFromImage(imageUrl);
    log.push(`vision brief: "${brief.subject}" / ${brief.style}`);
  }

  // 3. Build copy that matches the image (no drift).
  const copy = buildListingCopy({ ...brief, price: p.price ?? brief.price });
  log.push(`copy built: "${copy.title.slice(0, 60)}" (${copy.tags.length} tags)`);

  // 4. Create the DRAFT listing with when_made=2020_2026 baked in.
  const { listing_id } = await createDraftListing(copy);
  log.push(`draft listing created #${listing_id}`);

  // 5. Attach the high-res file + strip any low-res junk.
  let fileResult = null;
  if (fileUrl) {
    try {
      const fname = `house_of_jreym_${String(copy.title).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}.png`;
      await replaceLowResFiles(listing_id).catch(() => {});
      fileResult = await attachFileFromUrl(listing_id, fileUrl, fname);
      log.push(`file attached (${fileResult.size}b)`);
    } catch (e) {
      log.push(`file attach failed (non-fatal): ${e.message}`);
    }
  } else {
    log.push("no fileUrl supplied — draft created without a digital file (attach before approving)");
  }

  // 6. Queue for human approval. publish_queue stays 'queued' until you approve.
  let queueId = null;
  try {
    const { data: row } = await supabase.from("publish_queue").insert({
      agent: "KOFI",
      listing_id: String(listing_id),
      design_id: designId || null,
      status: "queued",
      meta: { title: copy.title, image_url: imageUrl, file_attached: !!fileResult, brief },
    }).select().single();
    queueId = row?.id || null;
  } catch (e) {
    log.push(`publish_queue insert failed (run the migration?): ${e.message}`);
  }

  await saveAgentOutput("KOFI", "canva_to_etsy", {
    listing_id, queue_id: queueId, title: copy.title, tags: copy.tags,
    description: copy.description, file_attached: !!fileResult, status: "queued", log,
  });
  await logAgent("KOFI", `Canva→Etsy draft #${listing_id} queued for approval (queue #${queueId})`, "info", null, task.id);

  return { listing_id, queue_id: queueId, status: "queued", file_attached: !!fileResult, title: copy.title, log };
}
