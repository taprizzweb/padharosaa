-- 0033_padharosaa_notify_worker
-- The delivery worker's two doors into the notifications outbox. Service role only.
--   padh_claim_notifications: takes up to N due WhatsApp rows (skip locked, so two workers never send the same one), counts the attempt,
--     and resolves each staff member's number at this moment (numbers are never copied into the outbox).
--   padh_finish_notification: sent, or retry with backoff (1, 2, 4, 8 minutes), failed for good after 5 attempts. A person who has since been
--     deactivated or has no number is suppressed.
-- Idempotent. Rollback: drop both functions.

create or replace function public.padh_claim_notifications(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select n.id from public.notifications n
     where n.status = 'queued' and n.channel = 'whatsapp' and n.scheduled_at <= now()
     order by n.scheduled_at limit p_limit for update skip locked) x;
  update public.notifications set attempts = attempts + 1 where id = any (v_ids);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'template', n.template, 'payload', n.payload, 'attempts', n.attempts,
             'to', (select p.whatsapp from public.staff_profiles p join public.staff s on s.user_id = p.user_id and s.active
                     where p.user_id::text = n.to_ref and p.restaurant_id = n.restaurant_id)) order by n.scheduled_at)
      from public.notifications n where n.id = any (v_ids)), '[]'::jsonb);
end $$;

create or replace function public.padh_finish_notification(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.notifications;
begin
  select * into n from public.notifications where id = p_id and status = 'queued' for update;
  if not found then return; end if;
  if p_ok then
    update public.notifications set status = 'sent', sent_at = now(), last_error = null where id = n.id;
  elsif p_error = 'no_recipient' then
    update public.notifications set status = 'suppressed', last_error = 'no_recipient' where id = n.id;
  elsif n.attempts >= 5 then
    update public.notifications set status = 'failed', last_error = left(coalesce(p_error, 'failed'), 300) where id = n.id;
  else
    update public.notifications set last_error = left(coalesce(p_error, 'failed'), 300), scheduled_at = now() + make_interval(mins => (2 ^ (n.attempts - 1))::int) where id = n.id;
  end if;
end $$;

revoke all on function public.padh_claim_notifications(int), public.padh_finish_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.padh_claim_notifications(int), public.padh_finish_notification(uuid, boolean, text) to service_role;
