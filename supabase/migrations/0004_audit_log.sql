-- 0004_audit_log
-- Append-only audit trail. UPDATE/DELETE/TRUNCATE are blocked by privileges AND by triggers.
-- Row-level triggers on menu/table/staff/settings tables record who changed what.
-- Idempotent. Rollback: drop triggers and table audit_log.

create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  actor_user_id uuid,
  actor_role    text,
  action        text not null,
  entity        text not null,
  entity_id     text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint audit_action_len check (char_length(action) between 1 and 60),
  constraint audit_entity_len check (char_length(entity) between 1 and 60)
);
create index if not exists audit_restaurant_idx on public.audit_log (restaurant_id, created_at desc);
create index if not exists audit_actor_idx on public.audit_log (actor_user_id);

alter table public.audit_log enable row level security;
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner','manager'));
grant select on public.audit_log to authenticated;

-- Block tampering. The only exception is the admin purge function, which sets a transaction-local flag.
create or replace function private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('gotomenu.audit_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception using errcode = 'GM017', message = 'audit_log_is_append_only';
end $$;

drop trigger if exists audit_no_update on public.audit_log;
create trigger audit_no_update before update on public.audit_log
  for each row execute function private.audit_immutable();
drop trigger if exists audit_no_delete on public.audit_log;
create trigger audit_no_delete before delete on public.audit_log
  for each row execute function private.audit_immutable();
drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

-- Single write path used by triggers and SQL functions.
create or replace function private.write_audit(p_restaurant uuid, p_action text, p_entity text,
                                               p_entity_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, auth.uid(), private.my_role(), p_action, p_entity, p_entity_id,
          coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Generic row trigger. Secrets (qr_token) are never written to the log; noisy counters are ignored.
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_skip text[] := array['qr_token','order_counter'];
  v_row jsonb; v_old jsonb; v_diff jsonb; v_rid uuid; v_id text;
begin
  -- During an admin purge the whole restaurant is being deleted; the admin function logs that itself.
  if coalesce(current_setting('gotomenu.audit_purge', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then v_row := to_jsonb(old) - v_skip; else v_row := to_jsonb(new) - v_skip; end if;
  v_diff := v_row;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_skip;
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_row) n join jsonb_each(v_old) o on o.key = n.key
      where n.value is distinct from o.value;
    if v_diff = '{}'::jsonb then return null; end if;
  end if;
  v_rid := coalesce((v_row->>'restaurant_id')::uuid, case when tg_table_name = 'restaurants' then (v_row->>'id')::uuid end);
  v_id  := coalesce(v_row->>'id', v_row->>'user_id');
  perform private.write_audit(v_rid, lower(tg_op), tg_table_name, v_id, v_diff);
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff','categories','items','dining_tables'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function private.audit_row()', t);
  end loop;
end $$;

-- restaurants: every order bumps order_counter; only log real settings changes
drop trigger if exists audit_restaurants on public.restaurants;
drop trigger if exists audit_restaurants_ins_del on public.restaurants;
drop trigger if exists audit_restaurants_upd on public.restaurants;
create trigger audit_restaurants_ins_del after insert or delete on public.restaurants
  for each row execute function private.audit_row();
create trigger audit_restaurants_upd after update on public.restaurants
  for each row when (
    (old.slug, old.name, old.status, old.plan, old.paid_until, old.review_url, old.accent, old.amber_minutes, old.red_minutes)
    is distinct from
    (new.slug, new.name, new.status, new.plan, new.paid_until, new.review_url, new.accent, new.amber_minutes, new.red_minutes))
  execute function private.audit_row();
