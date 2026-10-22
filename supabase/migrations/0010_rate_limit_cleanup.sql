-- 0010_rate_limit_cleanup
-- The privacy notice promises scrambled-IP counters are deleted within a day. Rather than depend on an external
-- scheduler, roughly 2% of rate-limit calls also delete counters older than a day (cheap: indexed on window_start).
-- guest_purge_rate_limits() stays available for an explicit run. Idempotent. Rollback: restore the 0005 definition.

create or replace function public.guest_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return private.rl_hit(p_key, p_limit, p_window_seconds);
end $$;

revoke all on function public.guest_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.guest_rate_limit(text, int, int) to service_role;
