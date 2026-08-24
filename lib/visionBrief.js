// lib/visionBrief.js — image-grounded Etsy metadata brief
import Anthropic from "@anthropic-ai/sdk";
import { fetchWithRetry } from "./security.js";

const VISION_MODEL = process.env.VISION_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM = `You write Etsy listing briefs for House of Jreym, a printable wall-art shop centered on Black culture, identity, atmosphere, and home decor.
Return ONLY one JSON object matching exactly:
{"subject":string,"style":string,"palette":string[],"keywords":string[],"collection":string,"premium":boolean,"bundle_count":number}

Rules:
- Describe only what is visibly depicted. Do not invent people, places, brands, celebrities, events, or copyrighted characters.
- Treat the image as artwork even when the rendering is realistic. Do not call it a photograph or product photo.
- subject: concise buyer-facing subject, maximum 6 words.
- style: one of illustration, line art, watercolor, digital painting, abstract, silhouette, realistic art print, minimalist, pop art.
- palette: 2-4 dominant color words.
- keywords: 6-10 natural Etsy search phrases, each at most 20 characters, no brand stuffing.
- collection: Black Girl Power, Royalty & Melanin, Affirmations & Empowerment, or House of Jreym.
- premium: true only for unusually detailed or premium-looking single artwork.
- bundle_count: 1 unless multiple distinct coordinated artworks are visibly presented.
- Never output pricing; pricing is controlled by the store policy engine.`;

async function fetchImageBase64(url) {
  const res = await fetchWithRetry(url, {}, { retries: 2, timeoutMs: 20_000, validateRemote: true });
  if (!res.ok) throw new Error(`visionBrief: image fetch ${res.status}`);

  const contentLength = Number(res.headers.get("content-length")) || 0;
  if (contentLength > 12 * 1024 * 1024) throw new Error("visionBrief: image exceeds 12MB limit");

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 12 * 1024 * 1024) throw new Error("visionBrief: image exceeds 12MB limit");

  let media_type = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(media_type)) media_type = "image/png";
  return { data: buf.toString("base64"), media_type };
}

export async function briefFromImage(imageUrl) {
  if (!imageUrl) throw new Error("visionBrief: imageUrl required");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("visionBrief: ANTHROPIC_API_KEY not set");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { data, media_type } = await fetchImageBase64(imageUrl);

  const resp = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type, data } },
        { type: "text", text: "Generate the House of Jreym Etsy brief for this artwork." },
      ],
    }],
  });

  const raw = (resp.content?.[0]?.text || "")
    .trim()
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let brief;
  try {
    brief = JSON.parse(raw);
  } catch {
    throw new Error("visionBrief: model returned invalid JSON");
  }

  brief.subject = String(brief.subject || "Afrocentric wall art")
    .trim().split(/\s+/).slice(0, 6).join(" ");
  brief.style = String(brief.style || "digital painting")
    .trim()
    .replace(/\b(photo(graph(y)?)?|footwear|product)\b/gi, "art print")
    .trim();
  brief.palette = Array.isArray(brief.palette) ? brief.palette.slice(0, 4) : [];
  brief.keywords = (Array.isArray(brief.keywords) ? brief.keywords : [])
    .map((k) => String(k).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20))
    .filter(Boolean)
    .slice(0, 10);
  brief.collection = String(brief.collection || "House of Jreym")
    .replace(/black girl magic/gi, "Black Girl Power")
    .trim();
  brief.premium = brief.premium === true;
  brief.bundle_count = Math.max(1, Math.min(10, Number(brief.bundle_count) || 1));
  return brief;
}
