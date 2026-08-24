// workers/scheduler.js — House of Jreym controlled automation scheduler
import cron from "node-cron";
import {
  enqueueTask,
  claimNextTask,
  updateTaskStatus,
  updateSchedulerState,
  logAgent,
  recordHealth,
  saveAgentOutput,
  supabase,
} from "../lib/supabase.js";
import { executeTask, publishNextListing } from "../agents/executor.js";
import { drainPublishQueue } from "../agents/publisher.js";
import { getEtsyToken } from "../lib/etsyDraft.js";
import {
  runAutoPublish,
  takeFollowerSnapshot,
  generateCEOReport,
  generateAndSchedulePosts,
  nextDaytimeSlot,
} from "../routes/ibrahim.js";
import {
  backfillNextListingFiles,
  assignNextSections,
  createQueuedBundles,
  runShopRolloutTick,
  syncEtsyRevenue,
  reseoTop20Tick,
  generateMissingFormats,
  archiveTextOnlyTick,
} from "../routes/etsy.js";
import { runPodGen, bulkTrendDrop } from "../routes/podgen.js";

const APP_VERSION = process.env.APP_VERSION || "6.0.0";
const BASE_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://swarm-app-3nch.onrender.com";
const WORKER_ID = `worker-${process.env.RENDER_INSTANCE_ID || "local"}-${Date.now()}`;
const MAX_RETRIES = Math.max(0, Number(process.env.TASK_MAX_RETRIES) || 3);
const AUTONOMOUS_PRODUCT_DROPS = process.env.AUTONOMOUS_PRODUCT_DROPS === "true";

console.log(`SWARM OS ${APP_VERSION} — ${WORKER_ID}`);

function extractTopPick(result) {
  const raw = result?.top_pick;
  if (!raw) return null;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "object") {
    const value = raw.keyword ?? raw.top_pick ?? raw.title ?? raw.name ?? "";
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function retryCount(task) {
  return Number(task?.result?._retry_count) || 0;
}

async function processAgentQueue(agent) {
  try {
    const task = await claimNextTask(agent);
    if (!task) return;
    console.log(`[${agent}] Claimed ${task.task_type} (${task.id})`);

    try {
      const result = await executeTask(task);
      if (result?.requires_approval) {
        await updateTaskStatus(task.id, "awaiting_approval", result);
        await logAgent(agent, `Awaiting approval: ${task.task_type}`, "warn", result, task.id);
      } else {
        await updateTaskStatus(task.id, "completed", result);
        await enqueueFollowUps(task, result);
      }
    } catch (error) {
      const result = { ...(task.result || {}), _retry_count: retryCount(task), last_error: error.message };
      await updateTaskStatus(task.id, "failed", result, error.message);
      await logAgent(agent, `Failed: ${error.message}`, "error", null, task.id);
    }
  } catch (error) {
    console.error(`[${agent}] queue error:`, error.message);
  }
}

async function retryFailedTasks() {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: failed, error } = await supabase
      .from("tasks")
      .select("id,result,error,priority,updated_at")
      .eq("status", "failed")
      .lt("updated_at", cutoff)
      .lt("priority", 9)
      .limit(50);
    if (error) throw error;
    if (!failed?.length) return;

    let requeued = 0;
    let exhausted = 0;
    for (const task of failed) {
      const nextRetry = retryCount(task) + 1;
      if (nextRetry > MAX_RETRIES) {
        exhausted++;
        continue;
      }
      const delayMinutes = [2, 10, 30][Math.min(nextRetry - 1, 2)];
      const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
      await supabase
        .from("tasks")
        .update({
          status: "pending",
          error: null,
          started_at: null,
          completed_at: null,
          scheduled_for: scheduledFor,
          result: { ...(task.result || {}), _retry_count: nextRetry },
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("status", "failed");
      requeued++;
    }
    if (requeued || exhausted) console.log(`[RETRY] requeued ${requeued}; exhausted ${exhausted}`);
  } catch (error) {
    console.error("[RETRY]", error.message);
  }
}

async function getSiblingOutputs(parentId, types) {
  if (!parentId) return {};
  const { data: siblings } = await supabase
    .from("tasks")
    .select("id,task_type")
    .eq("parent_task_id", parentId)
    .in("task_type", types);
  if (!siblings?.length) return {};

  const { data: outputs } = await supabase
    .from("agent_outputs")
    .select("output_type,etsy_title,etsy_description,etsy_tags,data")
    .in("task_id", siblings.map((task) => task.id));
  const map = {};
  for (const output of outputs || []) map[output.output_type] = output;
  return map;
}

async function enqueueFollowUps(completedTask, result) {
  const { task_type, id: taskId, parent_task_id: parentId } = completedTask;

  if (task_type === "trend_research" && result?.top_pick) {
    const keyword = extractTopPick(result);
    if (!keyword) return;
    await enqueueTask({ agent: "AISHA", task_type: "seo_generation", payload: { keyword, title: keyword }, priority: 3, parentTaskId: taskId });
    await enqueueTask({ agent: "AMARA", task_type: "generate_etsy_title", payload: { keyword }, priority: 3, parentTaskId: taskId });
    await enqueueTask({ agent: "AMARA", task_type: "generate_etsy_description", payload: { keyword }, priority: 3, parentTaskId: taskId });
    await enqueueTask({ agent: "AMARA", task_type: "generate_etsy_tags", payload: { keyword }, priority: 3, parentTaskId: taskId });
    await enqueueTask({ agent: "AMARA", task_type: "generate_social_caption", payload: { keyword }, priority: 4, parentTaskId: taskId });
  }

  if (task_type === "generate_etsy_tags" && result?.tags) {
    if (!parentId) return;
    const siblings = await getSiblingOutputs(parentId, ["etsy_title", "etsy_description"]);
    const title = siblings.etsy_title?.etsy_title;
    const description = siblings.etsy_description?.etsy_description;
    if (!title || !description) return;

    await enqueueTask({
      agent: "AMARA",
      task_type: "generate_digital_file",
      payload: { keyword: title, title, description, tags: result.tags },
      priority: 2,
      parentTaskId: parentId,
    });
  }

  if (task_type === "generate_digital_file") {
    if (!parentId) return;
    const siblings = await getSiblingOutputs(parentId, ["etsy_title", "etsy_description", "etsy_tags"]);
    const title = siblings.etsy_title?.etsy_title;
    const description = siblings.etsy_description?.etsy_description;
    const tags = siblings.etsy_tags?.etsy_tags;
    if (!title || !description || !tags) return;

    await enqueueTask({
      agent: "AISHA",
      task_type: "publish_etsy_listing",
      payload: {
        title,
        description,
        tags,
        file_url: result.file_url || null,
        file_name: result.file_name || "digital-download.svg",
      },
      priority: 1,
      parentTaskId: parentId,
    });
  }

  if (task_type === "publish_etsy_listing" && result?.queued_for_approval) {
    await logAgent(
      "AISHA",
      `STAGED: Etsy draft #${result.listing_id} queued for approval`,
      result.file_attached ? "success" : "warn",
      result,
      taskId,
    );
    await saveAgentOutput({
      taskId,
      agent: "AISHA",
      outputType: "etsy_listing_staged",
      etsyTitle: result.title,
      confidence: result.quality_score ? result.quality_score / 100 : 0.7,
      data: result,
    });
  }

  if (task_type === "seo_generation" && result?.title) {
    await enqueueTask({
      agent: "AMARA",
      task_type: "social_caption",
      payload: { product: result.title, keyword: result.title, platform: "instagram" },
      priority: 4,
      parentTaskId: taskId,
    });
  }

  if (task_type === "analytics_report" && result?.underperformers?.length) {
    await enqueueTask({
      agent: "KWAME",
      task_type: "sales_optimization",
      payload: { sales: result },
      priority: 4,
    });
  }
}

const NICHE_POOL = [
  "black wall art",
  "afrocentric decor",
  "black love art",
  "black surfer art",
  "affirmation prints",
  "minimalist line art",
  "abstract art prints",
  "botanical prints",
  "celestial art",
  "modern gallery wall",
  "heritage wall art",
  "wellness wall art",
];

async function runTrendScan() {
  const hour = new Date().getUTCHours();
  const start = (hour * 3) % NICHE_POOL.length;
  const categories = [...NICHE_POOL.slice(start), ...NICHE_POOL.slice(0, start)].slice(0, 5);
  for (const category of categories) {
    await enqueueTask({ agent: "NANA", task_type: "trend_research", payload: { category }, priority: 3 });
  }
  await updateSchedulerState("hourly_trend_scan", "ok");
}

async function runInventoryCheck() {
  await enqueueTask({ agent: "KOFI", task_type: "inventory_check", payload: {}, priority: 2 });
  await updateSchedulerState("hourly_inventory_check", "ok");
}

async function runOrderMonitor() {
  await syncEtsyRevenue().catch(() => {});
  await enqueueTask({ agent: "SEUN", task_type: "analytics_report", payload: { period: "last_hour" }, priority: 2 });
  await updateSchedulerState("hourly_order_monitor", "ok");
}

async function runDailySEO() {
  const { data: trends } = await supabase.from("trends").select("*").order("score", { ascending: false }).limit(5);
  for (const trend of trends || []) {
    await enqueueTask({ agent: "AISHA", task_type: "seo_generation", payload: { keyword: trend.keyword, title: trend.keyword }, priority: 4 });
  }
  await updateSchedulerState("daily_seo_generation", "ok");
}

async function runDailyAnalytics() {
  await enqueueTask({ agent: "SEUN", task_type: "analytics_report", payload: { period: "last_24_hours" }, priority: 3 });
  await enqueueTask({ agent: "ABENA", task_type: "financial_report", payload: { period: "today" }, priority: 4 });
  await updateSchedulerState("daily_analytics_report", "ok");
}

async function runWeeklyReview() {
  await enqueueTask({ agent: "AMARA", task_type: "marketing_campaign", payload: { goal: "weekly_review" }, priority: 5 });
  await enqueueTask({ agent: "KWAME", task_type: "sales_optimization", payload: { context: "weekly_audit" }, priority: 5 });
  await enqueueTask({ agent: "DELE", task_type: "pricing_analysis", payload: { context: "weekly_review" }, priority: 5 });
  await updateSchedulerState("weekly_product_audit", "ok");
}

async function runHealthCheck() {
  for (const service of ["anthropic", "supabase", "shopify", "etsy"]) {
    try {
      const started = Date.now();
      const response = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/health/${service}`, { signal: AbortSignal.timeout(8000) });
      const data = await response.json().catch(() => ({}));
      await recordHealth(service, data.status === "ok" ? "ok" : "fail", Date.now() - started, data);
    } catch (error) {
      await recordHealth(service, "fail", null, { error: error.message });
    }
  }
  try { await getEtsyToken(); }
  catch (error) { console.warn("[healthCheck] Etsy token refresh/check failed:", error.message); }
}

const AGENTS = ["NANA", "KOFI", "AMARA", "KWAME", "FATIMA", "SEUN", "AISHA", "IBRAHIM", "ZARA", "DELE", "IMANI", "ABENA"];
async function runWorkerLoop() {
  for (const agent of AGENTS) await processAgentQueue(agent);
}

cron.schedule("*/30 * * * * *", runWorkerLoop);
cron.schedule("*/5 * * * *", retryFailedTasks);
cron.schedule("*/10 * * * *", async () => {
  const result = await publishNextListing().catch(() => ({ queued: 0 }));
  if (result.queued) console.log(`[STAGE-QUEUE] ${result.queued} Etsy listing task(s) queued`);
});
cron.schedule("0 */4 * * *", runTrendScan);
cron.schedule("5 * * * *", runInventoryCheck);
cron.schedule("10 * * * *", runOrderMonitor);
cron.schedule("0 6 * * *", runDailySEO);
cron.schedule("15 6 * * *", runDailyAnalytics);
cron.schedule("0 7 * * 1", runWeeklyReview);
cron.schedule("*/15 * * * *", runHealthCheck);
cron.schedule("*/8 * * * *", async () => {
  try { await reseoTop20Tick(3); } catch {}
});

// Human-approved Etsy drafts are the only listings this worker activates.
cron.schedule("*/5 * * * *", async () => {
  try {
    const result = await drainPublishQueue(5);
    if (result.processed) console.log(`[KWAME] Published ${result.processed} approved Etsy listing(s)`);
  } catch (error) {
    console.error("[KWAME]", error.message);
  }
});

// Etsy maintenance jobs remain throttled to protect API quota.
cron.schedule("4-59/10 * * * *", async () => {
  try { await archiveTextOnlyTick(12); } catch {}
});
cron.schedule("*/12 * * * *", () => { backfillNextListingFiles(5).catch(() => {}); });
cron.schedule("*/14 * * * *", () => { assignNextSections(5).catch(() => {}); });
cron.schedule("*/20 * * * *", () => { createQueuedBundles().catch(() => {}); });
cron.schedule("*/7 * * * *", () => { runShopRolloutTick().catch(() => {}); });
cron.schedule("*/8 * * * *", () => { generateMissingFormats().catch(() => {}); });

// Social publishing uses its own approval state and platform controls.
cron.schedule("*/5 * * * *", async () => {
  try { await runAutoPublish(); } catch (error) { console.error("[IBRAHIM auto-publish]", error.message); }
});
cron.schedule("0 */6 * * *", async () => {
  try {
    const { count } = await supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("platform", "instagram")
      .eq("status", "scheduled");
    if ((count || 0) < 6) await generateAndSchedulePosts(10);
  } catch (error) {
    console.error("[IBRAHIM refill]", error.message);
  }
});
cron.schedule("0 6 * * *", () => { takeFollowerSnapshot().catch(() => {}); });
cron.schedule("0 7 * * *", () => { generateCEOReport().catch(() => {}); });

// Reclaim workers that die mid-task. Max three reclaims, then stop.
cron.schedule("*/10 * * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from("tasks")
      .select("id,result")
      .eq("status", "running")
      .lt("started_at", cutoff)
      .limit(50);
    for (const task of stuck || []) {
      const reclaims = Number(task.result?._reclaims || 0) + 1;
      if (reclaims > 3) {
        await supabase.from("tasks").update({
          status: "failed",
          error: `stale: reclaimed ${reclaims - 1}x without completing`,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          result: { ...(task.result || {}), _reclaims: reclaims - 1 },
        }).eq("id", task.id);
      } else {
        await supabase.from("tasks").update({
          status: "pending",
          started_at: null,
          completed_at: null,
          result: { ...(task.result || {}), _reclaims: reclaims },
          updated_at: new Date().toISOString(),
        }).eq("id", task.id);
      }
    }
  } catch (error) {
    console.error("[RECLAIMER]", error.message);
  }
});

// One-time reslot of legacy scheduled social posts onto daytime slots.
(async () => {
  try {
    const { data: gate } = await supabase
      .from("scheduler_state")
      .select("run_count")
      .eq("job_name", "reslot_posts_v1")
      .limit(1);
    if (gate?.length) return;
    await updateSchedulerState("reslot_posts_v1", "started");
    const { data: rows } = await supabase
      .from("social_posts")
      .select("id,scheduled_for")
      .eq("status", "scheduled")
      .order("scheduled_for", { ascending: true });
    let cursor = new Date();
    for (const row of rows || []) {
      const slot = nextDaytimeSlot(cursor);
      await supabase.from("social_posts").update({ scheduled_for: slot.toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
      cursor = slot;
    }
    await updateSchedulerState("reslot_posts_v1", "ok");
  } catch (error) {
    console.error("[RESLOT]", error.message);
  }
})();

// Autonomous product creation is opt-in. Normal Etsy publication still requires
// the human approval queue even when upstream design generation is enabled.
const PODGEN_FLAVORS = {
  1: "New Year renewal",
  2: "Black History Month tribute",
  3: "spring awakening",
  6: "Juneteenth heritage",
  7: "summer block party",
  9: "harvest gratitude",
  10: "Afro-gothic autumn",
  11: "Thanksgiving legacy",
  12: "Kwanzaa celebration",
};
const PODGEN_FALLBACK = ["Sankofa Wisdom", "Melanin Queen", "Ancestral Power", "Diaspora Roots", "Kente Heritage", "Black Love", "Golden Heritage", "Afro Muse"];

async function runPodgenTrendDrop(slot) {
  if (!AUTONOMOUS_PRODUCT_DROPS) return;
  try {
    const { data } = await supabase
      .from("tasks")
      .select("result")
      .eq("task_type", "trend_research")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(1);
    const pick = extractTopPick(data?.[0]?.result || {});
    const fallback = PODGEN_FALLBACK[(Math.floor(Date.now() / 86400000) + slot) % PODGEN_FALLBACK.length];
    const flavor = PODGEN_FLAVORS[new Date().getUTCMonth() + 1] || "culture edition";
    let result = await runPodGen({ theme: `deep symbolic ${pick || fallback} — unique ${flavor} edition`, style: "art" });
    if (result?.reason === "theme tripped IP blocklist") {
      result = await runPodGen({ theme: `deep symbolic ${fallback} — unique ${flavor} edition`, style: "art" });
    }
    console.log(`[PODGEN] slot ${slot}: ${result?.status || result?.reason || "done"}`);
  } catch (error) {
    console.error("[PODGEN]", error.message);
  }
}

cron.schedule("0 5 * * *", () => runPodgenTrendDrop(0));
cron.schedule("0 9 * * *", () => runPodgenTrendDrop(1));
cron.schedule("0 12 * * *", () => runPodgenTrendDrop(2));

// Legacy 24-product drop is also opt-in and remains one-shot.
(async () => {
  if (!AUTONOMOUS_PRODUCT_DROPS) return;
  try {
    const { data: gate } = await supabase
      .from("scheduler_state")
      .select("run_count")
      .eq("job_name", "trend_drop_24b_0720")
      .limit(1);
    if (gate?.length) return;
    await updateSchedulerState("trend_drop_24b_0720", "started");
    setTimeout(async () => {
      try {
        const result = await bulkTrendDrop({ count: 24 });
        await updateSchedulerState("trend_drop_24b_0720", result?.made ? "ok" : "no_products");
      } catch (error) {
        await updateSchedulerState("trend_drop_24b_0720", "failed");
        console.error("[TREND-DROP-24]", error.message);
      }
    }, 90_000);
  } catch (error) {
    console.error("[TREND-DROP-24 seed]", error.message);
  }
})();

// Seed only operational analytics/trend work, never live listings.
(async () => {
  try {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .gt("created_at", since);
    if ((count || 0) < 3) {
      await runTrendScan();
      await runDailyAnalytics();
    }
  } catch (error) {
    console.error("[SEED]", error.message);
  }
})();

console.log(`SWARM OS ${APP_VERSION}: controlled cron jobs registered`);
