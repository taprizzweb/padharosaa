-- 0070_local_guides
-- A list of local guides (people) the hotel recommends: a heritage-walk guide, a driver-guide, a photographer. The owner or manager adds them
-- (nothing is required except a name and one way to reach them); guests see the active ones in the app with their charges and contacts and can
-- call, WhatsApp or open their Instagram or LinkedIn. The hotel only lists them: the charges are the guide's own.
-- Idempotent. Rollback: drop the functions and the table.
create table if not exists public.local_guides (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  title         text check (title is null or char_length(title) <= 80),          -- "Heritage walk guide"
  about         text check (about is null or char_length(about) <= 500),
  languages     text check (languages is null or char_length(languages) <= 100), -- "English, Hindi, French"
  charges       text check (charges is null or char_length(charges) <= 160),     -- "₹1,500 for 3 hours"
  phone         text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  whatsapp      text check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
  instagram     text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  linkedin      text check (linkedin is null or (linkedin ~ '^https://[^[:space:]]+$' and char_length(linkedin) <= 300)),
  active        boolean not null default true,
  sort          int not null default 100 check (sort between 0 and 10000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (phone is not null or whatsapp is not null or instagram is not null or linkedin is not null)
);
create index if not exists local_guides_hotel_idx on public.local_guides (restaurant_id, sort, name) where active;
alter table public.local_guides enable row level security; -- no policy: reached only through the functions below

-- owner / manager: everything, including the guides that are switched off
create or replace function public.padh_lguide_manage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  return jsonb_build_object('guides', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'title', g.title, 'about', g.about, 'languages', g.languages, 'charges', g.charges,
    'phone', g.phone, 'whatsapp', g.whatsapp, 'instagram', g.instagram, 'linkedin', g.linkedin, 'active', g.active, 'sort', g.sort) order by g.sort, g.name)
    from public.local_guides g where g.restaurant_id = v_rid), '[]'::jsonb));
end $$;
revoke all on function public.padh_lguide_manage() from public, anon, service_role;
grant execute on function public.padh_lguide_manage() to authenticated;

create or replace function public.padh_lguide_save(p_id uuid, p_name text, p_title text, p_about text, p_languages text, p_charges text, p_phone text, p_whatsapp text,
  p_instagram text, p_linkedin text, p_active boolean, p_sort int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_id uuid;
  v_name text := nullif(private.clean_text(p_name), ''); v_title text := nullif(private.clean_text(p_title), ''); v_about text := nullif(private.clean_text(p_about), '');
  v_lang text := nullif(private.clean_text(p_languages), ''); v_chg text := nullif(private.clean_text(p_charges), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), ''); v_wa text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), '');
  v_ig text := nullif(regexp_replace(btrim(coalesce(p_instagram, '')), '^(https?://)?(www\.)?(instagram\.com/)?@?|/+$', '', 'gi'), ''); v_in text := nullif(btrim(coalesce(p_linkedin, '')), '');
begin
  if v_name is null or char_length(v_name) > 80 or (v_title is not null and char_length(v_title) > 80) or (v_about is not null and char_length(v_about) > 500)
     or (v_lang is not null and char_length(v_lang) > 100) or (v_chg is not null and char_length(v_chg) > 160)
     or (v_phone is not null and v_phone !~ '^[0-9]{10,15}$') or (v_wa is not null and v_wa !~ '^[0-9]{10,15}$')
     or (v_ig is not null and v_ig !~ '^[A-Za-z0-9._]{1,30}$') or (v_in is not null and (v_in !~ '^https://[^[:space:]]+$' or char_length(v_in) > 300))
     or p_active is null or p_sort is null or p_sort not between 0 and 10000
     or (v_phone is null and v_wa is null and v_ig is null and v_in is null) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_id is null then
    if (select count(*) from public.local_guides where restaurant_id = v_rid) >= 40 then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
    insert into public.local_guides (restaurant_id, name, title, about, languages, charges, phone, whatsapp, instagram, linkedin, active, sort)
    values (v_rid, v_name, v_title, v_about, v_lang, v_chg, v_phone, v_wa, v_ig, v_in, p_active, p_sort) returning id into v_id;
  else
    update public.local_guides set name = v_name, title = v_title, about = v_about, languages = v_lang, charges = v_chg, phone = v_phone, whatsapp = v_wa, instagram = v_ig,
           linkedin = v_in, active = p_active, sort = p_sort, updated_at = now() where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, 'padh_lguide_save', 'local_guides', v_id::text, jsonb_build_object('name', v_name, 'active', p_active));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_lguide_save(uuid, text, text, text, text, text, text, text, text, text, boolean, int) from public, anon, service_role;
grant execute on function public.padh_lguide_save(uuid, text, text, text, text, text, text, text, text, text, boolean, int) to authenticated;

-- a signed-in guest: the active guides of their own hotel
create or replace function public.padh_guest_lguides(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  return jsonb_build_object('guides', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'title', g.title, 'about', g.about, 'languages', g.languages, 'charges', g.charges,
    'phone', g.phone, 'whatsapp', g.whatsapp, 'instagram', g.instagram, 'linkedin', g.linkedin) order by g.sort, g.name)
    from public.local_guides g where g.restaurant_id = s.restaurant_id and g.active), '[]'::jsonb));
end $$;
revoke all on function public.padh_guest_lguides(uuid) from public, anon, authenticated;
grant execute on function public.padh_guest_lguides(uuid) to service_role;
