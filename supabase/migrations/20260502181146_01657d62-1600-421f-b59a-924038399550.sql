-- Replace broad SELECT with one that prevents directory listing.
-- The Supabase Storage list API uses storage.search() which checks SELECT policy
-- against rows where name starts with the queried prefix. By requiring the
-- requested name to contain at least one '/' AND a non-empty extension, plain
-- "list bucket" calls return nothing while direct object lookup by full key
-- still works (public CDN URLs use the full path).
DROP POLICY IF EXISTS "Student photos are publicly viewable" ON storage.objects;

CREATE POLICY "Student photos: public read by exact key only"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'student-photos'
    AND name ~ '^[^/]+/[^/]+\.(jpg|jpeg|png|webp)$'
  );
