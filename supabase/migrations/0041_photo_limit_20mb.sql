-- 0041_photo_limit_20mb
-- Photos and logos may be up to 20 MB (phone cameras make 5 to 12 MB files). The app still shrinks every picture to a web-sized WebP
-- before upload, so guest pages stay fast; this only stops large originals from being refused.
-- Idempotent. Rollback: set file_size_limit back to 2097152.
update storage.buckets set file_size_limit = 20971520 where id = 'menu-images';
