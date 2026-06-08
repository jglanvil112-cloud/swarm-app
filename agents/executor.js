// agents/executor.js — SWARM OS v6.5 — fix: send x-api-key as key:secret with Bearer token
// Full Etsy listing publish + SVG file attachment end-to-end verified.
import Anthropic from "@anthropic-ai/sdk";
import { logAgent, saveDecision, saveTrend, saveAgentOutput, enqueueTask, supabase } from "../lib/supabase.js";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL     = process.env.BASE_URL    || "https://swarm-app-3nch.onrender.com";
const ETSY_SHOP_ID = process.env.ETSY_SHOP_ID || "";

const AGENT_PROMPTS = {
  NANA:"You are NANA, Trend Scout for House of Jreym (POD/digital goods). Return structured JSON only.",
  KOFI:"You are KOFI, Supply Chain Monitor. Return structured JSON only.",
  AMARA:"You are AMARA, Marketing Strategist. Return structured JSON only.",
  KWAME:"You are KWAME, Sales Optimizer. Return structured JSON only.",
  FATIMA:"You are FATIMA, Customer Service Manager. Return structured JSON only.",
  SEUN:"You are SEUN, Analytics & Forecasting. Return structured JSON only.",
  AISHA:"You are AISHA, SEO Strategist for Etsy/Shopify. Return structured JSON only.",
  IBRAHIM:"You are IBRAHIM, Social Media Manager. Return structured JSON only.",
  ZARA:"You are ZARA, Inventory Manager. Return structured JSON only.",
  DELE:"You are DELE, Pricing Strategist. Return structured JSON only.",
  IMANI:"You are IMANI, Paid Ads Manager. Flag spend >$50 for approval. Return structured JSON only.",
  ABENA:"You are ABENA, Finance Tracker. Return structured JSON only.",
};

function extractKeyword(p) {
  const raw = p.keyword ?? p.trend_keyword ?? p.top_pick ?? p.kw ?? "";
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "object" && raw !== null) {
    const inner = raw.keyword ?? raw.top_pick ?? raw.name ?? "";
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  // Fallback: use first tag if no keyword field (scheduler sends tags-only payloads)
  const firstTag = Array.isArray(p.tags) ? p.tags[0] : (typeof p.tags === "string" ? p.tags.split(",")[0].trim() : "");
  if (firstTag && firstTag.trim()) return firstTag.trim();
  // Last resort: use niche or title
  if (p.niche && typeof p.niche === "string") return p.niche.trim();
  if (p.title && typeof p.title === "string") return p.title.split("—")[0].trim().slice(0, 30);
  throw new Error("Invalid keyword in payload: " + JSON.stringify(p));
}

async function callClaude(agent, prompt) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: (AGENT_PROMPTS[agent] || AGENT_PROMPTS.NANA) + "\n\nReturn ONLY valid JSON. No markdown.",
    messages: [{ role: "user", content: prompt }],
  });
  const raw = response.content[0].text.trim().replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
  try { return JSON.parse(raw); } catch { return { raw_response: raw, parse_error: true }; }
}

// ── Etsy token (auto-refresh) ───────────────────────────────────────────────
const ETSY_KEY    = process.env.ETSY_KEY    || "06k7svc5tbl35c6oh7k399ak";
const ETSY_SECRET_VAL = process.env.ETSY_SECRET || "4omdt27v26";

async function getLiveEtsyToken() {
  console.log('[getLiveEtsyToken] START');
  try {
    const { data: rows, error: rErr } = await supabase
      .from('oauth_tokens').select('access_token, refresh_token')
      .eq('platform','etsy').order('id',{ascending:false}).limit(1);
    console.log('[getLiveEtsyToken] rows:', rows?.length, 'err:', rErr?.message || 'none');
    const row = rows?.[0];
    if (!row) { console.log('[getLiveEtsyToken] no row found'); return process.env.ETSY_ACCESS_TOKEN || null; }
    if (row.access_token) {
      console.log('[getLiveEtsyToken] token found:', row.access_token.slice(0,12));
      return row.access_token;
    }
    if (row.refresh_token) {
      console.log('[getLiveEtsyToken] trying refresh...');
      const r = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ETSY_KEY, refresh_token: row.refresh_token }),
      });
      const rt = await r.text(); console.log('[getLiveEtsyToken] refresh:', r.status, rt.slice(0,80));
      if (r.ok) {
        const j = JSON.parse(rt);
        if (j.access_token) {
          await supabase.from('oauth_tokens').update({ access_token: j.access_token, refresh_token: j.refresh_token || row.refresh_token }).eq('platform','etsy');
          return j.access_token;
        }
      }
    }
    return process.env.ETSY_ACCESS_TOKEN || null;
  } catch(e) { console.error('[getLiveEtsyToken] ERROR:', e.message); return process.env.ETSY_ACCESS_TOKEN || null; }
}

// ── SVG generator ────────────────────────────────────────────────────────────
function generateSVG(keyword, niche) {
  const safeKw    = (keyword || "Brooklyn Luxury").replace(/[<>&"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  const safeNiche = (niche   || "Digital Print").replace(/[<>&"]/g,  c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  const palettes  = [
    ["#1a1a2e","#e2b04a","#f5f0e8"],
    ["#0d1b2a","#c9a84c","#f8f4ed"],
    ["#16213e","#d4a843","#fffff0"],
    ["#0f0e17","#e8c547","#fffffe"],
    ["#1c1c3a","#f0c040","#faf7f0"],
  ];
  const p = palettes[Math.abs(keyword.split("").reduce((a,c)=>a+c.charCodeAt(0),0)) % palettes.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${p[0]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${p[0]}cc;stop-opacity:1"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${p[1]};stop-opacity:0.6"/>
      <stop offset="50%" style="stop-color:${p[1]};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${p[1]};stop-opacity:0.6"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <rect x="40" y="40" width="720" height="520" fill="none" stroke="${p[1]}" stroke-width="2" opacity="0.4"/>
  <rect x="50" y="50" width="700" height="500" fill="none" stroke="${p[1]}" stroke-width="0.5" opacity="0.2"/>
  <line x1="100" y1="180" x2="700" y2="180" stroke="url(#gold)" stroke-width="1"/>
  <line x1="100" y1="420" x2="700" y2="420" stroke="url(#gold)" stroke-width="1"/>
  <text x="400" y="100" font-family="Georgia,serif" font-size="11" fill="${p[1]}" text-anchor="middle" letter-spacing="6" opacity="0.7">HOUSE OF JREYM</text>
  <text x="400" y="310" font-family="Georgia,serif" font-size="52" font-weight="bold" fill="${p[2]}" text-anchor="middle" dominant-baseline="middle">${safeKw}</text>
  <text x="400" y="470" font-family="Georgia,serif" font-size="13" fill="${p[1]}" text-anchor="middle" letter-spacing="4" opacity="0.8">${safeNiche.toUpperCase()}</text>
  <circle cx="400" cy="570" r="3" fill="${p[1]}" opacity="0.5"/>
  <circle cx="380" cy="570" r="2" fill="${p[1]}" opacity="0.3"/>
  <circle cx="420" cy="570" r="2" fill="${p[1]}" opacity="0.3"/>
</svg>`;
}


// ── Generate PNG image for Etsy listing (raw multipart — same pattern as attachFileToListing) ──
async function generateAndUploadListingImage(listingId, keyword, niche, token) {
  const ETSY_KEY    = process.env.ETSY_KEY    || "06k7svc5tbl35c6oh7k399ak";
  const ETSY_SECRET = process.env.ETSY_SECRET || "4omdt27v26";
  try {
    const svg    = generateSVG(keyword, niche);
    const svgBuf = Buffer.from(svg, "utf8");
    const { default: sharp } = await import("sharp");
    const pngBuf = await sharp(svgBuf, { density: 150 }).png().toBuffer();

    // Raw multipart — same pattern that works in attachFileToListing
    const boundary = "----HoJImgBoundary" + Date.now().toString(36);
    const filename  = `hoj_${listingId}.png`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
      pngBuf,
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n1\r\n--${boundary}--\r\n`,
    ];
    const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p));
    const headers = {
      "Content-Type":   `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
      Authorization:    `Bearer ${token}`,
      "x-api-key":      ETSY_KEY + (ETSY_SECRET ? ":" + ETSY_SECRET : ""),
    };

    const url = `https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP_ID}/listings/${listingId}/images`;
    const imgRes  = await fetch(url, { method: "POST", headers, body });
    const imgText = await imgRes.text();
    let imgData;
    try { imgData = JSON.parse(imgText); } catch { imgData = { raw: imgText }; }

    if (!imgRes.ok) {
      console.error(`[image] upload FAIL ${listingId} ${imgRes.status}:`, imgText.slice(0, 200));
      return { uploaded: false, error: imgData.error || imgText.slice(0,100) };
    }
    console.log(`[image] ✅ ${listingId} image_id:${imgData.listing_image_id}`);
    return { uploaded: true, listing_image_id: imgData.listing_image_id };
  } catch (e) {
    console.error(`[image] ERR ${listingId}:`, e.message);
    return { uploaded: false, error: e.message };
  }
}

// ── Upload SVG file to Etsy listing ───────────────────────────────────────────────
async function attachFileToListing(listingId, svgContent, filename) {
  const ETSY_KEY   = process.env.ETSY_KEY    || "06k7svc5tbl35c6oh7k399ak";
  const ETSY_TOKEN = await getLiveEtsyToken() || process.env.ETSY_ACCESS_TOKEN || "";
  if (!listingId || !ETSY_SHOP_ID) {
    console.warn("[attachFile] Missing listingId or ETSY_SHOP_ID — skip attach");
    return { skipped: true, reason: "missing_ids" };
  }

  const boundary = "----HoJFormBoundary" + Date.now().toString(36);
  const svgBytes  = Buffer.from(svgContent, "utf8");
  const safeFilename = (filename || "house_of_jreym_print.svg").replace(/[^a-zA-Z0-9._-]/g, "_");

  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: image/svg+xml\r\n\r\n`,
    svgBytes,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${safeFilename}\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(parts.map(p => (typeof p === "string" ? Buffer.from(p) : p)));

  const headers = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": body.length.toString(),
    ...(ETSY_TOKEN ? { Authorization: `Bearer ${ETSY_TOKEN}` } : {}),
"x-api-key": ETSY_KEY+":"+ETSY_SECRET_VAL,
  };

  const url = `https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP_ID}/listings/${listingId}/files`;
  console.log(`[attachFile] POST ${url} — size ${body.length}b`);

  const res  = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    console.error(`[attachFile] Etsy error ${res.status}:`, text.slice(0, 300));
    return { error: true, status: res.status, body: json };
  }
  console.log(`[attachFile] ✅ File attached to listing ${listingId}`, json);
  return { attached: true, listing_file_id: json.listing_file_id, ...json };
}

// ── publishNextListing() — scans agent_outputs, queues publish_etsy_listing tasks ──
export async function publishNextListing() {
    try {
          const { data: titleRows } = await supabase.from("agent_outputs").select("task_id, etsy_title").eq("output_type", "etsy_title").not("etsy_title", "is", null).limit(100);
          if (!titleRows?.length) { console.log("[publishNext] No title outputs"); return { queued: 0 }; }
          const taskIds = titleRows.map(r => r.task_id).filter(Boolean);
          const { data: titleTasks } = await supabase.from("tasks").select("id, parent_task_id").in("id", taskIds).not("parent_task_id", "is", null);
          if (!titleTasks?.length) { return { queued: 0 }; }
          const parentIds = [...new Set(titleTasks.map(t => t.parent_task_id))];
          const { data: existingPublish } = await supabase.from("tasks").select("parent_task_id").in("parent_task_id", parentIds).eq("task_type", "publish_etsy_listing");
          const alreadyQueued = new Set((existingPublish || []).map(t => t.parent_task_id));
          const candidateParents = parentIds.filter(pid => !alreadyQueued.has(pid));
          if (!candidateParents.length) { return { queued: 0, total_parents: parentIds.length }; }
          console.log(`[publishNext] ${candidateParents.length} sets ready`);
          let queued = 0;
          for (const parentId of candidateParents.slice(0, 10)) {
                  const { data: siblings } = await supabase.from("tasks").select("id, task_type").eq("parent_task_id", parentId).in("task_type", ["generate_etsy_title", "generate_etsy_description", "generate_etsy_tags"]);
                  if (!siblings?.length) continue;
                  const { data: outputs } = await supabase.from("agent_outputs").select("output_type, etsy_title, etsy_description, etsy_tags").in("task_id", siblings.map(s => s.id));
                  if (!outputs?.length) continue;
                  const oMap = {}; for (const o of outputs) oMap[o.output_type] = o;
                  const title = oMap["etsy_title"]?.etsy_title;
                  const description = oMap["etsy_description"]?.etsy_description;
                  const tags = oMap["etsy_tags"]?.etsy_tags;
                  if (!title || !description || !tags) continue;
                  const keyword = title.split("\u2014")[0].trim().split("|")[0].trim();
                  await enqueueTask({ agent: "AISHA", task_type: "publish_etsy_listing", payload: { title, description, tags, price: 4.99, keyword }, priority: 1, parentTaskId: parentId });
                  console.log(`[publishNext] Queued: "${title.slice(0, 60)}"`);
                  queued++;
          }
          return { queued, candidates: candidateParents.length, total_parents: parentIds.length };
    } catch (err) { console.error("[publishNext] Error:", err.message); return { error: err.message, queued: 0 }; }
}

// ── publish_etsy_listing handler ───────────────────────────────────────────────
export async function handlePublishEtsyListing(payload) {
  const _liveToken = await getLiveEtsyToken() || process.env.ETSY_ACCESS_TOKEN || "";
  const keyword     = extractKeyword(payload);
  const niche       = payload.niche       || payload.category || "Digital Art Print";
  const title       = payload.title       || `${keyword} — Luxury Digital Print | House of Jreym`;
  const description = payload.description || `Premium digital print: ${keyword}. Instant download. Print at home or at a local shop.`;
  const rawTags     = Array.isArray(payload.tags) ? payload.tags : (payload.tags||"").split(",");
  const tags = [...new Set(
    rawTags.map(t => t.trim().toLowerCase().replace(/[^a-z0-9 ]/g,"").slice(0,20)).filter(Boolean)
  )].slice(0, 13);

  const basePrice = typeof payload.price === "number" ? payload.price : 4.99;
  const price     = Math.max(2.99, Math.min(19.99, parseFloat(basePrice.toFixed(2))));

  const ETSY_KEY = process.env.ETSY_KEY || "06k7svc5tbl35c6oh7k399ak";
  const ETSY_SECRET_PUB = process.env.ETSY_SECRET || "4omdt27v26";
const authH = _liveToken ? { Authorization: `Bearer ${_liveToken}` } : { "x-api-key": ETSY_KEY };

  if (!ETSY_SHOP_ID) {
    console.error("[publish] ETSY_SHOP_ID not set — cannot publish");
    return { error: "ETSY_SHOP_ID_MISSING" };
  }

  // Fetch return_policy_id dynamically so it stays current
  let returnPolicyId = 1; // default from active listing 4512221027
  try {
    const rpRes = await fetch(
      `https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP_ID}/return-policies`,
      { headers: { ...authH, "x-api-key": `${ETSY_KEY}:${ETSY_SECRET_PUB}` } }
    );
    if (rpRes.ok) {
      const rpData = await rpRes.json();
      const policies = rpData.results || rpData;
      if (Array.isArray(policies) && policies.length) returnPolicyId = policies[0].return_policy_id;
      else if (policies.return_policy_id) returnPolicyId = policies.return_policy_id;
    }
    console.log(`[publish] return_policy_id resolved: ${returnPolicyId}`);
  } catch(e) { console.warn("[publish] return_policy fetch failed, using default:", returnPolicyId); }

  const listingBody = {
    quantity: 999,
    title: title.slice(0, 140),
    description: description.slice(0, 2000),
    price,
    who_made: "i_did",
    when_made: "made_to_order",
    taxonomy_id: 2078,
    tags,
    type: "download",
    is_digital: true,
    should_auto_renew: true,
    state: "active",
    return_policy_id: returnPolicyId,
  };

  // ── DIAGNOSTIC PAYLOAD LOG ──────────────────────────────────────────────────
  const diagPayload = {
    shop_id:     ETSY_SHOP_ID,
    shop_id_type: typeof ETSY_SHOP_ID,
    token_preview: _liveToken ? _liveToken.slice(0,20)+"..." : "NONE",
    auth_header_keys: Object.keys({ ...authH, "Content-Type": "application/json", "x-api-key": `${ETSY_KEY}:${ETSY_SECRET_PUB}` }),
    listing_body: {
      ...listingBody,
      price_type: typeof listingBody.price,
      taxonomy_id: listingBody.taxonomy_id,
      taxonomy_id_type: typeof listingBody.taxonomy_id,
      tags_count: listingBody.tags.length,
      tags_array: listingBody.tags,
      tags_longest: Math.max(...listingBody.tags.map(t=>t.length)),
      who_made: listingBody.who_made,
      is_digital: listingBody.is_digital,
      type: listingBody.type,
      state: listingBody.state,
    }
  };
  console.log("[publish:DIAG] RAW PAYLOAD:", JSON.stringify(diagPayload, null, 2));

  const createRes  = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${ETSY_SHOP_ID}/listings`,
    { method: "POST", headers: { ...authH, "Content-Type": "application/json", "x-api-key": `${ETSY_KEY}:${ETSY_SECRET_PUB}` }, body: JSON.stringify(listingBody) }
  );
  const createText = await createRes.text();
  let createJson;
  try { createJson = JSON.parse(createText); } catch { createJson = { raw: createText }; }

  // ── FULL RESPONSE LOG — always, regardless of status ────────────────────────
  console.log("[publish:RESP] HTTP status:", createRes.status);
  console.log("[publish:RESP] Raw body:", createText.slice(0, 1000));
  console.log("[publish:RESP] listing_id:", createJson.listing_id, "| type:", typeof createJson.listing_id);
  console.log("[publish:RESP] error field:", createJson.error || "(none)");
  console.log("[publish:RESP] full JSON keys:", Object.keys(createJson).join(", "));

  if (!createRes.ok) {
    console.error(`[publish:FAIL] Create listing FAILED ${createRes.status}:`, JSON.stringify(createJson));
    console.error("[publish:FAIL] Payload was:", JSON.stringify(listingBody));
    return { error: true, status: createRes.status, body: createJson, payload_sent: listingBody };
  }

  // ── Detect silent failure: 2xx but no listing_id ────────────────────────────
  const listingId = createJson.listing_id;
  if (!listingId) {
    console.error("[publish:SILENT_FAIL] Got 2xx but listing_id is undefined/null");
    console.error("[publish:SILENT_FAIL] Full response:", JSON.stringify(createJson));
    console.error("[publish:SILENT_FAIL] Payload was:", JSON.stringify(listingBody));
    return { error: "listing_id_missing", status: createRes.status, body: createJson, payload_sent: listingBody };
  }
  console.log(`[publish] ✅ Listing created: ${listingId}`);

  const svgContent = generateSVG(keyword, niche);
  const filename   = `hoj_${keyword.replace(/\s+/g,"_").toLowerCase().slice(0,30)}_${listingId}.svg`;

  const attachResult = await attachFileToListing(listingId, svgContent, filename);

  // Upload unique PNG image for this listing
  const imageResult = await generateAndUploadListingImage(listingId, keyword, niche, _liveToken);
  console.log(`[publish] image upload:`, JSON.stringify(imageResult));

  const outputRow = await saveAgentOutput("AISHA", "publish_etsy_listing", {
    listing_id:      listingId,
    listing_url:     `https://www.etsy.com/listing/${listingId}`,
    listing_file_id: attachResult.listing_file_id || null,
    title,
    keyword,
    niche,
    price,
    tags,
    file_attached:   attachResult.attached || false,
    published_at:    new Date().toISOString(),
  });
  await logAgent("AISHA", `LIVE: ${listingId} | file:${attachResult.attached||false} | saved:${!!outputRow}`, "success");

  return {
    published: true,
    listing_id: listingId,
    title,
    price,
    file_attached: attachResult.attached || false,
    attach_result: attachResult,
    etsy_url: `https://www.etsy.com/listing/${listingId}`,
  };
}

// ── Task router ────────────────────────────────────────────────────────────────
export async function executeTask(task) {
  const { task_type, agent, payload = {} } = task;

  try {
    if (task_type === "publish_etsy_listing") {
      return await handlePublishEtsyListing(payload);
    }


        if (task_type === "generate_digital_file") {
                const keyword = extractKeyword(payload);
                const niche = payload.niche || payload.category || "Digital Art Print";
                const svgContent = generateSVG(keyword, niche);
                const filename = `hoj_${keyword.replace(/\s+/g,"_").toLowerCase().slice(0,30)}.svg`;
                const dataUri = "data:image/svg+xml;base64," + Buffer.from(svgContent, "utf8").toString("base64");
                await saveAgentOutput({ taskId: task.id, agent: "AMARA", outputType: "digital_file", etsyTitle: keyword, confidence: 0.95 });
                console.log(`[generate_digital_file] SVG ready for "${keyword}"`);
      return { generated: true, keyword, niche, file_name: filename, file_url: dataUri };
        }
    if (task_type === "generate_etsy_title") {
      const kw  = extractKeyword(payload);
      const res = await callClaude("AMARA", `Generate 5 Etsy listing titles for a digital print about "${kw}". Return JSON: { titles: string[] }`);
      await saveAgentOutput("AMARA", "generate_etsy_title", { keyword: kw, ...res });
      return res;
    }

    if (task_type === "generate_etsy_description") {
      const kw  = extractKeyword(payload);
      const res = await callClaude("AMARA", `Write an Etsy listing description for a luxury digital print about "${kw}". Return JSON: { description: string }`);
      await saveAgentOutput("AMARA", "generate_etsy_description", { keyword: kw, ...res });
      return res;
    }

    if (task_type === "generate_etsy_tags") {
      const kw  = extractKeyword(payload);
      const res = await callClaude("AISHA", `Generate 13 Etsy tags for a digital print about "${kw}". Rules: max 20 chars each, no special chars. Return JSON: { tags: string[] }`);
      await saveAgentOutput("AISHA", "generate_etsy_tags", { keyword: kw, ...res });
      return res;
    }

    if (task_type === "generate_social_caption") {
      const kw  = extractKeyword(payload);
      const res = await callClaude("IBRAHIM", `Write an Instagram caption for a luxury digital print about "${kw}". Include hashtags. Return JSON: { caption: string }`);
      await saveAgentOutput("IBRAHIM", "generate_social_caption", { keyword: kw, ...res });
      return res;
    }

    if (task_type === "trend_analysis") {
      const res = await callClaude("NANA", `Identify top 5 trending niches for digital print products right now. Return JSON: { trends: [{niche, keyword, score}] }`);
      await saveAgentOutput("NANA", "trend_analysis", res);
      return res;
    }

    if (task_type === "analytics_report") {
      const res = await callClaude("SEUN", `Analyze sales performance for House of Jreym digital prints. Flag underperformers. Return JSON: { report: string, underperformers: string[], recommendations: string[] }`);
      await saveAgentOutput("SEUN", "analytics_report", res);
      return res;
    }

    if (task_type === "inventory_check") {
      const res = await callClaude("KOFI", `Check inventory levels for House of Jreym POD products. Return JSON: { status: string, low_stock: string[], actions: string[] }`);
      await saveAgentOutput("KOFI", "inventory_check", res);
      return res;
    }

    const res = await callClaude(agent || "NANA", payload.prompt || `Execute task: ${task_type}. Return JSON with results.`);
    await saveAgentOutput(agent || "NANA", task_type, res);
    return res;

  } catch (err) {
    console.error(`[executeTask] Error in ${task_type}:`, err.message);
    throw err;
  }
}
