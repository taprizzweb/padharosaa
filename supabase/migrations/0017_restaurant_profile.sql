-- 0017_restaurant_profile
-- Public restaurant profile: tagline, description, logo, banner, contact, WhatsApp, address, opening hours text,
-- Instagram. Everything here is intended for customers to see (the public menu exposes it).
-- Idempotent. Rollback: drop the columns and the function; restore guest_get_menu / mgr_get_settings from 0005 / 0013.

alter table public.restaurants
  add column if not exists tagline       text,
  add column if not exists description   text,
  add column if not exists logo_path     text,
  add column if not exists banner_path   text,
  add column if not exists phone         text,
  add column if not exists whatsapp      text,
  add column if not exists address       text,
  add column if not exists hours_text    text,
  add column if not exists instagram_url text;

do $$ begin
  alter table public.restaurants
    add constraint restaurants_tagline_len check (tagline is null or char_length(tagline) <= 120),
    add constraint restaurants_description_len check (description is null or char_length(description) <= 400),
    add constraint restaurants_logo_path check (logo_path is null or (logo_path like id::text || '/%' and logo_path !~ '\.\.' and char_length(logo_path) <= 200)),
    add constraint restaurants_banner_path check (banner_path is null or (banner_path like id::text || '/%' and banner_path !~ '\.\.' and char_length(banner_path) <= 200)),
    add constraint restaurants_phone_fmt check (phone is null or phone ~ '^[0-9]{10,15}$'),
    add constraint restaurants_whatsapp_fmt check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
    add constraint restaurants_address_len check (address is null or char_length(address) <= 200),
    add constraint restaurants_hours_len check (hours_text is null or char_length(hours_text) <= 200),
    add constraint restaurants_instagram_url check (instagram_url is null or (instagram_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._/-]+$' and char_length(instagram_url) <= 200));
exception when duplicate_object then null;
end $$;

-- Owner (only) edits the profile. Blank text becomes NULL.
create or replace function public.mgr_update_profile(
  p_tagline text, p_description text, p_logo text, p_banner text, p_phone text, p_whatsapp text,
  p_address text, p_hours text, p_instagram text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']);
begin
  update public.restaurants set
    tagline = nullif(btrim(coalesce(p_tagline, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    logo_path = nullif(btrim(coalesce(p_logo, '')), ''),
    banner_path = nullif(btrim(coalesce(p_banner, '')), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    whatsapp = nullif(btrim(coalesce(p_whatsapp, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    hours_text = nullif(btrim(coalesce(p_hours, '')), ''),
    instagram_url = nullif(btrim(coalesce(p_instagram, '')), '')
  where id = v_rid;
exception when check_violation then
  raise exception using errcode = 'GM015', message = 'invalid_input';
end $$;
revoke all on function public.mgr_update_profile(text, text, text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.mgr_update_profile(text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'phone', r.phone, 'whatsapp', r.whatsapp, 'address', r.address, 'hours_text', r.hours_text,
            'instagram_url', r.instagram_url)
          from public.restaurants r where r.id = v_rid);
end $$;

create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'phone', r.phone, 'whatsapp', r.whatsapp, 'address', r.address, 'hours_text', r.hours_text,
      'instagram_url', r.instagram_url, 'review_url', r.review_url),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;
