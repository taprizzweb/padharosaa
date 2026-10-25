-- 0051_admin_menu_access
-- The platform admin (Taprizz) can open ANY hotel's menu manager to add, change or delete dishes for that hotel (support work).
-- It works like a visit: admin_menu_access gives the admin a "manager" place in that one hotel named "Taprizz admin (support)", so every menu
-- screen and every database rule is exactly the hotel manager's. admin_menu_leave ends the visit. A visit is logged in the hotel's activity log.
-- An admin who is a REAL staff member somewhere (owner of their own hotel, say) is never touched: the visit is refused instead.
-- Idempotent. Rollback: drop both functions and delete staff rows named 'Taprizz admin (support)'.
create or replace function public.admin_menu_access(p_admin uuid, p_restaurant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_other record;
begin
  perform private.require_admin(p_admin);
  if not exists (select 1 from public.restaurants where id = p_restaurant) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into v_other from public.staff where user_id = p_admin;
  if found and v_other.display_name <> 'Taprizz admin (support)' then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  insert into public.staff (user_id, restaurant_id, role, display_name) values (p_admin, p_restaurant, 'manager', 'Taprizz admin (support)')
  on conflict (user_id) do update set restaurant_id = excluded.restaurant_id, role = 'manager', active = true;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'admin_menu_visit', 'restaurants', p_restaurant::text, '{}'::jsonb);
end $$;

create or replace function public.admin_menu_leave(p_admin uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  delete from public.staff where user_id = p_admin and display_name = 'Taprizz admin (support)';
end $$;

revoke all on function public.admin_menu_access(uuid, uuid), public.admin_menu_leave(uuid) from public, anon, authenticated;
grant execute on function public.admin_menu_access(uuid, uuid), public.admin_menu_leave(uuid) to service_role;
