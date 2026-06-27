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

const SYSTEM = `You write Etsy listing briefs for House of Jreym — an Afrocentric / Black-culture PRINTABLE WALL-ART shop. Every image you see IS a piece of digital art sold as a printable download, even if it looks photographic. Never describe it as a "photo", "photograph", or "product photography".
Return ONLY a JSON object, no prose, no markdown fences, matching exactly:
{"subject": string, "style": string, "palette": string[], "keywords": string[], "collection": string, "price": number}

Rules:
- subject    = the depicted subject, named CONCISELY as art (max 6 words). e.g. "Mary Jane Ballerina Flats", "Crowned Queen Portrait", "Abstract Gold Geometry". No long sentences.
- style      = an ART-PRINT style from this vocabulary only: "illustration", "line art", "watercolor", "digital painting", "abstract", "silhouette", "realistic art print", "minimalist", "pop art". Pick the closest. NEVER "photography" or "footwear/product" descriptors.
- palette    = 2-4 dominant colors as lowercase words.
- keywords   = 6-10 lowercase Etsy search terms a buyer would type, each <= 20 chars.
- collection = best-fit House of Jreym line: "Black Girl Power", "Royalty & Melanin", "Affirmations & Empowerment", or "House of Jreym" if unsure. Use "Black Girl Power" — never "Black Girl Magic".
- price      = a number; default 7.99, only higher for an obvious premium / multi-piece set.
Describe only what is visibly depicted, but always frame it as wall art to be printed.`;

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
  brief.subject    = String(brief.subject || "Afrocentric wall art").trim().split(/\s+/).slice(0, 6).join(" ");
  brief.style      = String(brief.style || "art print").trim().replace(/\b(photo(graph(y)?)?|footwear|product)\b/gi, "art print").trim();
  brief.palette    = Array.isArray(brief.palette) ? brief.palette.slice(0, 4) : [];
  brief.keywords   = (Array.isArray(brief.keywords) ? brief.keywords : [])
    .map(k => String(k).toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 20).trim())
    .filter(Boolean).slice(0, 10);
  brief.collection = String(brief.collection || "House of Jreym").replace(/black girl magic/i, "Black Girl Power").trim();
  brief.price      = typeof brief.price === "number" ? brief.price : 7.99;
  return brief;
}
