# Carousel Automation

Self-hosted hub for multiple TikTok accounts: **one project per account**, **campaigns** per project (each with 3 folders, text options, and schedule). When you **deploy** a campaign, it runs in the background at the times you set, generates images with text overlay, and **automatically posts to Blotato** (TikTok) or exposes **webContentUrls** for n8n.

## How it works

1. **Projects** — One project per TikTok account you run. Set **Blotato Account ID** on each project for auto-posting.
2. **Campaigns** — Under each project, create campaigns (e.g. "Hooks carousel", "Quotes"). Each campaign has:
   - **3 folders** — Drop as many photos as you want; one image is picked at random from each folder per run.
   - **On-screen text options** — A list of phrases; one is chosen at random per image and overlaid.
   - **Schedule** — Up to 3 times per day (e.g. 10:00, 13:00, 16:00).
   - **Deploy** — When toggled on, the campaign runs automatically at those times.
3. **Run** — Per campaign you can "Run now" to generate images and webContentUrls immediately.
4. **Blotato auto-post** — When the scheduler runs (e.g. Monday 10 AM), it picks random photos/text per folder, generates images, builds URLs, and sends them to Blotato as a carousel (folder 1 = slide 1, etc.).

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3721**. Create a project → add a campaign → upload images to the 3 folders → set text options and schedule → turn **Deployed** on. Set **Base URL** and **Blotato API Key** in Settings. Set **Blotato Account ID** on each project page.

## Settings

- **Base URL** — Used to build webContentUrls. Set to your **public URL** (e.g. `https://your-ngrok-url.ngrok.io` or `https://your-server.com`) so Blotato can fetch the generated images.
- **Blotato API Key** — Required for auto-posting. Get it from your Blotato dashboard.

## Blotato Account ID (per project)

On each project page, set **Blotato Account ID** (e.g. `acc_xxxxx`). Get it from Blotato: `GET https://backend.blotato.com/v2/users/me/accounts?platform=tiktok` with your API key in the `blotato-api-key` header.

## Deployment (public URL for Blotato)

Blotato must be able to fetch your generated images. Deploy the app to a public host and set **Base URL** in Settings to that URL.

- **ngrok** (local testing): `ngrok http 3721` → use the HTTPS URL in Base URL.
- **Railway / Render / Fly.io**: Deploy the repo, set `PORT` if needed, use the provided URL as Base URL.
- **VPS**: Run `npm start` behind nginx with SSL (Let's Encrypt).

### Railway: fixing 404 on generated links

Railway uses an ephemeral filesystem. Generated images may return 404 when:
- Multiple instances are running (file created on instance A, request hits instance B)
- The container restarts and files are lost

**Solutions:**
1. **Single instance** — In Railway → Settings → Scaling, set replicas to 1.
2. **Railway Volumes** — Create a volume and set mount path to `/data`. Add env vars: `GENERATED_DIR=/data/generated` and `UPLOADS_DIR=/data/uploads`.
3. **In-app display** — The Run response now includes base64 images. Thumbnails in the app will display correctly even when the URLs 404 (e.g. for Blotato, ensure single instance or volumes so URLs work).

## Data layout

- **data/projects.json** — Projects (id, name).
- **data/campaigns** (in memory from campaigns.json) — Campaigns (id, projectId, name, scheduleTimes, scheduleEnabled, deployed, textOptions).
- **data/runs/{campaignId}.json** — Latest run per campaign (webContentUrls, at).
- **uploads/{projectId}/{campaignId}/folder1|2|3/** — Your photos.
- **uploads/{projectId}/used/** — Images moved here after being sent to Blotato (per page). Deleted after 14 days.
- **generated/{projectId}/{campaignId}/** — Output images (served at `/generated/:projectId/:campaignId/:filename`).

## API (for n8n)

- `GET /api/projects` — List projects.
- `POST /api/projects` — Create project (body: `{ name }`).
- `GET /api/projects/:projectId/campaigns` — List campaigns.
- `GET /api/projects/:projectId/campaigns/:campaignId/latest` — Latest webContentUrls for a campaign.
- `POST /api/projects/:projectId/campaigns/:campaignId/run` — Run campaign now; returns `{ webContentUrls, webContentBase64 }` (base64 for in-app display).
- `GET /generated/:projectId/:campaignId/:filename` — Serve generated image (the webContentUrl target).

Schedule runs in the server’s local time (set `TZ` env var if needed, e.g. `TZ=America/New_York`).
