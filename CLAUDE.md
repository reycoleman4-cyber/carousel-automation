# Carousel Automation — CLAUDE.md

## Project Overview
Self-hosted TikTok carousel automation hub. Users create **Projects** (one per TikTok account), organize content into **Campaigns** (each with 3 image folders), and the app generates carousel images/videos with text overlays on a schedule. Posts are sent to TikTok via the Blotato API.

Multi-tenant: Supabase auth is optional. Without it, the app runs single-user with no login.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express 4.21 |
| Frontend | Vanilla JS SPA (no framework) |
| Auth / DB | Supabase (optional) |
| Image processing | Sharp |
| Video encoding | fluent-ffmpeg |
| Scheduling | node-cron |
| File uploads | Multer |
| ZIP export | Archiver |
| Posting | Blotato API (external) |

---

## Key Directories

```
/public/        Frontend SPA — index.html, app.js, styles.css
/data/          Local JSON persistence — projects, campaigns, runs, usage tracking
/uploads/       Raw user images — scoped by userId/projectId/campaignId/folder{1,2,3}/
/generated/     Post-processed carousel images and videos
```

---

## Key Files

| File | Purpose |
|---|---|
| [server.js](server.js) | Express API, all business logic, cron scheduler |
| [storage.js](storage.js) | Abstraction: local filesystem ↔ Supabase Storage |
| [worker.js](worker.js) | Optional VPS sidecar for offloading ffmpeg encoding |
| [public/app.js](public/app.js) | Entire frontend — routing, API calls, DOM rendering |
| [supabase-schema.sql](supabase-schema.sql) | DB schema: profiles, team_members, RLS policies |

---

## Build / Run Commands

```bash
npm start          # Production server (port 3721 default)
npm run dev        # Dev with --watch auto-restart
npm run worker     # Start VPS encoding worker
```

No test suite exists.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3721) |
| `DATA_DIR` | Data root for Railway volumes (default `./data`) |
| `SUPABASE_URL` | Enables Supabase auth + storage when set |
| `SUPABASE_ANON_KEY` | Client-side Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key |
| `ENCODING_MODE` | Set to `worker` to offload ffmpeg to worker.js |

---

## Deployment

Docker-ready via [Dockerfile](Dockerfile). Railway-compatible via [railway.json](railway.json) and [Procfile](Procfile).

Railway volumes: mount at `/data` and set `DATA_DIR=/data` for persistence across redeploys.

See [RAILWAY_DEPLOY.md](RAILWAY_DEPLOY.md), [SUPABASE-STORAGE.md](SUPABASE-STORAGE.md), [VPS-WORKER.md](VPS-WORKER.md) for deployment details.

---

## Additional Documentation

| File | When to check it |
|---|---|
| [.claude/docs/architectural_patterns.md](.claude/docs/architectural_patterns.md) | Before adding routes, data access, frontend views, or media pipeline logic |
