-- Add 'announcements' to app_module enum so super admins can be granted access
ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS 'announcements';

-- Create storage bucket for canteen announcement images
INSERT INTO storage.buckets (id, name, public)
VALUES ('canteen-announcements', 'canteen-announcements', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "Canteen announcements public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'canteen-announcements');

-- Authenticated write/update/delete (super admin will use them via panel)
CREATE POLICY "Authenticated upload canteen announcements"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'canteen-announcements');

CREATE POLICY "Authenticated update canteen announcements"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'canteen-announcements');

CREATE POLICY "Authenticated delete canteen announcements"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'canteen-announcements');