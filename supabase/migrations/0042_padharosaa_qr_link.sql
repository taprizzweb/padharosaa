-- 0042_padharosaa_qr_link
-- The guest link must be viewable at any time (owner, manager, platform admin), not only once. The QR key is now also kept as an
-- ENCRYPTED copy (AES-256-GCM, made by the app with PADHAROSAA_DATA_KEY), so the database alone can never reveal it. The existing
-- hash still decides whether a scanned key is valid.
-- Creating a NEW key (which makes every printed QR useless) is owner-only here, and the app asks for the owner's password first.
-- A platform admin has the same two abilities through the admin API. The old padh_rotate_qr_key (any manager, typed word) is closed.
-- Idempotent. Rollback: restore grants on padh_rotate_qr_key, drop the four functions and the column.

alter table public.hotel_settings add column if not exists qr_key_enc bytea; -- not in any grant: unreadable through the API

-- owner or manager: the encrypted copy, so the app can show the link again
create or replace function public.padh_qr_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); h public.hotel_settings;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  return jsonb_build_object('enc', case when h.qr_key_enc is null then null else encode(h.qr_key_enc, 'hex') end,
                            'rotated_at', h.qr_key_rotated_at, 'role', private.my_role());
end $$;

-- owner only: replaces the key. Every printed QR stops working at once.
create or replace function public.padh_qr_set(p_key_hash bytea, p_enc bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner']);
begin
  if p_key_hash is null or octet_length(p_key_hash) <> 32 or p_enc is null or octet_length(p_enc) not between 29 and 400 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set qr_key_hash = p_key_hash, qr_key_enc = p_enc, qr_key_rotated_at = now(), updated_at = now() where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_qr_set', 'hotel_settings', v_rid::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- platform admin (service role, admin checked inside): same two abilities for any hotel
create or replace function public.padh_admin_qr_get(p_admin uuid, p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.hotel_settings;
begin
  perform private.require_admin(p_admin);
  select * into h from public.hotel_settings where restaurant_id = p_restaurant;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  return jsonb_build_object('enabled', h.enabled, 'slug', (select slug from public.restaurants where id = p_restaurant),
                            'enc', case when h.qr_key_enc is null then null else encode(h.qr_key_enc, 'hex') end, 'rotated_at', h.qr_key_rotated_at);
end $$;

create or replace function public.padh_admin_qr_set(p_admin uuid, p_restaurant uuid, p_key_hash bytea, p_enc bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  if p_key_hash is null or octet_length(p_key_hash) <> 32 or p_enc is null or octet_length(p_enc) not between 29 and 400 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set qr_key_hash = p_key_hash, qr_key_enc = p_enc, qr_key_rotated_at = now(), updated_at = now() where restaurant_id = p_restaurant;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'padh_qr_set', 'hotel_settings', p_restaurant::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.padh_qr_get(), public.padh_qr_set(bytea, bytea), public.padh_admin_qr_get(uuid, uuid), public.padh_admin_qr_set(uuid, uuid, bytea, bytea)
  from public, anon, authenticated, service_role;
grant execute on function public.padh_qr_get(), public.padh_qr_set(bytea, bytea) to authenticated;
grant execute on function public.padh_admin_qr_get(uuid, uuid), public.padh_admin_qr_set(uuid, uuid, bytea, bytea) to service_role;

-- the old way (any manager, only a typed word, shown once) is closed
revoke all on function public.padh_rotate_qr_key(text) from public, anon, authenticated, service_role;
