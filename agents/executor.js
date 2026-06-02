// agents/executor.js — SWARM OS v6.1 CLEAN
// All handlers properly closed. Tags string→array fix in publish_etsy_listing.
import Anthropic from "@anthropic-ai/sdk";
import { logAgent, saveDecision, saveTrend, saveAgentOutput, supabase } from "../lib/supabase.js";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL     = process.env.BASE_URL     || "https://swarm-app-3nch.onrender.com";
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
    const inner = raw.keyword ?? raw.top_pick ?? raw.title ?? raw.name ?? "";
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  throw new Error("Invalid keyword in payload: " + JSON.stringify(raw));
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

async function selfPost(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(path + " failed: " + JSON.stringify(data));
  return data;
}

function makeSVG(keyword, tags = []) {
  const safe = (s) => String(s).replace(/[<>&"]/g, "").trim();
  const title = safe(keyword).slice(0, 55);
  const tagline = tags.slice(0, 3).map(safe).join(" · ");
  return '<?xml version="1.0" encoding="UTF-8"?><svg width="3000" height="3000" viewBox="0 0 3000 3000" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#080808"/><stop offset="100%" stop-color="#141428"/></linearGradient><linearGradient id="gd" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#b8922a"/><stop offset="50%" stop-color="#f0d97a"/><stop offset="100%" stop-color="#b8922a"/></linearGradient></defs><rect width="3000" height="3000" fill="url(#bg)"/><rect x="60" y="60" width="2880" height="2880" fill="none" stroke="url(#gd)" stroke-width="5"/><text x="1500" y="180" font-family="Georgia,serif" font-size="52" fill="#c9a84c" text-anchor="middle" opacity="0.7">HOUSE OF JREYM</text><text x="1500" y="1520" font-family="Georgia,serif" font-size="128" fill="url(#gd)" text-anchor="middle" dominant-baseline="middle">'+title+'</text><text x="1500" y="1660" font-family="Georgia,serif" font-size="54" fill="#c9a84c" text-anchor="middle" opacity="0.65">'+tagline+'</text><text x="1500" y="2870" font-family="Georgia,serif" font-size="42" fill="#c9a84c" text-anchor="middle" opacity="0.5">DIGITAL DOWNLOAD · SVG + PNG + PDF</text></svg>';
}

const TASK_HANDLERS = {
  trend_research: async (p) => callClaude("NANA", 'Research trending POD/digital products for: "'+( p.category||"lifestyle")+'". Return JSON: {"trends":[{"keyword":"string","category":"string","score":85,"opportunity":"string","tags":["t1"],"why_now":"string"}],"top_pick":"plain string keyword — never an object"}'),
  product_opportunity: async (p) => callClaude("NANA", "Analyze: "+JSON.stringify(p.trends||[])+". Return JSON: {product_title,niche,target_audience,design_brief,estimated_demand,recommended_price_range}"),
  seo_generation: async (p) => callClaude("AISHA", "SEO for "+(p.platform||"etsy")+'. Product:"'+(p.title||"unknown")+'" Keywords:'+(p.keywords||[]).join(",")+". Return JSON:{title,description,tags:string[],materials:string[],search_phrases:string[]}"),
  content_planning: async (p) => callClaude("AISHA", "7-day plan for "+(p.platform||"instagram,tiktok")+". Return JSON:{days:[{day,platform,caption,hashtags,visual_direction,post_time}]}"),
  marketing_campaign: async (p) => callClaude("AMARA", "Campaign for "+(p.product||"House of Jreym")+". Budget:$"+(p.budget||0)+". Platform:"+(p.platform||"etsy")+". Return JSON:{campaign_name,strategy,copy:{headline,body,cta},hashtags,timeline_days}"),
  social_caption: async (p) => callClaude("AMARA", "Write "+(p.count||5)+" captions for "+(p.platform||"instagram")+'. Product:"'+(p.product||"digital art")+'". Return JSON:{captions:[{text,hashtags,best_time_to_post}]}'),
  analytics_report: async (p) => callClaude("SEUN", "Performance "+(p.period||"last 7 days")+": "+JSON.stringify(p.data||{})+". Return JSON:{summary,top_performers,underperformers,revenue_trend,recommendations,alerts}"),
  customer_segmentation: async (p) => callClaude("SEUN", "Segment: "+JSON.stringify(p.customers||[])+". Return JSON:{segments:[{name,criteria,size_estimate,ltv_potential,marketing_approach}]}"),
  inventory_check: async (p) => callClaude("KOFI", "Inventory: "+JSON.stringify(p.inventory||{})+'. Return JSON:{status:"healthy|warning|critical",low_stock:[],overstock:[],actions:[{type,product_id,description,requires_approval}]}'),
  sales_optimization: async (p) => callClaude("KWAME", "Sales: "+JSON.stringify(p.sales||{})+". Return JSON:{conversion_issues,price_recommendations:[{product_id,current_price,suggested_price,reasoning}],listing_improvements,requires_approval}"),
  customer_service_workflow: async (p) => callClaude("FATIMA", 'Handle ('+(p.issue_type||"inquiry")+'):"'+(p.message||"")+'". Return JSON:{response_draft,escalate,action_needed,template_name}'),
  pricing_analysis: async (p) => callClaude("DELE", "Pricing: "+JSON.stringify(p.products||[])+". Return JSON:{recommendations:[{product_id,current_price,optimal_price,confidence,reasoning}],requires_approval:true}"),
  financial_report: async (p) => callClaude("ABENA", "Finance "+(p.period||"this month")+". Return JSON:{gross_revenue,net_profit,margin_pct,top_revenue_sources,alerts,forecast_30d}"),

  generate_etsy_title: async (p) => {
    const kw = extractKeyword(p);
    return callClaude("AMARA", 'Etsy title for:"'+kw+'". Max 140 chars, front-load keyword, end with product type. Return JSON:{"title":"string","confidence":0.9}');
  },
  generate_etsy_description: async (p) => {
    const kw = extractKeyword(p);
    return callClaude("AMARA", 'Etsy description for:"'+kw+'". 650-800 chars, hook, bullets SVG/PNG/PDF, usage tip. Return JSON:{"description":"string","confidence":0.9}');
  },
  generate_etsy_tags: async (p) => {
    const kw = extractKeyword(p);
    return callClaude("AMARA", '13 Etsy tags for:"'+kw+'". Each max 20 chars, no dupes. Return JSON:{"tags":["t1","t2","t3","t4","t5","t6","t7","t8","t9","t10","t11","t12","t13"],"confidence":0.9}');
  },
  generate_social_caption: async (p) => {
    const kw = extractKeyword(p);
    return callClaude("AMARA", 'TikTok/IG caption for:"'+kw+'". Brooklyn luxury. Hook line 1. 3-4 lines. 3-5 hashtags. Return JSON:{"caption":"string","confidence":0.9}');
  },

  generate_digital_file: async (p) => {
    const kw   = extractKeyword(p);
    const tags = Array.isArray(p.tags) ? p.tags : [];
    const svg  = makeSVG(kw, tags);
    const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const name = slug + "-" + Date.now() + ".svg";
    try {
      const { error } = await supabase.storage.from("digital-products")
        .upload(name, Buffer.from(svg, "utf-8"), { contentType: "image/svg+xml", upsert: true });
      if (error) throw new Error(error.message);
      const { data: u } = supabase.storage.from("digital-products").getPublicUrl(name);
      console.log("[executor] SVG → " + u.publicUrl);
      return { file_url: u.publicUrl, file_name: name, file_type: "svg", keyword: kw };
    } catch (uploadErr) {
      console.warn("[executor] Storage failed: " + uploadErr.message);
      await supabase.from("agent_outputs").insert({ agent:"AMARA", output_type:"digital_file_svg", etsy_title:kw, etsy_description:svg.slice(0,5000), confidence:0.5 }).catch(()=>{});
      return { file_url: null, file_name: name, fallback: "svg_in_agent_outputs", keyword: kw };
    }
  },

  publish_etsy_listing: async (p) => {
    let tags = p.tags;
    if (typeof tags === "string") { try { tags = JSON.parse(tags); } catch { tags = []; } }
    if (!Array.isArray(tags)) tags = [];
    const { title, description, price = 4.99, file_url, file_name } = p;
    if (!title || !description) throw new Error("publish_etsy_listing: missing title or description");
    if (!tags.length) throw new Error("publish_etsy_listing: tags empty after normalization");
    if (!ETSY_SHOP_ID) throw new Error("ETSY_SHOP_ID env var not set — add to Render");
    const pub = await selfPost("/api/etsy/publish", { title, description, tags, price, shop_id: ETSY_SHOP_ID });
    const { listing_id, url } = pub;
    console.log("[executor] Listing created: " + listing_id);
    let fr = { skipped: true, reason: "no file_url" };
    if (file_url) {
      try {
        fr = await selfPost("/api/etsy/upload-file", { listing_id, shop_id: ETSY_SHOP_ID, file_url, file_name: file_name || "digital-download.svg" });
        console.log("[executor] File attached to " + listing_id);
      } catch (e) {
        fr = { skipped: true, reason: e.message };
        console.warn("[executor] File upload failed: " + e.message);
      }
    }
    return { published: true, listing_id, url, file_attached: !fr.skipped };
  },
};

export async function executeTask(task) {
  const { id, agent, task_type, payload } = task;
  const handler = TASK_HANDLERS[task_type];
  if (!handler) throw new Error("No handler for task_type: " + task_type);
  await logAgent(agent, "Starting: " + task_type, "info", null, id);
  const result = await handler(payload || {});
  if (task_type === "trend_research" && result?.trends) {
    for (const t of result.trends) {
      await saveTrend({ keyword: t.keyword, category: t.category || payload?.category, score: t.score != null ? parseFloat(t.score) : 50, source: "nana_ai", data: t });
    }
  }
  await saveDecision({ agent, decision_type: task_type, reasoning: JSON.stringify(result).slice(0,200), data: result, approved: result?.requires_approval ? null : true });
  await logAgent(agent, "Completed: " + task_type, "success", result, id);
  return result;
}

export { TASK_HANDLERS };