-- House of Jreym security hardening — 2026-08
-- Run after the existing schema + Canva pipeline migrations.

create table if not exists oauth_states (
  state text primary key,
  verifier text not null,
  created_at timestamptz not null default now()
);

alter table publish_queue add column if not exists updated_at timestamptz not null default now();
create index if not exists publish_queue_listing_idx on publish_queue (listing_id);

-- Before enforcing one open queue row per Etsy listing, retire any older duplicate
-- rows that may already exist from the legacy publisher. Keep the newest row.
with ranked as (
  select
    id,
    row_number() over (
      partition by listing_id
      order by coalesce(updated_at, created_at) desc, id desc
    ) as rn
  from publish_queue
  where status in ('queued','approved','publishing','blocked_missing_file')
)
update publish_queue p
set
  status = 'rejected',
  error = coalesce(p.error, 'Retired by 2026-08 hardening migration: duplicate open queue row'),
  updated_at = now()
from ranked r
where p.id = r.id and r.rn > 1;

create unique index if not exists publish_queue_open_listing_uq
  on publish_queue (listing_id)
  where status in ('queued','approved','publishing','blocked_missing_file');

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

-- Remove legacy social policies only when the corresponding tables exist.
do $$
begin
  if to_regclass('public.social_credentials') is not null then
    drop policy if exists "service_all_social_credentials" on social_credentials;
  end if;
  if to_regclass('public.social_posts') is not null then
    drop policy if exists "service_all_social_posts" on social_posts;
  end if;
  if to_regclass('public.social_analytics') is not null then
    drop policy if exists "service_all_social_analytics" on social_analytics;
  end if;
  if to_regclass('public.social_account_stats') is not null then
    drop policy if exists "service_all_social_account_stats" on social_account_stats;
  end if;
  if to_regclass('public.social_reports') is not null then
    drop policy if exists "service_all_social_reports" on social_reports;
  end if;
end $$;

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
