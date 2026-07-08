// lib/etsyDraft.js — SWARM OS
// Self-contained Etsy helpers for the Canva pipeline. The Made-To-Order glitch is
// fixed at the source: when_made is ALWAYS "2020_2026" on create AND on activate,
// so the digital-file container is never hidden. Mirrors the proven token + auth
// patterns already in routes/etsy.js / agents/executor.js (no shared-export coupling).

import { supabase } from "./supabase.js";

const ETSY_BASE    = "https://openapi.etsy.com/v3/application";
const ETSY_KEY     = process.env.ETSY_KEY     || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET  = process.env.ETSY_SECRET  || "";
const ETSY_SHOP_ID = parseInt(process.env.ETSY_SHOP_ID) || 0;
const LOWRES_FLOOR = parseInt(process.env.ETSY_LOWRES_FLOOR_BYTES) || 500 * 1024; // 500 kb
// Etsy's when_made enum rolls forward ~yearly. "2020_2026" is the value that works in
// this shop today; flip ETSY_WHEN_MADE when Etsy advances the bucket. NEVER made_to_order
// (that hides the digital-file container).
const WHEN_MADE = process.env.ETSY_WHEN_MADE || "2020_2026";

function authH(t) {
  return { Authorization: "Bearer " + t, "x-api-key": ETSY_KEY + ":" + ETSY_SECRET, "Content-Type": "application/json" };
}
function xkey() { return ETSY_KEY + ":" + ETSY_SECRET; }

// Read live Etsy token from oauth_tokens; refresh if only a refresh_token is present.
export async function getEtsyToken() {
  const { data } = await supabase.from("oauth_tokens")
    .select("access_token, refresh_token").eq("platform", "etsy")
    .order("id", { ascending: false }).limit(1);
  const row = data?.[0];
  if (row?.access_token) return row.access_token;
  if (row?.refresh_token) {
    const r = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: ETSY_KEY, refresh_token: row.refresh_token }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.access_token) {
      await supabase.from("oauth_tokens").update({ access_token: j.access_token, refresh_token: j.refresh_token || row.refresh_token }).eq("platform", "etsy");
      return j.access_token;
    }
  }
  return process.env.ETSY_ACCESS_TOKEN || null;
}

function assertShop() {
  if (!ETSY_SHOP_ID) throw new Error("etsyDraft: ETSY_SHOP_ID not set (GET /api/etsy/shop-id)");
}

// Create a DRAFT listing. Never goes live here — activation is gated behind approval.
export async function createDraftListing({ title, description, tags, price = 7.99 }, token) {
  assertShop();
  const t = token || await getEtsyToken();
  if (!t) throw new Error("etsyDraft: no Etsy token");

  const body = {
    quantity: 999,
    title: String(title).slice(0, 140),
    description: String(description).slice(0, 2000),
    price: parseFloat(Number(price).toFixed(2)),
    who_made: "i_did",
    when_made: WHEN_MADE,            // ← the fix. NEVER made_to_order.
    taxonomy_id: 2078,
    tags: (Array.isArray(tags) ? tags : []).map(x => String(x).slice(0, 20)).filter(Boolean).slice(0, 13),
    type: "download",
    is_digital: true,
    should_auto_renew: true,
    state: "draft",                  // ← draft only
  };

  const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings`, {
    method: "POST", headers: authH(t), body: JSON.stringify(body),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok || !j.listing_id) throw new Error(`etsyDraft create ${r.status}: ${text.slice(0, 300)}`);
  return { listing_id: j.listing_id, state: j.state };
}

// Delete any attached digital file under the size floor (the 60–85 kb placeholders).
export async function replaceLowResFiles(listing_id, token) {
  assertShop();
  const t = token || await getEtsyToken();
  const removed = [];
  const lr = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/files`, { headers: authH(t) });
  if (!lr.ok) return { removed, note: "could not list files" };
  const fd = await lr.json().catch(() => ({}));
  const files = fd.results || fd || [];
  for (const f of (Array.isArray(files) ? files : [])) {
    const size = f.filesize || f.size || 0;
    if (size && size < LOWRES_FLOOR) {
      const dr = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/files/${f.listing_file_id}`, { method: "DELETE", headers: authH(t) });
      if (dr.ok) removed.push({ id: f.listing_file_id, name: f.name, size });
    }
  }
  return { removed };
}

// Attach a high-res digital file from a public URL (Canva export / Supabase Storage).
export async function attachFileFromUrl(listing_id, fileUrl, filename, token) {
  assertShop();
  const t = token || await getEtsyToken();
  const fr = await fetch(fileUrl);
  if (!fr.ok) throw new Error(`etsyDraft: fetch file ${fr.status} for ${fileUrl}`);
  const buf = Buffer.from(await fr.arrayBuffer());
  let fileCT = (fr.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!/^image\//.test(fileCT)) fileCT = "image/png";
  if (buf.length < LOWRES_FLOOR) {
    console.warn(`[etsyDraft] file ${buf.length}b is under the ${LOWRES_FLOOR}b floor — attaching anyway, but upscale source recommended`);
  }
  const safe = String(filename || `house_of_jreym_${listing_id}.png`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const boundary = "----HoJCanvaBoundary" + Date.now().toString(36);
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safe}"\r\nContent-Type: ${fileCT}\r\n\r\n`,
    buf,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${safe}\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));
  const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/files`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
      Authorization: "Bearer " + t,
      "x-api-key": xkey(),
    },
    body,
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`etsyDraft attach ${r.status}: ${text.slice(0, 300)}`);
  return { attached: true, listing_file_id: j.listing_file_id, size: buf.length };
}

// Flip a draft to active. Re-asserts when_made so a stale Made-To-Order value can't slip through.
export async function activateListing(listing_id, token) {
  assertShop();
  const t = token || await getEtsyToken();
  const r = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}`, {
    method: "PATCH", headers: authH(t),
    body: JSON.stringify({ state: "active", when_made: WHEN_MADE }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`etsyDraft activate ${r.status}: ${text.slice(0, 300)}`);
  return { activated: true, listing_id };
}
