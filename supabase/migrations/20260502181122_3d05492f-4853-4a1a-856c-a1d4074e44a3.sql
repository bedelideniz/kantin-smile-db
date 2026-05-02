-- Public bucket for student profile photos (used on parent panel + printed cards)
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read so <img src> works directly
CREATE POLICY "Student photos are publicly viewable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'student-photos');

-- No client-side writes; uploads go through edge functions using service role.
-- (No INSERT/UPDATE/DELETE policies = denied for anon/authenticated clients.)
