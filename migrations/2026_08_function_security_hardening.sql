-- Follow-up hardening for legacy/public functions.

alter function public.hoj_touch_updated_at() set search_path = pg_catalog, public;
alter function public.label_claim_next_task() set search_path = pg_catalog, public;

revoke execute on function public.claim_next_task(text) from public, anon, authenticated;
grant execute on function public.claim_next_task(text) to service_role;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

revoke execute on function public.label_claim_next_task() from public, anon, authenticated;
grant execute on function public.label_claim_next_task() to service_role;

revoke execute on function public.hoj_touch_updated_at() from public, anon, authenticated;
grant execute on function public.hoj_touch_updated_at() to service_role;
