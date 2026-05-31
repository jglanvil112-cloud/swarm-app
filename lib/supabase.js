import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
if (typeof globalThis.WebSocket === "undefined") { globalThis.WebSocket = WebSocket; }

// Use SUPABASE_SERVICE_KEY (JWT stored in Render) — bypasses RLS for workers
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPERBASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) console.error("SUPABASE_URL or SUPABASE_KEY not set!");
else console.log("Supabase init: url=" + SUPABASE_URL.slice(-20) + " keyLen=" + SUPABASE_KEY.length);

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function enqueueTask({ agent, task_type, payload = {}, priority = 5, scheduledFor = null, parentTaskId = null }) {
  const { data, error } = await supabase.from("tasks").insert({
    agent, task_type, payload, priority, status: "pending",
    scheduled_for: scheduledFor || new Date().toISOString(),
    parent_task_id: parentTaskId || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function claimNextTask(agent) {
  const { data, error } = await supabase.rpc("claim_next_task", { p_agent: agent });
  if (error) { console.error("claimNextTask error:", error.message); return null; }
  return data;
}

export async function updateTaskStatus(taskId, status, result = null, error = null) {
  const update = {
    status, updated_at: new Date().toISOString(),
    ...(status === "running" ? { started_at: new Date().toISOString() } : {}),
    ...(["completed","failed","awaiting_approval"].includes(status) ? { completed_at: new Date().toISOString() } : {}),
    ...(result ? { result } : {}),
    ...(error  ? { error  } : {}),
  };
  const { data } = await supabase.from("tasks").update(update).eq("id", taskId).select().single();
  return data;
}

export async function logAgent(agent, message, level = "info", data = null, taskId = null) {
  const { error } = await supabase.from("agent_logs").insert({ agent, message, level, data: data || null, task_id: taskId || null });
  if (error) console.error("logAgent error:", error.message);
}

export async function saveTrend({ keyword, category, score, source, data }) {
  const { error } = await supabase.from("trends").upsert(
    { keyword, category, score, source, data, detected_at: new Date().toISOString() },
    { onConflict: "keyword" }
  );
  if (error) console.error("saveTrend error:", error.message);
}

export async function saveDecision({ agent, decision_type, reasoning, data, approved = null }) {
  const { error } = await supabase.from("agent_decisions").insert({ agent, decision_type, reasoning, data, approved });
  if (error) console.error("saveDecision error:", error.message);
}

export async function updateSchedulerState(jobName, status = "ok") {
  const { error } = await supabase.from("scheduler_state").upsert(
    { job_name: jobName, last_run: new Date().toISOString(), last_status: status },
    { onConflict: "job_name" }
  );
  if (error) console.error("schedulerState error:", error.message);
}

export async function recordHealth(service, status, latencyMs = null, detail = null) {
  const { error } = await supabase.from("health_checks").insert({ service, status, latency_ms: latencyMs, detail });
  if (error) console.error("recordHealth error:", error.message);
}
