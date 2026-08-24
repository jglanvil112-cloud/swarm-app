// agents/executor.js — House of Jreym agent task executor
// All Etsy publication paths stage a DRAFT and queue it for explicit human approval.
import Anthropic from "@anthropic-ai/sdk";
import { logAgent, saveAgentOutput, enqueueTask, supabase } from "../lib/supabase.js";
import { handleCanvaToEtsy } from "./canvaToEtsy.js";
import { handleCanvaToSocial } from "./canvaToSocial.js";
import { briefFromImage } from "../lib/visionBrief.js";
import {
  createDraftListing,
  attachFileBuffer,
  attachFileFromUrl,
  getEtsyToken,
} from "../lib/etsyDraft.js";
import { resolveListingPrice } from "../lib/pricing.js";
import { scoreListingQuality } from "../lib/seo.js";
import { fetchWithRetry } from "../lib/security.js";

const MODEL = process.env.AGENT_MODEL || "claude-haiku-4-5-20251001";
const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_SHOP_ID = Number(process.env.ETSY_SHOP_ID) || 0;
const ETSY_KEY = process.env.ETSY_KEY || process.env.ETSY_API_KEY || "";
const ETSY_SECRET = process.env.ETSY_SECRET || "";

const AGENT_PROMPTS = {
  NANA: "You are NANA, trend strategist for House of Jreym digital art. Use only the data supplied. Return structured JSON only.",
  KOFI: "You are KOFI, operations and delivery monitor. Return structured JSON only.",
  AMARA: "You are AMARA, Etsy conversion copywriter. Return structured JSON only.",
  KWAME: "You are KWAME, sales optimizer. Return structured JSON only.",
  FATIMA: "You are FATIMA, customer service manager. Return structured JSON only.",
  SEUN: "You are SEUN, commerce analytics and forecasting analyst. Use supplied metrics. Return structured JSON only.",
  AISHA: "You are AISHA, Etsy SEO strategist. Use natural buyer-intent phrases and avoid keyword stuffing. Return structured JSON only.",
  IBRAHIM: "You are IBRAHIM, social media manager. Return structured JSON only.",
  ZARA: "You are ZARA, inventory manager. Return structured JSON only.",
  DELE: "You are DELE, pricing strategist. Return structured JSON only.",
  IMANI: "You are IMANI, paid ads manager. Flag spend above $50 for approval. Return structured JSON only.",
  ABENA: "You are ABENA, finance tracker. Return structured JSON only.",
};

function extractKeyword(payload = {}) {
  const raw = payload.keyword ?? payload.trend_keyword ?? payload.top_pick ?? payload.kw ?? "";
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    const inner = raw.keyword ?? raw.top_pick ?? raw.name ?? raw.title ?? "";
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  const firstTag = Array.isArray(payload.tags)
    ? payload.tags[0]
    : typeof payload.tags === "string"
      ? payload.tags.split(",")[0]
      : "";
  if (firstTag?.trim()) return firstTag.trim();
  if (typeof payload.niche === "string" && payload.niche.trim()) return payload.niche.trim();
  if (typeof payload.title === "string" && payload.title.trim()) return payload.title.split("—")[0].trim().slice(0, 50);
  throw new Error("Task payload does not contain a usable keyword");
}

async function callClaude(agent, prompt, maxTokens = 1600) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: `${AGENT_PROMPTS[agent] || AGENT_PROMPTS.NANA}\nReturn ONLY valid JSON with no markdown fences.`,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (response.content?.[0]?.text || "")
    .trim()
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  try { return JSON.parse(raw); }
  catch { throw new Error(`${agent} returned invalid JSON`); }
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateSVG(keyword, niche) {
  const safeKw = escapeXml(keyword || "House of Jreym");
  const safeNiche = escapeXml(niche || "Digital Art Print");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 3000" width="2400" height="3000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#151525"/>
      <stop offset="1" stop-color="#292240"/>
    </linearGradient>
  </defs>
  <rect width="2400" height="3000" fill="url(#bg)"/>
  <rect x="120" y="120" width="2160" height="2760" fill="none" stroke="#d6ad55" stroke-width="8" opacity="0.65"/>
  <text x="1200" y="480" text-anchor="middle" font-family="Georgia,serif" font-size="66" fill="#d6ad55" letter-spacing="18">HOUSE OF JREYM</text>
  <text x="1200" y="1500" text-anchor="middle" font-family="Georgia,serif" font-size="170" font-weight="bold" fill="#f7f2e8">${safeKw}</text>
  <text x="1200" y="2470" text-anchor="middle" font-family="Georgia,serif" font-size="58" fill="#d6ad55" letter-spacing="12">${safeNiche.toUpperCase()}</text>
</svg>`;
}

function normalizeTags(rawTags) {
  const tags = Array.isArray(rawTags) ? rawTags : String(rawTags || "").split(",");
  return [...new Set(tags
    .map((tag) => String(tag).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20))
    .filter(Boolean))]
    .slice(0, 13);
}

function etsyXKey() {
  if (!ETSY_KEY) throw new Error("ETSY_KEY is not configured");
  return ETSY_SECRET ? `${ETSY_KEY}:${ETSY_SECRET}` : ETSY_KEY;
}

async function uploadDraftCover(listingId, keyword, niche, token) {
  if (!ETSY_SHOP_ID || !token) return { uploaded: false, reason: "missing_config" };
  try {
    const { default: sharp } = await import("sharp");
    const png = await sharp(Buffer.from(generateSVG(keyword, niche), "utf8"), { density: 120 })
      .png()
      .resize(1600, 2000, { fit: "cover" })
      .toBuffer();

    const boundary = `----HoJImg${Date.now().toString(36)}`;
    const filename = `hoj_${listingId}.png`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="rank"\r\n\r\n1\r\n--${boundary}--\r\n`),
    ]);

    const response = await fetchWithRetry(
      `${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings/${listingId}/images`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": etsyXKey(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
      },
      { retries: 2, timeoutMs: 30_000 },
    );
    if (!response.ok) return { uploaded: false, status: response.status };
    const json = await response.json().catch(() => ({}));
    return { uploaded: true, listing_image_id: json.listing_image_id || null };
  } catch (error) {
    return { uploaded: false, error: error.message };
  }
}

function decodeDataUri(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const buffer = isBase64
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { buffer, mime };
}

export async function stageEtsyListing(payload = {}) {
  const keyword = extractKeyword(payload);
  const niche = payload.niche || payload.category || "Digital Art Print";
  const title = String(payload.title || `${keyword}, Printable Digital Download`).slice(0, 140);
  const description = String(payload.description || `Digital artwork inspired by ${keyword}. Instant digital delivery; no physical item is shipped.`).slice(0, 5000);
  const tags = normalizeTags(payload.tags);
  if (!tags.length) tags.push("digital download", "printable wall art", "black wall art");

  const price = resolveListingPrice({
    ...payload,
    price_locked: payload.price_locked === true,
  });
  const qualityScore = scoreListingQuality({ title, tags, description });

  const draft = await createDraftListing({
    title,
    description,
    tags,
    price,
    price_locked: true,
    premium: payload.premium,
    bundle_count: payload.bundle_count,
  });

  const token = await getEtsyToken();
  let fileResult = null;
  try {
    if (payload.file_url) {
      const decoded = decodeDataUri(payload.file_url);
      if (decoded) {
        fileResult = await attachFileBuffer(
          draft.listing_id,
          decoded.buffer,
          payload.file_name || `house_of_jreym_${draft.listing_id}.svg`,
          decoded.mime,
          token,
        );
      } else {
        fileResult = await attachFileFromUrl(
          draft.listing_id,
          payload.file_url,
          payload.file_name || `house_of_jreym_${draft.listing_id}.png`,
          token,
        );
      }
    } else {
      const svg = Buffer.from(generateSVG(keyword, niche), "utf8");
      fileResult = await attachFileBuffer(
        draft.listing_id,
        svg,
        `house_of_jreym_${draft.listing_id}.svg`,
        "image/svg+xml",
        token,
      );
    }
  } catch (error) {
    await logAgent("AISHA", `Draft #${draft.listing_id} file attach failed: ${error.message}`, "warn");
  }

  const coverResult = await uploadDraftCover(draft.listing_id, keyword, niche, token);
  const meta = {
    source: "agent_pipeline",
    title,
    keyword,
    niche,
    price,
    quality_score: qualityScore,
    file_attached: Boolean(fileResult?.attached),
    file_size: fileResult?.size || 0,
    cover_uploaded: Boolean(coverResult?.uploaded),
  };

  const { data: queue, error: queueError } = await supabase
    .from("publish_queue")
    .insert({
      agent: "AISHA",
      listing_id: String(draft.listing_id),
      status: "queued",
      meta,
    })
    .select()
    .single();
  if (queueError) throw new Error(`publish_queue: ${queueError.message}`);

  await saveAgentOutput("AISHA", "etsy_listing_staged", {
    listing_id: draft.listing_id,
    queue_id: queue.id,
    etsy_title: title,
    tags,
    price,
    quality_score: qualityScore,
    file_attached: meta.file_attached,
    state: "draft",
  });
  await logAgent(
    "AISHA",
    `STAGED Etsy draft #${draft.listing_id} for approval (queue #${queue.id})`,
    meta.file_attached ? "success" : "warn",
    meta,
  );

  return {
    published: false,
    queued_for_approval: true,
    listing_id: draft.listing_id,
    queue_id: queue.id,
    title,
    price,
    quality_score: qualityScore,
    file_attached: meta.file_attached,
    etsy_url: `https://www.etsy.com/listing/${draft.listing_id}`,
  };
}

// Compatibility export: legacy callers keep the old function name, but the
// implementation now stages a draft instead of publishing directly.
export const handlePublishEtsyListing = stageEtsyListing;

export async function publishNextListing() {
  try {
    const { data: titleRows } = await supabase
      .from("agent_outputs")
      .select("task_id,etsy_title")
      .eq("output_type", "etsy_title")
      .not("etsy_title", "is", null)
      .limit(100);
    if (!titleRows?.length) return { queued: 0 };

    const taskIds = titleRows.map((row) => row.task_id).filter(Boolean);
    const { data: titleTasks } = await supabase
      .from("tasks")
      .select("id,parent_task_id")
      .in("id", taskIds)
      .not("parent_task_id", "is", null);
    if (!titleTasks?.length) return { queued: 0 };

    const parentIds = [...new Set(titleTasks.map((task) => task.parent_task_id))];
    const { data: existing } = await supabase
      .from("tasks")
      .select("parent_task_id")
      .in("parent_task_id", parentIds)
      .eq("task_type", "publish_etsy_listing");
    const alreadyQueued = new Set((existing || []).map((task) => task.parent_task_id));

    let queued = 0;
    for (const parentId of parentIds.filter((id) => !alreadyQueued.has(id)).slice(0, 10)) {
      const { data: siblings } = await supabase
        .from("tasks")
        .select("id,task_type")
        .eq("parent_task_id", parentId)
        .in("task_type", ["generate_etsy_title", "generate_etsy_description", "generate_etsy_tags", "generate_digital_file"]);
      if (!siblings?.length) continue;

      const { data: outputs } = await supabase
        .from("agent_outputs")
        .select("output_type,etsy_title,etsy_description,etsy_tags,data")
        .in("task_id", siblings.map((s) => s.id));
      const map = {};
      for (const output of outputs || []) map[output.output_type] = output;

      const title = map.etsy_title?.etsy_title;
      const description = map.etsy_description?.etsy_description;
      const tags = map.etsy_tags?.etsy_tags;
      const fileUrl = map.digital_file?.data?.file_url || null;
      const fileName = map.digital_file?.data?.file_name || null;
      if (!title || !description || !tags) continue;

      await enqueueTask({
        agent: "AISHA",
        task_type: "publish_etsy_listing",
        payload: {
          title,
          description,
          tags,
          keyword: title.split("—")[0].split("|")[0].trim(),
          file_url: fileUrl,
          file_name: fileName,
        },
        priority: 1,
        parentTaskId: parentId,
      });
      queued++;
    }
    return { queued, total_parents: parentIds.length };
  } catch (error) {
    console.error("[publishNext]", error.message);
    return { queued: 0, error: error.message };
  }
}

async function analyticsSnapshot() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: revenue }, { data: products }] = await Promise.all([
    supabase.from("revenue_events").select("amount,product_id,recorded_at,platform").gte("recorded_at", since),
    supabase.from("products").select("external_id,title,price,status,performance").eq("platform", "etsy").limit(250),
  ]);
  const totalRevenue = (revenue || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return {
    period_days: 30,
    etsy_products: products || [],
    revenue_events: revenue || [],
    total_revenue: Math.round(totalRevenue * 100) / 100,
  };
}

export async function executeTask(task) {
  const { task_type, agent, payload = {} } = task;

  if (task_type === "publish_etsy_listing") return stageEtsyListing(payload);
  if (task_type === "canva_to_etsy") return handleCanvaToEtsy(task);
  if (task_type === "canva_to_social") return handleCanvaToSocial(task);

  if (task_type === "vision_brief") {
    const brief = await briefFromImage(payload.imageUrl);
    await saveAgentOutput("KOFI", "vision_brief", { task_id: task.id, image_url: payload.imageUrl, brief });
    return { brief };
  }

  if (task_type === "generate_digital_file") {
    const keyword = extractKeyword(payload);
    const niche = payload.niche || payload.category || "Digital Art Print";
    const svg = generateSVG(keyword, niche);
    const file_name = `hoj_${keyword.replace(/\s+/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30)}.svg`;
    const file_url = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
    const result = { generated: true, keyword, niche, file_name, file_url };
    await saveAgentOutput({
      taskId: task.id,
      agent: "AMARA",
      outputType: "digital_file",
      etsyTitle: keyword,
      confidence: 0.95,
      data: result,
    });
    return result;
  }

  if (task_type === "generate_etsy_title") {
    const keyword = extractKeyword(payload);
    const result = await callClaude(
      "AMARA",
      `Create ONE Etsy title for a House of Jreym digital wall-art listing about "${keyword}". Keep it 70-135 characters. Lead with buyer intent. Do not put "House of Jreym" in the title. Return {"title":string,"confidence":number}.`,
    );
    await saveAgentOutput({
      taskId: task.id,
      agent: "AMARA",
      outputType: "etsy_title",
      etsyTitle: result.title,
      confidence: result.confidence || 0.8,
      data: result,
    });
    return result;
  }

  if (task_type === "generate_etsy_description") {
    const keyword = extractKeyword(payload);
    const result = await callClaude(
      "AMARA",
      `Write an Etsy description for digital wall art about "${keyword}". Be specific, concise, and truthful. State that no physical item ships. Do not promise file sizes or formats not supplied. Return {"description":string,"confidence":number}.`,
    );
    await saveAgentOutput({
      taskId: task.id,
      agent: "AMARA",
      outputType: "etsy_description",
      etsyDescription: result.description,
      confidence: result.confidence || 0.8,
      data: result,
    });
    return result;
  }

  if (task_type === "generate_etsy_tags") {
    const keyword = extractKeyword(payload);
    const result = await callClaude(
      "AISHA",
      `Generate exactly 13 natural Etsy tags for digital wall art about "${keyword}". Each tag <=20 characters, lowercase, unique, no trademark guessing. Return {"tags":string[],"confidence":number}.`,
    );
    result.tags = normalizeTags(result.tags);
    await saveAgentOutput({
      taskId: task.id,
      agent: "AISHA",
      outputType: "etsy_tags",
      etsyTags: result.tags,
      confidence: result.confidence || 0.8,
      data: result,
    });
    return result;
  }

  if (task_type === "generate_social_caption" || task_type === "social_caption") {
    const keyword = extractKeyword(payload);
    const result = await callClaude(
      "IBRAHIM",
      `Write a short social caption for House of Jreym artwork about "${keyword}". Avoid unsupported claims. Return {"caption":string,"hashtags":string[]}.`,
    );
    await saveAgentOutput({
      taskId: task.id,
      agent: "IBRAHIM",
      outputType: "social_caption",
      socialCaption: result.caption,
      confidence: 0.8,
      data: result,
    });
    return result;
  }

  if (task_type === "trend_research" || task_type === "trend_analysis") {
    const category = payload.category || payload.niche || "wall art";
    const { data: priorTrends } = await supabase
      .from("trends")
      .select("keyword,category,score,data")
      .order("score", { ascending: false })
      .limit(25);
    const result = await callClaude(
      "NANA",
      `From the stored trend data below, choose the strongest testable Etsy niche within "${category}". Do not claim live internet knowledge. Return {"top_pick":string,"trends":[{"keyword":string,"score":number,"reason":string}]}. DATA=${JSON.stringify(priorTrends || [])}`,
    );
    await saveAgentOutput({ taskId: task.id, agent: "NANA", outputType: "trend_research", confidence: 0.7, data: result });
    return result;
  }

  if (task_type === "seo_generation") {
    const keyword = extractKeyword({ ...payload, keyword: payload.keyword || payload.title });
    const result = await callClaude(
      "AISHA",
      `Create an Etsy SEO test plan for "${keyword}" using only the supplied phrase. Return {"title":string,"tags":string[],"hypothesis":string}.`,
    );
    result.tags = normalizeTags(result.tags);
    await saveAgentOutput({ taskId: task.id, agent: "AISHA", outputType: "seo_generation", etsyTitle: result.title, etsyTags: result.tags, confidence: 0.75, data: result });
    return result;
  }

  if (task_type === "analytics_report") {
    const snapshot = await analyticsSnapshot();
    const result = await callClaude(
      "SEUN",
      `Analyze this 30-day House of Jreym Etsy snapshot. Identify underperformers only when supported by the data. Return {"report":string,"underperformers":string[],"recommendations":string[],"metrics":object}. SNAPSHOT=${JSON.stringify(snapshot)}`,
      2200,
    );
    await saveAgentOutput({ taskId: task.id, agent: "SEUN", outputType: "analytics_report", confidence: 0.9, data: { ...result, snapshot_summary: { total_revenue: snapshot.total_revenue, product_count: snapshot.etsy_products.length } } });
    return result;
  }

  if (task_type === "financial_report") {
    const snapshot = await analyticsSnapshot();
    const result = {
      period_days: snapshot.period_days,
      total_revenue: snapshot.total_revenue,
      revenue_events: snapshot.revenue_events.length,
    };
    await saveAgentOutput({ taskId: task.id, agent: "ABENA", outputType: "financial_report", confidence: 1, data: result });
    return result;
  }

  if (task_type === "inventory_check") {
    const { data: products } = await supabase
      .from("products")
      .select("external_id,title,status,performance")
      .limit(250);
    const result = {
      status: "ok",
      checked: products?.length || 0,
      low_stock: [],
      note: "Digital Etsy listings do not require artificial stock replenishment; POD inventory remains platform-managed.",
    };
    await saveAgentOutput({ taskId: task.id, agent: "KOFI", outputType: "inventory_check", confidence: 1, data: result });
    return result;
  }

  const result = await callClaude(
    agent || "NANA",
    payload.prompt || `Execute task "${task_type}" using only the supplied payload: ${JSON.stringify(payload)}. Return a concise JSON result.`,
  );
  await saveAgentOutput({ taskId: task.id, agent: agent || "NANA", outputType: task_type, confidence: 0.6, data: result });
  return result;
}
