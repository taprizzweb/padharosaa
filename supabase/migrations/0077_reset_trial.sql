-- 0077_reset_trial
-- A hotel that has been trying the system out can wipe its test activity and start clean. Only the owner can do it, and only by typing RESET.
--   'activity'   : guest logins, guest requests, chat and food orders (what the guests did)
--   'everything' : the above, and also check-ins with their bills and invoices, bookings, counter bills and the bill numbering (back to 1)
-- The hotel's setup stays: rooms, room types, prices, taxes, team, menu, buffet, guides, stock items and their history, channel settings.
-- Idempotent. Rollback: nothing to undo; drop the function.
create or replace function public.padh_reset_trial(p_scope text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner']); v_req int := 0; v_ord int := 0; v_ses int := 0; v_stay int := 0; v_res int := 0; v_pos int := 0;
begin
  if p_scope is null or p_scope not in ('activity','everything') or p_confirm is distinct from 'RESET' then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if not private.rl_hit('padh_reset:' || v_rid::text, 5, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  if p_scope = 'everything' then
    delete from public.pos_bills where restaurant_id = v_rid; get diagnostics v_pos = row_count;
    delete from public.reservations where restaurant_id = v_rid; get diagnostics v_res = row_count;
    delete from public.stays where restaurant_id = v_rid; get diagnostics v_stay = row_count;
    delete from public.invoice_counters where restaurant_id = v_rid;
    delete from public.pos_counters where restaurant_id = v_rid;
    delete from public.channel_outbox where restaurant_id = v_rid;
  end if;
  select count(*) into v_req from public.requests where restaurant_id = v_rid;
  select count(*) into v_ord from public.orders where restaurant_id = v_rid;
  delete from public.guest_sessions where restaurant_id = v_rid; get diagnostics v_ses = row_count;
  delete from public.requests where restaurant_id = v_rid;
  delete from public.table_sessions where restaurant_id = v_rid;
  delete from public.orders where restaurant_id = v_rid;
  delete from public.notifications where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_reset_trial', 'restaurants', v_rid::text, jsonb_build_object('scope', p_scope));
  return jsonb_build_object('requests', v_req, 'orders', v_ord, 'guest_logins', v_ses, 'stays', v_stay, 'bookings', v_res, 'counter_bills', v_pos);
end $$;
revoke all on function public.padh_reset_trial(text, text) from public, anon, service_role;
grant execute on function public.padh_reset_trial(text, text) to authenticated;
