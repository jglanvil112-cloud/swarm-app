// lib/captionRules.js — SWARM OS house caption rules (CEO 7/10):
// every outbound caption carries a shoppable link and stays under a hard
// 250-word cap. Applied at ALL caption-creation sites (trending, ibrahim,
// podgen) so no post ever goes out promising a shop without a link.
//
// Link priority: exact product/listing link when known, houseofjreym.store otherwise.

const LINK_RE = /houseofjreym\.store|etsy\.com\/(listing|shop)/i;
const DEFAULT_LINK = "houseofjreym.store";
const WORD_CAP = 250;

export function enforceCaptionRules(caption = "", link = DEFAULT_LINK) {
  let text = String(caption || "").trim();

  // 1) Guaranteed shoppable link — insert before the trailing hashtag block
  //    when one exists, otherwise append.
  if (!LINK_RE.test(text)) {
    const shopLine = `🛍 Shop: ${link}`;
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
