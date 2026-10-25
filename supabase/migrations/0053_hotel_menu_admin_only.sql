-- 0053_hotel_menu_admin_only
-- In a Padharosaa hotel the menu (categories, dishes, sizes, options, prices, photos, order) is changed ONLY by the Taprizz platform admin
-- (from the admin panel, "Edit menu"). The hotel's owner, manager and reception cannot add, edit, delete or reorder dishes. What every staff
-- member keeps is the "sold out" switch (is_available), which is how a kitchen says a dish is finished.
-- It is enforced on the tables themselves, so it holds for the app, the API and any direct call. The server itself (no signed-in person: seeds,
-- copying or deleting a restaurant) is not affected, and a restaurant that is not a Padharosaa hotel keeps editing its own menu as before.
-- Idempotent. Rollback: drop the five triggers and private.menu_admin_only().
create or replace function private.menu_admin_only() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := coalesce(new.restaurant_id, old.restaurant_id); v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  if auth.uid() is null or not private.is_hotel(v_rid) then return v_row; end if;
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) then return v_row; end if;
  if tg_table_name = 'items' and tg_op = 'UPDATE' and (to_jsonb(new) - 'is_available') = (to_jsonb(old) - 'is_available') then return new; end if; -- the sold-out switch
  raise exception using errcode = 'GM011', message = 'forbidden';
end $$;
revoke all on function private.menu_admin_only() from public, anon, authenticated;

create or replace trigger menu_admin_only before insert or update or delete on public.categories for each row execute function private.menu_admin_only();
create or replace trigger menu_admin_only before insert or update or delete on public.items for each row execute function private.menu_admin_only();
create or replace trigger menu_admin_only before insert or update or delete on public.item_variants for each row execute function private.menu_admin_only();
create or replace trigger menu_admin_only before insert or update or delete on public.item_option_groups for each row execute function private.menu_admin_only();
create or replace trigger menu_admin_only before insert or update or delete on public.item_options for each row execute function private.menu_admin_only();
