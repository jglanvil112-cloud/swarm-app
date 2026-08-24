// lib/etsyDraft.js — single controlled Etsy draft/activation layer
import { supabase } from "./supabase.js";
import { resolveListingPrice } from "./pricing.js";
import { fetchWithRetry } from "./security.js";

const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_KEY = process.env.ETSY_KEY || process.env.ETSY_API_KEY || "";
const ETSY_SECRET = process.env.ETSY_SECRET || "";
const ETSY_SHOP_ID = Number(process.env.ETSY_SHOP_ID) || 0;
const LOWRES_FLOOR = Number(process.env.ETSY_LOWRES_FLOOR_BYTES) || 500 * 1024;
const MAX_FILE_BYTES = Number(process.env.ETSY_MAX_FILE_BYTES) || 20 * 1024 * 1024;
const WHEN_MADE = process.env.ETSY_WHEN_MADE || "2020_2026";

function assertConfig() {
  if (!ETSY_KEY) throw new Error("etsyDraft: ETSY_KEY is not configured");
  if (!ETSY_SHOP_ID) throw new Error("etsyDraft: ETSY_SHOP_ID is not configured");
}

function xkey() {
  return ETSY_SECRET ? `${ETSY_KEY}:${ETSY_SECRET}` : ETSY_KEY;
}

function authH(token) {
  return {
    Authorization: `Bearer ${token}`,
    "x-api-key": xkey(),
    "Content-Type": "application/json",
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { text, json };
}

export async function getEtsyToken() {
  assertConfig();
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("platform", "etsy")
    .limit(1);
  if (error) throw new Error(`etsyDraft: token lookup failed: ${error.message}`);

  const row = data?.[0];
  const envToken = process.env.ETSY_ACCESS_TOKEN || null;
  if (!row) return envToken;

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const needsRefresh = !row.access_token || (expiresAt && expiresAt <= Date.now() + 5 * 60 * 1000);
  if (!needsRefresh && row.access_token) return row.access_token;
  if (!row.refresh_token) return row.access_token || envToken;

  const response = await fetchWithRetry(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ETSY_KEY,
      refresh_token: row.refresh_token,
    }),
  }, { retries: 2, timeoutMs: 10_000 });

  const { text, json } = await parseJsonResponse(response);
  if (!response.ok || !json.access_token) {
    throw new Error(`etsyDraft: token refresh ${response.status}: ${text.slice(0, 200)}`);
  }

  const expires_at = json.expires_in
    ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
    : null;
  const { error: updateError } = await supabase
    .from("oauth_tokens")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token || row.refresh_token,
      expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("platform", "etsy");
  if (updateError) throw new Error(`etsyDraft: token save failed: ${updateError.message}`);
  return json.access_token;
}

export async function createDraftListing(input, token) {
  assertConfig();
  const t = token || await getEtsyToken();
  if (!t) throw new Error("etsyDraft: no Etsy access token");

  const tags = (Array.isArray(input.tags) ? input.tags : [])
    .map((tag) => String(tag).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20))
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 13);

  const body = {
    quantity: 999,
    title: String(input.title || "").trim().slice(0, 140),
    description: String(input.description || "").trim().slice(0, 5000),
    price: resolveListingPrice(input),
    who_made: "i_did",
    when_made: WHEN_MADE,
    taxonomy_id: Number(input.taxonomy_id) || 2078,
    tags,
    type: "download",
    is_digital: true,
    should_auto_renew: true,
    state: "draft",
  };

  if (!body.title || !body.description || !body.tags.length) {
    throw new Error("etsyDraft: title, description, and tags are required");
  }

  const response = await fetchWithRetry(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings`, {
    method: "POST",
    headers: authH(t),
    body: JSON.stringify(body),
  }, { retries: 2, timeoutMs: 15_000 });
  const { text, json } = await parseJsonResponse(response);
  if (!response.ok || !json.listing_id) {
    throw new Error(`etsyDraft create ${response.status}: ${text.slice(0, 300)}`);
  }

  return { listing_id: json.listing_id, state: json.state || "draft", price: body.price };
}

export async function listListingFiles(listing_id, token) {
  assertConfig();
  const t = token || await getEtsyToken();
  if (!t) throw new Error("etsyDraft: no Etsy access token");
  const response = await fetchWithRetry(
    `${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/files`,
    { headers: authH(t) },
    { retries: 2, timeoutMs: 10_000 },
  );
  if (response.status === 404) return [];
  const { text, json } = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`etsyDraft files ${response.status}: ${text.slice(0, 200)}`);
  return Array.isArray(json.results) ? json.results : [];
}

export async function replaceLowResFiles(listing_id, token) {
  const t = token || await getEtsyToken();
  const files = await listListingFiles(listing_id, t);
  const removed = [];

  for (const file of files) {
    const size = Number(file.filesize_bytes || file.filesize || file.size) || 0;
    if (!size || size >= LOWRES_FLOOR) continue;
    const response = await fetchWithRetry(
      `${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/files/${file.listing_file_id}`,
      { method: "DELETE", headers: authH(t) },
      { retries: 1, timeoutMs: 10_000 },
    );
    if (response.ok) removed.push({ id: file.listing_file_id, name: file.filename || file.name, size });
  }
  return { removed };
}

export async function attachFileBuffer(listing_id, buffer, filename, mimeType = "image/png", token) {
  assertConfig();
  const t = token || await getEtsyToken();
  if (!t) throw new Error("etsyDraft: no Etsy access token");
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!buf.length) throw new Error("etsyDraft: empty file");
  if (buf.length > MAX_FILE_BYTES) throw new Error(`etsyDraft: file exceeds ${MAX_FILE_BYTES} bytes`);

  const safe = String(filename || `house_of_jreym_${listing_id}.png`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const boundary = `----HoJBoundary${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safe}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${safe}\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetchWithRetry(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "x-api-key": xkey(),
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  }, { retries: 2, timeoutMs: 30_000 });

  const { text, json } = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`etsyDraft attach ${response.status}: ${text.slice(0, 300)}`);
  return {
    attached: true,
    listing_file_id: json.listing_file_id,
    filename: safe,
    size: buf.length,
    low_res_warning: buf.length < LOWRES_FLOOR,
  };
}

export async function attachFileFromUrl(listing_id, fileUrl, filename, token) {
  const response = await fetchWithRetry(fileUrl, {}, {
    retries: 2,
    timeoutMs: 30_000,
    validateRemote: true,
  });
  if (!response.ok) throw new Error(`etsyDraft: remote file fetch ${response.status}`);

  const advertisedSize = Number(response.headers.get("content-length")) || 0;
  if (advertisedSize > MAX_FILE_BYTES) throw new Error("etsyDraft: remote file exceeds Etsy size limit");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) throw new Error("etsyDraft: remote file exceeds Etsy size limit");

  let mime = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!/^(image\/(png|jpeg|jpg|webp|svg\+xml)|application\/pdf|application\/zip)$/.test(mime)) {
    throw new Error(`etsyDraft: unsupported file type ${mime}`);
  }
  return attachFileBuffer(listing_id, buffer, filename, mime, token);
}

export async function activateListing(listing_id, token) {
  assertConfig();
  const t = token || await getEtsyToken();
  if (!t) throw new Error("etsyDraft: no Etsy access token");

  const response = await fetchWithRetry(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listing_id}`, {
    method: "PATCH",
    headers: authH(t),
    body: JSON.stringify({ state: "active", when_made: WHEN_MADE }),
  }, { retries: 2, timeoutMs: 15_000 });
  const { text } = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`etsyDraft activate ${response.status}: ${text.slice(0, 300)}`);
  return { activated: true, listing_id };
}
