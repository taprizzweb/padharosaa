-- 0012_failure_only_throttle
-- A shared cafe wifi puts dozens of honest guests behind ONE IP address, so counting every request per IP would block
-- real customers. Abuse that matters (guessing QR tokens, guessing passwords) is made of FAILURES. These two functions let
-- the server (a) check a counter without touching it and (b) add one to it only after a failure. Each runs and commits in
-- its own transaction, so the penalty survives the failed call it follows.
-- Executable by service_role only. Idempotent. Rollback: drop both functions.

create or replace function public.guest_rate_check(p_key text, p_limit int, p_window_seconds int)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select rl.window_start <= now() - make_interval(secs => p_window_seconds) or rl.count < p_limit
    from public.rate_limits rl where rl.key = p_key), true)
$$;

create or replace function public.guest_rate_hit(p_key text, p_window_seconds int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  perform private.rl_hit(p_key, 2147483647, p_window_seconds);
end $$;

revoke all on function public.guest_rate_check(text, int, int), public.guest_rate_hit(text, int) from public, anon, authenticated;
grant execute on function public.guest_rate_check(text, int, int), public.guest_rate_hit(text, int) to service_role;
