-- SWARM OS Migration 002 — Atomic task claim function
-- Run in Supabase SQL Editor AFTER 001_schema.sql

CREATE OR REPLACE FUNCTION claim_next_task(p_agent TEXT)
RETURNS SETOF tasks AS $$
DECLARE
  v_task tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task
  FROM tasks
  WHERE agent = p_agent
    AND status = 'pending'
    AND scheduled_for <= NOW()
  ORDER BY priority ASC, scheduled_for ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_task.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE tasks
  SET status = 'running', started_at = NOW(), updated_at = NOW()
  WHERE id = v_task.id;

  v_task.status := 'running';
  v_task.started_at := NOW();
  RETURN NEXT v_task;
END;
$$ LANGUAGE plpgsql;
