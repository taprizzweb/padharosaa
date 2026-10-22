-- 0007_storage_and_realtime
-- Menu photos: public-read bucket, folder = restaurant_id. Only owner/manager of that restaurant
-- (active) can upload/replace/delete inside their own folder. Images only, max 2 MB.
-- Realtime: staff screens subscribe to orders / requests / sessions (RLS filters every event).
-- Idempotent. Rollback: delete bucket + policies, remove tables from the publication.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_images_select on storage.objects;
create policy menu_images_select on storage.objects for select to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
         and (select private.my_role()) in ('owner','manager'));

drop policy if exists menu_images_insert on storage.objects;
create policy menu_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
              and (select private.can_manage()));

drop policy if exists menu_images_update on storage.objects;
create policy menu_images_update on storage.objects for update to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
         and (select private.can_manage()))
  with check (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
              and (select private.can_manage()));

drop policy if exists menu_images_delete on storage.objects;
create policy menu_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
         and (select private.can_manage()));

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders','service_requests','table_sessions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
