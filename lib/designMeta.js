// lib/designMeta.js — House of Jreym listing metadata builder
// Copy is deterministic and assembled from the visual brief so it stays aligned
// with the artwork while pricing and SEO are controlled by shared policy modules.

import { resolveListingPrice, priceTierLabel } from "./pricing.js";
import { buildEtsyTags, buildEtsyTitle, scoreListingQuality } from "./seo.js";

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {{
 *   subject?:string,
 *   style?:string,
 *   palette?:string[],
 *   keywords?:string[],
 *   collection?:string,
 *   price?:number,
 *   price_locked?:boolean,
 *   premium?:boolean,
 *   bundle_count?:number,
 *   custom?:boolean
 * }} brief
 */
export function buildListingCopy(brief = {}) {
  const subject = String(brief.subject || "Afrocentric Wall Art").trim();
  const style = String(brief.style || "Digital Painting").trim();
  const collection = String(brief.collection || "House of Jreym")
    .replace(/black girl magic/gi, "Black Girl Power")
    .trim();
  const palette = Array.isArray(brief.palette) ? brief.palette.filter(Boolean).slice(0, 4) : [];
  const keywords = Array.isArray(brief.keywords) ? brief.keywords.filter(Boolean).slice(0, 10) : [];

  const title = buildEtsyTitle({ subject, style, keywords, collection });
  const tags = buildEtsyTags({ subject, style, keywords, collection, palette });
  const price = resolveListingPrice(brief);
  const tier = priceTierLabel(brief);

  const paletteLine = palette.length
    ? ` The palette features ${palette.join(", ")}.`
    : "";
  const bundleCount = Math.max(1, Number(brief.bundle_count) || 1);
  const deliveryLine = bundleCount > 1
    ? `• ${bundleCount} coordinated digital artworks as described in the listing files\n`
    : "• High-resolution digital artwork as provided in the listing files\n";

  const description = `${titleCase(subject)} — ${style.toLowerCase()} from House of Jreym.${paletteLine}

WHAT YOU GET
${deliveryLine}• Instant digital download — no physical item is shipped
• Suitable for home, office, studio, salon, or gallery-wall printing

PLEASE NOTE
The exact downloadable file formats and dimensions are the files attached to this Etsy listing. This description does not promise sizes or formats that are not included. Colors can vary slightly by screen, paper, and printer.

LICENSE
Personal use only unless a separate commercial license is included. No resale or redistribution of the digital files.

House of Jreym — art, culture, identity, and atmosphere for your space.`;

  const quality_score = scoreListingQuality({ title, tags, description });
  return { title, tags, description, price, pricing_tier: tier, collection, quality_score };
}
