-- 0006_staff_functions
-- State changes by staff. Each function checks the caller's role and that the restaurant is active.
-- Executable by `authenticated` only. Idempotent (create or replace). Rollback: drop the functions.

create or replace function private.require_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text; v_status text;
begin
  select s.restaurant_id, s.role, r.status into v_rid, v_role, v_status
    from public.staff s join public.restaurants r on r.id = s.restaurant_id
   where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  if v_status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  return v_rid;
end $$;
revoke all on function private.require_staff(text[]) from public, anon, authenticated;

-- ---------- order status: placed -> preparing -> ready -> served ; cancel from placed/preparing ----------
create or replace function public.staff_set_order_status(p_order_id uuid, p_new text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
  o public.orders;
  v_closed timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_rid := private.require_staff(array['owner','manager','waiter','kitchen']);
  v_role := private.my_role();

  select * into o from public.orders where id = p_order_id and restaurant_id = v_rid for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  select closed_at into v_closed from public.table_sessions where id = o.session_id;
  if v_closed is not null then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;

  if p_new = 'cancelled' then
    if v_role not in ('owner','manager','waiter') then
      raise exception using errcode = 'GM011', message = 'forbidden';
    end if;
    if o.status not in ('placed','preparing') then
      raise exception using errcode = 'GM010', message = 'invalid_transition';
    end if;
    if v_reason is null or char_length(v_reason) > 200 then
      raise exception using errcode = 'GM014', message = 'reason_required';
    end if;
    update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, status_by = auth.uid()
     where id = o.id returning * into o;
    perform private.write_audit(v_rid, 'order_cancelled', 'orders', o.id::text,
      jsonb_build_object('order_no', o.order_no, 'reason', v_reason, 'total_paise', o.total_paise));
  elsif (o.status, p_new) in (('placed','preparing'), ('preparing','ready'), ('ready','served')) then
    update public.orders set
      status = p_new, status_by = auth.uid(),
      preparing_at = case when p_new = 'preparing' then now() else preparing_at end,
      ready_at     = case when p_new = 'ready'     then now() else ready_at end,
      served_at    = case when p_new = 'served'    then now() else served_at end
     where id = o.id returning * into o;
  else
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'status', o.status);
end $$;

-- ---------- waiter call / bill request done ----------
create or replace function public.staff_resolve_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; q public.service_requests;
begin
  v_rid := private.require_staff(array['owner','manager','waiter']);
  update public.service_requests set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where id = p_request_id and restaurant_id = v_rid and status = 'open'
   returning * into q;
  if not found then
    -- already done (double tap) is fine; a missing/foreign id is not
    select * into q from public.service_requests where id = p_request_id and restaurant_id = v_rid;
    if not found then
      raise exception using errcode = 'GM012', message = 'not_found';
    end if;
  end if;
  return jsonb_build_object('request_id', q.id, 'status', q.status);
end $$;

-- ---------- mark table paid (closes the session) ----------
create or replace function public.staff_close_session(
  p_session_id uuid, p_force boolean default false, p_reason text default null, p_pay_mode text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
  s public.table_sessions;
  v_unserved int;
  v_total int;
  v_label text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_rid := private.require_staff(array['owner','manager','waiter']);
  v_role := private.my_role();
  if p_pay_mode is not null and p_pay_mode not in ('cash','upi','card') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  select * into s from public.table_sessions where id = p_session_id and restaurant_id = v_rid for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.closed_at is not null then
    return jsonb_build_object('session_id', s.id, 'already_closed', true, 'total_paise', s.final_total_paise);
  end if;

  select count(*) into v_unserved from public.orders
   where session_id = s.id and status in ('placed','preparing','ready');
  if p_force then
    if v_role not in ('owner','manager') then
      raise exception using errcode = 'GM011', message = 'forbidden';
    end if;
    if v_reason is null or char_length(v_reason) > 200 then
      raise exception using errcode = 'GM014', message = 'reason_required';
    end if;
  elsif v_unserved > 0 then
    raise exception using errcode = 'GM013', message = 'unserved_orders';
  end if;

  select coalesce(sum(total_paise), 0) into v_total from public.orders where session_id = s.id and status <> 'cancelled';
  update public.table_sessions
     set closed_at = now(), closed_by = auth.uid(), close_reason = case when p_force then 'forced' else 'paid' end,
         final_total_paise = v_total, pay_mode = coalesce(p_pay_mode, pay_mode)
   where id = s.id;
  update public.service_requests set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where session_id = s.id and status = 'open';

  select label into v_label from public.dining_tables where id = s.table_id;
  perform private.write_audit(v_rid, case when p_force then 'table_force_closed' else 'table_paid' end,
    'table_sessions', s.id::text,
    jsonb_build_object('table', v_label, 'total_paise', v_total, 'unserved_orders', v_unserved, 'reason', v_reason));
  return jsonb_build_object('session_id', s.id, 'already_closed', false, 'total_paise', v_total);
end $$;

-- ---------- sold-out toggle (every role) ----------
create or replace function public.staff_set_item_availability(p_item_ids uuid[], p_available boolean)
returns int language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_found int; v_changed int := 0; rec record;
begin
  v_rid := private.require_staff(array['owner','manager','waiter','kitchen']);
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 500 or p_available is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select count(*) into v_found from public.items where id = any (p_item_ids) and restaurant_id = v_rid;
  if v_found <> (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  for rec in
    update public.items set is_available = p_available
     where id = any (p_item_ids) and restaurant_id = v_rid and is_available is distinct from p_available
     returning id, name_en
  loop
    v_changed := v_changed + 1;
    perform private.write_audit(v_rid, 'item_availability', 'items', rec.id::text,
      jsonb_build_object('name', rec.name_en, 'is_available', p_available));
  end loop;
  return v_changed;
end $$;

-- ---------- owner / manager: table QR tokens ----------
create or replace function public.mgr_get_table_tokens()
returns table (table_id uuid, label text, active boolean, qr_token text)
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid;
begin
  v_rid := private.require_staff(array['owner','manager']);
  return query select t.id, t.label, t.active, t.qr_token from public.dining_tables t
               where t.restaurant_id = v_rid order by t.created_at, t.label;
end $$;

create or replace function public.mgr_rotate_table_token(p_table_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_token text; v_label text;
begin
  v_rid := private.require_staff(array['owner','manager']);
  update public.dining_tables
     set qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where id = p_table_id and restaurant_id = v_rid
   returning qr_token, label into v_token, v_label;
  if v_token is null then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  perform private.write_audit(v_rid, 'qr_rotated', 'dining_tables', p_table_id::text, jsonb_build_object('table', v_label));
  return v_token;
end $$;

-- create tables numbered p_from..p_to (existing labels are skipped); returns how many were created
create or replace function public.mgr_create_tables(p_from int, p_to int) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_n int;
begin
  v_rid := private.require_staff(array['owner','manager']);
  if p_from is null or p_to is null or p_from < 1 or p_to < p_from or p_to - p_from >= 200 or p_to > 999 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.dining_tables where restaurant_id = v_rid) + (p_to - p_from + 1) > 400 then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  insert into public.dining_tables (restaurant_id, label)
  select v_rid, g::text from generate_series(p_from, p_to) g
  on conflict (restaurant_id, label) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- grants ----------
revoke all on function public.staff_set_order_status(uuid, text, text), public.staff_resolve_request(uuid),
  public.staff_close_session(uuid, boolean, text, text), public.staff_set_item_availability(uuid[], boolean),
  public.mgr_get_table_tokens(), public.mgr_rotate_table_token(uuid), public.mgr_create_tables(int, int)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_set_order_status(uuid, text, text), public.staff_resolve_request(uuid),
  public.staff_close_session(uuid, boolean, text, text), public.staff_set_item_availability(uuid[], boolean),
  public.mgr_get_table_tokens(), public.mgr_rotate_table_token(uuid), public.mgr_create_tables(int, int)
  to authenticated;
