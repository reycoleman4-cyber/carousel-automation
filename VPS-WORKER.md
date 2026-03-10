# VPS encoding worker

When video encoding is heavy (e.g. many users or long clips), you can run encoding on a separate VPS so the main app (e.g. Railway) does not run ffmpeg.

## 1. App (Railway)

Set these environment variables:

- **`ENCODING_MODE`** = `worker`
- **`ENCODING_WORKER_SECRET`** = a long random secret (e.g. run `openssl rand -hex 32` and paste the result)

## 2. VPS (e.g. Hetzner)

- Install Node.js and ffmpeg:
  ```bash
  apt update && apt install -y ffmpeg nodejs npm
  ```
- Clone or copy this repo onto the VPS. At minimum you need: `worker.js`, `storage.js`, `package.json`. Then run `npm install`.
- Create a `.env` file in the project root with:
  - **`RAILWAY_APP_URL`** = your app URL (e.g. `https://your-app.up.railway.app`)
  - **`ENCODING_WORKER_SECRET`** = same value as on the app
  - **`SUPABASE_URL`** = your Supabase project URL
  - **`SUPABASE_SERVICE_ROLE_KEY`** = your Supabase service role key (same as the app, so the worker can upload to the `generated` bucket)
- Run the worker:
  ```bash
  node worker.js
  ```
  Or: `npm run worker`. Keep it running (e.g. with systemd or PM2).

## 3. Behavior

- **Run now** and the **scheduler** enqueue **video** and **video (add text)** jobs instead of running ffmpeg on the app.
- The worker polls `GET /api/encoding/jobs/next`, downloads the source video, runs ffmpeg (or copies for video-only), uploads the result to Supabase, then calls `POST /api/encoding/jobs/:id/complete`. The app then sends to Blotato and updates run outcomes.
- **Photo** campaigns and **lyric preset** overlays still run on the app (no worker).

## 4. Optional: run worker as a service (systemd)

Create `/etc/systemd/system/carousel-worker.service`:

```ini
[Unit]
Description=Carousel encoding worker
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/your/repo
ExecStart=/usr/bin/node worker.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:

```bash
systemctl daemon-reload
systemctl enable carousel-worker
systemctl start carousel-worker
systemctl status carousel-worker
```

Use the same `.env` path or set `EnvironmentFile=/path/to/your/repo/.env` in the `[Service]` section.
