-- Storage policy for checklist-photos bucket.
-- Uploads go through the Next.js API using the service role key.
-- Run in Supabase SQL editor if inserts fail from the app.

-- Public read (bucket should already be public)
CREATE POLICY IF NOT EXISTS "Public read checklist photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'checklist-photos');

-- Service role bypasses RLS; this policy is for anon/authenticated if needed later.
-- Inserts are handled server-side only via SUPABASE_SERVICE_ROLE_KEY.
