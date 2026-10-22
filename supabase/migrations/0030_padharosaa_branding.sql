-- 0030_padharosaa_branding
-- Brand colour, logo, hero photo (with the manager's crop and adjust settings), and the guest-facing links: Instagram, Google and
-- TripAdvisor reviews, the restaurant's own menu page. The text and button colours are NOT stored: the app derives readable ones from
-- the picked colour (src/lib/padharosaa/theme.ts), so any colour a hotel picks stays readable.
-- The "Powered by Taprizz" credit and its Instagram link are fixed in the app (lib/brand.ts), not hotel data, so they cannot be removed.
-- Writes go through padh_set_branding (owner/manager only). Idempotent. Rollback: drop the function and the columns below, restore
-- padh_public_hotel from 0028.

create or replace function private.valid_crop(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select c is null or jsonb_typeof(c) = 'null' or (
    jsonb_typeof(c) = 'object'
    and (c - array['zoom','x','y','aspect','brightness','contrast']) = '{}'::jsonb
    and jsonb_typeof(c->'zoom') = 'number' and (c->>'zoom')::numeric between 1 and 4
    and jsonb_typeof(c->'x') = 'number' and (c->>'x')::numeric between 0 and 1
    and jsonb_typeof(c->'y') = 'number' and (c->>'y')::numeric between 0 and 1
    and (c->>'aspect') in ('1:1','4:3','16:9','3:4','free')
    and (c->'brightness' is null or (jsonb_typeof(c->'brightness') = 'number' and (c->>'brightness')::numeric between 0.5 and 1.5))
    and (c->'contrast' is null or (jsonb_typeof(c->'contrast') = 'number' and (c->>'contrast')::numeric between 0.5 and 1.5)))
$$;
revoke all on function private.valid_crop(jsonb) from public, anon;
grant execute on function private.valid_crop(jsonb) to authenticated;

alter table public.hotel_settings
  add column if not exists brand_color    text check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'),
  add column if not exists logo_path      text check (logo_path is null or char_length(logo_path) <= 300),
  add column if not exists logo_crop      jsonb check (private.valid_crop(logo_crop)),
  add column if not exists hero_path      text check (hero_path is null or char_length(hero_path) <= 300),
  add column if not exists hero_crop      jsonb check (private.valid_crop(hero_crop)),
  add column if not exists tripadvisor_url text check (tripadvisor_url is null or (tripadvisor_url ~ '^https://(www\.)?tripadvisor\.[a-z.]{2,10}/[^[:space:]]*$' and char_length(tripadvisor_url) <= 500)),
  add column if not exists menu_url       text check (menu_url is null or menu_url ~ '^https://menu\.taprizz\.in/[a-z0-9-]{2,40}(\?k=[0-9a-f]{64})?$');

grant select (brand_color, logo_path, logo_crop, hero_path, hero_crop, tripadvisor_url, menu_url) on public.hotel_settings to authenticated;

-- manager / owner: change the look and the links in one call. A null argument clears that setting.
create or replace function public.padh_set_branding(
  p_brand_color text, p_logo_path text, p_logo_crop jsonb, p_hero_path text, p_hero_crop jsonb,
  p_instagram text, p_google text, p_tripadvisor text, p_menu text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_insta text := nullif(btrim(coalesce(p_instagram, '')), '');
begin
  -- a JSON null (what a browser client sends for "no value") means the same as SQL null
  if jsonb_typeof(p_logo_crop) = 'null' then p_logo_crop := null; end if;
  if jsonb_typeof(p_hero_crop) = 'null' then p_hero_crop := null; end if;
  if v_insta is not null then
    v_insta := 'https://www.instagram.com/' || regexp_replace(v_insta, '^@', '');
    if v_insta !~ '^https://www\.instagram\.com/[A-Za-z0-9._]{1,30}$' then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
  end if;
  if p_google is not null and p_google !~ '^https://(search\.google\.com|www\.google\.com|g\.page|maps\.app\.goo\.gl)/[^[:space:]]*$' then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  begin
    update public.hotel_settings
       set brand_color = lower(p_brand_color), logo_path = p_logo_path, logo_crop = p_logo_crop, hero_path = p_hero_path, hero_crop = p_hero_crop,
           review_link = p_google, tripadvisor_url = p_tripadvisor, menu_url = p_menu, updated_at = now()
     where restaurant_id = v_rid;
  exception when check_violation then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  update public.restaurants set instagram_url = v_insta where id = v_rid;
  perform private.write_audit(v_rid, 'padh_branding_updated', 'hotel_settings', v_rid::text, jsonb_build_object('brand_color', lower(p_brand_color)));
end $$;
revoke all on function public.padh_set_branding(text, text, jsonb, text, jsonb, text, text, text, text) from public, anon, service_role;
grant execute on function public.padh_set_branding(text, text, jsonb, text, jsonb, text, text, text, text) to authenticated;

-- the login page gets the look and the links (still no phone numbers)
create or replace function public.padh_public_hotel(p_slug text, p_k text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; h public.hotel_settings;
begin
  select r2.* into r from public.restaurants r2 where r2.slug = p_slug;
  select * into h from public.hotel_settings where restaurant_id = r.id;
  if r.id is null or h.restaurant_id is null or not h.enabled or h.qr_key_hash is null or p_k is null or char_length(p_k) <> 64
     or h.qr_key_hash <> sha256(convert_to(p_k, 'UTF8')) or r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM002', message = 'invalid_qr_key';
  end if;
  return jsonb_build_object('name', r.name, 'slug', r.slug, 'theme', h.theme, 'brand_color', h.brand_color, 'backdrop_mode', h.backdrop_mode,
    'backdrop_svg_path', h.backdrop_svg_path, 'logo_path', h.logo_path, 'logo_crop', h.logo_crop, 'hero_path', h.hero_path, 'hero_crop', h.hero_crop,
    'verification_level', h.verification_level, 'languages', jsonb_build_array('en','hi','fr','es','de'), 'is_mock', h.is_mock);
end $$;

-- logged-in guests also get the links (Instagram, reviews, menu); the public page above does not need them
create or replace function public.padh_guest_links(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; r public.restaurants;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  select * into r from public.restaurants where id = s.restaurant_id;
  return jsonb_build_object('instagram_url', r.instagram_url, 'google_review_url', coalesce(h.review_link, r.review_url),
    'tripadvisor_url', h.tripadvisor_url, 'menu_url', h.menu_url, 'entrance_maps_url', h.entrance_maps_url);
end $$;
revoke all on function public.padh_guest_links(uuid) from public, anon, authenticated;
grant execute on function public.padh_guest_links(uuid) to service_role;
