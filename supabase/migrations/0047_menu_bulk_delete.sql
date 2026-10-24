-- 0047_menu_bulk_delete
-- Clear out an old menu quickly: delete many dishes in one go, or a category together with all its dishes.
-- Owner and manager only, own restaurant only. Past orders keep their snapshot of each dish (order_items.item_id becomes null).
-- Idempotent. Rollback: drop function public.mgr_delete_items(uuid[]); drop function public.mgr_delete_category_all(uuid).
create or replace function public.mgr_delete_items(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); n int;
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 500 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if (select count(*) from public.items where restaurant_id = v_rid and id = any (p_ids)) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  delete from public.items where restaurant_id = v_rid and id = any (p_ids);
  get diagnostics n = row_count;
  perform private.write_audit(v_rid, 'menu_items_deleted', 'items', null, jsonb_build_object('count', n));
  return n;
end $$;

create or replace function public.mgr_delete_category_all(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); n int;
begin
  if not exists (select 1 from public.categories where id = p_id and restaurant_id = v_rid) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  delete from public.items where category_id = p_id and restaurant_id = v_rid;
  get diagnostics n = row_count;
  delete from public.categories where id = p_id and restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'menu_category_deleted_with_items', 'categories', p_id::text, jsonb_build_object('items', n));
  return n;
end $$;

revoke all on function public.mgr_delete_items(uuid[]), public.mgr_delete_category_all(uuid) from public, anon, service_role;
grant execute on function public.mgr_delete_items(uuid[]), public.mgr_delete_category_all(uuid) to authenticated;
