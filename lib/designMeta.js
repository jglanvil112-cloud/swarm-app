// lib/designMeta.js — SWARM OS
// Turns a structured brief (from a Canva design brief OR lib/visionBrief.js) into
// Etsy-ready title / tags / description. Deterministic on purpose: the copy is
// assembled FROM the brief, so it can't drift from the image the brief describes.

const STOP = new Set(["the", "and", "for", "with", "art", "print", "wall"]);

function titleCase(s) {
  return String(s || "").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * @param {{subject,style,palette?,keywords?,collection?,price?}} brief
 * @returns {{title:string, tags:string[], description:string, price:number, collection:string}}
 */
export function buildListingCopy(brief = {}) {
  const subject    = String(brief.subject || "Afrocentric Wall Art").trim();
  const style      = String(brief.style || "Digital Print").trim();
  const collection = String(brief.collection || "House of Jreym").replace(/black girl magic/i, "Black Girl Power").trim();
  const palette    = Array.isArray(brief.palette) ? brief.palette.filter(Boolean) : [];
  const kwIn       = Array.isArray(brief.keywords) ? brief.keywords.filter(Boolean) : [];
  const price      = Math.max(2.99, Math.min(49.99, typeof brief.price === "number" ? brief.price : 7.99));

  // ── Title (<=140 chars, segments that read like a real Etsy listing) ──
  const titleParts = [
    titleCase(subject),
    `${titleCase(style)} Print`,
    "Digital Download Wall Art",
    "House of Jreym",
  ];
  let title = titleParts.join(", ");
  if (title.length > 140) title = title.slice(0, 137).replace(/,?\s*$/, "") + "…";

  // ── Tags (13 max, <=20 chars each, lowercase, deduped) ──
  const tagSeeds = [
    ...kwIn,
    subject.toLowerCase(),
    style.toLowerCase(),
    ...palette.map(p => `${p} art`.toLowerCase()),
    "digital download",
    "printable wall art",
    "afrocentric art",
    "black art print",
    collection.toLowerCase(),
  ];
  const tags = [];
  const seen = new Set();
  for (let t of tagSeeds) {
    t = String(t).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (!t || t.length < 3) continue;
    if (STOP.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t); tags.push(t);
    if (tags.length >= 13) break;
  }

  // ── Description (own words, matches the image, instant-download terms) ──
  const paletteLine = palette.length ? ` Tones of ${palette.join(", ")} carry the piece.` : "";
  const description =
`${titleCase(subject)} — a ${style.toLowerCase()} from House of Jreym's ${collection} line.${paletteLine}

WHAT YOU GET
• High-resolution digital file, ready to print at home or at a local/online print shop
• Instant download — no physical item is shipped
• Print at multiple standard sizes for framing

This is a digital product. Colors may vary slightly between screens and printers. For personal use; not for resale or redistribution.

House of Jreym — Afrocentric art and culture, made to live on your wall.`;

  return { title, tags, description, price, collection };
}
