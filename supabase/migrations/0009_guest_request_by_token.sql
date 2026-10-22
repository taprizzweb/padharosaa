-- 0009_guest_request_by_token
-- A guest can call the waiter before ordering anything (water, cutlery...), and can ask for the bill from a
-- phone that has lost its cookie. Both are identified by the table's QR token, never by a client-supplied id.
-- Waiter calls find-or-create the table's open session (like place_order); bill requests need an open session
-- that already has an order. Delegates to guest_create_request for validation, rate limiting and idempotency.
-- Idempotent. Rollback: drop function.

create or replace function public.guest_request_by_token(
  p_slug text, p_token text, p_type text, p_reason text default null, p_pay_mode text default null,
  p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.dining_tables;
  r public.restaurants;
  s public.table_sessions;
  v_req jsonb;
begin
  if p_type not in ('waiter','bill') or p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('rq:' || p_ip_hash, 120, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  select t2.* into t
    from public.dining_tables t2 join public.restaurants r2 on r2.id = t2.restaurant_id
   where t2.qr_token = p_token and r2.slug = p_slug and t2.active;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;

  -- same lock order as guest_place_order (restaurant, then session)
  select * into r from public.restaurants where id = t.restaurant_id for no key update;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;

  select * into s from public.table_sessions where table_id = t.id and closed_at is null;
  if not found then
    if p_type = 'bill' then
      raise exception using errcode = 'GM016', message = 'no_orders';
    end if;
    insert into public.table_sessions (restaurant_id, table_id) values (r.id, t.id) returning * into s;
  end if;

  v_req := public.guest_create_request(s.id, p_type, p_reason, p_pay_mode);
  return jsonb_build_object('session_id', s.id, 'table_label', t.label, 'request', v_req);
end $$;

revoke all on function public.guest_request_by_token(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.guest_request_by_token(text, text, text, text, text, text) to service_role;
