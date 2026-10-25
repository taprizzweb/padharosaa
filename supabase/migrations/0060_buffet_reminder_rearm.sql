-- 0060_buffet_reminder_rearm
-- The daily buffet reminder is sent once a day. The "already sent today" mark now includes the reminder TIME, so when the hotel changes the
-- time (for example from 6:45 PM to 7:19 PM after a test) the reminder is armed again for the new time instead of being silently skipped.
-- Idempotent. Rollback: restore padh_buffet_reminders_claim from 0054.
create or replace function public.padh_buffet_reminders_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h record; v_today date; v_now time; v_claim uuid; v_b jsonb; v_out jsonb := '[]'::jsonb;
begin
  for h in select s.* from public.hotel_settings s where s.enabled and s.buffet_notify_time is not null loop
    begin v_today := (now() at time zone h.timezone)::date; v_now := (now() at time zone h.timezone)::time; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; v_now := (now() at time zone 'Asia/Kolkata')::time; end;
    continue when v_now < h.buffet_notify_time or v_now >= h.buffet_notify_time + interval '30 minutes';
    v_b := public.padh_buffet_today(h.restaurant_id);
    continue when v_b is null;
    insert into public.notifications (restaurant_id, channel, to_ref, template, payload, status, dedupe_key, sent_at)
    values (h.restaurant_id, 'push', 'all-guests', 'buffet_reminder', v_b, 'sent', 'buffet-reminder:' || h.restaurant_id || ':' || v_today || ':' || to_char(h.buffet_notify_time, 'HH24MI'), now())
    on conflict (dedupe_key) do nothing returning id into v_claim;
    continue when v_claim is null;
    v_out := v_out || jsonb_build_array(v_b || jsonb_build_object('restaurant_id', h.restaurant_id));
  end loop;
  return v_out;
end $$;
revoke all on function public.padh_buffet_reminders_claim() from public, anon, authenticated;
grant execute on function public.padh_buffet_reminders_claim() to service_role;
