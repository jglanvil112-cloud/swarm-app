// agents/canvaToEtsy.js — Canva → image-grounded Etsy DRAFT → human approval queue
import { supabase, saveAgentOutput, logAgent } from "../lib/supabase.js";
import { exportAndRehost, canvaAvailable } from "../lib/canva.js";
import { briefFromImage } from "../lib/visionBrief.js";
import { buildListingCopy } from "../lib/designMeta.js";
import { createDraftListing, attachFileFromUrl, replaceLowResFiles } from "../lib/etsyDraft.js";

export async function handleCanvaToEtsy(task) {
  const payload = task?.payload || {};
  const log = [];

  let imageUrl = payload.imageUrl || null;
  let fileUrl = payload.fileUrl || null;
  const designId = payload.designId || null;

  if (designId && canvaAvailable()) {
    const exported = await exportAndRehost(designId, { format: "png" });
    if (exported.available) {
      imageUrl ||= exported.imageUrl;
      fileUrl ||= exported.imageUrl;
      log.push("Canva export rehosted");
    }
  }

  let brief = payload.brief || null;
  if (!brief) {
    if (!imageUrl) throw new Error("canvaToEtsy: brief, imageUrl, or Canva designId required");
    brief = await briefFromImage(imageUrl);
    log.push(`Vision brief: ${brief.subject} / ${brief.style}`);
  }

  const copy = buildListingCopy({
    ...brief,
    price: payload.price,
    price_locked: Number.isFinite(Number(payload.price)),
  });
  log.push(`Copy score ${copy.quality_score}/100 · ${copy.tags.length} tags · $${copy.price}`);

  const { listing_id, price } = await createDraftListing(copy);
  log.push(`Draft listing created #${listing_id}`);

  let fileResult = null;
  if (fileUrl) {
    try {
      const filename = `house_of_jreym_${String(copy.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, 40)}.png`;
      await replaceLowResFiles(listing_id).catch(() => {});
      fileResult = await attachFileFromUrl(listing_id, fileUrl, filename);
      log.push(`Digital file attached (${fileResult.size} bytes)`);
    } catch (error) {
      log.push(`Digital file attach failed: ${error.message}`);
    }
  } else {
    log.push("No digital file supplied; approval will remain blocked until a file is attached");
  }

  const meta = {
    source: "canva",
    title: copy.title,
    image_url: imageUrl,
    file_attached: Boolean(fileResult?.attached),
    file_size: fileResult?.size || 0,
    quality_score: copy.quality_score,
    pricing_tier: copy.pricing_tier,
    price,
    brief,
  };

  const { data: queueRow, error: queueError } = await supabase
    .from("publish_queue")
    .insert({
      agent: "KOFI",
      listing_id: String(listing_id),
      design_id: designId || null,
      status: "queued",
      meta,
    })
    .select()
    .single();

  if (queueError) {
    throw new Error(`canvaToEtsy: publish queue insert failed: ${queueError.message}`);
  }

  await saveAgentOutput("KOFI", "canva_to_etsy", {
    task_id: task?.id || null,
    listing_id,
    queue_id: queueRow.id,
    etsy_title: copy.title,
    tags: copy.tags,
    description: copy.description,
    file_attached: meta.file_attached,
    quality_score: copy.quality_score,
    price,
    status: "queued",
    log,
  });

  await logAgent(
    "KOFI",
    `Etsy draft #${listing_id} queued for human approval (queue #${queueRow.id})`,
    meta.file_attached ? "info" : "warn",
    { quality_score: copy.quality_score, file_attached: meta.file_attached },
    task?.id || null,
  );

  return {
    listing_id,
    queue_id: queueRow.id,
    status: "queued",
    file_attached: meta.file_attached,
    quality_score: copy.quality_score,
    title: copy.title,
    price,
    log,
  };
}
