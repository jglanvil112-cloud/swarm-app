// lib/captionRules.js — SWARM OS house caption rules (CEO 7/10):
// every outbound caption carries a shoppable link and stays under a hard
// 250-word cap. Applied at ALL caption-creation sites (trending, ibrahim,
// podgen) so no post ever goes out promising a shop without a link.
//
// Link priority: exact product/listing link when known, houseofjreym.store otherwise.

const LINK_RE = /houseofjreym\.store|etsy\.com\/(listing|shop)/i;
const DEFAULT_LINK = "houseofjreym.store";
const WORD_CAP = 250;
// CEO 7/11: art posts always sell the full offer — Classic + 3D + Holographic.
const ART_RE = /\bart\b|artwork|portrait|print|digital download|wall decor|drop/i;
const EDITIONS_RE = /3d|holographic/i;
const EDITIONS_LINE = "✨ Every piece comes in Classic, 3D & Holographic editions.";

export function enforceCaptionRules(caption = "", link = DEFAULT_LINK) {
  let text = String(caption || "").trim();

  // 0) Art captions must sell all three editions (CEO 7/11)
  if (ART_RE.test(text) && !EDITIONS_RE.test(text)) {
    const m0 = text.match(/\n\s*(#[^\s#]+[\s\S]*)$/);
    text = m0
      ? text.slice(0, m0.index).trimEnd() + "\n\n" + EDITIONS_LINE + "\n\n" + m0[1].trim()
      : text + "\n\n" + EDITIONS_LINE;
  }

  // 1) Guaranteed shoppable link — insert before the trailing hashtag block
  //    when one exists, otherwise append. IG captions aren't clickable, so the
  //    line also points to the always-clickable bio link.
  if (!LINK_RE.test(text)) {
    const shopLine = `🛍 Shop: ${link} — tap the link in our bio to shop instantly 🔗`;
    const m = text.match(/\n\s*(#[^\s#]+[\s\S]*)$/);
    text = m
      ? text.slice(0, m.index).trimEnd() + "\n\n" + shopLine + "\n\n" + m[1].trim()
      : (text ? text + "\n\n" : "") + shopLine;
  }

  // 2) Hard 250-word cap — shed trailing hashtags first, then truncate the
  //    body, but never lose the link.
  const count = t => t.split(/\s+/).filter(Boolean).length;
  while (count(text) > WORD_CAP && /#[^\s#]+\s*$/.test(text)) {
    text = text.replace(/#[^\s#]+\s*$/, "").trimEnd();
  }
  if (count(text) > WORD_CAP) {
    text = text.split(/\s+/).filter(Boolean).slice(0, WORD_CAP - 4).join(" ");
    if (!LINK_RE.test(text)) text += `\n\n🛍 Shop: ${link}`;
  }

  return text.trim();
}
