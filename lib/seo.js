const GENERIC = new Set([
  "art", "wall art", "print", "prints", "digital", "download", "printable", "decor",
]);

function cleanPhrase(value, max = 40) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildEtsyTags({ subject, style, keywords = [], collection, palette = [] } = {}) {
  const seeds = [
    ...keywords,
    subject,
    collection,
    style,
    ...palette.map((p) => `${p} wall art`),
    "black wall art",
    "afrocentric decor",
    "digital download",
    "printable wall art",
  ];

  const tags = [];
  const seen = new Set();
  for (const seed of seeds) {
    const phrase = cleanPhrase(seed, 20);
    if (!phrase || phrase.length < 3 || GENERIC.has(phrase) || seen.has(phrase)) continue;
    seen.add(phrase);
    tags.push(phrase);
    if (tags.length === 13) break;
  }
  return tags;
}

export function buildEtsyTitle({ subject, style, keywords = [], collection } = {}) {
  const subjectPhrase = titleCase(String(subject || "Afrocentric Wall Art").trim());
  const candidates = [
    subjectPhrase,
    ...keywords.slice(0, 5).map(titleCase),
    collection && !/house of jreym/i.test(collection) ? titleCase(collection) : null,
    style ? `${titleCase(style)} Print` : null,
    "Printable Digital Download",
  ].filter(Boolean);

  const parts = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = cleanPhrase(candidate, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parts.push(candidate.trim());
  }

  let title = parts.join(", ");
  if (title.length > 140) {
    while (parts.length > 1 && parts.join(", ").length > 140) parts.pop();
    title = parts.join(", ").slice(0, 140).replace(/[ ,]+$/, "");
  }
  return title;
}

export function scoreListingQuality({ title = "", tags = [], description = "", performance = {} } = {}) {
  let score = 0;
  if (title.length >= 55 && title.length <= 140) score += 20;
  if (Array.isArray(tags)) score += Math.min(tags.length, 13) * 2;
  if (description.length >= 300) score += 14;
  if (!/house of jreym/i.test(title)) score += 5;
  if (!/\b(photo|photography)\b/i.test(title)) score += 5;

  const views = Number(performance.views) || 0;
  const favorites = Number(performance.favorites) || 0;
  const orders = Number(performance.orders) || 0;
  if (views > 0) score += Math.min(15, (favorites / views) * 300);
  if (orders > 0) score += Math.min(15, orders * 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}
