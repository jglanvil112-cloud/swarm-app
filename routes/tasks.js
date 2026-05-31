// routes/tasks.js — Task queue management + monitoring API
import express from "express";
import { supabase, enqueueTask, updateTaskStatus, logAgent } from "../lib/supabase.js";
export const tasksRouter = express.Router();

tasksRouter.get("/", async (req, res) => {
  try {
    const { status, agent, limit = 50, offset = 0 } = req.query;
    let query = supabase.from("tasks").select("*").order("created_at", { ascending: false }).range(Number(offset), Number(offset)+Number(limit)-1);
    if (status) query = query.eq("status", status);
    if (agent)  query = query.eq("agent", agent);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ tasks: data, count: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.post("/", async (req, res) => {
  try {
    const { agent, task_type, payload, priority, scheduled_for } = req.body;
    if (!agent || !task_type) return res.status(400).json({ error: "agent and task_type required" });
    const task = await enqueueTask({ agent, task_type, payload: payload || {}, priority: priority || 5, scheduledFor: scheduled_for });
    res.json({ task });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.post("/:id/approve", async (req, res) => {
  try {
    const { data: task } = await supabase.from("tasks").select("*").eq("id", req.params.id).single();
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.status !== "awaiting_approval") return res.status(400).json({ error: "Task not awaiting approval" });
    const newTask = await enqueueTask({ agent: task.agent, task_type: task.task_type, payload: { ...task.payload, approved: true }, priority: 1, parentTaskId: task.id });
    await updateTaskStatus(task.id, "completed", { approved: true, re_enqueued: newTask.id });
    await logAgent(task.agent, `Task approved: ${task.task_type}`, "success", null, task.id);
    res.json({ approved: true, new_task_id: newTask.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.post("/:id/reject", async (req, res) => {
  try {
    await updateTaskStatus(req.params.id, "failed", null, `Rejected: ${req.body.reason || "no reason"}`);
    res.json({ rejected: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/monitoring/dashboard", async (req, res) => {
  try {
    const [{ data: taskStats }, { data: recentLogs }, { data: pendingApprovals }, { data: schedulerState }, { data: recentRevenue }, { data: healthChecks }] = await Promise.all([
      supabase.from("tasks").select("status,agent").gte("created_at", new Date(Date.now()-86400000).toISOString()),
      supabase.from("agent_logs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("tasks").select("*").eq("status","awaiting_approval").order("created_at", { ascending: false }),
      supabase.from("scheduler_state").select("*").order("last_run", { ascending: false }),
      supabase.from("revenue_events").select("amount,platform,recorded_at").gte("recorded_at", new Date(Date.now()-7*86400000).toISOString()),
      supabase.from("health_checks").select("*").order("checked_at", { ascending: false }).limit(20),
    ]);
    const stats = { pending: 0, running: 0, completed: 0, failed: 0, awaiting_approval: 0 };
    const byAgent = {};
    for (const t of (taskStats||[])) { stats[t.status]=(stats[t.status]||0)+1; byAgent[t.agent]=byAgent[t.agent]||{completed:0,failed:0,pending:0}; byAgent[t.agent][t.status]=(byAgent[t.agent][t.status]||0)+1; }
    const totalRevenue = (recentRevenue||[]).reduce((s,r)=>s+parseFloat(r.amount),0);
    const revenueByPlatform = {};
    for (const r of (recentRevenue||[])) revenueByPlatform[r.platform]=(revenueByPlatform[r.platform]||0)+parseFloat(r.amount);
    res.json({ task_stats: stats, by_agent: byAgent, pending_approvals: pendingApprovals||[], recent_logs: recentLogs||[], scheduler: schedulerState||[], revenue: { total_7d: totalRevenue.toFixed(2), by_platform: revenueByPlatform }, health: healthChecks||[], timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/monitoring/logs", async (req, res) => {
  try {
    const { agent, level, limit = 100 } = req.query;
    let query = supabase.from("agent_logs").select("*").order("created_at", { ascending: false }).limit(Number(limit));
    if (agent) query = query.eq("agent", agent);
    if (level) query = query.eq("level", level);
    const { data } = await query;
    res.json({ logs: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/monitoring/errors", async (req, res) => {
  try {
    const [{ data: failedTasks }, { data: errorLogs }] = await Promise.all([
      supabase.from("tasks").select("*").eq("status","failed").order("updated_at",{ascending:false}).limit(50),
      supabase.from("agent_logs").select("*").eq("level","error").order("created_at",{ascending:false}).limit(50),
    ]);
    res.json({ failed_tasks: failedTasks||[], error_logs: errorLogs||[] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/monitoring/revenue", async (req, res) => {
  try {
    const days = parseInt(req.query.days||"30");
    const { data } = await supabase.from("revenue_events").select("*").gte("recorded_at", new Date(Date.now()-days*86400000).toISOString()).order("recorded_at",{ascending:true});
    const total = (data||[]).reduce((s,r)=>s+parseFloat(r.amount),0);
    res.json({ revenue_events: data, total, period_days: days });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/memory/trends", async (req, res) => {
  try { const { data } = await supabase.from("trends").select("*").order("score",{ascending:false}).limit(50); res.json({ trends: data }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/memory/decisions", async (req, res) => {
  try {
    const { agent, limit = 50 } = req.query;
    let query = supabase.from("agent_decisions").select("*").order("created_at",{ascending:false}).limit(Number(limit));
    if (agent) query = query.eq("agent", agent);
    const { data } = await query;
    res.json({ decisions: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

tasksRouter.get("/memory/products", async (req, res) => {
  try {
    const { platform, status } = req.query;
    let query = supabase.from("products").select("*").order("updated_at",{ascending:false}).limit(100);
    if (platform) query = query.eq("platform", platform);
    if (status)   query = query.eq("status", status);
    const { data } = await query;
    res.json({ products: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
