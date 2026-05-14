
-- Add 'stories' to app_module enum
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'stories';

-- Create storage bucket for school stories (Instagram-like reels)
INSERT INTO storage.buckets (id, name, public)
VALUES ('school-stories', 'school-stories', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Public can view school stories"
ON storage.objects FOR SELECT
USING (bucket_id = 'school-stories');

-- Authenticated super admins can upload/update/delete
CREATE POLICY "Super admins can upload school stories"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'school-stories' AND public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admins can update school stories"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'school-stories' AND public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admins can delete school stories"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'school-stories' AND public.has_role(auth.uid(), 'super_admin'::app_role));
