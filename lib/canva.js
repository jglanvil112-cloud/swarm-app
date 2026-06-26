// lib/canva.js — SWARM OS
// Minimal Canva Connect client. OPTIONAL source for the pipeline: the rest of the
// flow works with any public image URL, but if you supply a Canva designId this
// exports it and rehosts the asset to Supabase Storage — Canva export URLs expire
// in 24–72h, which would otherwise break a scheduled/queued listing or post.
//
// Idles gracefully when CANVA_ACCESS_TOKEN is unset (returns {available:false}).

import { supabase } from "./supabase.js";

const CANVA_BASE   = "https://api.canva.com/rest/v1";
const CANVA_TOKEN  = () => process.env.CANVA_ACCESS_TOKEN || "";
const BUCKET       = process.env.CANVA_BUCKET || "designs";

function headers() {
  return { Authorization: "Bearer " + CANVA_TOKEN(), "Content-Type": "application/json" };
}

export function canvaAvailable() { return !!CANVA_TOKEN(); }

// Start an export job and poll until the asset URL is ready.
export async function exportDesign(designId, { format = "png" } = {}) {
  if (!canvaAvailable()) return { available: false };
  if (!designId) throw new Error("canva: designId required");

  const start = await fetch(`${CANVA_BASE}/exports`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ design_id: designId, format: { type: format } }),
  });
  const startJson = await start.json().catch(() => ({}));
  if (!start.ok) throw new Error(`canva export start ${start.status}: ${JSON.stringify(startJson).slice(0, 200)}`);
  const jobId = startJson.job?.id;
  if (!jobId) throw new Error("canva: no export job id");

  // Poll (Canva exports are usually ready within a few seconds).
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const poll = await fetch(`${CANVA_BASE}/exports/${jobId}`, { headers: headers() });
    const pj = await poll.json().catch(() => ({}));
    const status = pj.job?.status;
    if (status === "success") {
      const url = pj.job?.urls?.[0] || pj.job?.url;
      if (!url) throw new Error("canva: export success but no url");
      return { available: true, exportUrl: url, jobId };
    }
    if (status === "failed") throw new Error("canva: export failed: " + JSON.stringify(pj.job?.error || {}));
  }
  throw new Error("canva: export timed out");
}

// Rehost a (possibly expiring) URL into Supabase Storage and return a durable public URL.
// Best-effort: on any failure, returns the original URL so the pipeline still proceeds.
export async function rehostToStorage(sourceUrl, keyHint = "design") {
  try {
    const r = await fetch(sourceUrl);
    if (!r.ok) return sourceUrl;
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (r.headers.get("content-type") || "image/png").includes("jpeg") ? "jpg" : "png";
    const path = `${keyHint.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
      contentType: r.headers.get("content-type") || "image/png", upsert: true,
    });
    if (error) { console.warn("[canva] rehost upload failed, using source url:", error.message); return sourceUrl; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || sourceUrl;
  } catch (e) {
    console.warn("[canva] rehost error, using source url:", e.message);
    return sourceUrl;
  }
}

// Convenience: designId -> durable public image URL.
export async function exportAndRehost(designId, opts = {}) {
  const ex = await exportDesign(designId, opts);
  if (!ex.available) return { available: false };
  const durable = await rehostToStorage(ex.exportUrl, `canva_${designId}`);
  return { available: true, imageUrl: durable, exportUrl: ex.exportUrl };
}
