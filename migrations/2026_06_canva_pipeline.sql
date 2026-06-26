-- migrations/2026_06_canva_pipeline.sql — SWARM OS
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- Backs the gated Canva→Etsy publisher. social_posts already exists and is reused as-is.

create table if not exists publish_queue (
  id          bigint generated always as identity primary key,
  agent       text,
  listing_id  text,
  design_id   text,
  status      text default 'queued',   -- queued | approved | rejected | publishing | published | failed
  meta        jsonb,
  error       text,
  created_at  timestamptz default now()
);

create index if not exists publish_queue_status_idx on publish_queue (status);
