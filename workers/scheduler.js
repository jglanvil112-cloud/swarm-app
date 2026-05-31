// workers/scheduler.js — Autonomous 24/7 SWARM OS Worker
import cron from "node-cron";
import { enqueueTask, claimNextTask, updateTaskStatus, updateSchedulerState, logAgent, recordHealth, supabase } from "../lib/supabase.js";
import { executeTask } from "../agents/executor.js";

const WORKER_ID = `worker-${process.env.RENDER_INSTANCE_ID || "local"}-${Date.now()}`;
console.log(`SWARM OS Scheduler starting — ${WORKER_ID}`);

async function processAgentQueue(agent) {
  try {
    const task = await claimNextTask(agent);
    if (!task) return;
    console.log(`[${agent}] Claimed: ${task.task_type} (${task.id})`);
    try {
      const result = await executeTask(task);
      if (result?.requires_approval) {
        await updateTaskStatus(task.id, "awaiting_approval", result);
        await logAgent(agent, `Awaiting approval: ${task.task_type}`, "warn", result, task.id);
      } else {
        await updateTaskStatus(task.id, "completed", result);
        await enqueueFollowUps(task, result);
      }
    } catch (err) {
      await updateTaskStatus(task.id, "failed", null, err.message);
      await logAgent(agent, `Failed: ${err.message}`, "error", null, task.id);
    }
  } catch (err) { console.error(`[${agent}] Queue error:`, err.message); }
}

async function enqueueFollowUps(completedTask, result) {
  const { task_type } = completedTask;
  if (task_type === "trend_research" && result?.top_pick) {
    await enqueueTask({ agent: "AISHA", task_type: "seo_generation", payload: { title: result.top_pick, keywords: result.trends?.map(t => t.keyword) || [], platform: "etsy" }, priority: 3, parentTaskId: completedTask.id });
  }
  if (task_type === "seo_generation" && result?.title) {
    await enqueueTask({ agent: "AMARA", task_type: "social_caption", payload: { product: result.title, platform: "instagram", count: 3 }, priority: 4, parentTaskId: completedTask.id });
  }
  if (task_type === "analytics_report" && result?.underperformers?.length > 0) {
    await enqueueTask({ agent: "KWAME", task_type: "sales_optimization", payload: { sales: result }, priority: 4, parentTaskId: completedTask.id });
  }
  if (task_type === "inventory_check" && result?.status === "critical") {
    await enqueueTask({ agent: "ZARA", task_type: "inventory_check", payload: { low_stock: result.low_stock, context: "critical_alert" }, priority: 1, parentTaskId: completedTask.id });
  }
}

async function runHourlyTrendScan() {
  const categories = ["wall art","digital prints","home decor","affirmation prints","black art"];
  for (const category of categories) await enqueueTask({ agent: "NANA", task_type: "trend_research", payload: { category }, priority: 3 });
  await updateSchedulerState("hourly_trend_scan", "ok");
}
async function runHourlyInventoryCheck() { await enqueueTask({ agent: "KOFI", task_type: "inventory_check", payload: {}, priority: 2 }); await updateSchedulerState("hourly_inventory_check", "ok"); }
async function runHourlyOrderMonitor() { await enqueueTask({ agent: "SEUN", task_type: "analytics_report", payload: { period: "last_hour" }, priority: 2 }); await updateSchedulerState("hourly_order_monitor", "ok"); }
async function runDailySEO() {
  const { data: trends } = await supabase.from("trends").select("*").order("score", { ascending: false }).limit(5);
  if (trends?.length) for (const t of trends) await enqueueTask({ agent: "AISHA", task_type: "seo_generation", payload: { title: t.keyword, keywords: [t.keyword], platform: "etsy" }, priority: 4 });
  await updateSchedulerState("daily_seo_generation", "ok");
}
async function runDailyAnalytics() {
  await enqueueTask({ agent: "SEUN", task_type: "analytics_report", payload: { period: "last_24_hours" }, priority: 3 });
  await enqueueTask({ agent: "ABENA", task_type: "financial_report", payload: { period: "today" }, priority: 4 });
  await updateSchedulerState("daily_analytics_report", "ok");
}
async function runWeeklyCampaign() { await enqueueTask({ agent: "AMARA", task_type: "marketing_campaign", payload: { goal: "weekly_review" }, priority: 5 }); await updateSchedulerState("weekly_campaign_review", "ok"); }
async function runWeeklyAudit() {
  await enqueueTask({ agent: "KWAME", task_type: "sales_optimization", payload: { context: "weekly_audit" }, priority: 5 });
  await enqueueTask({ agent: "DELE", task_type: "pricing_analysis", payload: { context: "weekly_review" }, priority: 5 });
  await updateSchedulerState("weekly_product_audit", "ok");
}
async function runHealthCheck() {
  for (const svc of ["anthropic","supabase","shopify","etsy"]) {
    try {
      const start = Date.now();
      const r = await fetch(`https://swarm-app-3nch.onrender.com/api/health/${svc}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      await recordHealth(svc, d.status === "ok" ? "ok" : "fail", Date.now()-start, d);
    } catch (e) { await recordHealth(svc, "fail", null, { error: e.message }); }
  }
}

const AGENTS = ["NANA","KOFI","AMARA","KWAME","FATIMA","SEUN","AISHA","IBRAHIM","ZARA","DELE","IMANI","ABENA"];
async function runWorkerLoop() { for (const agent of AGENTS) await processAgentQueue(agent); }

// Worker loop — every 30 seconds
cron.schedule("*/30 * * * * *", runWorkerLoop);
// Hourly
cron.schedule("0 * * * *",  runHourlyTrendScan);
cron.schedule("5 * * * *",  runHourlyInventoryCheck);
cron.schedule("10 * * * *", runHourlyOrderMonitor);
// Daily 6am UTC
cron.schedule("0 6 * * *",  runDailySEO);
cron.schedule("15 6 * * *", runDailyAnalytics);
// Weekly Monday 7am UTC
cron.schedule("0 7 * * 1",  runWeeklyCampaign);
cron.schedule("30 7 * * 1", runWeeklyAudit);
// Health every 15 min
cron.schedule("*/15 * * * *", runHealthCheck);

// Seed on startup
(async () => { try { await runHourlyTrendScan(); await runDailyAnalytics(); console.log("SWARM OS: Initial tasks seeded"); } catch(e) { console.error("Seed error:", e.message); } })();
console.log("SWARM OS: All cron jobs registered");
