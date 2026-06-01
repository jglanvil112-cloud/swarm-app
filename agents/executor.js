// agents/executor.js — Claude-powered agent task runner
import Anthropic from "@anthropic-ai/sdk";
import { logAgent, saveDecision, saveTrend } from "../lib/supabase.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_PROMPTS = {
  NANA:   "You are NANA, Trend Scout for House of Jreym (POD/digital goods). Find trending product opportunities. Return structured JSON only.",
  KOFI:   "You are KOFI, Supply Chain Monitor. Track inventory, flag low stock, identify supply risks. Return structured JSON only.",
  AMARA:  "You are AMARA, Marketing Strategist. Create campaigns, launches, social content. Return structured JSON only.",
  KWAME:  "You are KWAME, Sales Optimizer. Analyze sales, suggest pricing, improve conversions. Return structured JSON only.",
  FATIMA: "You are FATIMA, Customer Service Manager. Create workflows, handle inquiries. Return structured JSON only.",
  SEUN:   "You are SEUN, Analytics & Forecasting. Analyze performance, create forecasts. Return structured JSON only.",
  AISHA:  "You are AISHA, SEO Strategist. Generate SEO titles, descriptions, tags for Etsy/Shopify. Return structured JSON only.",
  IBRAHIM:"You are IBRAHM, Social Media Manager. Create captions, content calendars. Return structured JSON only.",
  ZARA:   "You are ZARA, Inventory Manager. Monitor stock, coordinate Printify, flag restocks. Return structured JSON only.",
  DELE:   "You are DELE, Pricing Strategist. Optimize pricing based on competition and demand. Return structured JSON only.",
  IMANI:  "You are IMANI, Paid Ads Manager. Plan campaigns, optimize ROAS. Flag spend >$50 for approval. Return structured JSON only.",
  ABENA:  "You are ABENA, Finance Tracker. Track revenue, expenses, margins. Return structured JSON only.",
};

const TASK_HANDLERS = {
  trend_research: async (p) => callClaude("NANA",
    `Research trending POD opportunities for ${p.category || "lifestyle"}. Return JSON: { trends: [{ keyword, category, score, opportunity, tags, why_now }], top_pick }`),

  product_opportunity: async (p) => callClaude("NANA",
    `Analyze trend data and identify best product: ${JSON.stringify(p.trends || [])}. Return JSON: { product_title, niche, target_audience, design_brief, estimated_demand, recommended_price_range }`),

  seo_generation: async (p) => callClaude("AISHA",
    `Generate SEO for ${p.platform || "etsy"} - Product: ${p.title || "unknown"}. Keywords: ${(p.keywords||[]).join(", ")}. Return JSON: { title, description, tags: string[], materials: string[], search_phrases: string[] }`),

  content_planning: async (p) => callClaude("AISHA",
    `Create 7-day content plan for ${p.platform || "instagram,tiktok"}. Return JSON: { days: [{ day, platform, caption, hashtags, visual_direction, post_time }] }`),

  marketing_campaign: async (p) => callClaude("AMARA",
    `Create marketing campaign for ${p.product || "House of Jreym"}. Budget: $${p.budget || 0}. Platform: ${p.platform || "etsy"}. Return JSON: { campaign_name, strategy, copy: { headline, body, cta }, hashtags, timeline_days }`),

  social_caption: async (p) => callClaude("AMARA",
    `Write ${p.count || 5} captions for ${p.platform || "instagram"} - Product: ${p.product}. Return JSON: { captions: [{ text, hashtags, best_time_to_post }] }`),

  analytics_report: async (p) => callClaude("SEUN",
    `Analyze store performance for ${p.period || "last 7 days"}: ${JSON.stringify(p.data || {})}. Return JSON: { summary, top_performers, underperformers, revenue_trend, recommendations, alerts }`),

  customer_segmentation: async (p) => callClaude("SEUN",
    `Segment customers: ${JSON.stringify(p.customers || [])}. Return JSON: { segments: [{ name, criteria, size_estimate, ltv_potential, marketing_approach }] }`),

  inventory_check: async (p) => callClaude("KOFI",
    `Review inventory: ${JSON.stringify(p.inventory || {})}. Return JSON: { status: "healthy|warning|critical", low_stock: [], overstock: [], actions: [{ type, product_id, description, requires_approval }] }`),

  sales_optimization: async (p) => callClaude("KWAME",
    `Analyze sales and suggest improvements: ${JSON.stringify(p.sales || {})}. Return JSON: { conversion_issues, price_recommendations: [{ product_id, current_price, suggested_price, reasoning }], listing_improvements, requires_approval }`),

  customer_service_workflow: async (p) => callClaude("FATIMA",
    `Handle customer issue (${p.issue_type || "inquiry"}): "${p.message || ""}". Return JSON: { response_draft, escalate, action_needed, template_name }`),

  pricing_analysis: async (p) => callClaude("DELE",
    `Analyze pricing for ${JSON.stringify(p.products || [])}. Return JSON: { recommendations: [{ product_id, current_price, optimal_price, confidence, reasoning }], requires_approval: true }`),

  financial_report: async (p) => callClaude("ABENA",
    `Financial summary for ${p.period || "this month"}. Return JSON: { gross_revenue, net_profit, margin_pct, top_revenue_sources, alerts, forecast_30d }`),
};

async function callClaude(agent, prompt) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: (AGENT_PROMPTS[agent] || AGENT_PROMPTS.NANA) + "\n\nReturn ONLY valid JSON. No markdown.",
    messages: [{ role: "user", content: prompt }],
  });
  const raw = response.content[0].text.trim()
    .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { raw_response: raw, parse_error: true };
  }
}

export async function executeTask(task) {
  const { id, agent, task_type, payload } = task;
  const handler = TASK_HANDLERS[task_type];
  if (!handler) throw new Error(`No handler for task_type: ${task_type}`);

  await logAgent(agent, `Starting: ${task_type}`, "info", null, id);
  const result = await handler(payload || {});

  if (task_type === "trend_research" && result?.trends) {
    for (const t of result.trends) {
      await saveTrend({ keyword: t.keyword, category: t.category || payload?.category, score: t.score != null ? parseFloat(t.score) : 50, source: "nana_ai", data: t });
    }
  }

  await saveDecision({ agent, decision_type: task_type, reasoning: JSON.stringify(result).slice(0, 200), data: result, approved: result?.requires_approval ? null : true });
  await logAgent(agent, `Completed: ${task_type}`, "success", result, id);
  return result;
}

export { TASK_HANDLERS };
