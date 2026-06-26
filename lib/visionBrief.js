// lib/visionBrief.js — SWARM OS
// Closes the last gap from the Canva pipeline: artwork that arrives WITHOUT a brief
// (e.g. an upload, or that gold abstract) gets a brief generated FROM THE IMAGE ITSELF,
// so title/tags/description can never drift from what the picture actually shows.
//
// Pairs with lib/designMeta.js -> buildListingCopy(brief).
// Uses the @anthropic-ai/sdk already in the project (same ANTHROPIC_API_KEY).

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Haiku 4.5 is vision-capable, cheap, and accurate enough for captioning.
// Override with VISION_MODEL if you want to bump it.
const VISION_MODEL = process.env.VISION_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM = `You write Etsy listing briefs for House of Jreym — an Afrocentric / Black-culture printable wall-art shop.
Look at the artwork and return ONLY a JSON object, no prose, no markdown fences, matching exactly:
{"subject": string, "style": string, "palette": string[], "keywords": string[], "collection": string, "price": number}

Rules:
- subject    = what the art ACTUALLY depicts. Describe only what you can see.
- style      = visual style, e.g. "abstract gold geometric", "line-art portrait", "watercolor silhouette".
- palette    = 2-4 dominant colors as lowercase words.
- keywords   = 6-10 lowercase Etsy search terms a real buyer would type, each <= 20 chars.
- collection = best-fit House of Jreym line: "Black Girl Power", "Royalty & Melanin", "Affirmations & Empowerment", or "House of Jreym" if unsure. Use "Black Girl Power" — never "Black Girl Magic".
- price      = a number; default 7.99, only higher for an obvious premium / multi-piece set.
NEVER invent themes that aren't visible in the image.`;

// Fetch a public image URL (Etsy CDN / Supabase Storage / Canva export) -> base64 the API can read.
async function fetchImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`visionBrief: fetch image ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let media_type = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(media_type)) media_type = "image/png";
  return { data: buf.toString("base64"), media_type };
}

/**
 * Generate a structured brief from an image.
 * @param {string} imageUrl - public URL to the artwork.
 * @returns {Promise<{subject,style,palette,keywords,collection,price}>}
 */
export async function briefFromImage(imageUrl) {
  if (!imageUrl) throw new Error("visionBrief: imageUrl required");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("visionBrief: ANTHROPIC_API_KEY not set");

  const { data, media_type } = await fetchImageBase64(imageUrl);

  const resp = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type, data } },
        { type: "text", text: "Generate the listing brief JSON for this artwork." },
      ],
    }],
  });

  const raw = (resp.content?.[0]?.text || "").trim()
    .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let brief;
  try { brief = JSON.parse(raw); }
  catch { throw new Error("visionBrief: model did not return valid JSON: " + raw.slice(0, 200)); }

  // Normalize / harden defaults so downstream copy never breaks.
  brief.subject    = String(brief.subject || "Afrocentric wall art").trim();
  brief.style      = String(brief.style || "digital print").trim();
  brief.palette    = Array.isArray(brief.palette) ? brief.palette.slice(0, 4) : [];
  brief.keywords   = (Array.isArray(brief.keywords) ? brief.keywords : [])
    .map(k => String(k).toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 20).trim())
    .filter(Boolean).slice(0, 10);
  brief.collection = String(brief.collection || "House of Jreym").replace(/black girl magic/i, "Black Girl Power").trim();
  brief.price      = typeof brief.price === "number" ? brief.price : 7.99;
  return brief;
}
