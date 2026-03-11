# Make Supabase storage buckets public (for Blotato)

The app sends **direct Supabase storage URLs** to Blotato (e.g. `https://xxx.supabase.co/storage/v1/object/public/uploads/...`). For Blotato to fetch those URLs, the buckets must be **public**.

## Steps in Supabase

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **Storage** in the left sidebar.
3. For each bucket used by the app (**`uploads`** and **`generated`**):
   - Click the bucket name.
   - Open **Configuration** or the bucket **settings** (gear or three dots).
   - Enable **“Public bucket”** (or set visibility to **Public**) so that “Anyone with the asset URL can download files.”
   - Save.

4. Test: open one of the generated links in an incognito/private browser window. If the file loads, the bucket is public and Blotato can use the URL.

## If the bucket was created as private

New buckets created by the app are created with `public: true`. If you created `uploads` or `generated` earlier (e.g. in the dashboard) as private, the app does not change that. You must set them to public in Storage → bucket → Configuration as above.

## Optional: confirm via SQL

In **SQL Editor** you can check or fix visibility:

```sql
-- List buckets and public flag
SELECT id, name, public FROM storage.buckets;

-- Make buckets public if they exist
UPDATE storage.buckets SET public = true WHERE id IN ('uploads', 'generated');
```

Then try the URL again in the browser.
