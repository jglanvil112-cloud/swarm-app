-- House of Jreym security hardening — 2026-08
-- Run after the existing schema + Canva pipeline migrations.

create table if not exists oauth_states (
  state text primary key,
  verifier text not null,
  created_at timestamptz not null default now()
);

alter table publish_queue add column if not exists updated_at timestamptz not null default now();
create index if not exists publish_queue_listing_idx on publish_queue (listing_id);
create unique index if not exists publish_queue_open_listing_uq
  on publish_queue (listing_id)
  where status in ('queued','approved','publishing','published','blocked_missing_file');

create or replace function hoj_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_publish_queue_updated_at on publish_queue;
create trigger trg_publish_queue_updated_at
before update on publish_queue
for each row execute function hoj_touch_updated_at();

-- Remove the original social policies that used USING (true) without a role target.
drop policy if exists "service_all_social_credentials" on social_credentials;
drop policy if exists "service_all_social_posts" on social_posts;
drop policy if exists "service_all_social_analytics" on social_analytics;
drop policy if exists "service_all_social_account_stats" on social_account_stats;
drop policy if exists "service_all_social_reports" on social_reports;

-- Server-owned tables are accessed through the Supabase service-role key only.
-- This prevents direct anon/authenticated client access to OAuth tokens, customer/order
-- analytics, task queues, approval queues, logs, and operational memory.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'oauth_tokens',
    'oauth_states',
    'publish_queue',
    'tasks',
    'agent_logs',
    'agent_decisions',
    'agent_outputs',
    'revenue_events',
    'health_checks',
    'scheduler_state',
    'products',
    'trends',
    'social_credentials',
    'social_posts',
    'social_analytics',
    'social_account_stats',
    'social_reports'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format('drop policy if exists hoj_service_role_all on public.%I', table_name);
      execute format(
        'create policy hoj_service_role_all on public.%I for all to service_role using (true) with check (true)',
        table_name
      );
    end if;
  end loop;
end $$;

-- OAuth states are short lived; keep the table tidy even if a callback never arrives.
delete from oauth_states where created_at < now() - interval '30 minutes';
