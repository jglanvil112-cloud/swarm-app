import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
if (typeof globalThis.WebSocket === "undefined") { globalThis.WebSocket = WebSocket; }

// Env vars checked in priority order — hardcoded fallbacks ensure workers always connect
const SUPABASE_URL = 
  process.env.SUPABASE_URL    ||
  process.env.SUPERBASE_URL   ||
  "https://cufrxwpmxglgiquntlca.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY         ||
  process.env.SUPABASE_ANON_KEY    ||
  process.env.SUPERBAS_KEY         ||
  "";

console.log(`[Supabase] URL=${SUPABASE_URL.slice(-20)} KEY_LEN=${SUPABASE_KEY.length} KEY_FMT=${SUPABASE_KEY.slice(0,10)}`);

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
  let run_count = 1;
  try { const { data } = await supabase.from("scheduler_state").select("run_count").eq("job_name", jobName).limit(1); run_count = ((data && data[0] && data[0].run_count) || 0) + 1; } catch (e) {}
  const { error } = await supabase.from("scheduler_state").upsert(
    { job_name: jobName, last_run: new Date().toISOString(), last_status: status, run_count },
    { onConflict: "job_name" }
  );
  if (error) console.error("schedulerState error:", error.message);
}

export async function recordHealth(service, status, latencyMs = null, detail = null) {
  const { error } = await supabase.from("health_checks").insert({ service, status, latency_ms: latencyMs, detail });
  if (error) console.error("recordHealth error:", error.message);
}

export async function saveAgentOutput(agentOrObj, outputTypeArg, dataArg) {
  // Supports both call styles:
  // Positional: saveAgentOutput("AISHA", "publish_etsy_listing", { listing_id, ... })
  // Object:     saveAgentOutput({ agent, outputType, taskId, etsyTitle, ... })
  let agent, outputType, taskId, trendId, etsyTitle, etsyDescription, etsyTags, socialCaption, confidence, data;

  if (typeof agentOrObj === 'string') {
    agent       = agentOrObj;
    outputType  = outputTypeArg;
    data        = dataArg || null;
    etsyTitle       = data?.etsy_title || data?.titles?.[0] || null;
    etsyDescription = data?.description || data?.etsy_description || null;
    etsyTags        = data?.tags || data?.etsy_tags || null;
    socialCaption   = data?.caption || data?.social_caption || null;
    confidence      = typeof data?.confidence === 'number' ? data.confidence : 0;
    taskId          = data?.task_id || null;
    trendId         = data?.trend_id || null;
  } else {
    ({ agent, outputType, taskId = null, trendId = null,
       etsyTitle = null, etsyDescription = null, etsyTags = null,
       socialCaption = null, confidence = 0, data = null } = agentOrObj || {});
  }

  if (!agent || !outputType) {
    console.error('[saveAgentOutput] missing agent or outputType:', { agent, outputType });
    return null;
  }

  const insertPayload = {
    task_id:          taskId || null,
    trend_id:         trendId || null,
    agent,
    output_type:      outputType,
    etsy_title:       etsyTitle || null,
    etsy_description: etsyDescription || null,
    etsy_tags:        etsyTags || null,
    social_caption:   socialCaption || null,
    confidence:       typeof confidence === 'number' ? confidence : parseFloat(confidence) || 0,
    data:             data || null,
  };

  let { data: row, error } = await supabase.from('agent_outputs').insert(insertPayload).select().single();

  if (error) { console.error('[saveAgentOutput]', error.message, { agent, outputType }); return null; }
  console.log(`[saveAgentOutput] ✅ saved: ${agent}/${outputType} id=${row?.id}`);
  return row;
}

                            export async function getRecentOutputs(limit = 20) {
                              const { data, error } = await supabase.from('agent_outputs').select('*').order('created_at', { ascending: false }).limit(limit);
                                if (error) { console.error('[getRecentOutputs]', error.message); return []; }
                                  return data || [];
                                  }
