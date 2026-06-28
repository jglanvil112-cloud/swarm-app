// lib/taskReclaimer.js — SWARM OS
// Fixes "zombie" tasks: rows stuck in status='running' because a worker claimed
// them (claim_next_task → running, sets started_at) and then died/restarted
// without ever calling updateTaskStatus(). With no lease expiry these sit in
// 'running' forever, inflating the running count and (if concurrency is capped
// by running count) throttling the queue.
//
// Lease-expiry policy:
//   • running + started_at between 6h and 30m ago  → back to 'pending' (retry;
//     likely a transient worker death worth re-running)
//   • running + started_at older than 6h           → 'failed' / dead-letter
//     (clearly abandoned; do NOT resurrect — avoids re-running ancient work and
//     any downstream cascade). Operator can manually requeue if desired.
//
// Self-registers a cron (every 10 min) and runs once ~20s after boot to clear
// any backlog on deploy. Import for side effects from server.js:
//     import "./lib/taskReclaimer.js";

import cron from "node-cron";
import { supabase, logAgent } from "./supabase.js";

const RETRY_AFTER_MIN = Number(process.env.RECLAIM_RETRY_AFTER_MIN || 30);
const DEADLETTER_AFTER_HOURS = Number(process.env.RECLAIM_DEADLETTER_AFTER_HOURS || 6);

export async function reclaimStaleTasks({ dry = false } = {}) {
  const now = Date.now();
  const retryCutoff = new Date(now - RETRY_AFTER_MIN * 60 * 1000).toISOString();
  const deadCutoff = new Date(now - DEADLETTER_AFTER_HOURS * 60 * 60 * 1000).toISOString();
  const ts = new Date().toISOString();

  const summary = { dry, dead_lettered: 0, requeued: 0, errors: [] };

  try {
    // 1) Dead-letter ancient zombies first (running, started_at older than 6h).
    //    Doing this first removes them from 'running' so step 2 only touches the
    //    30m–6h band.
    if (dry) {
      const { data } = await supabase.from("tasks")
        .select("id").eq("status", "running").lt("started_at", deadCutoff);
      summary.dead_lettered = (data || []).length;
    } else {
      const { data, error } = await supabase.from("tasks")
        .update({ status: "failed", error: `reclaimer: dead-lettered (stuck running > ${DEADLETTER_AFTER_HOURS}h)`, updated_at: ts })
        .eq("status", "running").lt("started_at", deadCutoff)
        .select("id");
      if (error) summary.errors.push("deadletter: " + error.message);
      else summary.dead_lettered = (data || []).length;
    }

    // 2) Requeue the rest that are merely stale (running, started_at older than 30m).
    //    After step 1, remaining 'running' rows all started within the last 6h.
    if (dry) {
      const { data } = await supabase.from("tasks")
        .select("id").eq("status", "running").lt("started_at", retryCutoff);
      summary.requeued = (data || []).length;
    } else {
      const { data, error } = await supabase.from("tasks")
        .update({ status: "pending", started_at: null, error: null, updated_at: ts })
        .eq("status", "running").lt("started_at", retryCutoff)
        .select("id");
      if (error) summary.errors.push("requeue: " + error.message);
      else summary.requeued = (data || []).length;
    }

    const touched = summary.dead_lettered + summary.requeued;
    if (touched > 0 && !dry) {
      await logAgent("RECLAIMER",
        `♻️ Reclaimed ${touched} stale task(s): ${summary.requeued} requeued, ${summary.dead_lettered} dead-lettered`,
        summary.errors.length ? "warn" : "info");
    }
  } catch (e) {
    summary.errors.push("fatal: " + e.message);
    try { await logAgent("RECLAIMER", "Reclaimer error: " + e.message, "error"); } catch (_) {}
  }
  return summary;
}

// Cron: every 10 minutes.
cron.schedule("*/10 * * * *", () => {
  reclaimStaleTasks().catch(e => console.log("[reclaimer] cron error:", e.message));
});

// One-shot on boot (after a short delay so the DB/client are ready) to clear any
// backlog accumulated while this was offline.
setTimeout(() => {
  reclaimStaleTasks()
    .then(s => console.log("[reclaimer] boot run:", JSON.stringify(s)))
    .catch(e => console.log("[reclaimer] boot error:", e.message));
}, 20 * 1000);

console.log(`[reclaimer] armed — requeue>${RETRY_AFTER_MIN}m, dead-letter>${DEADLETTER_AFTER_HOURS}h, cron */10m`);
