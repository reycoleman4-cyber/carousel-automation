# Architectural Patterns

Patterns confirmed to appear in 3+ locations. Check these before adding new features.

---

## 1. JSON Persistence — `readJson` / `writeJson`

All server-side data is stored as JSON files under `data/`. Never read/write JSON files directly — use the helpers.

- Helpers defined at [server.js:264-275](../../server.js#L264)
- Called at: [server.js:236](../../server.js#L236), [server.js:253](../../server.js#L253), [server.js:279](../../server.js#L279), [server.js:311](../../server.js#L311), [server.js:378](../../server.js#L378)

`readJson(filePath, defaultValue)` returns the default if the file doesn't exist. `writeJson(filePath, data)` always writes with 2-space indentation.

---

## 2. Auth Middleware + `requireUserId`

Two-layer auth pattern on all protected routes:

- `authMiddleware` defined at [server.js:54-64](../../server.js#L54) — validates JWT from `Authorization: Bearer` header or `access_token` query param, sets `req.user = { id, email }`.
- `requireUserId(req, res)` defined at [server.js:199-206](../../server.js#L199) — returns `req.user.id` or sends a 401 and returns null.

Usage pattern in routes:
```
const uid = requireUserId(req, res);
if (!uid) return;
```

Used at: [server.js:3290](../../server.js#L3290), [server.js:3437](../../server.js#L3437), [server.js:3481](../../server.js#L3481)

---

## 3. User-Scoped File Paths

All data paths are scoped by a sanitized userId to isolate multi-tenant data.

Sanitization pattern: `String(userId).replace(/[/\\]/g, '_')`

Examples:
- `getProjectsPath(userId)` — [server.js:220](../../server.js#L220)
- `getCampaignsPath(userId)` — [server.js:225](../../server.js#L225)
- `campaignDirs(uid, projectId, campaignId)` — [server.js:563](../../server.js#L563)
- `generatedDir(uid, projectId, campaignId)` — [server.js:577](../../server.js#L577)
- `imageUsagePath(userId, projectId, ...)` — [server.js:686](../../server.js#L686)
- `videoPostedPath(userId, projectId, ...)` — [server.js:752](../../server.js#L752)

Always sanitize userId before using it in a path.

---

## 4. Storage Abstraction — Local ↔ Supabase

[storage.js](../../storage.js) wraps all file I/O. The app never calls `fs.*` directly for uploads or generated files — it calls storage functions.

- Switch logic: [storage.js:14](../../storage.js#L14) — `const useSupabase = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)`
- Each exported function branches: Supabase SDK path vs local `fs.*` path
- Examples of branching: [storage.js:118-126](../../storage.js#L118) (`readFileBuffer`), [storage.js:147-152](../../storage.js#L147) (`getFileUrl`)

Key exports: `listImages`, `listVideos`, `readFileBuffer`, `uploadFile`, `getFileUrl`, `deleteFile`, `uploadGenerated`, `getGeneratedUrl`, `readGeneratedBuffer`

---

## 5. Least-Used Selection Algorithm

Used in three places to avoid repeating content. Pattern: track usage counts per item → pick the item(s) with the minimum count → random-pick among ties → persist the incremented count.

- Images: [server.js:710-720](../../server.js#L710) — `pickLeastUsedImage()`
- Videos: [server.js:803-813](../../server.js#L803) — same logic
- Text options: [server.js:842-858](../../server.js#L842) — `pickLeastUsedTextOptionAndIncrement()`

Usage persistence: `incrementImageUsage()` at [server.js:700](../../server.js#L700), `incrementVideoUsage()` at [server.js:739](../../server.js#L739), `writeTextOptionUsage()` at [server.js:832](../../server.js#L832).

---

## 6. Error Response Pattern

All route handlers return errors as JSON with an explicit HTTP status code. No HTML error pages.

```
res.status(CODE).json({ error: 'message string' })
```

Examples: [server.js:202](../../server.js#L202) (401), [server.js:1812](../../server.js#L1812) (500), [server.js:1820](../../server.js#L1820) (400), [server.js:2189](../../server.js#L2189) (404), [server.js:3300](../../server.js#L3300) (400)

Internal logic throws `new Error('...')` and routes catch + convert to this format.

---

## 7. Frontend Hash Router

The SPA uses `window.location.hash` for client-side routing. No router library.

- `getRoute()` at [app.js:901-962](../../public/app.js#L901) — parses hash segments into `{ view, ...params }`
- `render()` at [app.js:5512-5589](../../public/app.js#L5512) — calls `getRoute()` then dispatches to the appropriate render function
- Navigation: `window.location.hash = '#/path'` scattered throughout app.js

Adding a new view requires: a new branch in `getRoute()` and a corresponding case in `render()`.

---

## 8. Frontend Fetch Wrapper — `apiWithAuth`

All backend API calls go through a shared auth-injecting wrapper. Never call `fetch()` directly.

- `getAuthHeaders()` at [app.js:799-804](../../public/app.js#L799) — pulls Supabase session token, returns `{ Authorization: 'Bearer ...' }` or `{}`
- `apiWithAuth(url, options)` at [app.js:816-820](../../public/app.js#L816) — merges auth headers into every request

All API helper functions (e.g., `apiProjects()` at [app.js:235](../../public/app.js#L235), `apiRunCampaign()` at [app.js:499](../../public/app.js#L499)) follow this pattern:
```
return apiWithAuth(`${API}/api/...`, { method, headers, body }).then(r => r.json())
```

---

## 9. Campaign Run Pipeline

Entry point: POST route at [server.js:3289](../../server.js#L3289)

Sequence:
1. `requireUserId()` — auth check
2. `getCampaignById()` — load campaign
3. `getPostType()` — load post type config
4. If `ENCODING_MODE=worker` — enqueue job, return early
5. `runCampaignPipeline()` at [server.js:3343](../../server.js#L3343) — selects media, processes, returns URLs
6. `sendToBlotato()` at [server.js:3345](../../server.js#L3345) — posts to TikTok if API key configured
7. `appendRunOutcome()` — logs result

When adding new post types, the pipeline branch lives inside `runCampaignPipeline()`.

---

## 10. Video Posted Tracking (7-Day Retention)

Prevents recently-posted videos from being reused. Tracked per `userId/projectId/campaignId/postTypeId`.

- `markVideoPosted()` — [server.js:750](../../server.js#L750)
- `readVideoPosted()` — [server.js:756](../../server.js#L756)
- `cleanupPostedVideosOlderThan7Days()` — [server.js:779](../../server.js#L779)
- Retention constants: `VIDEO_POSTED_RETENTION_DAYS = 7`, `MS_PER_DAY = 86400000` at [server.js:775-776](../../server.js#L775)

---

## 11. Recurring Pages Pattern

"Recurring Pages" are projects that get a special auto-created campaign named "Recurring posts". They're treated as persistent/evergreen content rather than scheduled campaigns.

- Route parsing: [app.js:946-960](../../public/app.js#L946)
- Render logic (auto-creates the campaign if missing): [app.js:5530-5584](../../public/app.js#L5530)
- Global nav flags: `fromRecurringPages`, `projectContentMode` near [app.js:899](../../public/app.js#L899)
