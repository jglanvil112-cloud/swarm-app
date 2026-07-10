// routes/trending.js — SWARM OS
// Fully-automated trending/holiday social pipeline (no human approval gate).
//
//   A) NANA   — reads the calendar off today's date, picks the occasion/theme + brief
//   B) AMARA  — generates an ORIGINAL on-brand caption and selects owned brand artwork
//   C) GATE   — programmatic safety: IP/trademark filter, brand-fit, quality.
//               Pass -> status 'scheduled' (auto-publishes via IBRAHIM to IG+FB).
//               Fail -> status 'draft' (held for human review).
//   D) WIRE   — daily cron generates the day's post; a CEO log line reports outcome.
//
// HARD RULE: original content only. The pipeline never features/reposts copyrighted
// trending PRODUCTS or brands — that's what the IP filter enforces.

import express from "express";
import cron from "node-cron";
import { enforceCaptionRules } from "../lib/captionRules.js";
import { supabase, logAgent } from "../lib/supabase.js";

export const trendingRouter = express.Router();

const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const POST_TIMES_UTC = ["14:00", "22:00"];

// ── Owned brand artwork (House of Jreym) keyed by visual theme ────────────────
const ART = {
  portraits:   "https://i.etsystatic.com/66171116/r/il/bf7ea6/8151607459/il_1080xN.8151607459_swyc.jpg",
  melanin:     "https://i.etsystatic.com/66171116/r/il/563357/8103702370/il_1080xN.8103702370_c2zp.jpg",
  afrocentric: "https://i.etsystatic.com/66171116/r/il/299fd3/8151607563/il_1080xN.8151607563_ot56.jpg",
  affirmation: "https://i.etsystatic.com/66171116/r/il/1a19c5/8103702138/il_1080xN.8103702138_gwua.jpg",
  hair:        "https://i.etsystatic.com/66171116/r/il/74c44c/8151607937/il_1080xN.8151607937_d5l7.jpg",
};

// ── A) Calendar: fixed-date occasions + monthly evergreen themes ──────────────
// Keyed "MM-DD". Themes map to an ART key + a brief for the caption.
const HOLIDAYS = {
  "01-01": { occasion: "New Year", art: "affirmation", brief: "New year, new intentions — growth, fresh starts, self-belief." },
  "02-01": { occasion: "Black History Month", art: "portraits", brief: "Celebrating Black history, legacy, and the visionaries who shaped culture." },
  "02-14": { occasion: "Valentine's Day", art: "melanin", brief: "Self-love and love for the culture — melanin and worth." },
  "03-08": { occasion: "International Women's Day", art: "melanin", brief: "Honoring Black women's strength, beauty, and power." },
  "06-19": { occasion: "Juneteenth", art: "afrocentric", brief: "Freedom, heritage, and Black joy — Juneteenth." },
  "07-04": { occasion: "Independence Day", art: "afrocentric", brief: "Freedom and independence, celebrated through our lens." },
  "10-01": { occasion: "Fall / Cozy Season", art: "hair", brief: "Cozy season self-care and natural beauty." },
  "11-01": { occasion: "Gratitude Season", art: "affirmation", brief: "Gratitude, reflection, and grounding." },
  "12-01": { occasion: "Holiday Season", art: "melanin", brief: "Warmth, family, and celebrating the culture through the holidays." },
};
// Monthly evergreen fallback when there's no fixed holiday.
const EVERGREEN = [
  { occasion: "Affirmation", art: "affirmation", brief: "A daily affirmation of worth, purpose, and self-belief." },
  { occasion: "Melanin Monday", art: "melanin", brief: "Celebrating melanin, beauty, and confidence." },
  { occasion: "Culture & Heritage", art: "afrocentric", brief: "Honoring Afrocentric roots, art, and identity." },
  { occasion: "Natural Beauty", art: "hair", brief: "Celebrating natural hair and self-expression." },
  { occasion: "Black Excellence", art: "portraits", brief: "Black excellence, legacy, and creativity." },
];

function pickOccasion(date = new Date()) {
  const mmdd = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  if (HOLIDAYS[mmdd]) return { ...HOLIDAYS[mmdd], date: mmdd };
  // rotate evergreen by day-of-year for variety
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = Math.floor((date - start) / 86400000);
  return { ...EVERGREEN[doy % EVERGREEN.length], date: mmdd };
}

// ── C) Safety gate: IP/trademark + brand-fit + quality ───────────────────────
const IP_BLOCKLIST = [
  "disney","marvel","dc comics","pixar","nike","adidas","gucci","louis vuitton","supreme",
  "nfl","nba","mlb","nhl","fifa","olympics","star wars","harry potter","pokemon","pokémon",
  "mickey","spider-man","batman","superman","barbie","coca-cola","pepsi","apple inc","taylor swift",
  "beyoncé","drake","netflix","spotify","tiktok logo","instagram logo",
];
function safetyGate(caption, imageUrl) {
  const reasons = [];
  const low = (caption || "").toLowerCase();
  const hit = IP_BLOCKLIST.find(term => low.includes(term));
  if (hit) reasons.push(`ip:${hit}`);
  if (!imageUrl) reasons.push("no-image");
  if (!caption || caption.length < 40) reasons.push("too-short");
  if (caption && caption.length > 2200) reasons.push("too-long");
  if (/\b(as an ai|i cannot|i'm sorry|language model)\b/i.test(low)) reasons.push("llm-artifact");
  return { pass: reasons.length === 0, reasons };
}

// ── B) AMARA: caption generation via Claude ──────────────────────────────────
async function generateCaption(occasion, brief) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const system = "You are AMARA, social voice of House of Jreym — a Black-culture / Afrocentric art brand. " +
    "Write ORIGINAL, on-brand Instagram/Facebook captions. Never mention other brands, trademarks, copyrighted " +
    "characters, celebrities, or trending products. Warm, empowering, culturally rooted. 2-4 short sentences, " +
    "a light call-to-action, and 5-8 relevant hashtags. Output ONLY the caption text.";
  const prompt = `Occasion/theme: ${occasion}\nBrief: ${brief}\nWrite one caption.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json();
  if (j.error) throw new Error("Claude: " + j.error.message);
  return (j.content || []).map(b => b.text || "").join("").trim();
}

// ── Scheduling: next open post slot not already taken ────────────────────────
async function nextOpenSlot() {
  const now = Date.now();
  const { data: taken } = await supabase.from("social_posts")
    .select("scheduled_for").in("status", ["scheduled", "published"])
    .gte("scheduled_for", new Date(now).toISOString());
  const used = new Set((taken || []).map(t => new Date(t.scheduled_for).toISOString()));
  for (let d = 0; d < 30; d++) {
    for (const t of POST_TIMES_UTC) {
      const [h, m] = t.split(":").map(Number);
      const slot = new Date();
      slot.setUTCDate(slot.getUTCDate() + d);
      slot.setUTCHours(h, m, 0, 0);
      if (slot.getTime() <= now) continue;
      if (!used.has(slot.toISOString())) return slot.toISOString();
    }
  }
  return new Date(now + 3600000).toISOString();
}

// ── Full pipeline run (A -> B -> C -> D) ─────────────────────────────────────
export async function runTrendingPipeline({ dry = false } = {}) {
  const occ = pickOccasion(new Date());                         // A) NANA scout
  const imageUrl = ART[occ.art] || ART.affirmation;
  let caption = "";
  try { caption = enforceCaptionRules(await generateCaption(occ.occasion, occ.brief)); } // B) AMARA (+house rules: link + 250w cap)
  catch (e) { await logAgent("NANA", `Trending run aborted: ${e.message}`, "error"); return { ok: false, error: e.message }; }

  const gate = safetyGate(caption, imageUrl);                   // C) gate
  const status = gate.pass ? "scheduled" : "draft";
  const scheduled_for = gate.pass ? await nextOpenSlot() : null;

  if (dry) return { ok: true, dry: true, occasion: occ.occasion, status, gate, scheduled_for, caption };

  const { data: post, error } = await supabase.from("social_posts").insert({  // D) wire
    platform: "all", status, caption, media_urls: [imageUrl], media_type: "IMAGE",
    scheduled_for, keyword: occ.occasion, created_by: "TRENDING",
    meta: { pipeline: "trending", occasion: occ.occasion, theme: occ.art, gate },
  }).select().single();
  if (error) { await logAgent("NANA", `Trending insert failed: ${error.message}`, "error"); return { ok: false, error: error.message }; }

  const line = gate.pass
    ? `Trending post scheduled for ${scheduled_for} — "${occ.occasion}" (IG+FB)`
    : `Trending post held as DRAFT — failed gate [${gate.reasons.join(", ")}] — "${occ.occasion}"`;
  await logAgent("NANA", line, gate.pass ? "success" : "warn");
  return { ok: true, id: post.id, occasion: occ.occasion, status, scheduled_for, gate };
}

// ── Endpoints ────────────────────────────────────────────────────────────────
function requireApproval(req, res) {
  if (!APPROVAL_SECRET) { res.status(503).json({ error: "approval not configured" }); return false; }
  const key = req.headers["x-approval-key"] || req.query.key;
  if (key !== APPROVAL_SECRET) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}
// POST /api/trending/run  (gated) — body { dry?: true } for a no-write preview
trendingRouter.post("/run", async (req, res) => {
  if (!requireApproval(req, res)) return;
  try { res.json(await runTrendingPipeline({ dry: req.body?.dry === true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// GET /api/trending/calendar — preview today's occasion pick
trendingRouter.get("/calendar", (req, res) => {
  const occ = pickOccasion(new Date());
  res.json({ today: occ, post_times_utc: POST_TIMES_UTC });
});

// ── Daily cron: generate the day's trending post at 08:00 UTC (before windows)
cron.schedule("0 8 * * *", () => {
  runTrendingPipeline().catch(e => console.log("[trending] cron error:", e.message));
});
console.log("[trending] pipeline armed — daily 08:00 UTC scout+generate");
