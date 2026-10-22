-- GoToMenu staging: the three delete-related functions the Supabase tool asked to confirm and were cancelled.
-- Paste ALL of this into Supabase > SQL Editor > New query > Run. Safe to run twice.

create or replace function public.mgr_delete_category(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if not exists (select 1 from public.categories where id = p_id and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.items where category_id = p_id) then
    raise exception using errcode = 'GM018', message = 'category_not_empty';
  end if;
  delete from public.categories where id = p_id and restaurant_id = v_rid;
end $$;

create or replace function public.mgr_delete_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  delete from public.items where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;

create or replace function public.admin_delete_restaurant(p_admin uuid, p_restaurant uuid, p_confirm_slug text)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; v_users uuid[];
begin
  perform private.require_admin(p_admin);
  select * into r from public.restaurants where id = p_restaurant for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if p_confirm_slug is distinct from r.slug then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select coalesce(array_agg(user_id), '{}') into v_users from public.staff where restaurant_id = r.id;
  perform set_config('gotomenu.audit_purge', 'on', true);
  delete from public.restaurants where id = r.id;
  perform set_config('gotomenu.audit_purge', 'off', true);
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (null, p_admin, 'platform_admin', 'restaurant_deleted', 'restaurants', r.id::text,
          jsonb_build_object('slug', r.slug, 'name', r.name));
  return v_users;
end $$;

revoke all on function public.mgr_delete_category(uuid), public.mgr_delete_item(uuid), public.admin_delete_restaurant(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mgr_delete_category(uuid), public.mgr_delete_item(uuid) to authenticated;
grant execute on function public.admin_delete_restaurant(uuid, uuid, text) to service_role;
