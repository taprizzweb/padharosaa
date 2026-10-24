-- 0046_team_account_actions
-- The owner can reset a team member's password or correct their email from the Team card. Both need the same checks as the menu app's
-- staff reset (owner only, member of this restaurant, never the owner) but each is written to the activity log under its own name.
-- Idempotent. Rollback: drop function public.owner_check_staff_action(uuid, uuid, text).
create or replace function public.owner_check_staff_action(p_owner uuid, p_user uuid, p_action text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner);
begin
  if p_action is null or p_action not in ('staff_password_reset', 'staff_email_changed') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.staff where user_id = p_user and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.staff where user_id = p_user and role = 'owner') then
    raise exception using errcode = 'GM020', message = 'protected';
  end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  perform private.write_audit(v_rid, p_action, 'staff', p_user::text, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.owner_check_staff_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_check_staff_action(uuid, uuid, text) to service_role;
