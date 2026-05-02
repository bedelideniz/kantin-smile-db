-- Drop the broad public SELECT policy; public bucket URLs still work without a SELECT policy.
DROP POLICY IF EXISTS "School splashes are publicly readable" ON storage.objects;

-- Allow only super_admin to LIST/inspect bucket contents via the API.
CREATE POLICY "Super admin lists school splashes"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'school-splashes' AND public.has_role(auth.uid(), 'super_admin'));