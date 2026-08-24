import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || "";

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_KEY) {
  throw new Error("SUPABASE_SERVICE_KEY (or SUPABASE_KEY containing the service-role key) is required");
}

console.log(`[Supabase] configured for ${new URL(SUPABASE_URL).hostname}`);

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function enqueueTask({ agent, task_type, payload = {}, priority = 5, scheduledFor = null, parentTaskId = null }) {
  const { data, error } = await supabase.from("tasks").insert({
    agent,
    task_type,
    payload,
    priority,
    status: "pending",
    scheduled_for: scheduledFor || new Date().toISOString(),
    parent_task_id: parentTaskId || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function claimNextTask(agent) {
  const { data, error } = await supabase.rpc("claim_next_task", { p_agent: agent });
  if (error) {
    console.error("claimNextTask error:", error.message);
    return null;
  }
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function updateTaskStatus(taskId, status, result = null, error = null) {
  const update = {
    status,
    updated_at: new Date().toISOString(),
    ...(status === "running" ? { started_at: new Date().toISOString(), completed_at: null } : {}),
    ...(["completed", "failed"].includes(status) ? { completed_at: new Date().toISOString() } : {}),
    ...(status === "awaiting_approval" ? { completed_at: null } : {}),
    ...(result !== null ? { result } : {}),
    ...(error !== null ? { error } : {}),
  };
  const { data, error: updateError } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", taskId)
    .select()
    .single();
  if (updateError) throw new Error(updateError.message);
  return data;
}

export async function logAgent(agent, message, level = "info", data = null, taskId = null) {
  const { error } = await supabase.from("agent_logs").insert({
    agent,
    message,
    level,
    data: data || null,
    task_id: taskId || null,
  });
  if (error) console.error("logAgent error:", error.message);
}

export async function saveTrend({ keyword, category, score, source, data }) {
  const { error } = await supabase.from("trends").upsert(
    { keyword, category, score, source, data, detected_at: new Date().toISOString() },
    { onConflict: "keyword" },
  );
  if (error) console.error("saveTrend error:", error.message);
}

export async function saveDecision({ agent, decision_type, reasoning, data, approved = null }) {
  const { error } = await supabase.from("agent_decisions").insert({
    agent,
    decision_type,
    reasoning,
    data,
    approved,
  });
  if (error) console.error("saveDecision error:", error.message);
}

export async function updateSchedulerState(jobName, status = "ok") {
  let run_count = 1;
  try {
    const { data } = await supabase.from("scheduler_state").select("run_count").eq("job_name", jobName).limit(1);
    run_count = ((data && data[0] && data[0].run_count) || 0) + 1;
  } catch {}

  const { error } = await supabase.from("scheduler_state").upsert(
    { job_name: jobName, last_run: new Date().toISOString(), last_status: status, run_count },
    { onConflict: "job_name" },
  );
  if (error) console.error("schedulerState error:", error.message);
}

export async function recordHealth(service, status, latencyMs = null, detail = null) {
  const { error } = await supabase.from("health_checks").insert({
    service,
    status,
    latency_ms: latencyMs,
    detail,
  });
  if (error) console.error("recordHealth error:", error.message);
}

export async function saveAgentOutput(agentOrObj, outputTypeArg, dataArg) {
  let agent, outputType, taskId, trendId, etsyTitle, etsyDescription, etsyTags, socialCaption, confidence, data;

  if (typeof agentOrObj === "string") {
    agent = agentOrObj;
    outputType = outputTypeArg;
    data = dataArg || null;
    etsyTitle = data?.etsy_title || data?.titles?.[0] || null;
    etsyDescription = data?.description || data?.etsy_description || null;
    etsyTags = data?.tags || data?.etsy_tags || null;
    socialCaption = data?.caption || data?.social_caption || null;
    confidence = typeof data?.confidence === "number" ? data.confidence : 0;
    taskId = data?.task_id || null;
    trendId = data?.trend_id || null;
  } else {
    ({
      agent,
      outputType,
      taskId = null,
      trendId = null,
      etsyTitle = null,
      etsyDescription = null,
      etsyTags = null,
      socialCaption = null,
      confidence = 0,
      data = null,
    } = agentOrObj || {});
  }

  if (!agent || !outputType) {
    console.error("[saveAgentOutput] missing agent or outputType");
    return null;
  }

  const insertPayload = {
    task_id: taskId || null,
    trend_id: trendId || null,
    agent,
    output_type: outputType,
    etsy_title: etsyTitle || null,
    etsy_description: etsyDescription || null,
    etsy_tags: etsyTags || null,
    social_caption: socialCaption || null,
    confidence: typeof confidence === "number" ? confidence : parseFloat(confidence) || 0,
    data: data || null,
  };

  const { data: row, error } = await supabase.from("agent_outputs").insert(insertPayload).select().single();
  if (error) {
    console.error("[saveAgentOutput]", error.message, { agent, outputType });
    return null;
  }
  return row;
}

export async function getRecentOutputs(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const { data, error } = await supabase
    .from("agent_outputs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) {
    console.error("[getRecentOutputs]", error.message);
    return [];
  }
  return data || [];
}
