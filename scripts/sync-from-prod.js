#!/usr/bin/env node
/**
 * Syncs ALL production data to your local data directory:
 *   - projects, campaigns, trends, logins, text-presets metadata, recurring-pages
 *   - Project / campaign / trend / login avatar images
 *   - Text preset video files
 *
 * Run: npm run sync
 * Requires in .env.local: PROD_URL, ENCODING_WORKER_SECRET, SYNC_USER_ID
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const fs = require('fs');

const PROD_URL = (process.env.PROD_URL || '').replace(/\/$/, '');
const SECRET   = process.env.ENCODING_WORKER_SECRET;
const USER_ID  = process.env.SYNC_USER_ID;
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

if (!PROD_URL || !SECRET || !USER_ID) {
  console.error('Missing required vars in .env.local: PROD_URL, ENCODING_WORKER_SECRET, SYNC_USER_ID');
  process.exit(1);
}

const safeId = String(USER_ID).replace(/[/\\]/g, '_');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

/** Download a URL to a local file path. Returns true on success, false if 404. */
async function downloadFile(url, destPath, headers = {}) {
  const res = await fetch(url, { headers });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return true;
}

/** Download an avatar from a public endpoint. Tries .jpg extension first (server serves whatever is stored). */
async function downloadAvatar(endpoint, destPath) {
  try {
    const res = await fetch(`${PROD_URL}/api${endpoint}`);
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath + ext, buf);
    return true;
  } catch {
    return false;
  }
}

async function sync() {
  console.log(`Fetching production data from ${PROD_URL}...`);
  const res = await fetch(
    `${PROD_URL}/api/admin/export-data?userId=${encodeURIComponent(USER_ID)}`,
    { headers: { Authorization: `Bearer ${SECRET}` } },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Export failed ${res.status}: ${txt}`);
  }
  const { projects, campaigns, textPresets, trends, logins, recurringPages } = await res.json();

  // --- Write JSON files ---
  const dirs = {
    projects:       path.join(DATA_DIR, 'projects'),
    campaigns:      path.join(DATA_DIR, 'campaigns'),
    textPresets:    path.join(DATA_DIR, 'text-presets'),
    trends:         path.join(DATA_DIR, 'trends'),
    logins:         path.join(DATA_DIR, 'logins'),
    recurringPages: path.join(DATA_DIR, 'recurring-pages'),
  };
  Object.values(dirs).forEach(ensureDir);

  fs.writeFileSync(path.join(dirs.projects,       `${safeId}.json`), JSON.stringify(projects,       null, 2));
  fs.writeFileSync(path.join(dirs.campaigns,       `${safeId}.json`), JSON.stringify(campaigns,       null, 2));
  fs.writeFileSync(path.join(dirs.textPresets,     `${safeId}.json`), JSON.stringify(textPresets,     null, 2));
  fs.writeFileSync(path.join(dirs.trends,          `${safeId}.json`), JSON.stringify(trends,          null, 2));
  fs.writeFileSync(path.join(dirs.logins,          `${safeId}.json`), JSON.stringify(logins,          null, 2));
  fs.writeFileSync(path.join(dirs.recurringPages,  `${safeId}.json`), JSON.stringify(recurringPages,  null, 2));

  const projectItems  = (projects.items  || []);
  const campaignItems = (campaigns.items || []);
  const trendItems    = (trends.items    || []);
  const loginItems    = (logins.items    || []);
  const presets       = (textPresets.presets || []);

  console.log(`Saved: ${projectItems.length} projects, ${campaignItems.length} campaigns, ${trendItems.length} trends, ${loginItems.length} logins, ${presets.length} text presets`);

  // --- Download avatars ---
  const avatarsDir         = path.join(DATA_DIR, 'avatars');
  const campaignAvatarsDir = path.join(DATA_DIR, 'campaign-avatars');
  const trendAvatarsDir    = path.join(DATA_DIR, 'trend-avatars');
  const loginAvatarsDir    = path.join(DATA_DIR, 'login-avatars');
  [avatarsDir, campaignAvatarsDir, trendAvatarsDir, loginAvatarsDir].forEach(ensureDir);

  let avatarCount = 0;

  for (const p of projectItems) {
    // Remove old avatar files for this project before downloading
    ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].forEach((ext) => {
      const f = path.join(avatarsDir, `${p.id}${ext}`);
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
    });
    const ok = await downloadAvatar(`/projects/${p.id}/avatar`, path.join(avatarsDir, String(p.id)));
    if (ok) avatarCount++;
  }

  for (const c of campaignItems) {
    const ok = await downloadAvatar(`/campaigns/${c.id}/avatar`, path.join(campaignAvatarsDir, String(c.id)));
    if (ok) avatarCount++;
  }

  for (const t of trendItems) {
    const ok = await downloadAvatar(`/trends/${t.id}/avatar`, path.join(trendAvatarsDir, String(t.id)));
    if (ok) avatarCount++;
  }

  for (const l of loginItems) {
    const ok = await downloadAvatar(`/logins/${l.id}/avatar`, path.join(loginAvatarsDir, String(l.id)));
    if (ok) avatarCount++;
  }

  console.log(`Downloaded ${avatarCount} avatar images`);

  // --- Download text preset video files ---
  const presetDir = path.join(DATA_DIR, 'text-presets', safeId);
  ensureDir(presetDir);
  let presetFileCount = 0;

  for (const preset of presets) {
    if (!preset.id || !preset.filename) continue;
    const destPath = path.join(presetDir, preset.filename);
    if (fs.existsSync(destPath)) {
      console.log(`  Preset "${preset.name}" already exists locally, skipping`);
      presetFileCount++;
      continue;
    }
    try {
      const ok = await downloadFile(
        `${PROD_URL}/api/encoding/preset-file?userId=${encodeURIComponent(USER_ID)}&presetId=${encodeURIComponent(preset.id)}`,
        destPath,
        { Authorization: `Bearer ${SECRET}` },
      );
      if (ok) { console.log(`  Downloaded preset "${preset.name}"`); presetFileCount++; }
      else console.warn(`  Preset "${preset.name}" not found on server (skipped)`);
    } catch (e) {
      console.warn(`  Failed to download preset "${preset.name}": ${e.message}`);
    }
  }

  console.log(`Downloaded ${presetFileCount}/${presets.length} text preset video files`);
  console.log('Sync complete. Refresh your browser to see the updated data.');
}

sync().catch(e => { console.error(e.message); process.exit(1); });
