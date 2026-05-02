-- Public bucket for per-school parent splash/ad images
INSERT INTO storage.buckets (id, name, public)
VALUES ('school-splashes', 'school-splashes', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read (public ad images)
CREATE POLICY "School splashes are publicly readable"
ON storage.objects
FOR SELECT
USING (bucket_id = 'school-splashes');

-- Only super_admin can upload
CREATE POLICY "Super admin uploads school splashes"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'school-splashes' AND public.has_role(auth.uid(), 'super_admin'));

-- Only super_admin can update
CREATE POLICY "Super admin updates school splashes"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'school-splashes' AND public.has_role(auth.uid(), 'super_admin'));

-- Only super_admin can delete
CREATE POLICY "Super admin deletes school splashes"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'school-splashes' AND public.has_role(auth.uid(), 'super_admin'));