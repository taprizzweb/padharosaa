-- 0019_order_location_check
-- Optional "only take orders near the cafe" rule. The owner saves the cafe's position, a radius and a switch.
-- The server asks guest_check_location() before it places an order. A guest's coordinates are used for that one
-- check and are never stored. Honest limit: phone location can be switched off or faked, so this reduces casual
-- ordering from home, it is not proof of presence.
-- Idempotent. Rollback: drop the two functions and the four columns; restore mgr_get_settings from 0017.

alter table public.restaurants
  add column if not exists geo_required   boolean not null default false,
  add column if not exists geo_lat        double precision,
  add column if not exists geo_lng        double precision,
  add column if not exists geo_radius_m   int not null default 150;

do $$ begin
  alter table public.restaurants
    add constraint restaurants_geo_range check ((geo_lat is null or geo_lat between -90 and 90) and (geo_lng is null or geo_lng between -180 and 180)),
    add constraint restaurants_geo_radius check (geo_radius_m between 50 and 2000),
    add constraint restaurants_geo_complete check (not geo_required or (geo_lat is not null and geo_lng is not null));
exception when duplicate_object then null;
end $$;

-- 'ok' | 'required' (no position sent) | 'inaccurate' (phone could not fix its position well) | 'too_far'
create or replace function public.guest_check_location(p_slug text, p_lat double precision, p_lng double precision, p_acc double precision)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_dist double precision;
  a double precision;
  b double precision;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found or not r.geo_required then return 'ok'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return 'required'; end if;
  if p_acc is null or p_acc < 0 or p_acc > 500 then return 'inaccurate'; end if;
  a := sin(radians(p_lat - r.geo_lat) / 2) ^ 2 + cos(radians(r.geo_lat)) * cos(radians(p_lat)) * sin(radians(p_lng - r.geo_lng) / 2) ^ 2;
  v_dist := 2 * 6371000 * asin(least(1, sqrt(a)));
  -- the phone's own accuracy estimate gives the guest the benefit of the doubt, up to 200 m
  if v_dist > r.geo_radius_m + least(p_acc, 200) then return 'too_far'; end if;
  return 'ok';
end $$;
revoke all on function public.guest_check_location(text, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.guest_check_location(text, double precision, double precision, double precision) to service_role;

create or replace function public.mgr_update_location(p_required boolean, p_lat double precision, p_lng double precision, p_radius int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']);
begin
  if p_required is null or p_radius is null or p_radius not between 50 and 2000
     or (p_required and (p_lat is null or p_lng is null))
     or (p_lat is not null and p_lat not between -90 and 90) or (p_lng is not null and p_lng not between -180 and 180) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.restaurants set geo_required = p_required, geo_lat = p_lat, geo_lng = p_lng, geo_radius_m = p_radius where id = v_rid;
end $$;
revoke all on function public.mgr_update_location(boolean, double precision, double precision, int) from public, anon, service_role;
grant execute on function public.mgr_update_location(boolean, double precision, double precision, int) to authenticated;

create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'phone', r.phone, 'whatsapp', r.whatsapp, 'address', r.address, 'hours_text', r.hours_text,
            'instagram_url', r.instagram_url,
            'geo_required', r.geo_required, 'geo_lat', r.geo_lat, 'geo_lng', r.geo_lng, 'geo_radius_m', r.geo_radius_m)
          from public.restaurants r where r.id = v_rid);
end $$;
