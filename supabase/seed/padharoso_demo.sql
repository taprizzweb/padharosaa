-- Padharoso DEMO data (spec 11.3). Everything here is MOCK: the hotel, the places, the ratings and the guide text are invented for
-- demos and tests, carry is_mock = true, and must NEVER reach a production database (`npm run check:no-mock` fails if they do).
-- Idempotent. Run against a throw-away or staging database only.

do $$
declare
  r uuid;
  it uuid;
begin
  select id into r from public.restaurants where slug = 'haveli-rajmahal-demo';
  if r is null then
    insert into public.restaurants (slug, name, plan) values ('haveli-rajmahal-demo', 'Haveli Rajmahal (DEMO)', 'pilot') returning id into r;
  end if;

  insert into public.hotel_settings (restaurant_id, is_mock, reception_phone, manager_phone)
  values (r, true, '9999900001', '9999900002')
  on conflict (restaurant_id) do nothing;

  insert into public.rooms (restaurant_id, number)
  select r, n::text from generate_series(101, 106) n on conflict do nothing;

  if not exists (select 1 from public.concierge_shifts where restaurant_id = r) then
    insert into public.concierge_shifts (restaurant_id, label, start_time, end_time, staff_name, sort) values
      (r, 'Morning', '07:00', '15:00', 'Demo Concierge A', 1),
      (r, 'Evening', '15:00', '23:00', 'Demo Concierge B', 2),
      (r, 'Night',   '23:00', '07:00', 'Demo Concierge C', 3);
  end if;

  if not exists (select 1 from public.guide_items where restaurant_id = r) then
    insert into public.guide_items (restaurant_id, category, name, description_en, maps_query, is_mock, sort) values
      (r, 'place', 'Amer Fort (demo text)', 'Demo description. Not verified.', 'Amer Fort Jaipur', true, 1),
      (r, 'food',  'Dal baati churma (demo text)', 'Demo description. Not verified.', null, true, 2),
      (r, 'craft', 'Blue pottery (demo text)', 'Demo description. Not verified.', null, true, 3),
      (r, 'tip',   'Carry water (demo text)', 'Demo tip. Not verified.', null, true, 4);
  end if;

  if not exists (select 1 from public.itineraries where restaurant_id = r) then
    insert into public.itineraries (restaurant_id, name, tagline, tip, is_mock, sort)
    values (r, 'The 48-Hour Classic (demo)', 'Demo itinerary', 'Demo tip.', true, 1) returning id into it;
    insert into public.itinerary_stops (restaurant_id, itinerary_id, when_label, name, note, maps_query, sort) values
      (r, it, 'Day 1, 9:00 AM', 'Amer Fort', 'Demo stop', 'Amer Fort Jaipur', 1),
      (r, it, 'Day 1, 3:00 PM', 'City Palace', 'Demo stop', 'City Palace Jaipur', 2);
  end if;

  if not exists (select 1 from public.places where restaurant_id = r) then
    insert into public.places (restaurant_id, name, category, lat, lng, address, rating, review_count, featured_review, featured_review_author, data_source, is_mock)
    values (r, 'Demo Cafe & Lounge', 'Fine Dining & Views', 26.9239, 75.8267, 'Demo address', 4.5, 100, 'Demo review text, not a real review.', 'Demo author', 'mock', true);
  end if;
end $$;
