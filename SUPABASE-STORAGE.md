# Supabase Storage Setup

When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in your `.env` (or Railway variables), the app uses Supabase Storage instead of local disk for:

- **Folder images/videos** (uploads)
- **Generated carousel images**
- **Used images** (moved after posting)

## Automatic bucket creation

On startup, the app creates three public buckets if they don't exist:

- `uploads` – source images and videos
- `generated` – carousel outputs
- `used` – images moved after Blotato sends

## Manual setup (optional)

You can create the buckets in **Supabase Dashboard → Storage → New bucket**:

1. Create bucket `uploads` – set to **Public**
2. Create bucket `generated` – set to **Public**
3. Create bucket `used` – set to **Public**

## Environment variables

Add to `.env` (or Railway):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Note:** The service role key is required for server-side storage operations. Never expose it to the client.

## Switching back to local storage

Remove or comment out `SUPABASE_SERVICE_ROLE_KEY` from your env. The app will fall back to local disk (Railway volume or `uploads/` and `generated/`).
