-- =============================================================================
-- Muscat Bay Patrol System — 04: Private storage for scan photos and voice memos
-- =============================================================================
-- First principles
-- ----------------
-- * Files live in the PRIVATE bucket "patrol-media". "Private" means no file
--   has a public link. The portal asks for a short-lived "signed URL" each
--   time a supervisor opens a photo.
-- * Folder layout:  scans/{scan_id}/{attachment_id}.jpg | .m4a
--   storage.foldername(name) splits the path, so for
--   "scans/1234/abcd.jpg" it returns {scans,1234}.
-- * Storage uses RLS too (on the table storage.objects). A guard may upload
--   or read files only inside the folder of a scan that is THEIR scan.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patrol-media',
  'patrol-media',
  false,
  10485760,  -- 10 MB per file (a 1600 px JPEG is ~300 KB; a 2-minute AAC memo ~1 MB)
  array['image/jpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Is the scan in this storage path owned by the current user?
create or replace function public.owns_scan_folder(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = 'scans'
     and exists (
       select 1 from public.scans s
       where s.id::text = (storage.foldername(p_name))[2]
         and s.guard_id = auth.uid()
     );
$$;
revoke all on function public.owns_scan_folder(text) from public, anon;
grant execute on function public.owns_scan_folder(text) to authenticated;

create policy "patrol-media: guard uploads to own scan folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'patrol-media' and public.owns_scan_folder(name));

-- Needed for "upsert" so a retried upload can overwrite a half-finished one.
create policy "patrol-media: guard updates own scan files"
  on storage.objects for update to authenticated
  using (bucket_id = 'patrol-media' and public.owns_scan_folder(name))
  with check (bucket_id = 'patrol-media' and public.owns_scan_folder(name));

create policy "patrol-media: guard or staff reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'patrol-media' and (public.owns_scan_folder(name) or public.is_staff()));

-- No delete policy: evidence files cannot be deleted from the apps.
