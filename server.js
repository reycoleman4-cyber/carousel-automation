const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const archiver = require('archiver');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const cron = require('node-cron');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const storage = require('./storage');

const PORT = process.env.PORT || 3721;
const ROOT = path.resolve(__dirname);
// Railway Volumes: set DATA_DIR, GENERATED_DIR, UPLOADS_DIR to your volume paths so all data persists across redeploys.
// Example: mount volume at /data, then DATA_DIR=/data, GENERATED_DIR=/data/generated, UPLOADS_DIR=/data/uploads
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const GENERATED = process.env.GENERATED_DIR ? path.resolve(process.env.GENERATED_DIR) : path.join(DATA, 'generated');
const UPLOADS = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(DATA, 'uploads');
const PROJECTS_PATH = path.join(DATA, 'projects.json');
const CAMPAIGNS_PATH = path.join(DATA, 'campaigns.json');
const PROJECTS_DIR = path.join(DATA, 'projects');
const CAMPAIGNS_DIR = path.join(DATA, 'campaigns');
const CONFIG_PATH = path.join(DATA, 'config.json');
const LOGINS_DIR = path.join(DATA, 'logins');
const LOGINS_PATH = path.join(DATA, 'logins.json'); // legacy global path (migrated on first access)
const RUNS_DIR = path.join(DATA, 'runs');
const RUN_OUTCOMES_PATH = path.join(DATA, 'run-outcomes.json');
const ENCODING_QUEUE_PATH = path.join(DATA, 'encoding-queue.json');
const TEXT_USAGE_DIR = path.join(DATA, 'text-usage');
const IMAGE_USAGE_DIR = path.join(DATA, 'image-usage');
const VIDEO_USAGE_DIR = path.join(DATA, 'video-usage');
const VIDEO_POSTED_DIR = path.join(DATA, 'video-posted');
const AVATARS_DIR = path.join(DATA, 'avatars');
const CAMPAIGN_AVATARS_DIR = path.join(DATA, 'campaign-avatars');
const TREND_AVATARS_DIR = path.join(DATA, 'trend-avatars');
const LOGIN_AVATARS_DIR = path.join(DATA, 'login-avatars');
const TRENDS_DIR = path.join(DATA, 'trends');
const TEXT_PRESETS_DIR = path.join(DATA, 'text-presets');
const RECURRING_PAGES_DIR = path.join(DATA, 'recurring-pages');

const app = express();
app.use(cors());
app.use(express.json());

// Supabase admin client for auth + profiles/team (optional)
let supabaseAdmin = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authMiddleware(req, res, next) {
  req.user = null;
  let token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token && req.query.access_token) token = req.query.access_token;
  if (!token || !supabaseAdmin) return next();
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && user) req.user = { id: user.id, email: user.email };
  } catch (_) {}
  next();
}

// Health check for Railway/load balancers
app.get('/health', (req, res) => res.status(200).send('ok'));

const api = express.Router();
api.use(authMiddleware);

const DEFAULT_TEXT_OPTIONS = [
  'Follow for more',
  'Like & Save',
  'Comment below',
  'Link in bio',
  'Share with a friend',
  'Double tap if you agree',
];

// --- Data helpers ---
function ensureDataDir() {
  if (!fsSync.existsSync(DATA)) fsSync.mkdirSync(DATA, { recursive: true });
  if (!fsSync.existsSync(RUNS_DIR)) fsSync.mkdirSync(RUNS_DIR, { recursive: true });
  if (!fsSync.existsSync(TEXT_USAGE_DIR)) fsSync.mkdirSync(TEXT_USAGE_DIR, { recursive: true });
  if (!fsSync.existsSync(IMAGE_USAGE_DIR)) fsSync.mkdirSync(IMAGE_USAGE_DIR, { recursive: true });
  if (!fsSync.existsSync(AVATARS_DIR)) fsSync.mkdirSync(AVATARS_DIR, { recursive: true });
  if (!fsSync.existsSync(CAMPAIGN_AVATARS_DIR)) fsSync.mkdirSync(CAMPAIGN_AVATARS_DIR, { recursive: true });
  if (!fsSync.existsSync(LOGIN_AVATARS_DIR)) fsSync.mkdirSync(LOGIN_AVATARS_DIR, { recursive: true });
  if (!fsSync.existsSync(PROJECTS_DIR)) fsSync.mkdirSync(PROJECTS_DIR, { recursive: true });
  if (!fsSync.existsSync(CAMPAIGNS_DIR)) fsSync.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
  if (!fsSync.existsSync(TRENDS_DIR)) fsSync.mkdirSync(TRENDS_DIR, { recursive: true });
  if (!fsSync.existsSync(TEXT_PRESETS_DIR)) fsSync.mkdirSync(TEXT_PRESETS_DIR, { recursive: true });
  if (!fsSync.existsSync(RECURRING_PAGES_DIR)) fsSync.mkdirSync(RECURRING_PAGES_DIR, { recursive: true });
  if (!fsSync.existsSync(VIDEO_POSTED_DIR)) fsSync.mkdirSync(VIDEO_POSTED_DIR, { recursive: true });
}

/** Run outcomes for calendar: success/failure per (projectId, campaignId, postTypeId, scheduledAt). Prune older than 14 days. */
const RUN_OUTCOMES_RETENTION_DAYS = 14;
async function readRunOutcomes() {
  const raw = await fs.readFile(RUN_OUTCOMES_PATH, 'utf8').catch(() => '[]');
  let list = [];
  try {
    list = JSON.parse(raw);
  } catch (_) {}
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RUN_OUTCOMES_RETENTION_DAYS);
  const cutoffMs = cutoff.getTime();
  const kept = list.filter((o) => new Date(o.scheduledAt).getTime() >= cutoffMs);
  if (kept.length !== list.length) {
    await fs.writeFile(RUN_OUTCOMES_PATH, JSON.stringify(kept), 'utf8').catch(() => {});
  }
  return kept;
}

async function appendRunOutcome(projectId, campaignId, postTypeId, scheduledAt, status, errorMessage = null) {
  ensureDataDir();
  const list = await readRunOutcomes();
  list.push({
    projectId: String(projectId),
    campaignId: String(campaignId),
    postTypeId: String(postTypeId),
    scheduledAt,
    status,
    error: errorMessage || undefined,
  });
  await fs.writeFile(RUN_OUTCOMES_PATH, JSON.stringify(list), 'utf8').catch((e) => console.error('[run-outcomes] write failed', e.message));
}

/** Returns a map keyed by `${projectId}|${campaignId}|${postTypeId}|${scheduledAt}` -> { status } */
function runOutcomesByKey(outcomes) {
  const map = {};
  for (const o of outcomes) {
    map[`${o.projectId}|${o.campaignId}|${o.postTypeId}|${o.scheduledAt}`] = o;
  }
  return map;
}

// --- Encoding job queue (for VPS worker when ENCODING_MODE=worker) ---
async function readEncodingQueue() {
  ensureDataDir();
  const raw = await fs.readFile(ENCODING_QUEUE_PATH, 'utf8').catch(() => '{}');
  try {
    const data = JSON.parse(raw);
    return {
      nextId: data.nextId || 1,
      jobs: data.jobs || {},
      pendingIds: Array.isArray(data.pendingIds) ? data.pendingIds : [],
    };
  } catch (_) {
    return { nextId: 1, jobs: {}, pendingIds: [] };
  }
}

async function writeEncodingQueue(data) {
  ensureDataDir();
  await fs.writeFile(ENCODING_QUEUE_PATH, JSON.stringify(data, null, 0), 'utf8');
}

async function enqueueEncodingJob(payload) {
  const q = await readEncodingQueue();
  const id = String(q.nextId);
  q.nextId = q.nextId + 1;
  q.jobs[id] = {
    id,
    status: 'pending',
    payload,
    result: null,
    createdAt: new Date().toISOString(),
  };
  q.pendingIds.push(id);
  await writeEncodingQueue(q);
  return id;
}

async function claimNextEncodingJob() {
  const q = await readEncodingQueue();
  const id = q.pendingIds.shift();
  if (!id || !q.jobs[id]) return null;
  q.jobs[id].status = 'claimed';
  q.jobs[id].claimedAt = new Date().toISOString();
  await writeEncodingQueue(q);
  return q.jobs[id];
}

async function completeEncodingJob(id, result) {
  const q = await readEncodingQueue();
  if (!q.jobs[id]) return;
  q.jobs[id].status = result && result.error ? 'failed' : 'completed';
  q.jobs[id].result = result || null;
  q.jobs[id].completedAt = new Date().toISOString();
  await writeEncodingQueue(q);
}

function getEncodingJob(id) {
  return readEncodingQueue().then((q) => q.jobs[id] || null);
}

/** Returns req.user.id or sends 401 and null. Use for routes that must be per-user. */
function requireUserId(req, res) {
  if (!req.user || !req.user.id) {
    res.status(401).json({ error: 'Sign in required' });
    return null;
  }
  return req.user.id;
}

/** Encoding worker auth: Bearer ENCODING_WORKER_SECRET or query.secret. Used for /api/encoding/jobs/next and .../complete. */
function requireEncodingWorker(req, res, next) {
  const secret = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret;
  const expected = process.env.ENCODING_WORKER_SECRET;
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Invalid encoding worker secret' });
  }
  next();
}

function getProjectsPath(userId) {
  if (!userId) return null;
  return path.join(PROJECTS_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
}

function getCampaignsPath(userId) {
  if (!userId) return null;
  return path.join(CAMPAIGNS_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
}

function getRecurringPagesPath(userId) {
  if (!userId) return null;
  return path.join(RECURRING_PAGES_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
}

function getRecurringPageIds(userId) {
  if (!userId) return [];
  const filePath = getRecurringPagesPath(userId);
  const data = readJson(filePath, { projectIds: [] });
  return Array.isArray(data.projectIds) ? data.projectIds : [];
}

function setRecurringPageIds(userId, projectIds) {
  if (!userId) return;
  ensureDataDir();
  const filePath = getRecurringPagesPath(userId);
  writeJson(filePath, { projectIds: projectIds.filter((id, i, a) => a.indexOf(id) === i) });
}

/** One-time: if user file missing but legacy single file exists, copy to user file. */
function migrateLegacyToUser(userId) {
  const pp = getProjectsPath(userId);
  const pc = getCampaignsPath(userId);
  if (!pp || !pc) return;
  if (!fsSync.existsSync(pp) && fsSync.existsSync(PROJECTS_PATH)) {
    const data = readJson(PROJECTS_PATH, { nextId: 1, items: [] });
    ensureDataDir();
    writeJson(pp, data);
  }
  if (!fsSync.existsSync(pc) && fsSync.existsSync(CAMPAIGNS_PATH)) {
    const data = readJson(CAMPAIGNS_PATH, { nextId: 1, items: [] });
    ensureDataDir();
    writeJson(pc, data);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback !== undefined ? fallback : {};
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getConfig() {
  const defaultBaseUrl = process.env.BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`);
  return readJson(CONFIG_PATH, { baseUrl: defaultBaseUrl });
}

function normalizeBaseUrl(baseUrl) {
  const s = (baseUrl || '').trim().replace(/\/$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

/** Base URL for generated/webContentUrls. Prefers Railway public URL over localhost so Blotato can fetch media. */
function getBaseUrlForGenerated(req = null) {
  const config = getConfig();
  let url = normalizeBaseUrl(config.baseUrl);
  if (!url || /localhost|127\.0\.0\.1/i.test(url)) {
    url = normalizeBaseUrl(process.env.BASE_URL) || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
  }
  if (!url && req && req.get('host')) {
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    url = `${proto}://${req.get('host')}`;
  }
  return url || `http://localhost:${PORT}`;
}

function setConfig(config) {
  writeJson(CONFIG_PATH, { ...getConfig(), ...config });
}

function getProjects(userId) {
  if (!userId) return [];
  migrateLegacyToUser(userId);
  const filePath = getProjectsPath(userId);
  const data = readJson(filePath, { nextId: 1, items: [] });
  return data.items || [];
}

function getProjectsMeta(userId) {
  if (!userId) return { nextId: 1, items: [] };
  migrateLegacyToUser(userId);
  const filePath = getProjectsPath(userId);
  const data = readJson(filePath, { nextId: 1, items: [] });
  return { nextId: data.nextId || 1, items: data.items || [] };
}

function saveProjects(items, nextId, userId) {
  if (!userId) return;
  ensureDataDir();
  const meta = getProjectsMeta(userId);
  const filePath = getProjectsPath(userId);
  writeJson(filePath, {
    nextId: nextId !== undefined ? nextId : meta.nextId,
    items: items || meta.items,
  });
}

function getCampaigns(projectId, userId) {
  if (!userId) return [];
  migrateLegacyToUser(userId);
  const filePath = getCampaignsPath(userId);
  const data = readJson(filePath, { nextId: 1, items: [] });
  const pid = typeof projectId === 'string' ? parseInt(projectId, 10) : projectId;
  const items = (data.items || []).filter((c) => {
    if (c.pageIds && Array.isArray(c.pageIds)) return c.pageIds.includes(pid);
    return c.projectId === pid;
  });
  return items;
}

function getAllCampaigns(userId) {
  if (!userId) return [];
  migrateLegacyToUser(userId);
  const filePath = getCampaignsPath(userId);
  const data = readJson(filePath, { nextId: 1, items: [] });
  return data.items || [];
}

function getCampaignsMeta(userId) {
  if (!userId) return { nextId: 1, items: [] };
  migrateLegacyToUser(userId);
  const filePath = getCampaignsPath(userId);
  const data = readJson(filePath, { nextId: 1, items: [] });
  return { nextId: data.nextId || 1, items: data.items || [] };
}

function getCampaignById(campaignId, userId) {
  const all = getAllCampaigns(userId);
  const id = typeof campaignId === 'string' ? parseInt(campaignId, 10) : campaignId;
  return all.find((c) => c.id === id || String(c.id) === String(campaignId));
}

function saveCampaign(campaign, userId) {
  if (!userId) return;
  ensureDataDir();
  const meta = getCampaignsMeta(userId);
  const items = [...(meta.items || [])];
  const idx = items.findIndex((c) => c.id === campaign.id);
  if (idx >= 0) items[idx] = campaign;
  else items.push(campaign);
  const nextId = campaign.id >= meta.nextId ? campaign.id + 1 : meta.nextId;
  writeJson(getCampaignsPath(userId), { nextId, items });
}

function deleteCampaign(campaignId, userId) {
  if (!userId) return;
  const meta = getCampaignsMeta(userId);
  const items = (meta.items || []).filter((c) => c.id !== campaignId);
  writeJson(getCampaignsPath(userId), { ...meta, items });
}

// --- Multi-user: shared campaign helpers ---

/**
 * For a given campaignId + requesting userId, returns the effective owner userId.
 * If the requesting user is a campaign_member, returns the owner's userId so all
 * file paths resolve to the owner's data. Returns requestingUserId if it's their own campaign.
 */
async function resolveEffectiveUserId(campaignId, requestingUserId) {
  if (!supabaseAdmin || !campaignId || !requestingUserId) return requestingUserId;
  try {
    const { data } = await supabaseAdmin
      .from('campaign_members')
      .select('owner_id')
      .eq('campaign_id', parseInt(campaignId, 10))
      .eq('member_id', requestingUserId)
      .maybeSingle();
    return data ? data.owner_id : requestingUserId;
  } catch { return requestingUserId; }
}

/**
 * Returns all campaigns shared with userId (where they are a member, not the owner).
 * Each campaign is tagged with _sharedOwnerId and _sharedOwnerUsername.
 */
async function getSharedCampaigns(userId) {
  if (!supabaseAdmin || !userId) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('campaign_members')
      .select('owner_id, campaign_id')
      .eq('member_id', userId);
    if (error || !data || !data.length) return [];
    const ownerIds = [...new Set(data.map((r) => r.owner_id))];
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id, username, full_name').in('id', ownerIds);
    const profileMap = (profiles || []).reduce((m, p) => { m[p.id] = p; return m; }, {});
    const result = [];
    for (const row of data) {
      const ownerCampaigns = getAllCampaigns(row.owner_id);
      const campaign = ownerCampaigns.find((c) => c.id === row.campaign_id);
      if (campaign) {
        const owner = profileMap[row.owner_id] || {};
        result.push({ ...campaign, _sharedOwnerId: row.owner_id, _sharedOwnerUsername: owner.username || row.owner_id });
      }
    }
    return result;
  } catch { return []; }
}

/** Get user settings from Supabase user_settings table. Falls back to global config for blotato key. */
async function getUserSettings(userId) {
  if (!supabaseAdmin || !userId) {
    const cfg = getConfig();
    return { blotatoApiKey: cfg.blotatoApiKey || '', timezone: process.env.TZ || 'America/New_York' };
  }
  try {
    const { data } = await supabaseAdmin.from('user_settings').select('blotato_api_key, timezone').eq('user_id', userId).maybeSingle();
    if (data) return { blotatoApiKey: data.blotato_api_key || '', timezone: data.timezone || process.env.TZ || 'America/New_York' };
    // Fall back to global config for existing single-user setups
    const cfg = getConfig();
    return { blotatoApiKey: cfg.blotatoApiKey || '', timezone: process.env.TZ || 'America/New_York' };
  } catch {
    const cfg = getConfig();
    return { blotatoApiKey: cfg.blotatoApiKey || '', timezone: process.env.TZ || 'America/New_York' };
  }
}

async function saveUserSettings(userId, settings) {
  if (!supabaseAdmin || !userId) { setConfig(settings); return; }
  try {
    await supabaseAdmin.from('user_settings').upsert({
      user_id: userId,
      blotato_api_key: settings.blotatoApiKey ?? '',
      timezone: settings.timezone ?? (process.env.TZ || 'America/New_York'),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch { setConfig(settings); }
}

// --- Per-user logins ---
function getLoginsPath(userId) {
  if (!userId) return LOGINS_PATH;
  const safe = String(userId).replace(/[/\\]/g, '_');
  fsSync.mkdirSync(path.join(DATA, 'logins'), { recursive: true });
  return path.join(DATA, 'logins', `${safe}.json`);
}

function getLoginsDataForUser(userId) {
  const userPath = getLoginsPath(userId);
  // Migrate from global logins.json on first access
  if (!fsSync.existsSync(userPath) && userId && fsSync.existsSync(LOGINS_PATH)) {
    try {
      const global = readJson(LOGINS_PATH, { nextId: 1, items: [] });
      writeJson(userPath, global);
    } catch (_) {}
  }
  return readJson(userPath, { nextId: 1, items: [] });
}

function getLoginsForUser(userId) { return (getLoginsDataForUser(userId).items || []).slice(); }

function saveLoginsForUser(userId, items, nextId) {
  const data = getLoginsDataForUser(userId);
  writeJson(getLoginsPath(userId), { nextId: nextId !== undefined ? nextId : data.nextId, items: items || data.items || [] });
}

// --- Trends (shared text at top, one folder of photos per page) ---
function getTrendsPath(userId) {
  if (!userId) return null;
  return path.join(TRENDS_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
}

function getTrendsMeta(userId) {
  if (!userId) return { nextId: 1, items: [] };
  ensureDataDir();
  const filePath = getTrendsPath(userId);
  const data = readJson(filePath, { nextId: 1, items: [] });
  return { nextId: data.nextId || 1, items: data.items || [] };
}

function getAllTrends(userId) {
  if (!userId) return [];
  const data = getTrendsMeta(userId);
  return data.items || [];
}

function getTrendById(trendId, userId) {
  const all = getAllTrends(userId);
  const id = typeof trendId === 'string' ? parseInt(trendId, 10) : trendId;
  return all.find((t) => t.id === id);
}

function saveTrend(trend, userId) {
  if (!userId) return;
  ensureDataDir();
  const meta = getTrendsMeta(userId);
  const items = [...(meta.items || [])];
  const idx = items.findIndex((t) => t.id === trend.id);
  if (idx >= 0) items[idx] = trend;
  else items.push(trend);
  const nextId = trend.id >= meta.nextId ? trend.id + 1 : meta.nextId;
  writeJson(getTrendsPath(userId), { nextId, items });
}

function deleteTrend(trendId, userId) {
  if (!userId) return;
  const meta = getTrendsMeta(userId);
  const items = (meta.items || []).filter((t) => t.id !== trendId);
  writeJson(getTrendsPath(userId), { ...meta, items });
}

function trendDirs(userId, trendId, pageCount) {
  const uid = String(userId).replace(/[/\\]/g, '_');
  const base = path.join(TRENDS_DIR, uid, String(trendId));
  const dirs = [];
  for (let i = 1; i <= pageCount; i++) dirs.push(path.join(base, String(i)));
  return dirs;
}

/** Per-page folder dirs: when folderCount is 1 returns [ base/pageIndex ]; when > 1 returns [ base/page_N/1, base/page_N/2, ... ]. */
function trendPageFolderDirs(userId, trendId, pageIndex, folderCount) {
  const uid = String(userId).replace(/[/\\]/g, '_');
  const base = path.join(TRENDS_DIR, uid, String(trendId));
  const n = Math.max(1, parseInt(folderCount, 10) || 1);
  const dirs = [];
  if (n === 1) {
    dirs.push(path.join(base, String(pageIndex)));
  } else {
    for (let f = 1; f <= n; f++) dirs.push(path.join(base, `page_${pageIndex}`, String(f)));
  }
  return dirs;
}

async function ensureTrendDirs(userId, trendId, pageIds, folderCount = 1) {
  const uid = String(userId).replace(/[/\\]/g, '_');
  const base = path.join(TRENDS_DIR, uid, String(trendId));
  const count = (pageIds && pageIds.length) ? pageIds.length : 0;
  const n = Math.max(1, parseInt(folderCount, 10) || 1);
  if (n === 1) {
    for (let i = 1; i <= count; i++) await fs.mkdir(path.join(base, String(i)), { recursive: true });
  } else {
    for (let i = 1; i <= count; i++) {
      for (let f = 1; f <= n; f++) await fs.mkdir(path.join(base, `page_${i}`, String(f)), { recursive: true });
    }
  }
}

function generatedDirForTrend(userId, trendId) {
  const uid = String(userId).replace(/[/\\]/g, '_');
  return path.join(GENERATED, uid, 'trends', String(trendId));
}

// --- Text presets (moving text / lyric overlays) ---
function getTextPresetsPath(userId) {
  if (!userId) return null;
  return path.join(TEXT_PRESETS_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
}

function getTextPresets(userId) {
  if (!userId) return [];
  ensureDataDir();
  const filePath = getTextPresetsPath(userId);
  const data = readJson(filePath, { nextId: 1, presets: [] });
  return Array.isArray(data.presets) ? data.presets : [];
}

function getTextPreset(userId, presetId) {
  const presets = getTextPresets(userId);
  const id = typeof presetId === 'string' ? presetId : String(presetId);
  return presets.find((p) => String(p.id) === id);
}

function getPresetDir(userId) {
  if (!userId) return null;
  const uid = String(userId).replace(/[/\\]/g, '_');
  return path.join(TEXT_PRESETS_DIR, uid);
}

function getPresetFilePath(userId, presetId) {
  const preset = getTextPreset(userId, presetId);
  if (!preset || !preset.filename) return null;
  const dir = getPresetDir(userId);
  return dir ? path.join(dir, preset.filename) : null;
}

/** Resolve preset path: if presetId is 'random', pick a random preset from the user's list; otherwise get that preset's path. */
function resolvePresetPath(userId, presetId) {
  if (!presetId) return null;
  if (String(presetId) === 'random') {
    const presets = getTextPresets(userId).filter((p) => p && p.id != null && p.filename);
    if (!presets.length) return null;
    const chosen = presets[Math.floor(Math.random() * presets.length)];
    return getPresetFilePath(userId, chosen.id);
  }
  return getPresetFilePath(userId, presetId);
}

/** Pick a preset ID for this run: randomly select from pt.textPresetIds array, or fall back to legacy pt.textPresetId. */
function getEffectivePresetId(pt) {
  if (Array.isArray(pt.textPresetIds) && pt.textPresetIds.length > 0) {
    return pt.textPresetIds[Math.floor(Math.random() * pt.textPresetIds.length)];
  }
  return pt.textPresetId || null;
}

function saveTextPreset(userId, preset) {
  if (!userId) return;
  ensureDataDir();
  const filePath = getTextPresetsPath(userId);
  const data = readJson(filePath, { nextId: 1, presets: [] });
  const presets = [...(data.presets || [])];
  const idx = presets.findIndex((p) => String(p.id) === String(preset.id));
  if (idx >= 0) presets[idx] = preset;
  else presets.push(preset);
  writeJson(filePath, { nextId: data.nextId || 1, presets });
}

function deleteTextPreset(userId, presetId) {
  const preset = getTextPreset(userId, presetId);
  if (!preset) return;
  const filePath = getPresetFilePath(userId, presetId);
  if (filePath && fsSync.existsSync(filePath)) {
    try { fsSync.unlinkSync(filePath); } catch (_) {}
  }
  const all = getTextPresets(userId).filter((p) => String(p.id) !== String(presetId));
  const metaPath = getTextPresetsPath(userId);
  const data = readJson(metaPath, { nextId: 1, presets: [] });
  writeJson(metaPath, { ...data, presets: all });
}

/** List all user IDs that have project/campaign data (for cron). */
function listUserIdsWithData() {
  ensureDataDir();
  const ids = new Set();
  try {
    for (const name of fsSync.readdirSync(PROJECTS_DIR)) {
      if (name.endsWith('.json')) ids.add(name.slice(0, -5));
    }
    for (const name of fsSync.readdirSync(CAMPAIGNS_DIR)) {
      if (name.endsWith('.json')) ids.add(name.slice(0, -5));
    }
  } catch (_) {}
  return Array.from(ids);
}

// --- Paths (userId required for per-profile isolation) ---
function campaignDirs(userId, projectId, campaignId, folderCount, postTypeId) {
  const uid = userId ? String(userId).replace(/[/\\]/g, '_') : '';
  const base = uid
    ? path.join(UPLOADS, uid, String(projectId), String(campaignId))
    : path.join(UPLOADS, String(projectId), String(campaignId));
  const ptBase = postTypeId && postTypeId !== 'default'
    ? path.join(base, `pt_${postTypeId}`)
    : base;
  const n = Math.max(1, parseInt(folderCount, 10) || 3);
  const dirs = [];
  for (let i = 1; i <= n; i++) dirs.push(path.join(ptBase, `folder${i}`));
  return dirs;
}

function generatedDir(userId, projectId, campaignId) {
  const uid = userId ? String(userId).replace(/[/\\]/g, '_') : '';
  return uid
    ? path.join(GENERATED, uid, String(projectId), String(campaignId))
    : path.join(GENERATED, String(projectId), String(campaignId));
}

async function ensureDirs(userId, projectId, campaignId, folderCount, postTypeId) {
  const dirs = [
    ...campaignDirs(userId, projectId, campaignId, folderCount, postTypeId),
    generatedDir(userId, projectId, campaignId),
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// --- Image pipeline (uses storage module when Supabase configured) ---
function parseFolderDir(dir) {
  const up = path.resolve(UPLOADS);
  const rel = path.relative(up, dir);
  const parts = rel.split(/[/\\]/).filter(Boolean);
  let userId = null;
  let projectId, campaignId;
  let postTypeId = 'default';
  let folderNum = 1;
  if (parts.length >= 4) {
    userId = parts[0];
    projectId = parts[1];
    campaignId = parts[2];
    if (parts[3]?.startsWith('pt_')) {
      postTypeId = parts[3].slice(3);
      if (parts[4]?.startsWith('folder')) folderNum = parseInt(parts[4].replace(/^folder/, ''), 10) || 1;
    } else if (parts[3]?.startsWith('folder')) {
      folderNum = parseInt(parts[3].replace(/^folder/, ''), 10) || 1;
    }
  } else if (parts.length >= 3) {
    projectId = parts[0];
    campaignId = parts[1];
    if (parts[2]?.startsWith('pt_')) {
      postTypeId = parts[2].slice(3);
      if (parts[3]?.startsWith('folder')) folderNum = parseInt(parts[3].replace(/^folder/, ''), 10) || 1;
    } else if (parts[2]?.startsWith('folder')) {
      folderNum = parseInt(parts[2].replace(/^folder/, ''), 10) || 1;
    }
  } else return null;
  return { userId, projectId, campaignId, postTypeId, folderNum };
}

async function listImages(dirOrParams) {
  if (storage.useSupabase()) {
    const p = typeof dirOrParams === 'string' ? parseFolderDir(dirOrParams) : dirOrParams;
    if (!p) return [];
    const items = await storage.listImages(p.projectId, p.campaignId, p.postTypeId, p.folderNum, p.userId);
    return items.map((i) => ({ ...i, ...p, path: i.localPath || i.storagePath }));
  }
  try {
    const dir = typeof dirOrParams === 'string' ? dirOrParams : null;
    if (!dir) return [];
    const names = await fs.readdir(dir);
    const files = [];
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.isFile() && /\.(jpg|jpeg|png|webp|gif)$/i.test(name)) files.push({ path: full, filename: name });
    }
    files.sort((a, b) => a.filename.localeCompare(b.filename));
    return files;
  } catch {
    return [];
  }
}

async function listVideos(dirOrParams) {
  if (storage.useSupabase()) {
    const p = typeof dirOrParams === 'string' ? parseFolderDir(dirOrParams) : dirOrParams;
    if (!p) return [];
    const items = await storage.listVideos(p.projectId, p.campaignId, p.postTypeId, p.folderNum, p.userId);
    return items.map((i) => ({ ...i, ...p, path: i.localPath || i.storagePath }));
  }
  try {
    const dir = typeof dirOrParams === 'string' ? dirOrParams : null;
    if (!dir) return [];
    const names = await fs.readdir(dir);
    const files = [];
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.isFile() && /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(name)) files.push({ path: full, filename: name });
    }
    files.sort((a, b) => a.filename.localeCompare(b.filename));
    return files;
  } catch {
    return [];
  }
}

async function getImageBuffer(item, folderIndex, folders, projectId, campaignId, postTypeId, userId) {
  if (storage.useSupabase()) {
    return storage.readFileBuffer(projectId, campaignId, postTypeId, folderIndex + 1, item.filename, userId);
  }
  return fs.readFile(item.path);
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Path for image usage counts per folder: { "filename": count }. */
function imageUsagePath(userId, projectId, campaignId, postTypeId, folderNum) {
  const safe = (s) => String(s).replace(/[/\\]/g, '_');
  return path.join(IMAGE_USAGE_DIR, `${safe(userId)}_${safe(projectId)}_${safe(campaignId)}_${safe(postTypeId)}_folder${folderNum}.json`);
}

async function readImageUsage(userId, projectId, campaignId, postTypeId, folderNum) {
  const p = imageUsagePath(userId, projectId, campaignId, postTypeId, folderNum);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (_) {
    return {};
  }
}

async function incrementImageUsage(userId, projectId, campaignId, postTypeId, folderNum, filename) {
  ensureDataDir();
  const usage = await readImageUsage(userId, projectId, campaignId, postTypeId, folderNum);
  const key = String(filename);
  usage[key] = (usage[key] || 0) + 1;
  const p = imageUsagePath(userId, projectId, campaignId, postTypeId, folderNum);
  await fs.writeFile(p, JSON.stringify(usage), 'utf8');
}

/** Pick image with lowest usage count (tie-break random). Does not increment. */
function pickLeastUsedImage(images, getUsage) {
  if (!images || images.length === 0) return null;
  const usage = getUsage();
  const withCount = images.map((img) => {
    const name = img.filename || (img.path && path.basename(img.path));
    return { img, count: usage[name] || 0 };
  });
  const minCount = Math.min(...withCount.map((x) => x.count));
  const leastUsed = withCount.filter((x) => x.count === minCount);
  return leastUsed[Math.floor(Math.random() * leastUsed.length)].img;
}

/** Path for video usage counts per folder: { "filename": count }. */
function videoUsagePath(userId, projectId, campaignId, postTypeId, folderNum) {
  const safe = (s) => String(s).replace(/[/\\]/g, '_');
  return path.join(VIDEO_USAGE_DIR, `${safe(userId)}_${safe(projectId)}_${safe(campaignId)}_${safe(postTypeId)}_folder${folderNum}.json`);
}

async function readVideoUsage(userId, projectId, campaignId, postTypeId, folderNum) {
  const p = videoUsagePath(userId, projectId, campaignId, postTypeId, folderNum);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (_) {
    return {};
  }
}

async function incrementVideoUsage(userId, projectId, campaignId, postTypeId, folderNum, filename) {
  ensureDataDir();
  const usage = await readVideoUsage(userId, projectId, campaignId, postTypeId, folderNum);
  const key = String(filename);
  usage[key] = (usage[key] || 0) + 1;
  const p = videoUsagePath(userId, projectId, campaignId, postTypeId, folderNum);
  await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => {});
  await fs.writeFile(p, JSON.stringify(usage), 'utf8');
}

/** "Videos (without text)" post type: track when a video was posted; it is only used once and deleted after 7 days. */
function videoPostedPath(userId, projectId, campaignId, postTypeId, folderNum) {
  const safe = (s) => String(s).replace(/[/\\]/g, '_');
  return path.join(VIDEO_POSTED_DIR, `${safe(userId)}_${safe(projectId)}_${safe(campaignId)}_${safe(postTypeId)}_folder${folderNum}.json`);
}

async function readVideoPosted(userId, projectId, campaignId, postTypeId, folderNum) {
  const p = videoPostedPath(userId, projectId, campaignId, postTypeId, folderNum);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (_) {
    return {};
  }
}

/** Mark a video as posted (for "videos without text" post type). Value is ISO timestamp. */
async function markVideoPosted(userId, projectId, campaignId, postTypeId, folderNum, filename) {
  ensureDataDir();
  const posted = await readVideoPosted(userId, projectId, campaignId, postTypeId, folderNum);
  posted[String(filename)] = new Date().toISOString();
  const p = videoPostedPath(userId, projectId, campaignId, postTypeId, folderNum);
  await fs.writeFile(p, JSON.stringify(posted), 'utf8');
}

const VIDEO_POSTED_RETENTION_DAYS = 7;
const MS_PER_DAY = 86400000;

/** Remove videos posted more than 7 days ago from storage and from the posted map. */
async function cleanupPostedVideosOlderThan7Days(userId, projectId, campaignId, postTypeId, folderNum) {
  const posted = await readVideoPosted(userId, projectId, campaignId, postTypeId, folderNum);
  const now = Date.now();
  let changed = false;
  for (const [filename, postedAt] of Object.entries(posted)) {
    const ageMs = now - new Date(postedAt).getTime();
    if (ageMs >= VIDEO_POSTED_RETENTION_DAYS * MS_PER_DAY) {
      try {
        await storage.deleteFile(projectId, campaignId, postTypeId, folderNum, filename, userId);
      } catch (e) {
        console.warn('[cleanup] delete failed:', filename, e.message);
      }
      delete posted[filename];
      changed = true;
    }
  }
  if (changed) {
    const p = videoPostedPath(userId, projectId, campaignId, postTypeId, folderNum);
    await fs.writeFile(p, JSON.stringify(posted), 'utf8');
  }
  return posted;
}

/** Pick video with lowest usage count (tie-break random). Does not increment. */
function pickLeastUsedVideo(videos, getUsage) {
  if (!videos || videos.length === 0) return null;
  const usage = getUsage();
  const withCount = videos.map((v) => {
    const name = v.filename || (v.path && path.basename(v.path));
    return { video: v, count: usage[name] || 0 };
  });
  const minCount = Math.min(...withCount.map((x) => x.count));
  const leastUsed = withCount.filter((x) => x.count === minCount);
  return leastUsed[Math.floor(Math.random() * leastUsed.length)].video;
}

/** Path for persisting text-option usage counts per campaign/postType (folder index -> array of counts). */
function textUsagePath(projectId, campaignId, postTypeId) {
  const safe = (s) => String(s).replace(/[/\\]/g, '_');
  return path.join(TEXT_USAGE_DIR, `${safe(projectId)}-${safe(campaignId)}-${safe(postTypeId)}.json`);
}

async function readTextOptionUsage(projectId, campaignId, postTypeId) {
  const p = textUsagePath(projectId, campaignId, postTypeId);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (_) {
    return {};
  }
}

async function writeTextOptionUsage(projectId, campaignId, postTypeId, data) {
  const p = textUsagePath(projectId, campaignId, postTypeId);
  await fs.writeFile(p, JSON.stringify(data), 'utf8');
}

/**
 * Pick one option from the list using least-used strategy: choose randomly among options
 * that have the minimum usage count, then increment that option's count and persist.
 * Returns the chosen text, or null if the list is empty (no text overlay).
 */
async function pickLeastUsedTextOptionAndIncrement(projectId, campaignId, postTypeId, folderIndex, options) {
  const opts = Array.isArray(options) ? options.filter((t) => t != null && String(t).trim()) : [];
  if (opts.length === 0) return null;
  const key = String(folderIndex);
  const usage = await readTextOptionUsage(projectId, campaignId, postTypeId);
  let counts = Array.isArray(usage[key]) ? usage[key] : [];
  while (counts.length < opts.length) counts.push(0);
  counts = counts.slice(0, opts.length);
  const minCount = Math.min(...counts);
  const leastUsedIndices = counts.map((c, i) => (c === minCount ? i : -1)).filter((i) => i >= 0);
  const chosenIndex = leastUsedIndices[Math.floor(Math.random() * leastUsedIndices.length)];
  counts[chosenIndex] = (counts[chosenIndex] || 0) + 1;
  const next = { ...usage, [key]: counts };
  await writeTextOptionUsage(projectId, campaignId, postTypeId, next);
  const chosen = String(opts[chosenIndex]).trim();
  return chosen || null;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap text into lines that fit within maxCharsPerLine (approx). Keeps text within media bounds. */
function wrapTextToLines(text, maxCharsPerLine) {
  const str = String(text).trim() || ' ';
  if (maxCharsPerLine < 5) return [str];
  const words = str.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (next.length <= maxCharsPerLine) {
      line = next;
    } else {
      if (line) lines.push(line);
      if (word.length > maxCharsPerLine) {
        for (let i = 0; i < word.length; i += maxCharsPerLine) lines.push(word.slice(i, i + maxCharsPerLine));
        line = '';
      } else {
        line = word;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [str];
}

const OUT_W = 1080;
const OUT_H = 1920;

async function addTextOverlay(imagePath, text, outputPath, textStyle = {}) {
  const hasText = text != null && typeof text === 'string' && String(text).trim().length > 0;
  if (!hasText) {
    const input = Buffer.isBuffer(imagePath) ? imagePath : imagePath;
    const resized = await sharp(input)
      .resize(OUT_W, OUT_H, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 90 })
      .toBuffer();
    if (outputPath) await fs.writeFile(outputPath, resized);
    return resized;
  }
  const raw = String(text).trim();
  const s = textStyle || {};
  let v = s.fontSize != null ? parseFloat(s.fontSize) : 0.06;
  if (isNaN(v) || v <= 0) v = 0.06;
  let fontSize;
  if (v >= 12 && v <= 200) {
    fontSize = Math.round(v);
  } else {
    const frac = v > 1 ? v / 100 : v;
    fontSize = frac * Math.min(OUT_W, OUT_H);
  }
  if (fontSize < 12) fontSize = 12;
  // X (%) = horizontal position only (left/right). Y (%) = vertical position only (up/down). No cross-axis use.
  let xPct = (s.x != null && s.x !== '' ? parseFloat(s.x) : 50);
  let yPct = (s.y != null && s.y !== '' ? parseFloat(s.y) : 92);
  if (isNaN(xPct)) xPct = 50;
  if (isNaN(yPct)) yPct = 92;
  if (xPct === 0) xPct = 50;  // 0 = center horizontally
  if (yPct === 0) yPct = 50;  // 0 = center vertically
  const horizontalCenterPx = Math.round((xPct / 100) * OUT_W);  // X axis only: left-right position
  const verticalCenterPx = Math.round((yPct / 100) * OUT_H);    // Y axis only: up-down position
  const marginX = Math.round(OUT_W * 0.08);
  const marginY = Math.round(OUT_H * 0.06);
  const safeWidth = OUT_W - 2 * marginX;
  const lineHeightPx = Math.round(fontSize * 1.25);
  const maxCharsPerLine = Math.max(8, Math.floor(safeWidth / (fontSize * 0.6)));
  const maxLines = Math.max(1, Math.floor((OUT_H - 2 * marginY) / lineHeightPx));
  let lines = wrapTextToLines(raw, maxCharsPerLine);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);
  const blockHeightPx = lines.length * lineHeightPx;
  const startY = verticalCenterPx - Math.round(blockHeightPx / 2) + Math.round(lineHeightPx / 2);
  // Map UI font choices to Linux fonts (librsvg needs single quoted font name)
  const fontMap = {
    'arial, sans-serif': "'Liberation Sans'",
    'helvetica, sans-serif': "'Liberation Sans'",
    'georgia, serif': "'Liberation Serif'",
    'times new roman, serif': "'Liberation Serif'",
    'verdana, sans-serif': "'DejaVu Sans'",
    'tahoma, sans-serif': "'Liberation Sans'",
    'trebuchet ms, sans-serif': "'Liberation Sans'",
    'impact, sans-serif': "'Liberation Sans'",
    'comic sans ms, cursive': "'DejaVu Sans'",
    'courier new, monospace': "'Liberation Mono'",
    'dm sans, sans-serif': "'DejaVu Sans'",
    'jetbrains mono, monospace': "'Liberation Mono'",
  };
  const fontKey = String(textStyle.font || 'Arial, sans-serif').trim().toLowerCase();
  const font = fontMap[fontKey] || "'DejaVu Sans'";
  const color = textStyle.color || 'white';
  let strokeWidth = Math.max(0, parseFloat(s.strokeWidth) || 2);
  const strokeColor = textStyle.strokeColor || 'black';
  const isLightFill = /^(white|#fff|#ffffff|rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(String(color).trim());
  if (isLightFill && strokeWidth < fontSize * 0.03) strokeWidth = Math.max(strokeWidth, Math.round(fontSize * 0.03));
  const tspans = lines.map((line, i) => {
    const verticalPx = startY + i * lineHeightPx;
    return `<tspan x="${horizontalCenterPx}" y="${verticalPx}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</tspan>`;
  }).join('\n        ');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${OUT_W} ${OUT_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.6"/>
        </filter>
      </defs>
      <text
        font-family="${escapeXml(font)}"
        font-size="${fontSize}"
        font-weight="bold"
        fill="${escapeXml(color)}"
        filter="url(#shadow)"
        style="stroke: ${escapeXml(strokeColor)}; stroke-width: ${strokeWidth}; paint-order: stroke fill;"
      >
        ${tspans}
      </text>
    </svg>
  `;
  const svgBuffer = Buffer.from(svg);
  const input = Buffer.isBuffer(imagePath) ? imagePath : imagePath;
  const resized = await sharp(input)
    .resize(OUT_W, OUT_H, { fit: 'cover', position: 'center' })
    .toBuffer();
  const outBuf = await sharp(resized)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
  if (outputPath) await fs.writeFile(outputPath, outBuf);
  return outBuf;
}

/** Build encoding job payload for VPS worker. Does selection + usage/posted updates; returns payload or null if run locally (photo, preset, or no Supabase). */
async function buildEncodingJobPayload(userId, projectId, campaignId, postTypeId, options = {}) {
  if (!storage.useSupabase()) return null;
  const campaign = getCampaignById(campaignId, userId);
  if (!campaign) return null;
  const pt = getPostType(campaign, postTypeId || 'default', projectId);
  if (!pt) return null;
  const projectIdStr = String(projectId);
  const campaignIdStr = String(campaignId);
  const runId = Date.now();
  const outputFilename = `video-${runId}.mp4`;

  if (pt.mediaType === 'video') {
    const folderCount = 2;
    await ensureDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
    const folders = campaignDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
    const priorityVideos = await listVideos(folders[0]);
    const fallbackVideos = await listVideos(folders[1]);
    const posted1 = await readVideoPosted(userId, projectIdStr, campaignIdStr, pt.id, 1);
    const posted2 = await readVideoPosted(userId, projectIdStr, campaignIdStr, pt.id, 2);
    const unposted = (list, posted) => list.filter((v) => {
      const name = v.filename || (v.path && path.basename(v.path));
      return name && !posted[name];
    });
    const unpostedPriority = unposted(priorityVideos, posted1);
    const unpostedFallback = unposted(fallbackVideos, posted2);
    let chosen = null;
    let folderNum = 0;
    if (unpostedPriority.length) {
      chosen = unpostedPriority[Math.floor(Math.random() * unpostedPriority.length)];
      folderNum = 1;
    } else if (unpostedFallback.length) {
      chosen = unpostedFallback[Math.floor(Math.random() * unpostedFallback.length)];
      folderNum = 2;
    }
    if (!chosen) throw new Error('No unposted videos in Priority or Fallback folders. Add new videos or wait for posted ones to be removed after 7 days.');
    const filename = chosen.filename || path.basename(chosen.path || chosen);
    await markVideoPosted(userId, projectIdStr, campaignIdStr, pt.id, folderNum, filename);
    const effectivePresetId1 = getEffectivePresetId(pt);
    const presetPath = effectivePresetId1 ? resolvePresetPath(userId, effectivePresetId1) : null;
    const hasPreset = presetPath && fsSync.existsSync(presetPath);
    const sourceUrl = storage.getFileUrl(projectIdStr, campaignIdStr, pt.id, folderNum, filename, userId);
    if (!sourceUrl) return null;
    const baseAppUrl = (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : process.env.BASE_URL || '').replace(/\/$/, '');
    const presetUrl = hasPreset ? `${baseAppUrl}/api/encoding/preset-file?userId=${encodeURIComponent(userId)}&presetId=${encodeURIComponent(effectivePresetId1)}` : null;
    return {
      type: hasPreset ? 'video_preset' : 'video',
      sourceUrl,
      presetUrl,
      presetId: hasPreset ? effectivePresetId1 : null,
      outputFilename,
      projectId: projectIdStr,
      campaignId: campaignIdStr,
      userId,
      runId,
      postTypeId: postTypeId || 'default',
      sendToBlotato: !!options.sendToBlotato,
      draft: !!options.draft,
      scheduledAt: options.scheduledAt || null,
    };
  }

  if (pt.mediaType === 'video_text') {
    const folderCount = 1;
    await ensureDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
    const folders = campaignDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
    const videos = await listVideos(folders[0]);
    const usage = await readVideoUsage(userId, projectIdStr, campaignIdStr, pt.id, 1);
    const chosen = pickLeastUsedVideo(videos, () => usage);
    if (!chosen) throw new Error('No videos in folder. Upload videos first.');
    const filename = chosen.filename || path.basename(chosen.path || chosen);
    await incrementVideoUsage(userId, projectIdStr, campaignIdStr, pt.id, 1, filename);
    const effectivePresetId2 = getEffectivePresetId(pt);
    const presetPath = effectivePresetId2 ? resolvePresetPath(userId, effectivePresetId2) : null;
    const hasPreset = presetPath && fsSync.existsSync(presetPath);
    const baseAppUrl2 = (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : process.env.BASE_URL || '').replace(/\/$/, '');
    const presetUrl2 = hasPreset ? `${baseAppUrl2}/api/encoding/preset-file?userId=${encodeURIComponent(userId)}&presetId=${encodeURIComponent(effectivePresetId2)}` : null;
    const sourceUrl = storage.getFileUrl(projectIdStr, campaignIdStr, pt.id, 1, filename, userId);
    if (!sourceUrl) return null;
    if (hasPreset) {
      return {
        type: 'video_preset',
        sourceUrl,
        presetUrl: presetUrl2,
        presetId: effectivePresetId2,
        outputFilename,
        projectId: projectIdStr,
        campaignId: campaignIdStr,
        userId,
        runId,
        postTypeId: postTypeId || 'default',
        sendToBlotato: !!options.sendToBlotato,
        draft: !!options.draft,
        scheduledAt: options.scheduledAt || null,
      };
    }
    const fromOverride = Array.isArray(options.textOptionsOverride) && options.textOptionsOverride.length && Array.isArray(options.textOptionsOverride[0]) ? options.textOptionsOverride[0] : null;
    const textOptions = fromOverride ?? (Array.isArray(pt.textOptionsPerFolder) && pt.textOptionsPerFolder.length > 0 ? pt.textOptionsPerFolder[0] : null) ?? (Array.isArray(campaign.textOptionsPerFolder) && campaign.textOptionsPerFolder.length > 0 ? campaign.textOptionsPerFolder[0] : null) ?? DEFAULT_TEXT_OPTIONS;
    const text = await pickLeastUsedTextOptionAndIncrement(projectIdStr, campaignIdStr, postTypeId || 'default', 0, textOptions);
    const textStyle = options.textStyleOverride && options.textStyleOverride[0] ? options.textStyleOverride[0] : (pt.textStylePerFolder && pt.textStylePerFolder[0]) || {};
    return {
      type: 'video_text',
      sourceUrl,
      text: text != null ? String(text).trim() : '',
      textStyle,
      outputFilename,
      projectId: projectIdStr,
      campaignId: campaignIdStr,
      userId,
      runId,
      postTypeId: postTypeId || 'default',
      sendToBlotato: !!options.sendToBlotato,
      draft: !!options.draft,
      scheduledAt: options.scheduledAt || null,
    };
  }

  return null;
}

async function runCampaignPipelineVideo(userId, projectId, campaignId, postTypeId) {
  const campaign = getCampaignById(campaignId, userId);
  if (!campaign) throw new Error('Campaign not found');
  const pt = getPostType(campaign, postTypeId || 'default', projectId);
  if (!pt) throw new Error('Post type not found');
  const projectIdStr = String(projectId);
  const campaignIdStr = String(campaignId);
  const folderCount = 2;
  await ensureDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
  const folders = campaignDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
  const baseUrl = getBaseUrlForGenerated();
  const priorityVideos = await listVideos(folders[0]);
  const fallbackVideos = await listVideos(folders[1]);
  const posted1 = await readVideoPosted(userId, projectIdStr, campaignIdStr, pt.id, 1);
  const posted2 = await readVideoPosted(userId, projectIdStr, campaignIdStr, pt.id, 2);
  const unposted = (list, posted) => list.filter((v) => {
    const name = v.filename || (v.path && path.basename(v.path));
    return name && !posted[name];
  });
  const unpostedPriority = unposted(priorityVideos, posted1);
  const unpostedFallback = unposted(fallbackVideos, posted2);
  let chosen = null;
  let folderNum = 0;
  if (unpostedPriority.length) {
    chosen = unpostedPriority[Math.floor(Math.random() * unpostedPriority.length)];
    folderNum = 1;
  } else if (unpostedFallback.length) {
    chosen = unpostedFallback[Math.floor(Math.random() * unpostedFallback.length)];
    folderNum = 2;
  }
  if (!chosen) throw new Error('No unposted videos in Priority or Fallback folders. Add new videos or wait for posted ones to be removed after 7 days.');
  const filename = chosen.filename || path.basename(chosen.path || chosen);
  await markVideoPosted(userId, projectIdStr, campaignIdStr, pt.id, folderNum, filename);
  const effectivePresetId3 = getEffectivePresetId(pt);
  const presetPath = effectivePresetId3 ? resolvePresetPath(userId, effectivePresetId3) : null;
  const runId = Date.now();
  if (presetPath && fsSync.existsSync(presetPath)) {
    let basePath;
    try {
      basePath = await getVideoPathForFfmpeg(userId, projectIdStr, campaignIdStr, pt.id, folderNum, filename);
      const outDir = generatedDir(userId, projectIdStr, campaignIdStr);
      const outName = `video-${runId}.mp4`;
      const outPath = path.join(outDir, outName);
      await overlayPresetOnVideo(basePath, presetPath, outPath, {});
      const uidSeg = String(userId).replace(/[/\\]/g, '_');
      let videoUrl;
      if (storage.useSupabase()) {
        const outBuf = await fs.readFile(outPath);
        await storage.uploadGenerated(projectIdStr, campaignIdStr, outName, outBuf, 'video/mp4', userId);
        await fs.unlink(outPath).catch(() => {});
        videoUrl = storage.getGeneratedUrl(projectIdStr, campaignIdStr, outName, userId);
      } else {
        videoUrl = `${baseUrl}/generated/${uidSeg}/${projectIdStr}/${campaignIdStr}/${outName}`;
      }
      const runData = {
        campaignId: campaignIdStr,
        runId,
        webContentUrls: [videoUrl],
        webContentBase64: [],
        usedSourcePaths: [],
        at: new Date().toISOString(),
      };
      await fs.writeFile(
        path.join(RUNS_DIR, `${campaignIdStr}.json`),
        JSON.stringify({ campaignId: campaignIdStr, runId: runData.runId, webContentUrls: runData.webContentUrls, at: runData.at }, null, 2)
      );
      if (basePath && basePath.startsWith(os.tmpdir())) await fs.unlink(basePath).catch(() => {});
      return runData;
    } catch (err) {
      if (basePath && basePath.startsWith(os.tmpdir())) await fs.unlink(basePath).catch(() => {});
      throw err;
    }
  }
  const uidSeg = String(userId).replace(/[/\\]/g, '_');
  const outName = `video-${runId}.mp4`;
  let videoBuffer;
  if (storage.useSupabase()) {
    videoBuffer = await storage.readFileBuffer(projectIdStr, campaignIdStr, pt.id, folderNum, filename, userId);
  } else {
    const folderPath = folders[folderNum - 1];
    videoBuffer = await fs.readFile(path.join(folderPath, filename));
  }
  let videoUrl;
  if (storage.useSupabase()) {
    await storage.uploadGenerated(projectIdStr, campaignIdStr, outName, videoBuffer, 'video/mp4', userId);
    videoUrl = storage.getGeneratedUrl(projectIdStr, campaignIdStr, outName, userId);
  } else {
    const outDir = generatedDir(userId, projectIdStr, campaignIdStr);
    await fs.mkdir(outDir, { recursive: true }).catch(() => {});
    await fs.writeFile(path.join(outDir, outName), videoBuffer);
    videoUrl = `${baseUrl}/generated/${uidSeg}/${projectIdStr}/${campaignIdStr}/${outName}`;
  }
  const runData = {
    campaignId: campaignIdStr,
    runId,
    webContentUrls: [videoUrl],
    webContentBase64: [],
    usedSourcePaths: [],
    at: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(RUNS_DIR, `${campaignIdStr}.json`),
    JSON.stringify({ campaignId: campaignIdStr, runId: runData.runId, webContentUrls: runData.webContentUrls, at: runData.at }, null, 2)
  );
  return runData;
}

/** Return a local file path for the video so ffmpeg can read it (downloads to temp if Supabase). */
async function getVideoPathForFfmpeg(userId, projectId, campaignId, postTypeId, folderNum, filename) {
  if (storage.useSupabase()) {
    const buf = await storage.readFileBuffer(projectId, campaignId, postTypeId, folderNum, filename, userId);
    const ext = path.extname(filename) || '.mp4';
    const tmpPath = path.join(os.tmpdir(), `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    await fs.writeFile(tmpPath, buf);
    return tmpPath;
  }
  const dirs = campaignDirs(userId, String(projectId), String(campaignId), 1, postTypeId);
  return path.join(dirs[0], filename);
}

/** Map color name or hex to ffmpeg drawtext fontcolor (0xRRGGBB). */
function fontColorToHex(str) {
  if (!str || typeof str !== 'string') return '0xFFFFFF';
  const s = str.trim().toLowerCase();
  const names = { white: '0xFFFFFF', black: '0x000000', red: '0xFF0000', green: '0x00FF00', blue: '0x0000FF', yellow: '0xFFFF00' };
  if (names[s]) return names[s];
  const hex = s.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return '0x' + hex.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) return '0x' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return '0xFFFFFF';
}

/** Normalize fontSize to pixels: 12–200 = px; otherwise treat as fraction (0.01–1 or 1–100%) of 720. */
function videoFontSizePx(textStyle) {
  const v = parseFloat(textStyle.fontSize);
  if (Number.isNaN(v) || v <= 0) return 48;
  if (v >= 12 && v <= 200) return Math.round(v);
  const frac = v > 1 ? v / 100 : v;
  return Math.max(12, Math.min(Math.round(720 * frac), 200));
}

/** Escape for ffmpeg drawtext text= value. Single-quote: use '\'' so value parses correctly. */
function escapeDrawtext(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

/** Escape path for use in ffmpeg filter (colons must be escaped so they don't split options). */
function escapeDrawtextPath(p) {
  return String(p).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

/** Compress video buffer to under maxBytes (for Supabase 50MB limit). Returns compressed buffer or original if already small or on error. */
const SUPABASE_SAFE_VIDEO_BYTES = 48 * 1024 * 1024; // 48MB to stay under 50MB
async function compressVideoBufferToMax(buffer, maxBytes, originalExt) {
  if (!buffer || buffer.length <= maxBytes) return buffer;
  const ext = (originalExt || '.mp4').toLowerCase();
  if (!/\.(mp4|mov|webm|avi|mkv|m4v)$/.test(ext)) return buffer;
  const tmpIn = path.join(os.tmpdir(), `vid-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  const tmpOut = path.join(os.tmpdir(), `vid-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  try {
    await fs.writeFile(tmpIn, buffer);
    const targetFs = Math.floor(maxBytes * 0.92); // target ~92% of limit
    await new Promise((resolve, reject) => {
      ffmpeg(tmpIn)
        .outputOptions([
          '-c:v', 'libx264', '-crf', '28', '-preset', 'superfast',
          '-threads', '1',
          '-fs', String(targetFs),
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
        ])
        .output(tmpOut)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(err.message || 'Compression failed')))
        .run();
    });
    const outBuf = await fs.readFile(tmpOut);
    await fs.unlink(tmpIn).catch(() => {});
    await fs.unlink(tmpOut).catch(() => {});
    return outBuf.length <= maxBytes ? outBuf : buffer;
  } catch (e) {
    await fs.unlink(tmpIn).catch(() => {});
    await fs.unlink(tmpOut).catch(() => {});
    return buffer;
  }
}

/** Low-memory ffmpeg options to avoid OOM (SIGKILL) on Railway/constrained hosts. */
const FFMPEG_LOW_MEM_OPTS = ['-threads', '1', '-preset', 'superfast'];

/** Overlay text on video using ffmpeg; writes to outputPath (mp4). Used for both preview and final run output—
 *  so stroke, 1080x1920 crop, and text positioning apply to the final link. Uses textfile= to avoid quoting issues.
 *  options.preview: if true, limit output to a short clip. Always uses low-memory opts to avoid SIGKILL. */
async function addVideoTextOverlay(inputPath, text, textStyle, outputPath, options = {}) {
  const isPreview = options.preview === true;
  const W = 1080;
  const H = 1920;
  const cropFilter = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})/2`;
  const hasText = text != null && typeof text === 'string' && String(text).trim().length > 0;
  if (!hasText) {
    const outputOpts = ['-vf', cropFilter, '-c:a', 'copy', ...FFMPEG_LOW_MEM_OPTS];
    if (isPreview) outputOpts.push('-t', '5');
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(outputOpts)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(err.message || 'FFmpeg failed')))
        .run();
    });
    return;
  }
  const raw = String(text).trim();
  const s = textStyle || {};
  const fontSize = videoFontSizePx(s);
  const marginX = Math.round(W * 0.08);
  const marginY = Math.round(H * 0.06);
  const safeWidth = W - 2 * marginX;
  const approxCharWidth = fontSize * 0.6;
  const maxCharsPerLine = Math.max(8, Math.floor(safeWidth / approxCharWidth));
  const lineHeightPx = Math.round(fontSize * 1.25);
  const maxLines = Math.max(1, Math.floor((H - 2 * marginY) / lineHeightPx));
  const paragraphs = raw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
  let lines = [];
  for (const p of paragraphs) {
    if (lines.length >= maxLines) break;
    if (p.length <= maxCharsPerLine) {
      lines.push(p);
    } else {
      const wrapped = wrapTextToLines(p, maxCharsPerLine);
      for (const w of wrapped) {
        if (lines.length >= maxLines) break;
        lines.push(w);
      }
    }
  }
  if (lines.length === 0) lines = [' '];
  lines = lines.slice(0, maxLines);

  const fontcolor = fontColorToHex(s.color);
  const strokeWidth = Math.max(0, Math.min(20, Math.round(parseFloat(s.strokeWidth ?? s.stroke) || 0)));
  const strokeColor = fontColorToHex(s.strokeColor || s.strokeColor || 'black');
  const baseOpts = `fontsize=${fontSize}:fontcolor=${fontcolor}${strokeWidth > 0 ? `:borderw=${strokeWidth}:bordercolor=${strokeColor}` : ''}`;
  const rawX = (s.x != null && s.x !== '' && !Number.isNaN(parseFloat(s.x))) ? parseFloat(s.x) : 50;
  const rawY = (s.y != null && s.y !== '' && !Number.isNaN(parseFloat(s.y))) ? parseFloat(s.y) : 92;
  const horizontalPct = rawX === 0 ? 50 : rawX;
  const verticalPct = rawY === 0 ? 50 : rawY;
  const blockHeightPx = lines.length * lineHeightPx;
  const startYOffset = -Math.round(blockHeightPx / 2) + Math.round(lineHeightPx / 2);

  const tmpDir = path.join(os.tmpdir(), `drawtext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFiles = [];
  try {
    for (let i = 0; i < lines.length; i++) {
      const tmpFile = path.join(tmpDir, `line${i}.txt`);
      await fs.writeFile(tmpFile, lines[i].trim() || ' ', 'utf8');
      tmpFiles.push(tmpFile);
    }
    const drawtextFilters = lines.map((line, i) => {
      const textfilePath = tmpFiles[i];
      const xExpr = `(w*${horizontalPct}/100)-text_w/2`;
      const yOffsetPx = startYOffset + i * lineHeightPx;
      const yExpr = `(h*${verticalPct}/100)+${yOffsetPx}-text_h/2`;
      return `drawtext=textfile='${escapeDrawtextPath(textfilePath)}':${baseOpts}:x='${xExpr}':y='${yExpr}'`;
    });
    const vf = [cropFilter, ...drawtextFilters].join(',');
    const outputOpts = ['-vf', vf, '-c:a', 'copy', ...FFMPEG_LOW_MEM_OPTS];
    if (isPreview) outputOpts.push('-t', '5');

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(outputOpts)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(err.message || 'FFmpeg failed')))
        .run();
    });
  } finally {
    for (const f of tmpFiles) {
      try { await fs.unlink(f); } catch (_) {}
    }
    try { await fs.rmdir(tmpDir); } catch (_) {}
  }
}

/**
 * Overlay a preset video (e.g. moving text / lyric animation) on top of a base video.
 * Preset is looped to match base duration.
 * - Base is scaled/cropped to 1080x1920.
 * - Preset is scaled to fit 1080x1920 (no zoom/crop), then black pixels are made transparent
 *   (colorkey) so only the text/design shows; then overlaid.
 */
async function overlayPresetOnVideo(basePath, presetPath, outputPath, options = {}) {
  const isPreview = options.preview === true;
  const W = 1080;
  const H = 1920;
  const filterComplex = [
    '[0:v]scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H + '[base]',
    '[1:v]scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2:color=black,colorkey=0x000000:0.08:0.15,format=yuva420p[ck]',
    '[base][ck]overlay=0:0:format=auto:shortest=1[out]'
  ].join(';');
  const proc = ffmpeg(basePath)
    .inputOptions(['-stream_loop', '-1'])
    .input(presetPath)
    .outputOptions([
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-c:a', 'copy',
      ...FFMPEG_LOW_MEM_OPTS,
    ])
    .output(outputPath);
  if (isPreview) proc.outputOptions(['-t', '5']);
  return new Promise((resolve, reject) => {
    proc.on('end', () => resolve());
    proc.on('error', (err) => reject(new Error(err.message || 'Preset overlay failed')));
    proc.run();
  });
}

async function runCampaignPipelineVideoWithText(userId, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId, opts = {}) {
  const campaign = getCampaignById(campaignId, userId);
  if (!campaign) throw new Error('Campaign not found');
  const pt = getPostType(campaign, postTypeId || 'default', projectId);
  if (!pt) throw new Error('Post type not found');
  const projectIdStr = String(projectId);
  const campaignIdStr = String(campaignId);
  const folderCount = 1;
  await ensureDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
  const folders = campaignDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
  const videos = await listVideos(folders[0]);
  const usage = await readVideoUsage(userId, projectIdStr, campaignIdStr, pt.id, 1);
  const chosen = pickLeastUsedVideo(videos, () => usage);
  if (!chosen) throw new Error('No videos in folder. Upload videos first.');
  const filename = chosen.filename || path.basename(chosen.path || chosen);
  await incrementVideoUsage(userId, projectIdStr, campaignIdStr, pt.id, 1, filename);
  const effectivePresetId4 = getEffectivePresetId(pt);
  const presetPath = effectivePresetId4 ? resolvePresetPath(userId, effectivePresetId4) : null;
  const usePresetOnly = presetPath && fsSync.existsSync(presetPath);
  let inputPath;
  try {
    inputPath = await getVideoPathForFfmpeg(userId, projectIdStr, campaignIdStr, pt.id, 1, filename);
    const outDir = generatedDir(userId, projectIdStr, campaignIdStr);
    const runId = Date.now();
    const outName = `video-${runId}.mp4`;
    const outPath = path.join(outDir, outName);
    if (usePresetOnly) {
      await overlayPresetOnVideo(inputPath, presetPath, outPath, { preview: opts.preview === true });
    } else {
      const fromOverride = Array.isArray(textOptionsOverride) && textOptionsOverride.length && Array.isArray(textOptionsOverride[0])
        ? textOptionsOverride[0]
        : null;
      const textOptions = fromOverride ??
        (Array.isArray(pt.textOptionsPerFolder) && pt.textOptionsPerFolder.length > 0 ? pt.textOptionsPerFolder[0] : null) ??
        (Array.isArray(campaign.textOptionsPerFolder) && campaign.textOptionsPerFolder.length > 0 ? campaign.textOptionsPerFolder[0] : null) ??
        DEFAULT_TEXT_OPTIONS;
      const text = await pickLeastUsedTextOptionAndIncrement(projectIdStr, campaignIdStr, postTypeId || 'default', 0, textOptions);
      const textStyle = textStyleOverride && textStyleOverride[0]
        ? textStyleOverride[0]
        : (pt.textStylePerFolder && pt.textStylePerFolder[0]) || {};
      await addVideoTextOverlay(inputPath, text, textStyle, outPath, { preview: opts.preview === true });
    }
    const baseUrl = getBaseUrlForGenerated();
    const uidSeg = String(userId).replace(/[/\\]/g, '_');
    let url;
    if (storage.useSupabase()) {
      const outBuf = await fs.readFile(outPath);
      await storage.uploadGenerated(projectIdStr, campaignIdStr, outName, outBuf, 'video/mp4', userId);
      await fs.unlink(outPath).catch(() => {});
      url = storage.getGeneratedUrl(projectIdStr, campaignIdStr, outName, userId);
    } else {
      url = `${baseUrl}/generated/${uidSeg}/${projectIdStr}/${campaignIdStr}/${outName}`;
    }
    if (!url) throw new Error('Could not get output URL');
    const runData = {
      campaignId: campaignIdStr,
      runId,
      webContentUrls: [url],
      webContentBase64: [],
      usedSourcePaths: [], // do not move source videos to used; they stay for reuse
      at: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(RUNS_DIR, `${campaignIdStr}.json`),
      JSON.stringify({ campaignId: campaignIdStr, runId: runData.runId, webContentUrls: runData.webContentUrls, at: runData.at }, null, 2)
    );
    return runData;
  } finally {
    if (storage.useSupabase() && inputPath && inputPath.startsWith(os.tmpdir())) {
      await fs.unlink(inputPath).catch(() => {});
    }
  }
}

async function runCampaignPipeline(userId, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId) {
  const campaign = getCampaignById(campaignId, userId);
  if (!campaign) throw new Error('Campaign not found');
  const pt = getPostType(campaign, postTypeId || 'default', projectId);
  if (!pt) throw new Error('Post type not found');
  if (pt.mediaType === 'video') return runCampaignPipelineVideo(userId, projectId, campaignId, postTypeId);
  if (pt.mediaType === 'video_text') return runCampaignPipelineVideoWithText(userId, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId);
  const projectIdStr = String(projectId);
  const campaignIdStr = String(campaignId);
  const folderCount = Math.max(1, parseInt(pt.folderCount, 10) || 3);
  await ensureDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
  const folders = campaignDirs(userId, projectIdStr, campaignIdStr, folderCount, pt.id);
  const outDir = generatedDir(userId, projectIdStr, campaignIdStr);
  let textOptionsPerFolder = Array.isArray(textOptionsOverride) && textOptionsOverride.length
    ? [...textOptionsOverride]
    : (Array.isArray(pt.textOptionsPerFolder) && pt.textOptionsPerFolder.length
      ? [...pt.textOptionsPerFolder]
      : Array(folderCount).fill(null).map(() => [...DEFAULT_TEXT_OPTIONS]));
  while (textOptionsPerFolder.length < folderCount) textOptionsPerFolder.push([...DEFAULT_TEXT_OPTIONS]);
  let textStylePerFolder = Array.isArray(textStyleOverride) && textStyleOverride.length
    ? [...textStyleOverride]
    : [...(pt.textStylePerFolder || campaign.textStylePerFolder || [])];
  while (textStylePerFolder.length < folderCount) textStylePerFolder.push({});
  const baseUrl = getBaseUrlForGenerated();
  const webContentUrls = [];
  const webContentBase64 = [];
  const usedSourcePaths = [];
  const runId = Date.now();

  const useFirstImage = !!textStyleOverride;
  for (let i = 0; i < folderCount; i++) {
    const images = await listImages(folders[i]);
    const usage = await readImageUsage(userId, projectIdStr, campaignIdStr, pt.id, i + 1);
    const chosen = useFirstImage && images.length ? images[0] : pickLeastUsedImage(images, () => usage);
    if (!chosen) continue;
    usedSourcePaths.push({ item: chosen, folderNum: i + 1, postTypeId: pt.id });
    const opts = textOptionsPerFolder[i];
    let text = (Array.isArray(opts) && opts.length)
      ? (useFirstImage ? opts[0] : pickRandom(opts))
      : null;
    if (typeof text === 'string' && !text.trim()) text = null;
    const folderStyle = (textStylePerFolder[i]) || campaign.textStyle || {};
    const outName = useFirstImage ? `preview-${i + 1}.jpg` : `carousel-${runId}-${i + 1}.jpg`;
    const outPath = path.join(outDir, outName);
    const imgBuf = await getImageBuffer(chosen, i, folders, projectIdStr, campaignIdStr, pt.id, userId);
    const buf = await addTextOverlay(imgBuf, text, outPath, folderStyle);
    const uidSeg = String(userId).replace(/[/\\]/g, '_');
    if (storage.useSupabase()) {
      await storage.uploadGenerated(projectIdStr, campaignIdStr, outName, buf, undefined, userId);
      webContentUrls.push(storage.getGeneratedUrl(projectIdStr, campaignIdStr, outName, userId));
    } else {
      webContentUrls.push(`${baseUrl}/generated/${uidSeg}/${projectIdStr}/${campaignIdStr}/${outName}`);
    }
    webContentBase64.push(buf.toString('base64'));
    const chosenFilename = chosen.filename || (chosen.path && path.basename(chosen.path));
    if (chosenFilename && !useFirstImage) await incrementImageUsage(userId, projectIdStr, campaignIdStr, pt.id, i + 1, chosenFilename);
  }

  const runData = { campaignId: campaignIdStr, runId, webContentUrls, webContentBase64, usedSourcePaths, at: new Date().toISOString() };
  await fs.writeFile(
    path.join(RUNS_DIR, `${campaignIdStr}.json`),
    JSON.stringify({ campaignId: campaignIdStr, runId, webContentUrls, at: runData.at }, null, 2)
  );
  return runData;
}

async function runTrendPipeline(userId, trendId, textStyleOverride, textOptionsOverride) {
  const trend = getTrendById(trendId, userId);
  if (!trend) throw new Error('Trend not found');
  const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
  if (!pageIds.length) throw new Error('Trend has no pages');
  const textOptions = Array.isArray(textOptionsOverride) && textOptionsOverride.length
    ? textOptionsOverride
    : (Array.isArray(trend.textOptions) && trend.textOptions.length ? trend.textOptions : []);
  const textStyle = (textStyleOverride && typeof textStyleOverride === 'object') ? textStyleOverride : (trend.textStyle || {});
  const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 1);
  const outDir = generatedDirForTrend(userId, trendId);
  await fs.mkdir(outDir, { recursive: true });
  const baseUrl = getBaseUrlForGenerated();
  const uidSeg = String(userId).replace(/[/\\]/g, '_');
  const webContentUrls = [];
  const runId = Date.now();
  for (let i = 0; i < pageIds.length; i++) {
    const pageIndex = i + 1;
    const dirs = trendPageFolderDirs(userId, trendId, pageIndex, folderCount);
    for (let f = 0; f < dirs.length; f++) {
      const images = await listImages(dirs[f]);
      const chosen = pickRandom(images);
      if (!chosen) continue;
      let text = textOptions.length ? pickRandom(textOptions) : null;
      if (typeof text === 'string' && !text.trim()) text = null;
      const outName = folderCount > 1 ? `trend-${runId}-page-${pageIndex}-folder-${f + 1}.jpg` : `trend-${runId}-page-${pageIndex}.jpg`;
      const outPath = path.join(outDir, outName);
      const imgBuf = await fs.readFile(chosen.path);
      await addTextOverlay(imgBuf, text, outPath, textStyle);
      const url = `${baseUrl}/generated/${uidSeg}/trends/${trendId}/${outName}`;
      webContentUrls.push({ pageId: pageIds[i], folderNum: f + 1, url });
    }
  }
  const runData = { trendId: String(trendId), runId, webContentUrls, at: new Date().toISOString() };
  await fs.writeFile(
    path.join(RUNS_DIR, `trend-${trendId}.json`),
    JSON.stringify(runData, null, 2)
  );
  return runData;
}

async function sendToBlotato(apiKey, accountId, webContentUrls, options = {}) {
  if (!apiKey || !accountId || !webContentUrls || webContentUrls.length === 0) return null;
  const opts = options || {};
  const addMusic = opts.addMusicToCarousel === true;
  const payload = {
    post: {
      accountId,
      content: {
        text: opts.text || '',
        mediaUrls: webContentUrls,
        platform: 'tiktok',
      },
      target: {
        targetType: 'tiktok',
        privacyLevel: opts.privacyLevel ?? 'PUBLIC_TO_EVERYONE',
        disabledComments: opts.disabledComments ?? false,
        disabledDuet: opts.disabledDuet ?? false,
        disabledStitch: opts.disabledStitch ?? false,
        isBrandedContent: opts.isBrandedContent ?? false,
        isYourBrand: opts.isYourBrand ?? false,
        isAiGenerated: opts.isAiGenerated ?? false,
        isDraft: opts.isDraft ?? false,
        autoAddMusic: addMusic,
        ...(opts.title ? { title: String(opts.title).slice(0, 90) } : {}),
        ...(opts.imageCoverIndex != null ? { imageCoverIndex: opts.imageCoverIndex } : {}),
        ...(opts.videoCoverTimestamp != null ? { videoCoverTimestamp: opts.videoCoverTimestamp } : {}),
      },
    },
  };
  if (opts.isDraft) payload.isDraft = true;
  const res = await fetch('https://backend.blotato.com/v2/posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'blotato-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Blotato: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// --- Multer (per campaign) ---
// With Supabase use disk storage so large videos aren't buffered in memory (avoids 502 on Railway).
const uploadTempDir = path.join(os.tmpdir(), 'carousel-upload');
const uploadStorage = storage.useSupabase()
  ? multer.diskStorage({
      destination: (req, file, cb) => {
        fsSync.mkdirSync(uploadTempDir, { recursive: true });
        cb(null, uploadTempDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (req.query.mediaType === 'video' || req.query.mediaType === 'video_text' ? '.mp4' : '.jpg');
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    })
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const ctx = req.uploadContext;
        const projectId = ctx ? ctx.projectId : (req.params?.projectId ?? req.query?.projectId ?? '');
        const campaignId = ctx ? ctx.campaignId : (req.params?.campaignId ?? req.query?.campaignId ?? '');
        const folderNum = ctx ? ctx.folderNum : Math.max(1, Math.min(999, parseInt(req.query?.folder || '1', 10)));
        const postTypeId = ctx ? ctx.ptId : (req.query?.postTypeId || 'default');
        const uid = ctx ? ctx.uid : (req.user?.id ? String(req.user.id).replace(/[/\\]/g, '_') : '');
        const base = uid ? path.join(UPLOADS, uid, String(projectId), String(campaignId)) : path.join(UPLOADS, String(projectId), String(campaignId));
        const ptBase = postTypeId && postTypeId !== 'default' ? path.join(base, `pt_${postTypeId}`) : base;
        const dir = path.join(ptBase, `folder${folderNum}`);
        try {
          fsSync.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (e) {
          cb(e);
        }
      },
      filename: (req, file, cb) => {
        const isVideo = req.uploadContext?.isVideo ?? (req.query?.mediaType === 'video' || req.query?.mediaType === 'video_text');
        const ext = path.extname(file.originalname) || (isVideo ? '.mp4' : '.jpg');
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    });
function isVideoFile(file) {
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  const videoMime = /^video\//.test(mime);
  const videoExt = /\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/i.test(name) || /\.(mp4|mov|webm|avi|mkv|m4v)\b/i.test(name);
  const genericMime = !mime || mime === 'application/octet-stream';
  return videoMime || videoExt || (genericMime && /\.(mp4|mov|webm|avi|mkv|m4v)/i.test(name));
}

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mediaType = req.query.mediaType;
    if (mediaType === 'video' || mediaType === 'video_text') {
      cb(null, isVideoFile(file));
    } else if (isVideoFile(file)) {
      cb(null, true);
    } else {
      cb(null, /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype || ''));
    }
  },
});

const trendUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdirSync(uploadTempDir, { recursive: true });
      cb(null, uploadTempDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
    cb(null, !!ok);
  },
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdirSync(AVATARS_DIR, { recursive: true });
      cb(null, AVATARS_DIR);
    },
    filename: (req, file, cb) => {
      const projectId = req.params.projectId;
      const rawExt = path.extname(file.originalname) || '';
      const ext = /\.(jpg|jpeg|png|webp|gif)$/i.test(rawExt) ? rawExt : '.jpg';
      cb(null, `${projectId}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(null, !!ok);
  },
});

const campaignAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdirSync(CAMPAIGN_AVATARS_DIR, { recursive: true });
      cb(null, CAMPAIGN_AVATARS_DIR);
    },
    filename: (req, file, cb) => {
      const campaignId = req.params.campaignId;
      cb(null, `${campaignId}.jpg`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(null, !!ok);
  },
});

const trendAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdirSync(TREND_AVATARS_DIR, { recursive: true });
      cb(null, TREND_AVATARS_DIR);
    },
    filename: (req, file, cb) => {
      const trendId = req.params.trendId;
      cb(null, `${trendId}.jpg`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(null, !!ok);
  },
});

const loginAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdirSync(LOGIN_AVATARS_DIR, { recursive: true });
      cb(null, LOGIN_AVATARS_DIR);
    },
    filename: (req, file, cb) => {
      const id = req.params.id;
      cb(null, `${id}.jpg`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(null, !!ok);
  },
});

const presetUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fsSync.mkdirSync(uploadTempDir, { recursive: true });
      cb(null, uploadTempDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4';
      cb(null, `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isVideo = /^video\//i.test(file.mimetype) || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(path.extname(file.originalname || ''));
    cb(null, !!isVideo);
  },
});

// --- API: Text presets (moving text / lyric overlays) ---
api.get('/text-presets', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    res.json(getTextPresets(uid));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/text-presets', (req, res, next) => {
  presetUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 80 MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const file = req.file;
  const name = (req.body && req.body.name && String(req.body.name).trim()) || 'Text preset';
  if (!file || !file.path) return res.status(400).json({ error: 'No video file uploaded. Choose a video file (MP4, MOV, WebM) and try again.' });
  try {
    ensureDataDir();
    const metaPath = getTextPresetsPath(uid);
    const data = readJson(metaPath, { nextId: 1, presets: [] });
    const id = String(data.nextId || 1);
    const ext = path.extname(file.originalname) || '.mp4';
    const filename = `${id}${ext}`;
    const userDir = getPresetDir(uid);
    fsSync.mkdirSync(userDir, { recursive: true });
    const destPath = path.join(userDir, filename);
    fsSync.copyFileSync(file.path, destPath);
    try { fsSync.unlinkSync(file.path); } catch (_) {}
    const preset = { id, name, filename, createdAt: new Date().toISOString() };
    writeJson(metaPath, { nextId: (data.nextId || 1) + 1, presets: [...(data.presets || []), preset] });
    res.status(201).json(preset);
  } catch (e) {
    if (file && file.path && fsSync.existsSync(file.path)) try { fsSync.unlinkSync(file.path); } catch (_) {}
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/text-presets/:presetId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const presetId = req.params.presetId;
  if (!getTextPreset(uid, presetId)) return res.status(404).json({ error: 'Preset not found' });
  try {
    deleteTextPreset(uid, presetId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// --- API: Projects (all require auth; data scoped per profile) ---
api.get('/projects', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projects = getProjects(uid);
    const campaigns = getAllCampaigns(uid);
    const withCount = projects.map((p) => {
      const hasAvatar = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].some((ext) =>
        fsSync.existsSync(path.join(AVATARS_DIR, `${p.id}${ext}`))
      );
      return {
        ...p,
        campaignCount: campaigns.filter((c) => (c.pageIds && c.pageIds.includes(p.id)) || c.projectId === p.id).length,
        hasAvatar: !!hasAvatar,
      };
    });
    res.json(withCount);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/projects/:projectId/avatar', (req, res) => {
  const id = String(req.params.projectId);
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
  for (const ext of exts) {
    const filePath = path.join(AVATARS_DIR, id + ext);
    if (fsSync.existsSync(filePath)) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.resolve(filePath));
    }
  }
  res.status(404).end();
});

api.post('/projects/:projectId/avatar', (req, res, next) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received. Use the "avatar" field.' });
    try {
      const projectId = String(req.params.projectId);
      const projects = getProjects(uid);
      if (!projects.find((p) => p.id === parseInt(projectId, 10))) return res.status(404).json({ error: 'Page not found' });
      const keepFile = req.file.filename;
      const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
      exts.forEach((ext) => {
        const fname = projectId + ext;
        if (fname === keepFile) return;
        const oldPath = path.join(AVATARS_DIR, fname);
        if (fsSync.existsSync(oldPath)) try { fsSync.unlinkSync(oldPath); } catch (_) {}
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });
});

api.post('/projects', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const meta = getProjectsMeta(uid);
    const name = (req.body.name || 'New project').trim() || 'New project';
    const project = {
      id: meta.nextId,
      name,
      createdAt: new Date().toISOString(),
    };
    saveProjects([...(meta.items || []), project], meta.nextId + 1, uid);
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/projects/:projectId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projects = getProjects(uid);
  const p = projects.find((x) => x.id === parseInt(req.params.projectId, 10));
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const hasAvatar = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].some((ext) =>
    fsSync.existsSync(path.join(AVATARS_DIR, `${p.id}${ext}`))
  );
  res.json({ ...p, hasAvatar: !!hasAvatar });
});

api.put('/projects/:projectId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const meta = getProjectsMeta(uid);
  const id = parseInt(req.params.projectId, 10);
  const idx = (meta.items || []).findIndex((x) => x.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Project not found' });
  const item = meta.items[idx];
  const name = req.body.name !== undefined ? (String(req.body.name || '').trim() || item.name) : item.name;
  const section = req.body.section !== undefined ? req.body.section : item.section;
  const pageType = req.body.pageType !== undefined ? (req.body.pageType === 'campaign' ? 'campaign' : 'recurring') : item.pageType;
  const blotatoAccountId = req.body.blotatoAccountId !== undefined ? (String(req.body.blotatoAccountId || '').trim() || null) : item.blotatoAccountId;
  const updated = { ...item, name, section, pageType: pageType || 'recurring', blotatoAccountId };
  const items = [...(meta.items || [])];
  items[idx] = updated;
  saveProjects(items, meta.nextId, uid);
  res.json(updated);
});

api.delete('/projects/:projectId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const meta = getProjectsMeta(uid);
  const id = parseInt(req.params.projectId, 10);
  const items = (meta.items || []).filter((x) => x.id !== id);
  if (items.length === meta.items.length) return res.status(404).json({ error: 'Project not found' });
  const allCampaigns = getAllCampaigns(uid);
  allCampaigns.forEach((c) => {
    if (c.pageIds && c.pageIds.includes(id)) {
      const updated = c.pageIds.filter((pid) => pid !== id);
      if (updated.length === 0) deleteCampaign(c.id, uid);
      else saveCampaign({ ...c, pageIds: updated }, uid);
    } else if (c.projectId === id) {
      deleteCampaign(c.id, uid);
    }
  });
  saveProjects(items, undefined, uid);
  res.json({ ok: true });
});

// --- API: Recurring pages (list of project IDs for Recurring Pages tab) ---
api.get('/recurring-pages', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectIds = getRecurringPageIds(uid);
    res.json({ projectIds });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/recurring-pages', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = parseInt(req.body.projectId, 10);
  if (isNaN(projectId)) return res.status(400).json({ error: 'projectId required' });
  const projects = getProjects(uid);
  if (!projects.find((p) => p.id === projectId)) return res.status(404).json({ error: 'Page not found' });
  try {
    const ids = getRecurringPageIds(uid);
    if (ids.includes(projectId)) return res.json({ projectIds: ids });
    setRecurringPageIds(uid, [...ids, projectId]);
    res.json({ projectIds: getRecurringPageIds(uid) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/recurring-pages/:projectId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) return res.status(400).json({ error: 'projectId required' });
  try {
    const ids = getRecurringPageIds(uid).filter((id) => id !== projectId);
    setRecurringPageIds(uid, ids);
    res.json({ projectIds: ids });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// --- API: Campaigns ---
api.get('/projects/:projectId/campaigns', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = parseInt(req.params.projectId, 10);
  const list = getCampaigns(projectId, uid);
  const shared = (await getSharedCampaigns(uid)).filter((c) => campaignBelongsToPage(c, projectId));
  res.json([...list, ...shared]);
});

api.post('/projects/:projectId/campaigns', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = parseInt(req.params.projectId, 10);
  const projects = getProjects(uid);
  if (!projects.find((p) => p.id === projectId)) return res.status(404).json({ error: 'Project not found' });
  const meta = getCampaignsMeta(uid);
  const name = (req.body.name || 'New campaign').trim() || 'New campaign';
  const isPageNative = req.body.isPageNative === true;
  const campaign = {
    id: meta.nextId,
    projectId,
    name,
    pagePostTypes: {},
    deployedByPage: {},
    createdAt: new Date().toISOString(),
    isPageNative: isPageNative || undefined,
  };
  saveCampaign(campaign, uid);
  res.status(201).json(campaign);
});

function getPostTypesForPage(campaign, projectId) {
  if (!campaign) return [];
  const pid = parseInt(projectId, 10);
  if (Number.isNaN(pid)) return [];
  const ppt = campaign.pagePostTypes && typeof campaign.pagePostTypes === 'object' ? campaign.pagePostTypes : null;
  if (ppt) {
    let arr = ppt[pid] ?? ppt[String(pid)];
    if (!Array.isArray(arr)) {
      const key = Object.keys(ppt).find((k) => parseInt(k, 10) === pid);
      arr = key ? ppt[key] : null;
    }
    if (Array.isArray(arr)) return arr;
  }
  if (Array.isArray(campaign.postTypes) && campaignBelongsToPage(campaign, projectId)) {
    return campaign.postTypes;
  }
  return [];
}

function nextPostTypeIdForPage(campaign, projectId) {
  const existing = getPostTypesForPage(campaign, projectId).map((pt) => pt.id);
  let n = 1;
  while (existing.includes(`pt${n}`)) n++;
  return `pt${n}`;
}

function ensurePostTypes(campaign, projectId) {
  if (projectId != null) {
    const pts = getPostTypesForPage(campaign, projectId);
    return { ...campaign, postTypes: pts };
  }
  if (Array.isArray(campaign.postTypes)) return campaign;
  return { ...campaign, postTypes: [] };
}

function getPostType(campaign, postTypeId, projectId) {
  const pts = projectId != null ? getPostTypesForPage(campaign, projectId) : (campaign.postTypes || []);
  const id = postTypeId != null && postTypeId !== '' ? String(postTypeId) : 'default';
  const pt = pts.find((p) => String(p.id) === id);
  return pt || pts[0] || null;
}

/** True if this specific post type is deployed for this page. */
function isPostTypeDeployed(campaign, projectId, postTypeId) {
  const pid = parseInt(projectId, 10);
  const v = campaign.deployedByPage && campaign.deployedByPage[pid];
  if (v === undefined || v === null) return !!campaign.deployed;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object' && v !== null) return !!v[postTypeId];
  return false;
}

/** True if any post type on this page is deployed (for badges/lists). */
function isPageDeployed(campaign, projectId) {
  const pid = parseInt(projectId, 10);
  const v = campaign.deployedByPage && campaign.deployedByPage[pid];
  if (v === undefined || v === null) return !!campaign.deployed;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object' && v !== null) return Object.values(v).some((x) => !!x);
  return false;
}

function normalizeCampaign(campaign, projectId) {
  const c = projectId != null ? ensurePostTypes(campaign, projectId) : campaign;
  const pt = (c.postTypes || [])[0];
  const folderCount = pt ? Math.max(1, pt.folderCount || 3) : Math.max(1, c.folderCount || 3);
  let textOptionsPerFolder = pt?.textOptionsPerFolder || c.textOptionsPerFolder;
  if (!Array.isArray(textOptionsPerFolder) || textOptionsPerFolder.length < folderCount) {
    const legacy = Array.isArray(c.textOptions) ? c.textOptions : DEFAULT_TEXT_OPTIONS;
    textOptionsPerFolder = Array(folderCount).fill(null).map(() => [...legacy]);
  }
  while (textOptionsPerFolder.length < folderCount) textOptionsPerFolder.push([...DEFAULT_TEXT_OPTIONS]);
  const deployed = projectId != null ? isPageDeployed(campaign, projectId) : !!campaign.deployed;
  return { ...c, folderCount, textOptionsPerFolder, deployed };
}

function campaignBelongsToPage(campaign, projectId) {
  const pid = parseInt(projectId, 10);
  if (campaign.pageIds && Array.isArray(campaign.pageIds)) return campaign.pageIds.includes(pid);
  return campaign.projectId === pid;
}

api.get('/projects/:projectId/campaigns/:campaignId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = req.params.projectId;
  const postTypeId = req.query.postTypeId || 'default';
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  const campaign = getCampaignById(campaignId, effectiveUid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  const campaignWithPostTypes = ensurePostTypes(campaign, projectId);
  const normalized = normalizeCampaign(campaignWithPostTypes, projectId);
  if (postTypeId) {
    const pt = getPostType(campaign, postTypeId, projectId);
    if (pt) {
      const folderCount = Math.max(1, pt.folderCount || 3);
      let textOptionsPerFolder = pt.textOptionsPerFolder;
      if (!Array.isArray(textOptionsPerFolder) || textOptionsPerFolder.length < folderCount) {
        textOptionsPerFolder = Array(folderCount).fill(null).map(() => [...DEFAULT_TEXT_OPTIONS]);
      }
      while (textOptionsPerFolder.length < folderCount) textOptionsPerFolder.push([...DEFAULT_TEXT_OPTIONS]);
      return res.json({
        ...normalized,
        folderCount,
        textOptionsPerFolder,
        textStylePerFolder: pt.textStylePerFolder || [],
        samePhotoEachTimePerFolder: Array.isArray(pt.samePhotoEachTimePerFolder) ? pt.samePhotoEachTimePerFolder : [],
        scheduleTimes: pt.scheduleTimes || [],
        scheduleEnabled: !!pt.scheduleEnabled,
        scheduleStartDate: pt.scheduleStartDate || null,
        scheduleEndDate: pt.scheduleEndDate || null,
        scheduleDaysOfWeek: pt.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
        postTypeId: pt.id,
        mediaType: pt.mediaType,
      });
    }
  }
  res.json(normalized);
});

api.put('/projects/:projectId/campaigns/:campaignId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const postTypeId = req.body.postTypeId || 'default';
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  const campaign = getCampaignById(campaignId, effectiveUid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  const pt = getPostType(campaign, postTypeId, projectId);
  if (!pt) return res.status(404).json({ error: 'Post type not found' });
  let textOptionsPerFolder = pt.textOptionsPerFolder;
  if (Array.isArray(req.body.textOptionsPerFolder)) textOptionsPerFolder = req.body.textOptionsPerFolder;
  const folderCount = Math.max(1, parseInt(req.body.folderCount, 10) || pt.folderCount || 3);
  let textStyle = campaign.textStyle;
  if (req.body.textStyle && typeof req.body.textStyle === 'object') textStyle = { ...(textStyle || {}), ...req.body.textStyle };
  let textStylePerFolder = pt.textStylePerFolder;
  if (Array.isArray(req.body.textStylePerFolder)) textStylePerFolder = req.body.textStylePerFolder;
  const validReleaseTypes = ['single', 'ep', 'feature', 'album'];
  const releaseType = req.body.releaseType !== undefined
    ? (validReleaseTypes.includes(String(req.body.releaseType).toLowerCase()) ? String(req.body.releaseType).toLowerCase() : null)
    : campaign.releaseType;
  const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
  const pagePts = [...(pagePostTypes[projectId] || [])];
  const ptIdx = pagePts.findIndex((p) => p.id === pt.id);
  let samePhotoEachTimePerFolder = pt.samePhotoEachTimePerFolder;
  if (Array.isArray(req.body.samePhotoEachTimePerFolder)) {
    samePhotoEachTimePerFolder = req.body.samePhotoEachTimePerFolder.map((v) => !!v);
    while (samePhotoEachTimePerFolder.length < folderCount) samePhotoEachTimePerFolder.push(false);
  }
  const updatedPt = {
    ...pt,
    folderCount,
    textOptionsPerFolder,
    textStylePerFolder: textStylePerFolder || undefined,
    samePhotoEachTimePerFolder: samePhotoEachTimePerFolder || [],
    scheduleTimes: Array.isArray(req.body.scheduleTimes) ? req.body.scheduleTimes : pt.scheduleTimes,
    scheduleEnabled: req.body.scheduleEnabled !== undefined ? !!req.body.scheduleEnabled : pt.scheduleEnabled,
    scheduleStartDate: req.body.scheduleStartDate !== undefined ? (req.body.scheduleStartDate || null) : pt.scheduleStartDate,
    scheduleEndDate: req.body.scheduleEndDate !== undefined ? (req.body.scheduleEndDate || null) : pt.scheduleEndDate,
    scheduleDaysOfWeek: Array.isArray(req.body.scheduleDaysOfWeek) ? req.body.scheduleDaysOfWeek : (pt.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]),
  };
  if (ptIdx >= 0) pagePts[ptIdx] = updatedPt;
  else pagePts.push(updatedPt);
  pagePostTypes[projectId] = pagePts;
  const deployedByPage = { ...(campaign.deployedByPage || {}) };
  if (req.body.deployed !== undefined) {
    const prev = deployedByPage[projectId];
    const next = typeof prev === 'object' && prev !== null ? { ...prev } : {};
    next[postTypeId] = !!req.body.deployed;
    deployedByPage[projectId] = next;
  }
  const updated = {
    ...campaign,
    name: req.body.name !== undefined ? String(req.body.name).trim() || campaign.name : campaign.name,
    textStyle: textStyle || undefined,
    pagePostTypes,
    deployedByPage,
    releaseDate: req.body.releaseDate !== undefined ? (req.body.releaseDate || null) : campaign.releaseDate,
    releaseType,
    sendAsDraft: req.body.sendAsDraft !== undefined ? !!req.body.sendAsDraft : campaign.sendAsDraft,
    addMusicToCarousel: req.body.addMusicToCarousel !== undefined ? !!req.body.addMusicToCarousel : campaign.addMusicToCarousel,
    paused: req.body.paused !== undefined ? !!req.body.paused : (campaign.paused || false),
  };
  saveCampaign(updated, effectiveUid);
  res.json(ensurePostTypes(updated, projectId));
});

api.post('/projects/:projectId/campaigns/:campaignId/postTypes', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  const campaign = getCampaignById(campaignId, effectiveUid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  const name = (req.body.name || 'New post type').trim() || 'New post type';
  const mediaType = req.body.mediaType === 'video_text' ? 'video_text' : (req.body.mediaType === 'video' ? 'video' : 'photo');
  const id = nextPostTypeIdForPage(campaign, projectId);
  const folderCount = mediaType === 'video' ? 2 : (mediaType === 'video_text' ? 1 : 3);
  const textOptionsPerFolder = Array(folderCount).fill(null).map(() => []);
  const newPt = {
    id,
    name,
    mediaType,
    folderCount,
    textOptionsPerFolder,
    textStylePerFolder: [],
    scheduleTimes: ['10:00', '13:00', '16:00'],
    scheduleEnabled: true,
    scheduleStartDate: null,
    scheduleEndDate: null,
    scheduleDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  };
  const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
  const pagePts = [...(pagePostTypes[projectId] || []), newPt];
  pagePostTypes[projectId] = pagePts;
  const updated = { ...campaign, pagePostTypes };
  saveCampaign(updated, effectiveUid);
  ensureDirs(effectiveUid, String(projectId), String(campaignId), folderCount, id);
  const result = ensurePostTypes(updated, projectId);
  res.status(201).json(result);
});

api.put('/projects/:projectId/campaigns/:campaignId/postTypes/:postTypeId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const postTypeId = req.params.postTypeId;
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  const campaign = getCampaignById(campaignId, effectiveUid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  const pt = getPostType(campaign, postTypeId, projectId);
  if (!pt) return res.status(404).json({ error: 'Post type not found' });
  const name = req.body.name !== undefined ? String(req.body.name || '').trim() || pt.name : pt.name;
  const mediaType = req.body.mediaType !== undefined
    ? (req.body.mediaType === 'video_text' ? 'video_text' : req.body.mediaType === 'video' ? 'video' : 'photo')
    : pt.mediaType;
  const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
  const pagePts = [...(pagePostTypes[projectId] || [])];
  const ptIdx = pagePts.findIndex((p) => p.id === pt.id);
  const textPresetId = req.body.textPresetId !== undefined
    ? (req.body.textPresetId == null || req.body.textPresetId === '' ? null : String(req.body.textPresetId))
    : pt.textPresetId;
  const textPresetIds = req.body.textPresetIds !== undefined
    ? (Array.isArray(req.body.textPresetIds) ? req.body.textPresetIds.filter(Boolean).map(String) : null)
    : pt.textPresetIds;
  const title = req.body.title !== undefined
    ? (req.body.title == null ? '' : String(req.body.title).slice(0, 90))
    : (pt.title || '');
  let updatedPt = {
    ...pt, name, mediaType,
    textPresetId: textPresetId || undefined,
    textPresetIds: (Array.isArray(textPresetIds) && textPresetIds.length > 0) ? textPresetIds : undefined,
    title: title || undefined,
  };
  if (mediaType === 'video') {
    updatedPt = {
      ...updatedPt,
      folderCount: 2,
      textOptionsPerFolder: [[], []],
      textStylePerFolder: [],
    };
    ensureDirs(effectiveUid, String(projectId), String(campaignId), 2, pt.id);
  }
  if (mediaType === 'video_text') {
    updatedPt = {
      ...updatedPt,
      folderCount: 1,
      textOptionsPerFolder: Array.isArray(pt.textOptionsPerFolder) && pt.textOptionsPerFolder.length ? [pt.textOptionsPerFolder[0]] : [[]],
      textStylePerFolder: Array.isArray(pt.textStylePerFolder) && pt.textStylePerFolder.length ? [pt.textStylePerFolder[0]] : [{}],
    };
    ensureDirs(effectiveUid, String(projectId), String(campaignId), 1, pt.id);
  }
  if (ptIdx >= 0) pagePts[ptIdx] = updatedPt;
  else pagePts.push(updatedPt);
  pagePostTypes[projectId] = pagePts;
  const updated = { ...campaign, pagePostTypes };
  saveCampaign(updated, effectiveUid);
  res.json(ensurePostTypes(updated, projectId));
});

api.delete('/projects/:projectId/campaigns/:campaignId/postTypes/:postTypeId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const postTypeId = req.params.postTypeId;
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  const campaign = getCampaignById(campaignId, effectiveUid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  try {
    await storage.deleteAllUploadsForPostType(String(projectId), String(campaignId), postTypeId, effectiveUid);
  } catch (e) {
    console.warn('[delete post type] storage cleanup:', e.message);
  }
  const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
  const pagePts = (pagePostTypes[projectId] || []).filter((p) => p.id !== postTypeId);
  pagePostTypes[projectId] = pagePts;
  const updated = { ...campaign, pagePostTypes };
  saveCampaign(updated, effectiveUid);
  res.json(ensurePostTypes(updated, projectId));
});

api.post('/projects/:projectId/campaigns/:campaignId/postTypes/:postTypeId/duplicate', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const sourceProjectId = parseInt(req.params.projectId, 10);
  const sourceCampaignId = parseInt(req.params.campaignId, 10);
  const postTypeId = req.params.postTypeId;
  const targetCampaignId = parseInt(req.body.targetCampaignId, 10);
  const targetPageId = parseInt(req.body.targetPageId, 10);
  if (!targetCampaignId || !targetPageId) return res.status(400).json({ error: 'targetCampaignId and targetPageId required' });
  const sourceCampaign = getCampaignById(sourceCampaignId, uid);
  const targetCampaign = getCampaignById(targetCampaignId, uid);
  if (!sourceCampaign || !campaignBelongsToPage(sourceCampaign, sourceProjectId)) return res.status(404).json({ error: 'Source campaign not found' });
  if (!targetCampaign || !campaignBelongsToPage(targetCampaign, targetPageId)) return res.status(404).json({ error: 'Target campaign/page not found' });
  const pt = getPostType(sourceCampaign, postTypeId, sourceProjectId);
  if (!pt) return res.status(404).json({ error: 'Post type not found' });
  const newId = nextPostTypeIdForPage(targetCampaign, targetPageId);
  const newPt = { ...JSON.parse(JSON.stringify(pt)), id: newId };
  const pagePostTypes = { ...(targetCampaign.pagePostTypes || {}) };
  const pagePts = [...(pagePostTypes[targetPageId] || []), newPt];
  pagePostTypes[targetPageId] = pagePts;
  const updated = { ...targetCampaign, pagePostTypes };
  saveCampaign(updated, uid);
  const folderCount = newPt.mediaType === 'video' ? 2 : (newPt.mediaType === 'video_text' ? 1 : Math.max(1, newPt.folderCount || 3));
  ensureDirs(uid, String(targetPageId), String(targetCampaignId), folderCount, newId);
  res.status(201).json(ensurePostTypes(updated, targetPageId));
});

api.delete('/projects/:projectId/campaigns/:campaignId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  // Only the owner can delete a campaign — members cannot
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  if (effectiveUid !== uid) return res.status(403).json({ error: 'Only the campaign owner can delete it' });
  const campaign = getCampaignById(campaignId, uid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.pageIds && campaign.pageIds.length > 1) {
    const pid = parseInt(projectId, 10);
    const postTypesOnPage = getPostTypesForPage(campaign, pid);
    const postTypeIds = (postTypesOnPage || []).map((pt) => pt.id);
    try {
      await storage.deleteAllUploadsForPageInCampaign(String(pid), String(campaignId), postTypeIds, uid);
    } catch (e) {
      console.warn('[remove page from campaign] storage cleanup:', e.message);
    }
    const updated = { ...campaign, pageIds: campaign.pageIds.filter((id) => id !== pid) };
    const { [pid]: _removed, ...restPagePostTypes } = updated.pagePostTypes || {};
    updated.pagePostTypes = restPagePostTypes;
    if (updated.pageIds.length === 0) deleteCampaign(campaignId, uid);
    else saveCampaign(updated, uid);
  } else {
    const pageIdsToClear = campaign.pageIds && campaign.pageIds.length ? campaign.pageIds : (campaign.projectId != null ? [campaign.projectId] : []);
    for (const pageId of pageIdsToClear) {
      const pts = getPostTypesForPage(campaign, pageId);
      const ptIds = (pts || []).map((pt) => pt.id);
      try {
        await storage.deleteAllUploadsForPageInCampaign(String(pageId), String(campaignId), ptIds, uid);
      } catch (e) {
        console.warn('[delete campaign] storage cleanup:', e.message);
      }
    }
    deleteCampaign(campaignId, uid);
  }
  res.json({ ok: true });
});

api.get('/campaigns', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const all = getAllCampaigns(uid);
  const own = all.filter((c) => {
    if (c.isPageNative) return false;
    const pageIds = (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
    const isSinglePageRecurring = pageIds.length === 1 && (c.name === 'Recurring posts' || c.name === 'Recurring post');
    return !isSinglePageRecurring;
  });
  const shared = await getSharedCampaigns(uid);
  res.json([...own, ...shared]);
});

api.get('/campaigns/:campaignId/deployed-posts-count', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const getPageIds = (c) => (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
    const pageIds = getPageIds(campaign);
    let total = 0;
    const byPage = {};
    for (const projectId of pageIds) {
      let pageTotal = 0;
      const postTypes = getPostTypesForPage(campaign, projectId);
      for (const pt of postTypes) {
        if (!isPostTypeDeployed(campaign, projectId, pt.id)) continue;
        if (pt.scheduleEnabled === false) continue;
        if (pt.mediaType === 'video') {
          const dirs = campaignDirs(uid, String(projectId), String(campaignId), 2, pt.id);
          const v1 = await listVideos(dirs[0]);
          const v2 = await listVideos(dirs[1]);
          const posted1 = await readVideoPosted(uid, String(projectId), String(campaignId), pt.id, 1);
          const posted2 = await readVideoPosted(uid, String(projectId), String(campaignId), pt.id, 2);
          const unposted = (list, posted) => list.filter((v) => {
            const name = v.filename || (v.path && path.basename(v.path));
            return name && !posted[name];
          });
          pageTotal += unposted(v1, posted1).length + unposted(v2, posted2).length;
        } else if (pt.mediaType === 'video_text') {
          const dirs = campaignDirs(uid, String(projectId), String(campaignId), 1, pt.id);
          const videos = await listVideos(dirs[0]);
          pageTotal += videos.length;
        } else {
          const folderCount = Math.max(1, pt.folderCount || 3);
          const dirs = campaignDirs(uid, String(projectId), String(campaignId), folderCount, pt.id);
          let min = Infinity;
          for (let i = 0; i < folderCount; i++) {
            const files = await listImages(dirs[i]);
            if (files.length < min) min = files.length;
          }
          pageTotal += min === Infinity ? 0 : min;
        }
      }
      byPage[projectId] = pageTotal;
      total += pageTotal;
    }
    res.json({ count: total, byPage });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/campaigns/:campaignId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    deleteCampaign(campaignId, uid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/campaigns/:campaignId/avatar', (req, res) => {
  const id = String(req.params.campaignId);
  const filePath = path.join(CAMPAIGN_AVATARS_DIR, `${id}.jpg`);
  if (fsSync.existsSync(filePath)) { res.set('Cache-Control', 'public, max-age=86400'); return res.sendFile(path.resolve(filePath)); }
  res.status(404).end();
});

api.post('/campaigns/:campaignId/avatar', (req, res, next) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  campaignAvatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received. Use the "avatar" field.' });
    try {
      const campaignId = String(req.params.campaignId);
      const campaign = getCampaignById(parseInt(campaignId, 10), uid);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      const srcPath = req.file.path;
      const tempPath = path.join(CAMPAIGN_AVATARS_DIR, `${campaignId}-temp-${Date.now()}.jpg`);
      const size = 400;
      await sharp(srcPath)
        .rotate()
        .resize(size, size, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 90 })
        .toFile(tempPath);
      await fs.rename(tempPath, srcPath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });
});

api.put('/campaigns/:campaignId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    let pageIds = campaign.pageIds && campaign.pageIds.length ? [...campaign.pageIds] : (campaign.projectId != null ? [campaign.projectId] : []);
    if (Array.isArray(req.body.pageIds)) pageIds = req.body.pageIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    const projects = getProjects(uid);
    const validPageIds = [...new Set(pageIds)].filter((pid) => projects.some((p) => p.id === pid));
    const name = req.body.name !== undefined ? (String(req.body.name || '').trim() || campaign.name) : campaign.name;
    const releaseDate = req.body.releaseDate !== undefined ? (req.body.releaseDate || null) : campaign.releaseDate;
    const campaignStartDate = req.body.campaignStartDate !== undefined ? (req.body.campaignStartDate || null) : campaign.campaignStartDate;
    const campaignEndDate = req.body.campaignEndDate !== undefined ? (req.body.campaignEndDate || null) : campaign.campaignEndDate;
    const validReleaseTypes = ['single', 'ep', 'feature', 'album'];
    const releaseType = req.body.releaseType !== undefined
      ? (validReleaseTypes.includes(String(req.body.releaseType).toLowerCase()) ? String(req.body.releaseType).toLowerCase() : null)
      : campaign.releaseType;
    let memberUsernames = campaign.memberUsernames;
    if (Array.isArray(req.body.memberUsernames)) {
      memberUsernames = req.body.memberUsernames.map((u) => String(u).trim()).filter(Boolean);
    }
    const notes = req.body.notes !== undefined ? String(req.body.notes || '') : campaign.notes;
    let pageUgcTypes = campaign.pageUgcTypes && typeof campaign.pageUgcTypes === 'object' ? { ...campaign.pageUgcTypes } : {};
    if (req.body.pageUgcTypes && typeof req.body.pageUgcTypes === 'object') {
      pageUgcTypes = {};
      for (const [k, v] of Object.entries(req.body.pageUgcTypes)) {
        const pid = parseInt(k, 10);
        if (!isNaN(pid) && typeof v === 'string' && v.trim()) pageUgcTypes[pid] = v.trim();
      }
    }
    let customCategories = Array.isArray(campaign.customCategories) ? [...campaign.customCategories] : [];
    if (Array.isArray(req.body.customCategories)) {
      customCategories = req.body.customCategories.map((c) => String(c).trim()).filter(Boolean);
    }
    const previousPageIds = campaign.pageIds && campaign.pageIds.length ? campaign.pageIds : (campaign.projectId != null ? [campaign.projectId] : []);
    const newlyAddedPageIds = validPageIds.filter((pid) => !previousPageIds.includes(pid));
    const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
    validPageIds.forEach((pid) => {
      if (newlyAddedPageIds.includes(pid)) {
        pagePostTypes[pid] = [];
      } else if (!Array.isArray(pagePostTypes[pid])) {
        pagePostTypes[pid] = [];
      }
    });
    const updated = { ...campaign, name, pageIds: validPageIds, releaseDate, releaseType, campaignStartDate, campaignEndDate, memberUsernames: memberUsernames || [], notes, pagePostTypes, pageUgcTypes, customCategories };
    if (campaign.projectId != null && !campaign.pageIds) delete updated.projectId;
    saveCampaign(updated, uid);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/campaigns', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const name = (req.body.name || 'New campaign').trim() || 'New campaign';
    const pageIds = Array.isArray(req.body.pageIds) ? req.body.pageIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id)) : [];
    if (!pageIds.length) return res.status(400).json({ error: 'Select at least one page' });
    const projects = getProjects(uid);
    const validPageIds = pageIds.filter((pid) => projects.some((p) => p.id === pid));
    if (!validPageIds.length) return res.status(400).json({ error: 'No valid pages selected' });
    const meta = getCampaignsMeta(uid);
    const campaign = {
      id: meta.nextId,
      name,
      pageIds: validPageIds,
      releaseType: null,
      pagePostTypes: {},
      deployedByPage: {},
      createdAt: new Date().toISOString(),
    };
    saveCampaign(campaign, uid);
    res.status(201).json(campaign);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// --- API: Campaign folders & run ---
api.get('/projects/:projectId/campaigns/:campaignId/folders', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const postTypeId = req.query.postTypeId || 'default';
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    const campaign = getCampaignById(campaignId, effectiveUid);
    const pt = getPostType(campaign, postTypeId, projectId);
    const isVideo = pt && (pt.mediaType === 'video' || pt.mediaType === 'video_text');
    const folderCount = pt && pt.mediaType === 'video_text' ? 1 : (pt && pt.mediaType === 'video' ? 2 : (pt ? Math.max(1, pt.folderCount || 3) : Math.max(1, (campaign && campaign.folderCount) || 3)));
    if (pt && pt.id) await ensureDirs(effectiveUid, projectId, campaignId, folderCount, pt.id);
    const dirs = campaignDirs(effectiveUid, projectId, campaignId, folderCount, pt ? pt.id : undefined);
    const result = {};
    const listFn = isVideo ? listVideos : listImages;
    const ptIdForPath = pt ? String(pt.id) : postTypeId;
    for (let i = 0; i < folderCount; i++) {
      const folderNum = i + 1;
      const files = await listFn(dirs[i]);
      if (isVideo) {
        if (pt.mediaType === 'video') {
          await cleanupPostedVideosOlderThan7Days(effectiveUid, projectId, campaignId, ptIdForPath, folderNum);
          const posted = await readVideoPosted(effectiveUid, projectId, campaignId, ptIdForPath, folderNum);
          const now = Date.now();
          result[`folder${folderNum}`] = files.map((f) => {
            const name = (f && f.filename) ? f.filename : path.basename(f && f.path ? f.path : f);
            const postedAt = posted[name] || null;
            const daysLeft = postedAt
              ? Math.max(0, VIDEO_POSTED_RETENTION_DAYS - Math.floor((now - new Date(postedAt).getTime()) / MS_PER_DAY))
              : null;
            return { filename: name, usageCount: 0, postedAt, daysLeft };
          });
        } else {
          const usage = await readVideoUsage(effectiveUid, projectId, campaignId, ptIdForPath, folderNum);
          result[`folder${folderNum}`] = files.map((f) => {
            const name = (f && f.filename) ? f.filename : path.basename(f && f.path ? f.path : f);
            return { filename: name, usageCount: usage[name] || 0 };
          });
        }
      } else {
        const usage = await readImageUsage(effectiveUid, projectId, campaignId, ptIdForPath, i + 1);
        result[`folder${i + 1}`] = files.map((f) => {
          const name = (f && f.filename) ? f.filename : path.basename(f && f.path ? f.path : f);
          return { filename: name, usageCount: usage[name] || 0 };
        });
      }
    }
    res.json({ folders: result, folderCount, mediaType: (pt && pt.mediaType) || (isVideo ? 'video' : 'photo') });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/projects/:projectId/campaigns/:campaignId/folders', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const projectId = parseInt(req.params.projectId, 10);
    const postTypeId = req.body.postTypeId || req.query.postTypeId || 'default';
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    const campaign = getCampaignById(campaignId, effectiveUid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    if (pt.mediaType === 'video') return res.status(400).json({ error: 'Video post types have fixed folders (Priority and Fallback)' });
    if (pt.mediaType === 'video_text') return res.status(400).json({ error: 'Videos (add text) post types have a single folder' });
    const newCount = Math.max(1, (pt.folderCount || 3) + 1);
    const textOptionsPerFolder = Array.isArray(pt.textOptionsPerFolder) ? [...pt.textOptionsPerFolder] : [];
    while (textOptionsPerFolder.length < newCount) textOptionsPerFolder.push([]);
    const textStylePerFolder = Array.isArray(pt.textStylePerFolder) ? [...pt.textStylePerFolder] : [];
    while (textStylePerFolder.length < newCount) textStylePerFolder.push({});
    const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
    const pagePts = [...(pagePostTypes[projectId] || [])];
    const ptIdx = pagePts.findIndex((p) => p.id === pt.id);
    const updatedPt = { ...pt, folderCount: newCount, textOptionsPerFolder, textStylePerFolder };
    if (ptIdx >= 0) pagePts[ptIdx] = updatedPt;
    else pagePts.push(updatedPt);
    pagePostTypes[projectId] = pagePts;
    const updated = { ...campaign, pagePostTypes };
    saveCampaign(updated, effectiveUid);
    await ensureDirs(effectiveUid, String(projectId), String(campaignId), newCount, pt.id);
    res.json(ensurePostTypes(updated, projectId));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/projects/:projectId/campaigns/:campaignId/folders/:folderNum', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const projectId = parseInt(req.params.projectId, 10);
    const folderNum = parseInt(req.params.folderNum, 10);
    const postTypeId = req.query.postTypeId || req.body?.postTypeId || 'default';
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    const campaign = getCampaignById(campaignId, effectiveUid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    if (pt.mediaType === 'video') return res.status(400).json({ error: 'Video post types have fixed folders (Priority and Fallback)' });
    if (pt.mediaType === 'video_text') return res.status(400).json({ error: 'Videos (add text) post types have a single folder' });
    const currentCount = Math.max(1, pt.folderCount || 3);
    if (folderNum < 1 || folderNum > currentCount || currentCount <= 1) return res.status(400).json({ error: 'Invalid folder or cannot delete last folder' });
    const newCount = currentCount - 1;
    const ptSuffix = pt.id && pt.id !== 'default' ? `pt_${pt.id}` : '';
    const uidSeg = String(effectiveUid).replace(/[/\\]/g, '_');
    {
      const base = ptSuffix ? path.join(UPLOADS, uidSeg, String(projectId), String(campaignId), ptSuffix) : path.join(UPLOADS, uidSeg, String(projectId), String(campaignId));
      if (folderNum === currentCount) {
        const dirToRemove = path.join(base, `folder${currentCount}`);
        if (fsSync.existsSync(dirToRemove)) await fs.rm(dirToRemove, { recursive: true, force: true }).catch(() => {});
      }
      for (let i = folderNum; i < currentCount; i++) {
        const srcDir = path.join(base, `folder${i + 1}`);
        const dstDir = path.join(base, `folder${i}`);
        if (fsSync.existsSync(srcDir)) {
          const files = await fs.readdir(srcDir).catch(() => []);
          await fs.mkdir(dstDir, { recursive: true });
          const dstFiles = await fs.readdir(dstDir).catch(() => []);
          for (const f of dstFiles) {
            const p = path.join(dstDir, f);
            const stat = await fs.stat(p).catch(() => null);
            if (stat && stat.isFile()) await fs.unlink(p).catch(() => {});
          }
          for (const f of files) {
            const src = path.join(srcDir, f);
            const stat = await fs.stat(src).catch(() => null);
            if (stat && stat.isFile()) await fs.rename(src, path.join(dstDir, f));
          }
          await fs.rm(srcDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
    const textOptionsPerFolder = Array.isArray(pt.textOptionsPerFolder) ? [...pt.textOptionsPerFolder] : [];
    textOptionsPerFolder.splice(folderNum - 1, 1);
    const textStylePerFolder = Array.isArray(pt.textStylePerFolder) ? [...pt.textStylePerFolder] : [];
    if (textStylePerFolder.length >= folderNum) textStylePerFolder.splice(folderNum - 1, 1);
    const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
    const pagePts = [...(pagePostTypes[projectId] || [])];
    const ptIdx = pagePts.findIndex((p) => p.id === pt.id);
    const updatedPt = { ...pt, folderCount: newCount, textOptionsPerFolder, textStylePerFolder };
    if (ptIdx >= 0) pagePts[ptIdx] = updatedPt;
    pagePostTypes[projectId] = pagePts;
    const updated = { ...campaign, pagePostTypes };
    saveCampaign(updated, effectiveUid);
    res.json(ensurePostTypes(updated, projectId));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

async function deleteFolderFile(userId, projectId, campaignId, folderNum, filename, postTypeId) {
  const campaign = getCampaignById(campaignId, userId);
  const pt = getPostType(campaign, postTypeId, projectId);
  if (storage.useSupabase()) {
    await storage.deleteFile(projectId, campaignId, postTypeId, folderNum, filename, userId);
  } else {
    const folderCount = pt && pt.mediaType === 'video' ? 2 : (pt && pt.mediaType === 'video_text' ? 1 : (pt ? Math.max(1, pt.folderCount || 3) : 999));
    const dirs = campaignDirs(userId, projectId, campaignId, folderCount, pt ? pt.id : undefined);
    const dir = dirs[folderNum - 1];
    if (!dir) return;
    const filePath = path.join(dir, filename);
    await fs.unlink(filePath);
  }
  if (pt && pt.mediaType === 'video') {
    const posted = await readVideoPosted(userId, projectId, campaignId, pt.id, folderNum);
    if (posted[filename] !== undefined) {
      delete posted[filename];
      const p = videoPostedPath(userId, projectId, campaignId, pt.id, folderNum);
      await fs.writeFile(p, JSON.stringify(posted), 'utf8');
    }
  }
}

api.delete('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/images/:filename', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
    const postTypeId = req.query.postTypeId || 'default';
    const filename = req.params.filename;
    if (!filename || /[\/\\]/.test(filename)) return res.status(400).json({ error: 'Invalid filename' });
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    await deleteFolderFile(effectiveUid, projectId, campaignId, folderNum, filename, postTypeId);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/media/:filename', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
    const postTypeId = req.query.postTypeId || 'default';
    const filename = req.params.filename;
    if (!filename || /[\/\\]/.test(filename)) return res.status(400).json({ error: 'Invalid filename' });
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    await deleteFolderFile(effectiveUid, projectId, campaignId, folderNum, filename, postTypeId);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/clear', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
    const postTypeId = req.query.postTypeId || 'default';
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    const campaign = getCampaignById(campaignId, effectiveUid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    const folderCount = pt.mediaType === 'video' ? 2 : (pt.mediaType === 'video_text' ? 1 : Math.max(1, pt.folderCount || 3));
    const dirs = campaignDirs(effectiveUid, projectId, campaignId, folderCount, pt.id);
    const dir = dirs[folderNum - 1];
    if (!dir) return res.status(400).json({ error: 'Invalid folder' });
    const isVideo = pt.mediaType === 'video' || pt.mediaType === 'video_text';
    const files = isVideo ? await listVideos(dir) : await listImages(dir);
    for (const file of files) {
      const name = file.filename || (file.path && path.basename(file.path));
      if (name) await deleteFolderFile(effectiveUid, projectId, campaignId, folderNum, name, postTypeId).catch(() => {});
    }
    res.json({ ok: true, deleted: files.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

function imageContentType(filename) {
  const ext = (path.extname(filename) || '').toLowerCase();
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

function videoContentType(filename) {
  const ext = (path.extname(filename) || '').toLowerCase();
  const map = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.m4v': 'video/x-m4v' };
  return map[ext] || 'video/mp4';
}

api.get('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/images/:filename', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId);
  const campaignId = String(req.params.campaignId);
  const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
  const postTypeId = req.query.postTypeId || 'default';
  const filename = req.params.filename;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  try {
    if (storage.useSupabase()) {
      const directUrl = storage.getFileUrl(projectId, campaignId, postTypeId, folderNum, filename, uid);
      if (directUrl) {
        res.set('Cache-Control', 'public, max-age=86400');
        return res.redirect(302, directUrl);
      }
      const buffer = await storage.readFileBuffer(projectId, campaignId, postTypeId, folderNum, filename, uid);
      res.set('Cache-Control', 'private, max-age=3600');
      res.type(imageContentType(filename));
      return res.send(buffer);
    }
    const campaign = getCampaignById(campaignId, uid);
    const pt = getPostType(campaign, postTypeId, projectId);
    const uidSeg = String(uid).replace(/[/\\]/g, '_');
    const ptBase = pt && pt.id && pt.id !== 'default' ? `pt_${pt.id}` : '';
    const base = path.join(UPLOADS, uidSeg, projectId, campaignId, ptBase);
    const filePath = path.join(base, `folder${folderNum}`, filename);
    if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS))) return res.status(403).end();
    res.sendFile(path.resolve(filePath), (err) => { if (err && err.statusCode) res.status(err.statusCode).end(); });
  } catch (e) {
    if (e.message && (e.message.includes('Download failed') || /maximum allowed size|exceeded/i.test(e.message))) {
      const directUrl = storage.useSupabase() && storage.getFileUrl(projectId, campaignId, postTypeId, folderNum, filename, uid);
      if (directUrl) {
        res.set('Cache-Control', 'public, max-age=86400');
        return res.redirect(302, directUrl);
      }
      return res.status(404).end();
    }
    res.status(500).end();
  }
});

api.get('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/media/:filename', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId);
  const campaignId = String(req.params.campaignId);
  const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
  const postTypeId = req.query.postTypeId || 'default';
  const filename = req.params.filename;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  const campaign = getCampaignById(campaignId, uid);
  const pt = getPostType(campaign, postTypeId, projectId);
  if (!campaign || !pt) return res.status(404).end();
  if (storage.useSupabase()) {
    const directUrl = storage.getFileUrl(projectId, campaignId, postTypeId, folderNum, filename, uid);
    if (directUrl) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.redirect(302, directUrl);
    }
    try {
      const buffer = await storage.readFileBuffer(projectId, campaignId, postTypeId, folderNum, filename, uid);
      res.set('Cache-Control', 'private, max-age=3600');
      res.set('Accept-Ranges', 'bytes');
      res.type(videoContentType(filename));
      return res.send(buffer);
    } catch (e) {
      if (e.message && /download failed|not found/i.test(e.message)) return res.status(404).end();
      return res.status(500).end();
    }
  }
  const uidSeg = String(uid).replace(/[/\\]/g, '_');
  const ptBase = pt.id && pt.id !== 'default' ? `pt_${pt.id}` : '';
  const base = path.join(UPLOADS, uidSeg, projectId, campaignId, ptBase);
  const filePath = path.join(base, `folder${folderNum}`, filename);
  if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS))) return res.status(403).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(filePath), (err) => { if (err && err.statusCode) res.status(err.statusCode).end(); });
});

api.get('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/download-zip', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId);
  const campaignId = String(req.params.campaignId);
  const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
  const postTypeId = req.query.postTypeId || 'default';
  const campaign = getCampaignById(campaignId, uid);
  const pt = getPostType(campaign, postTypeId, projectId);
  if (!campaign || !pt) return res.status(404).json({ error: 'Campaign or post type not found' });
  const isVideo = pt.mediaType === 'video' || pt.mediaType === 'video_text';
  if (!isVideo) return res.status(400).json({ error: 'Download zip is only available for video folders' });
  const folderCount = pt.mediaType === 'video_text' ? 1 : 2;
  if (folderNum < 1 || folderNum > folderCount) return res.status(400).json({ error: 'Invalid folder' });
  try {
    const dirs = campaignDirs(uid, projectId, campaignId, folderCount, pt.id);
    const dir = dirs[folderNum - 1];
    if (!dir) return res.status(404).json({ error: 'Folder not found' });
    const files = await listVideos(dir);
    if (!files.length) return res.status(400).json({ error: 'No videos in this folder' });
    const zipName = `folder${folderNum}-videos.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
    archive.pipe(res);
    for (const file of files) {
      const name = file.filename || (file.path && path.basename(file.path));
      if (!name) continue;
      let buf;
      if (storage.useSupabase()) {
        buf = await storage.readFileBuffer(projectId, campaignId, pt.id, folderNum, name, uid);
      } else {
        buf = await fs.readFile(file.path);
      }
      archive.append(buf, { name });
    }
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e.message) });
  }
});

api.get('/calendar', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projects = getProjects(uid);
    const projectMap = {};
    projects.forEach((p) => { projectMap[p.id] = p; });
    const allCampaigns = [];
    for (const p of projects) {
      const campaigns = getCampaigns(p.id, uid);
      campaigns.forEach((c) => allCampaigns.push({ ...c, projectName: p.name, projectId: p.id }));
    }
    const todayStrTZ = getTodayDateStringInTZ();
    const items = [];
    const countByKey = {};
    const getMinFolderCount = async (projectId, campaignId, pt) => {
      if (!pt) return 0;
      if (pt.mediaType === 'video') {
        const dirs = campaignDirs(uid, String(projectId), String(campaignId), 2, pt.id);
        const v1 = await listVideos(dirs[0]);
        const v2 = await listVideos(dirs[1]);
        const posted1 = await readVideoPosted(uid, String(projectId), String(campaignId), pt.id, 1);
        const posted2 = await readVideoPosted(uid, String(projectId), String(campaignId), pt.id, 2);
        const unposted = (list, posted) => list.filter((v) => {
          const name = v.filename || (v.path && path.basename(v.path));
          return name && !posted[name];
        });
        return unposted(v1, posted1).length + unposted(v2, posted2).length;
      }
      if (pt.mediaType === 'video_text') {
        const folderCount = 1;
        const dirs = campaignDirs(uid, String(projectId), String(campaignId), folderCount, pt.id);
        const files = await listVideos(dirs[0]);
        return files.length;
      }
      const folderCount = Math.max(1, pt.folderCount || 3);
      const dirs = campaignDirs(uid, String(projectId), String(campaignId), folderCount, pt.id);
      const samePhotoEachTime = Array.isArray(pt.samePhotoEachTimePerFolder) ? pt.samePhotoEachTimePerFolder : [];
      let min = Infinity;
      for (let i = 0; i < folderCount; i++) {
        if (samePhotoEachTime[i]) continue;
        const files = await listImages(dirs[i]);
        if (files.length < min) min = files.length;
      }
      return min === Infinity ? (folderCount ? Infinity : 0) : min;
    };
    const calendarDays = 90;
    for (let d = 0; d < calendarDays; d++) {
      const date = new Date(todayStrTZ + 'T12:00:00Z');
      date.setUTCDate(date.getUTCDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      const dayOfWeek = date.getUTCDay();
      for (const c of allCampaigns) {
        if (c.paused) continue;
        const postTypes = getPostTypesForPage(c, c.projectId);
        const pts = postTypes.length ? postTypes : [];
        for (const pt of pts) {
          if (!isPostTypeDeployed(c, c.projectId, pt.id)) continue;
          if (pt.scheduleEnabled === false) continue;
          const times = pt.scheduleTimes || c.scheduleTimes || [];
          const startDate = pt.scheduleStartDate || c.scheduleStartDate || c.campaignStartDate;
          const endDate = pt.scheduleEndDate || c.scheduleEndDate || c.campaignEndDate;
          if (startDate && dateStr < startDate) continue;
          if (endDate && dateStr > endDate) continue;
          const days = pt.scheduleDaysOfWeek ?? c.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
          if (days.length && !days.includes(dayOfWeek)) continue;
          const key = `${c.id}-${c.projectId}-${pt.id}`;
          if (!(key in countByKey)) {
            countByKey[key] = { added: 0, max: await getMinFolderCount(c.projectId, c.id, pt) };
          }
          const { added, max } = countByKey[key];
          const capped = pt.mediaType === 'photo' || pt.mediaType === 'video_text' || pt.mediaType === 'video';
          if (capped && added >= max) continue;
          for (const t of times) {
            if (capped && countByKey[key].added >= countByKey[key].max) break;
            const [h, m] = t.split(':').map(Number);
            const sortKey = dateStr + ' ' + String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0');
            const scheduledAt = getScheduleUtcIso(dateStr, t, TZ);
            items.push({
              date: dateStr,
              time: t,
              sortKey,
              scheduledAt,
              projectName: c.projectName,
              projectId: c.projectId,
              campaignName: c.name,
              campaignId: c.id,
              postTypeId: pt.id,
            });
            if (capped) countByKey[key].added++;
          }
        }
      }
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const recurringIds = getRecurringPageIds(uid);
    const lastPostByKey = {};
    for (const it of items) {
      const k = `${it.projectId}-${it.campaignId}`;
      if (!lastPostByKey[k] || it.date > lastPostByKey[k]) lastPostByKey[k] = it.date;
    }
    const campaignById = {};
    for (const c of allCampaigns) campaignById[c.id] = c;
    const todayStr = new Date().toISOString().slice(0, 10);
    const msPerDay = 24 * 60 * 60 * 1000;
    const recurringTodo = [];
    for (const projectId of recurringIds) {
      const proj = projectMap[projectId];
      if (!proj) continue;
      const pageCampaigns = getCampaigns(projectId, uid);
      const recurringCamp = pageCampaigns.find((c) => c.isPageNative);
      if (!recurringCamp) continue;
      const k = `${projectId}-${recurringCamp.id}`;
      const stopDate = lastPostByKey[k];
      if (stopDate) {
        const daysUntil = Math.round((new Date(stopDate + 'T12:00:00Z') - new Date(todayStr + 'T12:00:00Z')) / msPerDay);
        recurringTodo.push({ type: 'recurring', pageName: proj.name || ('Page ' + projectId), stopDate, daysUntil });
      }
    }
    recurringTodo.sort((a, b) => (a.daysUntil - b.daysUntil) || (a.stopDate || '').localeCompare(b.stopDate || ''));
    const campaignGapTodo = [];
    const seenCampaignGap = new Set();
    for (const it of items) {
      const c = campaignById[it.campaignId];
      if (!c || !c.campaignEndDate) continue;
      const k = `${it.projectId}-${it.campaignId}`;
      const lastDate = lastPostByKey[k];
      if (!lastDate || lastDate >= c.campaignEndDate) continue;
      if (seenCampaignGap.has(k)) continue;
      seenCampaignGap.add(k);
      const daysBefore = Math.round((new Date(c.campaignEndDate) - new Date(lastDate)) / msPerDay);
      const pageName = it.projectName || (projectMap[it.projectId] && projectMap[it.projectId].name) || ('Page ' + it.projectId);
      campaignGapTodo.push({ type: 'campaign_gap', pageName, campaignName: c.name, daysBefore });
    }
    campaignGapTodo.sort((a, b) => a.daysBefore - b.daysBefore);

    const outcomes = await readRunOutcomes();
    const outcomeByKey = runOutcomesByKey(outcomes);
    for (const it of items) {
      const key = `${it.projectId}|${it.campaignId}|${it.postTypeId || 'default'}|${it.scheduledAt}`;
      const o = outcomeByKey[key];
      it.postStatus = o ? o.status : null;
    }

    res.json({ items, timezone: TZ, timezoneLabel: getScheduleTimezoneLabel(), todo: [...recurringTodo, ...campaignGapTodo], recurringTodo, campaignGapTodo });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

async function validateUploadContext(req, res, next) {
  req.setTimeout(5 * 60 * 1000);
  res.setTimeout(5 * 60 * 1000);
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId || req.query.projectId || '');
  const campaignId = String(req.params.campaignId || req.query.campaignId || '');
  if (!projectId || !campaignId) return res.status(400).json({ error: 'Missing project or campaign' });
  const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
  const campaign = getCampaignById(campaignId, effectiveUid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  const postTypeId = (req.query.postTypeId != null && req.query.postTypeId !== '') ? String(req.query.postTypeId) : 'default';
  const pt = getPostType(campaign, postTypeId, projectId);
  if (!pt) {
    const pts = getPostTypesForPage(campaign, projectId);
    const hint = pts.length ? `Post type "${postTypeId}" not found. Available: ${pts.map((p) => p.id).join(', ')}.` : 'No post types for this page yet. Create a "videos (without text)" post type first.';
    return res.status(404).json({ error: hint });
  }
  const isVideoQuery = req.query.mediaType === 'video' || req.query.mediaType === 'video_text';
  const isVideoPt = pt && (pt.mediaType === 'video' || pt.mediaType === 'video_text');
  req.uploadContext = {
    uid: effectiveUid,
    projectId,
    campaignId,
    ptId: String(pt.id),
    folderNum: Math.max(1, Math.min(999, parseInt(req.query.folder || '1', 10))),
    isVideo: isVideoQuery || isVideoPt,
  };
  next();
}

const UPLOAD_MAX_VIDEO_MB = 100;
api.post('/projects/:projectId/campaigns/:campaignId/upload', validateUploadContext, (req, res, next) => {
  upload.array('photo', 100)(req, res, async (err) => {
    if (err) {
      console.error('[upload] multer error:', err.message);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large. Each file must be under ${UPLOAD_MAX_VIDEO_MB} MB to upload. Videos are then compressed to under 50 MB for storage. Use a shorter clip or compress the video first.`
        : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    const ctx = req.uploadContext;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files or invalid folder. For video, use MP4, MOV, WebM, AVI, or M4V.' });
    try {
      if (storage.useSupabase()) {
        for (const file of files) {
          const ext = path.extname(file.originalname) || (ctx.isVideo ? '.mp4' : '.jpg');
          let filename = file.filename || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          const contentType = file.mimetype || (ctx.isVideo ? 'video/mp4' : 'image/jpeg');
          let buffer = file.buffer || await fs.readFile(file.path);
          if (ctx.isVideo && buffer.length > SUPABASE_SAFE_VIDEO_BYTES) {
            buffer = await compressVideoBufferToMax(buffer, SUPABASE_SAFE_VIDEO_BYTES, ext);
            if (buffer.length > SUPABASE_SAFE_VIDEO_BYTES) {
              return res.status(400).json({
                error: 'Video is too large. After compression it still exceeds the 50 MB limit. Try a shorter clip or compress it locally first.',
              });
            }
            filename = path.basename(filename, path.extname(filename)) + '.mp4';
          }
          await storage.uploadFile(ctx.projectId, ctx.campaignId, ctx.ptId, ctx.folderNum, buffer, filename, contentType, ctx.uid);
          if (file.path) await fs.unlink(file.path).catch(() => {});
        }
      }
      res.json({ ok: true, count: files.length });
    } catch (e) {
      console.error('[upload] error:', e.message);
      let msg = e.message || 'Upload failed';
      if (/maximum allowed size|exceeded.*size|object.*size|file.*too large/i.test(msg)) {
        msg = 'Video or file is too large for storage. Keep each file under 50 MB (Supabase limit). Try a shorter clip, or compress the video.';
      }
      return res.status(500).json({ error: msg });
    }
  });
});

api.post('/projects/:projectId/campaigns/:campaignId/preview', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const postTypeId = req.body.postTypeId || 'default';
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    const campaign = getCampaignById(campaignId, effectiveUid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    if (pt.mediaType === 'video_text') {
      try {
        const textStyleOverride = Array.isArray(req.body.textStylePerFolder) ? req.body.textStylePerFolder : null;
        const textOptionsOverride = Array.isArray(req.body.textOptionsPerFolder) ? req.body.textOptionsPerFolder : null;
        const result = await runCampaignPipelineVideoWithText(effectiveUid, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId, { preview: true });
        const url = result.webContentUrls && result.webContentUrls[0] ? result.webContentUrls[0] : null;
        return res.json({ url: url || '', base64: null });
      } catch (e) {
        const msg = (e && e.message) ? String(e.message) : '';
        let friendly = msg || 'Video preview failed';
        if (/cannot find ffmpeg|ffmpeg not found|enoent.*ffmpeg/i.test(msg)) {
          friendly = 'Video preview requires ffmpeg on the server. It is now installed in the Dockerfile—redeploy to enable preview.';
        } else if (/SIGKILL|killed|signal/i.test(msg)) {
          friendly = 'Preview was stopped (server ran out of memory or hit a resource limit). Try again, or use a shorter/smaller video for preview.';
        }
        return res.status(500).json({ error: friendly });
      }
    }
    const folderNum = Math.max(1, Math.min(999, parseInt(req.body.folderNum || '1', 10)));
    const textStyle = req.body.textStyle && typeof req.body.textStyle === 'object' ? req.body.textStyle : {};
    const optsFromBody = Array.isArray(req.body.textOptionsPerFolder) ? req.body.textOptionsPerFolder[folderNum - 1] : null;
    const optsFromPt = (pt.textOptionsPerFolder || campaign.textOptionsPerFolder || [])[folderNum - 1];
    const opts = Array.isArray(optsFromBody) && optsFromBody.length ? optsFromBody : (Array.isArray(optsFromPt) ? optsFromPt : []);
    const sampleText = await pickLeastUsedTextOptionAndIncrement(projectId, campaignId, postTypeId, folderNum - 1, opts);
    const folderCount = Math.max(1, pt.folderCount || 3);
    const dirs = campaignDirs(effectiveUid, projectId, campaignId, folderCount, pt.id);
    const dir = dirs[folderNum - 1];
    if (!dir) return res.status(404).json({ error: 'Folder not found' });
    const images = await listImages(dir);
    const chosen = images[0] || null;
    if (!chosen) return res.status(400).json({ error: 'No images in folder. Add photos to preview.' });
    const imgBuf = await getImageBuffer(chosen, folderNum - 1, dirs, projectId, campaignId, postTypeId, effectiveUid);
    const uniqueId = Date.now();
    const outName = `preview-${folderNum}-${uniqueId}.jpg`;
    const uidSeg = String(effectiveUid).replace(/[/\\]/g, '_');
    const outPath = storage.useSupabase() ? null : path.join(GENERATED, uidSeg, projectId, campaignId, outName);
    if (!storage.useSupabase()) await fs.mkdir(path.join(GENERATED, uidSeg, projectId, campaignId), { recursive: true });
    const normStyle = {
      x: textStyle.x != null && textStyle.x !== '' ? parseFloat(textStyle.x) : 0,
      y: textStyle.y != null && textStyle.y !== '' ? parseFloat(textStyle.y) : 0,
      fontSize: textStyle.fontSize != null ? parseFloat(textStyle.fontSize) : 60,
      font: textStyle.font || 'Arial, sans-serif',
      color: textStyle.color || 'white',
      strokeWidth: textStyle.strokeWidth != null ? parseFloat(textStyle.strokeWidth) : 2,
    };
    const imageBuffer = await addTextOverlay(imgBuf, sampleText, outPath, normStyle);
    const baseUrl = getBaseUrlForGenerated(req);
    let url;
    if (storage.useSupabase()) {
      await storage.uploadGenerated(projectId, campaignId, outName, imageBuffer, undefined, effectiveUid);
      url = `${baseUrl}/generated/${uidSeg}/${projectId}/${campaignId}/${outName}`;
    } else {
      url = `${baseUrl}/generated/${uidSeg}/${projectId}/${campaignId}/${outName}`;
    }
    res.json({ url, base64: imageBuffer.toString('base64') });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/projects/:projectId/campaigns/:campaignId/run', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = req.params.projectId;
    const campaignId = req.params.campaignId;
    const postTypeId = req.body?.postTypeId || 'default';
    const effectiveUid = await resolveEffectiveUserId(campaignId, uid);
    const campaign = getCampaignById(campaignId, effectiveUid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const todayStr = new Date().toISOString().slice(0, 10);
    if (campaign.campaignStartDate && todayStr < campaign.campaignStartDate) {
      return res.status(400).json({ error: 'Campaign has not started yet. Deployment is only allowed within the campaign date window.', campaignStartDate: campaign.campaignStartDate });
    }
    if (campaign.campaignEndDate && todayStr > campaign.campaignEndDate) {
      return res.status(400).json({ error: 'Campaign has ended. Deployment is only allowed within the campaign date window.', campaignEndDate: campaign.campaignEndDate });
    }
    const pt = getPostType(campaign, postTypeId, projectId);
    if (pt) {
      if (pt.scheduleStartDate && todayStr < pt.scheduleStartDate) {
        return res.status(400).json({ error: 'This post type\'s schedule has not started yet.', scheduleStartDate: pt.scheduleStartDate });
      }
      if (pt.scheduleEndDate && todayStr > pt.scheduleEndDate) {
        return res.status(400).json({ error: 'This post type\'s schedule has ended.', scheduleEndDate: pt.scheduleEndDate });
      }
    }
    const textStyleOverride = Array.isArray(req.body?.textStylePerFolder) ? req.body.textStylePerFolder : null;
    const textOptionsOverride = Array.isArray(req.body?.textOptionsPerFolder) ? req.body.textOptionsPerFolder : null;
    const sendAsDraft = req.body?.sendAsDraft === true;
    const addMusicRequested = req.body?.addMusicToCarousel === true;
    // Use the campaign owner's settings for Blotato (shared members post on behalf of owner)
    const ownerSettings = await getUserSettings(effectiveUid);
    const project = getProjects(effectiveUid).find((p) => String(p.id) === String(projectId));
    const accountId = project?.blotatoAccountId;
    const apiKey = ownerSettings.blotatoApiKey;
    const isPhotoPostType = pt && pt.mediaType === 'photo';
    const addMusicToCarousel = isPhotoPostType && addMusicRequested;

    if (process.env.ENCODING_MODE === 'worker' && pt && (pt.mediaType === 'video' || pt.mediaType === 'video_text')) {
      try {
        const payload = await buildEncodingJobPayload(effectiveUid, projectId, campaignId, postTypeId, {
          sendToBlotato: !!(apiKey && accountId),
          draft: sendAsDraft,
          scheduledAt: null,
          textStyleOverride,
          textOptionsOverride,
        });
        if (payload) {
          const jobId = await enqueueEncodingJob(payload);
          return res.json({ jobId, status: 'queued' });
        }
      } catch (e) {
        return res.status(500).json({ error: String(e && e.message || 'Run failed') });
      }
    }

    const result = await runCampaignPipeline(effectiveUid, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId);
    let runStatus = null;
    if (apiKey && accountId && result.webContentUrls?.length) {
      try {
        await sendToBlotato(apiKey, accountId, result.webContentUrls, { isDraft: sendAsDraft, addMusicToCarousel, title: isPhotoPostType ? (pt?.title || undefined) : undefined });
        result.blotatoSent = true;
        result.blotatoSentAsDraft = sendAsDraft;
        runStatus = 'success';
      } catch (blotatoErr) {
        result.blotatoError = String(blotatoErr.message);
        runStatus = 'failure';
      }
    }
    if (runStatus) {
      const todayStrRun = getTodayDateStringInTZ();
      const currentTimeRun = getCurrentTimeString();
      const times = (pt && (pt.scheduleTimes || campaign.scheduleTimes)) || [];
      const slotTime = times.filter((t) => String(t) <= currentTimeRun).pop() || times[0] || currentTimeRun;
      const scheduledAtRun = getScheduleUtcIso(todayStrRun, slotTime, TZ);
      await appendRunOutcome(projectId, campaignId, postTypeId, scheduledAtRun, runStatus, runStatus === 'failure' ? result.blotatoError : null).catch(() => {});
    }
    // Photos stay in folders; we track usage via image-usage counts and pick least-used next time.
    res.json(result);
  } catch (e) {
    let msg = String(e && e.message || 'Run failed');
    if (/SIGKILL|killed|signal|ECONNRESET|out of memory/i.test(msg)) {
      msg = 'Video encoding was stopped (server ran out of memory or hit a limit). Try a shorter or smaller video, or try again—encoding now uses lower memory.';
    }
    res.status(500).json({ error: msg });
  }
});

// --- Local dev data sync ---
api.get('/admin/export-data', requireEncodingWorker, (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const projects = readJson(getProjectsPath(userId), { nextId: 1, items: [] });
    const campaigns = readJson(getCampaignsPath(userId), { nextId: 1, items: [] });
    const textPresets = readJson(getTextPresetsPath(userId), { nextId: 1, presets: [] });
    const trends = readJson(getTrendsPath(userId), { nextId: 1, items: [] });
    const logins = readJson(getLoginsPath(userId), { nextId: 1, items: [] });
    const recurringPages = readJson(getRecurringPagesPath(userId), { projectIds: [] });
    res.json({ projects, campaigns, textPresets, trends, logins, recurringPages });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// --- Encoding queue API (for VPS worker when ENCODING_MODE=worker) ---

// Serve preset video files to the VPS worker
api.get('/encoding/preset-file', requireEncodingWorker, async (req, res) => {
  try {
    const { userId, presetId } = req.query;
    if (!userId || !presetId) return res.status(400).json({ error: 'Missing userId or presetId' });
    const presetPath = resolvePresetPath(userId, presetId);
    if (!presetPath || !fsSync.existsSync(presetPath)) return res.status(404).json({ error: 'Preset not found' });
    res.sendFile(presetPath);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/encoding/jobs/next', requireEncodingWorker, async (req, res) => {
  try {
    const job = await claimNextEncodingJob();
    if (!job) return res.status(204).send();
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/encoding/jobs/:id/complete', requireEncodingWorker, async (req, res) => {
  try {
    const id = req.params.id;
    const { url, error: errMsg } = req.body || {};
    await completeEncodingJob(id, url ? { url, error: null } : { url: null, error: String(errMsg || 'Unknown error') });
    const job = await getEncodingJob(id);
    if (!job || !job.payload) return res.json({ ok: true });
    const payload = job.payload;
    const { userId, projectId, campaignId, postTypeId, draft, scheduledAt } = payload;
    if (job.status === 'completed' && url && payload.runId != null) {
      const campaignIdStr = String(campaignId);
      const runData = {
        campaignId: campaignIdStr,
        runId: payload.runId,
        webContentUrls: [url],
        webContentBase64: [],
        usedSourcePaths: [],
        at: new Date().toISOString(),
      };
      await fs.writeFile(
        path.join(RUNS_DIR, `${campaignIdStr}.json`),
        JSON.stringify({ campaignId: campaignIdStr, runId: runData.runId, webContentUrls: runData.webContentUrls, at: runData.at }, null, 2)
      );
      if (userId && projectId) {
        const ownerSettings = await getUserSettings(userId);
        const project = getProjects(userId).find((p) => String(p.id) === String(projectId));
        const accountId = project?.blotatoAccountId;
        const apiKey = ownerSettings.blotatoApiKey;
        if (apiKey && accountId) {
          console.log(`[encoding] Sending to Blotato: accountId=${accountId} url=${url}`);
          try {
            const blotatoRes = await sendToBlotato(apiKey, accountId, [url], { isDraft: draft, addMusicToCarousel: false });
            console.log(`[encoding] Blotato post sent for campaign ${campaignId} page ${projectId} | response:`, JSON.stringify(blotatoRes));
          } catch (blotatoErr) {
            console.error(`[encoding] Blotato failed:`, blotatoErr.message);
            if (scheduledAt) {
              await appendRunOutcome(projectId, campaignId, postTypeId, scheduledAt, 'failure', `Blotato: ${blotatoErr.message}`).catch(() => {});
            }
          }
        }
      }
      if (scheduledAt) {
        await appendRunOutcome(projectId, campaignId, postTypeId, scheduledAt, 'success').catch(() => {});
      }
    } else if (job.status === 'failed' && scheduledAt) {
      const errMsg = job.result && job.result.error;
      await appendRunOutcome(projectId, campaignId, postTypeId, scheduledAt, 'failure', errMsg || null).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/encoding/jobs/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const job = await getEncodingJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.payload && String(job.payload.userId) !== String(uid)) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/projects/:projectId/campaigns/:campaignId/latest', async (req, res) => {
  try {
    const campaignId = String(req.params.campaignId);
    const filePath = path.join(RUNS_DIR, `${campaignId}.json`);
    const data = await fs.readFile(filePath, 'utf8').catch(() => '{}');
    res.json(JSON.parse(data));
  } catch {
    res.json({ webContentUrls: [] });
  }
});

api.delete('/projects/:projectId/campaigns/:campaignId/latest', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const runPath = path.join(RUNS_DIR, `${campaignId}.json`);
    await fs.unlink(runPath).catch(() => {});
    const genDir = generatedDir(uid, projectId, campaignId);
    const files = await fs.readdir(genDir).catch(() => []);
    for (const f of files) await fs.unlink(path.join(genDir, f)).catch(() => {});
    res.json({ webContentUrls: [] });
  } catch {
    res.json({ webContentUrls: [] });
  }
});

// --- API: Trends ---
api.get('/trends', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  let items = getAllTrends(uid);
  const campaignId = req.query.campaignId != null ? String(req.query.campaignId).trim() : null;
  if (campaignId) items = items.filter((t) => t.campaignId != null && String(t.campaignId).trim() === campaignId);
  res.json(items);
});

api.post('/trends', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const name = (req.body.name || 'New trend').trim() || 'New trend';
    let pageIds = Array.isArray(req.body.pageIds) ? req.body.pageIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id)) : [];
    const campaignId = req.body.campaignId != null ? String(req.body.campaignId) : null;
    if (!pageIds.length && campaignId) {
      const campaign = getCampaignById(campaignId, uid);
      if (campaign) pageIds = (campaign.pageIds && campaign.pageIds.length) ? campaign.pageIds : (campaign.projectId != null ? [campaign.projectId] : []);
    }
    if (!pageIds.length) return res.status(400).json({ error: 'Select at least one page' });
    const projects = getProjects(uid);
    const validPageIds = pageIds.filter((pid) => projects.some((p) => p.id === pid));
    if (!validPageIds.length) return res.status(400).json({ error: 'No valid pages selected' });
    const meta = getTrendsMeta(uid);
    const folderCount = Math.max(1, parseInt(req.body.folderCount, 10) || 3);
    const trend = {
      id: meta.nextId,
      name,
      pageIds: validPageIds,
      folderCount,
      textOptions: [...DEFAULT_TEXT_OPTIONS],
      textStyle: {},
      pageSchedules: {},
      campaignId: (campaignId != null && campaignId !== '') ? String(campaignId) : null,
      createdAt: new Date().toISOString(),
    };
    saveTrend(trend, uid);
    await ensureTrendDirs(uid, trend.id, trend.pageIds, trend.folderCount);
    res.status(201).json(trend);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/trends/:trendId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const trend = getTrendById(req.params.trendId, uid);
  if (!trend) return res.status(404).json({ error: 'Trend not found' });
  const folderCount = trend.folderCount != null ? Math.max(1, parseInt(trend.folderCount, 10) || 3) : 1;
  res.json({ ...trend, folderCount });
});

api.put('/trends/:trendId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = parseInt(req.params.trendId, 10);
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const name = req.body.name !== undefined ? (String(req.body.name || '').trim() || trend.name) : trend.name;
    let pageIds = trend.pageIds && trend.pageIds.length ? [...trend.pageIds] : [];
    if (Array.isArray(req.body.pageIds)) {
      const projects = getProjects(uid);
      pageIds = req.body.pageIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id)).filter((pid) => projects.some((p) => p.id === pid));
    }
    const textOptions = Array.isArray(req.body.textOptions) ? req.body.textOptions : trend.textOptions;
    const textStyle = req.body.textStyle && typeof req.body.textStyle === 'object' ? req.body.textStyle : trend.textStyle;
    const pageSchedules = req.body.pageSchedules && typeof req.body.pageSchedules === 'object' ? req.body.pageSchedules : trend.pageSchedules;
    const folderCount = req.body.folderCount !== undefined ? Math.max(1, parseInt(req.body.folderCount, 10) || 3) : (trend.folderCount != null ? Math.max(1, parseInt(trend.folderCount, 10) || 3) : 1);
    const campaignId = req.body.campaignId !== undefined ? (req.body.campaignId != null && req.body.campaignId !== '' ? String(req.body.campaignId) : null) : trend.campaignId;
    const sendAsDraft = req.body.sendAsDraft !== undefined ? !!req.body.sendAsDraft : trend.sendAsDraft;
    const addMusicToCarousel = req.body.addMusicToCarousel !== undefined ? !!req.body.addMusicToCarousel : trend.addMusicToCarousel;
    const updated = { ...trend, name, pageIds, textOptions, textStyle, pageSchedules, folderCount, campaignId, sendAsDraft, addMusicToCarousel };
    saveTrend(updated, uid);
    await ensureTrendDirs(uid, trendId, updated.pageIds, updated.folderCount);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/trends/:trendId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const trend = getTrendById(req.params.trendId, uid);
  if (!trend) return res.status(404).json({ error: 'Trend not found' });
  const trendId = String(trend.id);
  deleteTrend(trend.id, uid);
  try {
    const avatarPath = path.join(TREND_AVATARS_DIR, `${trendId}.jpg`);
    if (fsSync.existsSync(avatarPath)) fsSync.unlinkSync(avatarPath);
  } catch (_) {}
  res.json({ ok: true });
});

api.get('/trends/:trendId/avatar', (req, res) => {
  const id = String(req.params.trendId);
  const filePath = path.join(TREND_AVATARS_DIR, `${id}.jpg`);
  if (fsSync.existsSync(filePath)) { res.set('Cache-Control', 'public, max-age=86400'); return res.sendFile(path.resolve(filePath)); }
  res.status(404).end();
});

api.post('/trends/:trendId/avatar', (req, res, next) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  trendAvatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received. Use the "avatar" field.' });
    try {
      const trendId = String(req.params.trendId);
      const trend = getTrendById(trendId, uid);
      if (!trend) return res.status(404).json({ error: 'Trend not found' });
      const srcPath = req.file.path;
      const tempPath = path.join(TREND_AVATARS_DIR, `${trendId}-temp-${Date.now()}.jpg`);
      const size = 400;
      await sharp(srcPath)
        .rotate()
        .resize(size, size, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 90 })
        .toFile(tempPath);
      await fs.rename(tempPath, srcPath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });
});

api.get('/trends/:trendId/pages/:pageIndex/images', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const pageIndex = Math.max(1, Math.min(999, parseInt(req.params.pageIndex, 10)));
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    if (pageIndex > pageIds.length) return res.status(404).json({ error: 'Page index out of range' });
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 1);
    const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
    const dir = dirs[0];
    const files = await listImages(dir);
    res.json({ images: files.map((f) => f.filename || path.basename(f.path || f)) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/trends/:trendId/pages/:pageIndex/folders', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const pageIndex = Math.max(1, Math.min(999, parseInt(req.params.pageIndex, 10)));
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    if (pageIndex > pageIds.length) return res.status(404).json({ error: 'Page index out of range' });
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 3);
    const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
    const result = {};
    for (let f = 1; f <= folderCount; f++) {
      const files = await listImages(dirs[f - 1]);
      result[`folder${f}`] = files.map((item) => item.filename || path.basename(item.path || item));
    }
    res.json({ folderCount, folders: result });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/trends/:trendId/pages/:pageIndex/folders/:folderNum/images', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const pageIndex = Math.max(1, Math.min(999, parseInt(req.params.pageIndex, 10)));
    const folderNum = Math.max(1, Math.min(999, parseInt(req.params.folderNum, 10)));
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    if (pageIndex > pageIds.length) return res.status(404).json({ error: 'Page index out of range' });
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 3);
    if (folderNum > folderCount) return res.status(404).json({ error: 'Folder index out of range' });
    const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
    const files = await listImages(dirs[folderNum - 1]);
    res.json({ images: files.map((f) => f.filename || path.basename(f.path || f)) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/trends/:trendId/pages/:pageIndex/folders/:folderNum/images/:filename', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const trendId = String(req.params.trendId);
  const pageIndex = Math.max(1, Math.min(999, parseInt(req.params.pageIndex, 10)));
  const folderNum = Math.max(1, Math.min(999, parseInt(req.params.folderNum, 10)));
  const filename = req.params.filename;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  const trend = getTrendById(trendId, uid);
  if (!trend) return res.status(404).end();
  const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
  if (pageIndex > pageIds.length) return res.status(404).end();
  const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 3);
  if (folderNum > folderCount) return res.status(404).end();
  const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
  const filePath = path.join(dirs[folderNum - 1], filename);
  if (!path.resolve(filePath).startsWith(path.resolve(TRENDS_DIR))) return res.status(403).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(filePath), (err) => { if (err && err.statusCode) res.status(err.statusCode).end(); });
});

api.post('/trends/:trendId/pages/:pageIndex/folders/:folderNum/upload', (req, res, next) => {
  trendUpload.array('photo', 100)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const pageIndex = Math.max(1, Math.min(999, parseInt(req.params.pageIndex, 10)));
    const folderNum = Math.max(1, Math.min(999, parseInt(req.params.folderNum, 10)));
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    if (pageIndex > pageIds.length) return res.status(404).json({ error: 'Page index out of range' });
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 3);
    if (folderNum > folderCount) return res.status(404).json({ error: 'Folder index out of range' });
    const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
    const dir = dirs[folderNum - 1];
    await fs.mkdir(dir, { recursive: true });
    const files = req.files || [];
    for (const file of files) {
      const ext = path.extname(file.originalname) || '.jpg';
      const name = file.filename || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const dest = path.join(dir, name);
      await fs.rename(file.path, dest).catch(() => fs.copyFile(file.path, dest));
      try { await fs.unlink(file.path); } catch (_) {}
    }
    res.json({ ok: true, count: files.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/trends/:trendId/pages/:pageIndex/upload', upload.array('photo', 100), async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const pageIndex = Math.max(1, Math.min(999, parseInt(req.params.pageIndex, 10)));
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    if (pageIndex > pageIds.length) return res.status(404).json({ error: 'Page index out of range' });
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 1);
    const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
    const dir = dirs[0];
    await fs.mkdir(dir, { recursive: true });
    const files = req.files || [];
    for (const file of files) {
      const ext = path.extname(file.originalname) || '.jpg';
      const name = file.filename || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const dest = path.join(dir, name);
      await fs.rename(file.path, dest).catch(() => fs.copyFile(file.path, dest));
      try { await fs.unlink(file.path); } catch (_) {}
    }
    res.json({ ok: true, count: files.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/trends/:trendId/preview', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const pageIndex = Math.max(1, Math.min(999, parseInt(req.body.pageIndex, 10) || 1));
    const folderNum = Math.max(1, Math.min(999, parseInt(req.body.folderNum, 10) || 1));
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    if (pageIndex > pageIds.length) return res.status(404).json({ error: 'Page index out of range' });
    const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 3);
    if (folderNum > folderCount) return res.status(404).json({ error: 'Folder index out of range' });
    const dirs = trendPageFolderDirs(uid, trendId, pageIndex, folderCount);
    const images = await listImages(dirs[folderNum - 1]);
    const chosen = images[0] || null;
    if (!chosen) return res.status(400).json({ error: 'No images in folder. Add photos to preview.' });
    const imgBuf = await fs.readFile(chosen.path);
    const textOptions = Array.isArray(req.body.textOptions) && req.body.textOptions.length ? req.body.textOptions : (trend.textOptions || []);
    const sampleText = (req.body.sampleText && String(req.body.sampleText).trim()) || (textOptions[0] && String(textOptions[0]).trim()) || null;
    const textStyle = req.body.textStyle && typeof req.body.textStyle === 'object' ? req.body.textStyle : (trend.textStyle || {});
    const normStyle = {
      x: textStyle.x != null && textStyle.x !== '' ? parseFloat(textStyle.x) : 0,
      y: textStyle.y != null && textStyle.y !== '' ? parseFloat(textStyle.y) : 0,
      fontSize: textStyle.fontSize != null ? parseFloat(textStyle.fontSize) : 60,
      font: textStyle.font || 'Arial, sans-serif',
      color: textStyle.color || 'white',
      strokeWidth: textStyle.strokeWidth != null ? parseFloat(textStyle.strokeWidth) : 2,
    };
    const uidSeg = String(uid).replace(/[/\\]/g, '_');
    const outDir = generatedDirForTrend(uid, trendId);
    await fs.mkdir(outDir, { recursive: true });
    const outName = `preview-${pageIndex}-${folderNum}-${Date.now()}.jpg`;
    const outPath = path.join(outDir, outName);
    await addTextOverlay(imgBuf, sampleText, outPath, normStyle);
    const baseUrl = getBaseUrlForGenerated(req);
    const url = `${baseUrl}/generated/${uidSeg}/trends/${trendId}/${outName}`;
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/trends/:trendId/run', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = parseInt(req.params.trendId, 10);
    const trend = getTrendById(trendId, uid);
    if (!trend) return res.status(404).json({ error: 'Trend not found' });
    if (trend.campaignId) {
      const campaign = getCampaignById(trend.campaignId, uid);
      if (campaign) {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (campaign.campaignStartDate && todayStr < campaign.campaignStartDate) {
          return res.status(400).json({ error: 'This trend is linked to a campaign that has not started yet. Posting is only allowed within the campaign date window.', campaignStartDate: campaign.campaignStartDate });
        }
        if (campaign.campaignEndDate && todayStr > campaign.campaignEndDate) {
          return res.status(400).json({ error: 'This trend is linked to a campaign that has ended. Posting is only allowed within the campaign date window.', campaignEndDate: campaign.campaignEndDate });
        }
      }
    }
    const textStyleOverride = req.body.textStyle && typeof req.body.textStyle === 'object' ? req.body.textStyle : null;
    const textOptionsOverride = Array.isArray(req.body.textOptions) && req.body.textOptions.length ? req.body.textOptions : null;
    const result = await runTrendPipeline(uid, trendId, textStyleOverride, textOptionsOverride);
    const sendAsDraft = req.body?.sendAsDraft === true || trend.sendAsDraft === true;
    const addMusicToCarousel = req.body?.addMusicToCarousel === true || trend.addMusicToCarousel === true;
    const pageIds = trend.pageIds && trend.pageIds.length ? trend.pageIds : [];
    const firstProjectId = pageIds[0];
    if (firstProjectId && result.webContentUrls?.length) {
      const trendSettings = await getUserSettings(uid);
      const project = getProjects(uid).find((p) => String(p.id) === String(firstProjectId));
      const accountId = project?.blotatoAccountId;
      const apiKey = trendSettings.blotatoApiKey;
      if (apiKey && accountId) {
        try {
          await sendToBlotato(apiKey, accountId, result.webContentUrls, { isDraft: sendAsDraft, addMusicToCarousel });
          result.blotatoSent = true;
          result.blotatoSentAsDraft = sendAsDraft;
        } catch (blotatoErr) {
          result.blotatoError = String(blotatoErr.message);
        }
      }
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/trends/:trendId/latest', async (req, res) => {
  try {
    const trendId = String(req.params.trendId);
    const filePath = path.join(RUNS_DIR, `trend-${trendId}.json`);
    const data = await fs.readFile(filePath, 'utf8').catch(() => '{}');
    res.json(JSON.parse(data));
  } catch {
    res.json({ webContentUrls: [] });
  }
});

api.delete('/trends/:trendId/latest', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const trendId = String(req.params.trendId);
    const runPath = path.join(RUNS_DIR, `trend-${trendId}.json`);
    await fs.unlink(runPath).catch(() => {});
    const genDir = generatedDirForTrend(uid, trendId);
    const files = await fs.readdir(genDir).catch(() => []);
    for (const f of files) await fs.unlink(path.join(genDir, f)).catch(() => {});
    res.json({ webContentUrls: [] });
  } catch {
    res.json({ webContentUrls: [] });
  }
});

// --- Auth config (public keys for client-side Supabase) ---
api.get('/auth/config', (req, res) => {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    return res.status(503).json({ error: 'Auth not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.' });
  }
  if (!anonKey.startsWith('eyJ')) {
    return res.status(503).json({
      error: 'Invalid SUPABASE_ANON_KEY: use the anon public JWT from Supabase Dashboard → Project Settings → API (starts with eyJ...). Do not use the publishable key.',
    });
  }
  res.json({ supabaseUrl: url, supabaseAnonKey: anonKey });
});

// --- Profile lookup by username (for adding team members) ---
// --- Profile endpoints ---
api.get('/profiles/me', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  try {
    const { data, error } = await supabaseAdmin.from('profiles').select('id, username, full_name').eq('id', req.user.id).maybeSingle();
    if (error) throw error;
    res.json({ id: req.user.id, email: req.user.email, username: data?.username || '', full_name: data?.full_name || '' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || 'Failed') });
  }
});

api.put('/profiles/me', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  const { username, full_name } = req.body || {};
  const updates = {};
  if (username !== undefined) updates.username = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (full_name !== undefined) updates.full_name = String(full_name).trim();
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
  updates.updated_at = new Date().toISOString();
  try {
    const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', req.user.id);
    if (error) throw error;
    const { data } = await supabaseAdmin.from('profiles').select('id, username, full_name').eq('id', req.user.id).maybeSingle();
    res.json({ id: req.user.id, email: req.user.email, username: data?.username || '', full_name: data?.full_name || '' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || 'Update failed') });
  }
});

api.get('/profiles/lookup', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const { data, error } = await supabaseAdmin.from('profiles').select('id, username, full_name').ilike('username', username).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message || 'Lookup failed') });
  }
});

// --- Team members (account-level) ---
api.get('/team', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  try {
    const { data: rows, error } = await supabaseAdmin.from('team_members').select('member_id').eq('owner_id', req.user.id);
    if (error) throw error;
    const memberIds = [...new Set((rows || []).map((r) => r.member_id))];
    if (!memberIds.length) return res.json([]);
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id, username').in('id', memberIds);
    const byId = (profiles || []).reduce((acc, p) => { acc[p.id] = p.username; return acc; }, {});
    const list = memberIds.map((id) => ({ id, username: byId[id] || null })).filter((r) => r.username);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String(e.message || 'Failed to load team') });
  }
});

api.post('/team', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  const username = (req.body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('id').ilike('username', username).maybeSingle();
    if (!profile) return res.status(404).json({ error: 'User not found' });
    if (profile.id === req.user.id) return res.status(400).json({ error: 'You cannot add yourself' });
    const { error } = await supabaseAdmin.from('team_members').insert({ owner_id: req.user.id, member_id: profile.id });
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Already on your team' });
      throw error;
    }
    res.status(201).json({ id: profile.id, username });
  } catch (e) {
    res.status(500).json({ error: String(e.message || 'Failed to add team member') });
  }
});

api.delete('/team/:userId', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  const memberId = req.params.userId;
  try {
    const { error } = await supabaseAdmin.from('team_members').delete().eq('owner_id', req.user.id).eq('member_id', memberId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || 'Failed to remove') });
  }
});

// --- Campaign members (campaign-level sharing) ---
api.get('/campaigns/:campaignId/members', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const cid = parseInt(req.params.campaignId, 10);
    const { data: rows, error } = await supabaseAdmin.from('campaign_members').select('member_id, role, created_at').eq('campaign_id', cid).eq('owner_id', uid);
    if (error) throw error;
    if (!rows || !rows.length) return res.json([]);
    const memberIds = rows.map((r) => r.member_id);
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id, username, full_name').in('id', memberIds);
    const byId = (profiles || []).reduce((m, p) => { m[p.id] = p; return m; }, {});
    res.json(rows.map((r) => ({ id: r.member_id, username: byId[r.member_id]?.username || null, full_name: byId[r.member_id]?.full_name || '', role: r.role, added_at: r.created_at })));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.post('/campaigns/:campaignId/members', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  const uid = requireUserId(req, res);
  if (!uid) return;
  const username = (req.body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const cid = parseInt(req.params.campaignId, 10);
    // Verify requester owns this campaign
    const campaign = getCampaignById(cid, uid);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found or you do not own it' });
    const { data: profile } = await supabaseAdmin.from('profiles').select('id, username, full_name').ilike('username', username).maybeSingle();
    if (!profile) return res.status(404).json({ error: 'User not found' });
    if (profile.id === uid) return res.status(400).json({ error: 'Cannot add yourself' });
    const { error } = await supabaseAdmin.from('campaign_members').insert({ owner_id: uid, campaign_id: cid, member_id: profile.id });
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Already a member' });
      throw error;
    }
    res.status(201).json({ id: profile.id, username: profile.username, full_name: profile.full_name || '', role: 'editor' });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.delete('/campaigns/:campaignId/members/:memberId', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const cid = parseInt(req.params.campaignId, 10);
    const { error } = await supabaseAdmin.from('campaign_members').delete().eq('campaign_id', cid).eq('owner_id', uid).eq('member_id', req.params.memberId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// --- Per-user settings (replaces global config for blotato key) ---
api.get('/settings', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const settings = await getUserSettings(uid);
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.put('/settings', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const { blotatoApiKey, timezone } = req.body || {};
    const current = await getUserSettings(uid);
    const updated = { blotatoApiKey: blotatoApiKey !== undefined ? String(blotatoApiKey) : current.blotatoApiKey, timezone: timezone !== undefined ? String(timezone) : current.timezone };
    await saveUserSettings(uid, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// --- Config (kept for backwards compat — baseUrl only) ---
api.get('/config', (req, res) => res.json({ ...getConfig(), timezone: process.env.TZ || 'America/New_York' }));
api.put('/config', (req, res) => {
  const body = { ...req.body };
  if (body.baseUrl !== undefined) body.baseUrl = normalizeBaseUrl(body.baseUrl) || body.baseUrl;
  setConfig(body);
  res.json(getConfig());
});

// --- Logins (page credentials: email, username, password, platform) ---
api.get('/logins', (req, res) => {
  const uid = req.user?.id || null;
  try {
    res.json(getLoginsForUser(uid));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
api.post('/logins', (req, res) => {
  const uid = req.user?.id || null;
  try {
    const data = getLoginsDataForUser(uid);
    const nextId = (data.nextId || 1);
    const { email = '', username = '', password = '', platform = 'TikTok' } = req.body || {};
    const validPlatforms = ['TikTok', 'Instagram', 'YouTube'];
    const item = {
      id: nextId,
      email: String(email).trim(),
      username: String(username).trim(),
      password: String(password),
      platform: validPlatforms.includes(platform) ? platform : 'TikTok',
    };
    const items = [...(data.items || []), item];
    saveLoginsForUser(uid, items, nextId + 1);
    res.status(201).json(item);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
api.put('/logins/:id', (req, res) => {
  const uid = req.user?.id || null;
  try {
    const id = parseInt(req.params.id, 10);
    const data = getLoginsDataForUser(uid);
    const items = (data.items || []).slice();
    const idx = items.findIndex((l) => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Login not found' });
    const { email, username, password, platform } = req.body || {};
    const validPlatforms = ['TikTok', 'Instagram', 'YouTube'];
    if (email !== undefined) items[idx].email = String(email).trim();
    if (username !== undefined) items[idx].username = String(username).trim();
    if (password !== undefined) items[idx].password = String(password);
    if (platform !== undefined) items[idx].platform = validPlatforms.includes(platform) ? platform : items[idx].platform;
    saveLoginsForUser(uid, items);
    res.json(items[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
api.delete('/logins/:id', (req, res) => {
  const uid = req.user?.id || null;
  try {
    const id = parseInt(req.params.id, 10);
    const data = getLoginsDataForUser(uid);
    const items = (data.items || []).filter((l) => l.id !== id);
    if (items.length === (data.items || []).length) return res.status(404).json({ error: 'Login not found' });
    saveLoginsForUser(uid, items);
    const avatarPath = path.join(LOGIN_AVATARS_DIR, `${id}.jpg`);
    if (fsSync.existsSync(avatarPath)) fsSync.unlinkSync(avatarPath);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/logins/:id/avatar', (req, res) => {
  const id = String(req.params.id);
  const filePath = path.join(LOGIN_AVATARS_DIR, `${id}.jpg`);
  if (fsSync.existsSync(filePath)) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(path.resolve(filePath));
  }
  res.status(404).end();
});

api.post('/logins/:id/avatar', (req, res, next) => {
  loginAvatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received. Use the "avatar" field.' });
    try {
      const id = String(req.params.id);
      const login = (getLoginsForUser(req.user?.id || null) || []).find((l) => String(l.id) === id);
      if (!login) return res.status(404).json({ error: 'Login not found' });
      const srcPath = req.file.path;
      const destPath = path.join(LOGIN_AVATARS_DIR, `${id}.jpg`);
      const size = 120;
      await sharp(srcPath)
        .rotate()
        .resize(size, size, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 88 })
        .toFile(destPath);
      if (srcPath !== destPath) await fs.unlink(srcPath).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });
});

/** Parse Range header (e.g. "bytes=0-1023") and return [start, end] or null. */
function parseRange(rangeHeader, totalLength) {
  if (!rangeHeader || totalLength === 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] === '' ? 0 : parseInt(m[1], 10);
  let end = m[2] === '' ? totalLength - 1 : parseInt(m[2], 10);
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= totalLength) end = totalLength - 1;
  if (start > end || start < 0) return null;
  return [start, end];
}

// --- Serve generated images: /generated/:userId/:projectId/:campaignId/:filename (per-profile) ---
async function serveGeneratedImage(req, res) {
  const { userId, projectId, campaignId, filename } = req.params;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  if (storage.useSupabase()) {
    try {
      const buffer = await storage.readGeneratedBuffer(projectId, campaignId, filename, userId || undefined);
      const contentType = filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
      const totalLength = buffer.length;
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Type', contentType);
      res.set('Accept-Ranges', 'bytes');
      const range = parseRange(req.headers.range, totalLength);
      if (range) {
        const [start, end] = range;
        const chunk = buffer.slice(start, end + 1);
        res.status(206);
        res.set('Content-Range', `bytes ${start}-${end}/${totalLength}`);
        res.set('Content-Length', chunk.length);
        res.send(chunk);
      } else {
        res.set('Content-Length', totalLength);
        res.send(buffer);
      }
    } catch (e) {
      res.status(404).end();
    }
    return;
  }
  const uidSeg = userId ? String(userId).replace(/[/\\]/g, '_') : '';
  const filePath = uidSeg
    ? path.resolve(GENERATED, uidSeg, projectId, campaignId, filename)
    : path.resolve(GENERATED, projectId, campaignId, filename);
  const generatedResolved = path.resolve(GENERATED);
  if (!filePath.startsWith(generatedResolved)) return res.status(403).end();
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Accept-Ranges', 'bytes');
  res.sendFile(filePath, (err) => {
    if (err) res.status(err.statusCode || 500).end();
  });
}
api.get('/generated/:userId/:projectId/:campaignId/:filename', serveGeneratedImage);
app.get('/generated/:userId/:projectId/:campaignId/:filename', serveGeneratedImage);
// Trend generated images: /generated/:userId/trends/:trendId/:filename
app.get('/generated/:userId/trends/:trendId/:filename', (req, res) => {
  const { userId, trendId, filename } = req.params;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  const uid = (userId || '').replace(/\.\./g, '');
  const filePath = path.join(GENERATED, uid, 'trends', trendId, filename);
  const generatedResolved = path.resolve(GENERATED);
  if (!path.resolve(filePath).startsWith(generatedResolved)) return res.status(403).end();
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.resolve(filePath), (err) => { if (err) res.status(err.statusCode || 500).end(); });
});
// Legacy: no userId (try old path for backward compat)
app.get('/generated/:projectId/:campaignId/:filename', (req, res) => {
  req.params.userId = '';
  serveGeneratedImage(req, res);
});

// --- Scheduler: run deployed campaigns at their scheduled times ---
const TZ = process.env.TZ || 'America/New_York';
function getScheduleTimezoneLabel() {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : TZ;
  } catch (_) {
    return TZ;
  }
}

/** Given (dateStr, time) in a timezone, return the UTC instant as ISO string. */
function getScheduleUtcIso(dateStr, time, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const targetDate = String(y) + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const targetTime = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  for (let utcHour = -12; utcHour <= 36; utcHour++) {
    const cand = new Date(Date.UTC(y, mo - 1, d, utcHour, min, 0, 0));
    const parts = formatter.formatToParts(cand);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    const fd = get('day').padStart(2, '0');
    const fmo = get('month').padStart(2, '0');
    const fy = get('year');
    const fh = get('hour').padStart(2, '0');
    const fmin = get('minute').padStart(2, '0');
    const formattedDate = fy + '-' + fmo + '-' + fd;
    const formattedTime = fh + ':' + fmin;
    if (formattedDate === targetDate && formattedTime === targetTime) return cand.toISOString();
  }
  return new Date(Date.UTC(y, mo - 1, d, h, min, 0, 0)).toISOString();
}

function getCurrentTimeString() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour').value;
  const minute = parts.find((p) => p.type === 'minute').value;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function getTodayDateStringInTZ() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

let lastRunMinute = null;
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const currentTime = getCurrentTimeString();
  const todayStr = getTodayDateStringInTZ();
  const key = `${todayStr}-${currentTime}`;
  if (lastRunMinute === key) return;
  lastRunMinute = key;
  const dowFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dowFormatter.format(now));
  const userIds = listUserIdsWithData();
  const runs = [];
  for (const uid of userIds) {
    const campaigns = getAllCampaigns(uid);
    for (const c of campaigns) {
      if (c.paused) continue;
      const pageIds = (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
      for (const projectId of pageIds) {
        const postTypes = getPostTypesForPage(c, projectId);
        for (const pt of postTypes) {
          if (!isPostTypeDeployed(c, projectId, pt.id)) continue;
          const times = pt.scheduleTimes || c.scheduleTimes || [];
          if (!pt.scheduleEnabled || !times.length || !times.map((t) => String(t)).includes(currentTime)) continue;
          if (c.campaignStartDate && todayStr < c.campaignStartDate) continue;
          if (c.campaignEndDate && todayStr > c.campaignEndDate) continue;
          if (pt.scheduleStartDate && todayStr < pt.scheduleStartDate) continue;
          if (pt.scheduleEndDate && todayStr > pt.scheduleEndDate) continue;
          const days = pt.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
          if (days.length === 0 || !days.includes(dayOfWeek)) continue;
          runs.push({ userId: uid, campaign: c, projectId, postTypeId: pt.id });
        }
      }
    }
  }
  if (!runs.length) {
    return;
  }
  const scheduledAtIso = getScheduleUtcIso(todayStr, currentTime, TZ);
  const existingOutcomes = runOutcomesByKey(await readRunOutcomes());
  console.log(`[scheduler] ${currentTime} (${todayStr}): ${runs.length} run(s) to execute`);
  for (const { userId: uid, campaign: c, projectId, postTypeId } of runs) {
    const runKey = `${projectId}|${c.id}|${postTypeId}|${scheduledAtIso}`;
    if (existingOutcomes[runKey] && existingOutcomes[runKey].status === 'success') {
      console.log(`[scheduler] Already sent, skipping: ${c.name} page ${projectId} pt ${postTypeId} @ ${scheduledAtIso}`);
      continue;
    }
    const pt = getPostType(c, postTypeId, projectId);
    const projects = getProjects(uid);
    const project = projects.find((p) => p.id === parseInt(String(projectId), 10));
    const accountId = project?.blotatoAccountId;
    const ownerSettings = await getUserSettings(uid);
    const apiKey = ownerSettings.blotatoApiKey;

    if (process.env.ENCODING_MODE === 'worker' && pt && (pt.mediaType === 'video' || pt.mediaType === 'video_text')) {
      try {
        const payload = await buildEncodingJobPayload(uid, projectId, c.id, postTypeId, {
          sendToBlotato: !!(apiKey && accountId),
          draft: !!c.sendAsDraft,
          scheduledAt: scheduledAtIso,
          textStyleOverride: null,
          textOptionsOverride: null,
        });
        if (payload) {
          await enqueueEncodingJob(payload);
          console.log(`[scheduler] ${c.name} (page ${projectId}/${c.id} pt ${postTypeId}): job queued for worker`);
          continue;
        }
      } catch (e) {
        console.error(`[scheduler] ${c.name} page ${projectId} enqueue:`, e.message);
        await appendRunOutcome(projectId, c.id, postTypeId, scheduledAtIso, 'failure', e.message).catch(() => {});
        continue;
      }
    }

    try {
      const result = await runCampaignPipeline(uid, projectId, c.id, null, null, postTypeId);
      console.log(`[scheduler] ${c.name} (page ${projectId}/${c.id} pt ${postTypeId}): ${result.webContentUrls.length} URLs`);
      const addMusicToCarousel = pt && pt.mediaType === 'photo' && !!c.addMusicToCarousel;
      const isPhotoPostTypeCron = pt && pt.mediaType === 'photo';
      if (apiKey && accountId && result.webContentUrls?.length) {
        try {
          await sendToBlotato(apiKey, accountId, result.webContentUrls, { isDraft: c.sendAsDraft, addMusicToCarousel, title: isPhotoPostTypeCron ? (pt?.title || undefined) : undefined });
          console.log(`[scheduler] Blotato post sent for ${c.name} page ${projectId}`);
          await appendRunOutcome(projectId, c.id, postTypeId, scheduledAtIso, 'success');
        } catch (blotatoErr) {
          console.error(`[scheduler] Blotato failed ${c.name} page ${projectId}:`, blotatoErr.message);
          await appendRunOutcome(projectId, c.id, postTypeId, scheduledAtIso, 'failure', blotatoErr.message);
        }
      } else {
        if (!apiKey) console.warn(`[scheduler] Not sending to Blotato: no API key in Settings for ${c.name} page ${projectId}`);
        else if (!accountId) console.warn(`[scheduler] Not sending to Blotato: page ${projectId} has no Blotato account linked for ${c.name}`);
        else if (!result.webContentUrls?.length) console.warn(`[scheduler] No content URLs for ${c.name} page ${projectId}`);
      }
    } catch (e) {
      console.error(`[scheduler] ${c.name} page ${projectId}:`, e.message);
      await appendRunOutcome(projectId, c.id, postTypeId, scheduledAtIso, 'failure', e.message).catch(() => {});
    }
  }
});

// --- Mount API router ---
app.use('/api', api);

// --- Static (after API so /api never serves HTML) ---
app.use(express.static(path.join(ROOT, 'public')));

// --- Start ---
ensureDataDir();
try {
  fsSync.mkdirSync(GENERATED, { recursive: true });
  fsSync.mkdirSync(UPLOADS, { recursive: true });
} catch (e) {
  console.warn('Could not create generated/uploads dirs:', e.message);
}
(async () => {
  if (storage.useSupabase()) {
    try {
      await storage.initStorage();
      console.log('[storage] Using Supabase Storage');
    } catch (e) {
      console.warn('[storage] Supabase init failed:', e.message);
    }
    // Clear local generated dir on startup — all generated files go to Supabase now
    try {
      await fs.rm(GENERATED, { recursive: true, force: true });
      await fs.mkdir(GENERATED, { recursive: true });
      console.log('[storage] Cleared local generated cache (using Supabase)');
    } catch (e) {
      console.warn('[storage] Could not clear generated dir:', e.message);
    }
  }
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Carousel Automation running at http://0.0.0.0:${PORT}`);
    console.log(`Generated dir: ${GENERATED}`);
    if (storage.useSupabase()) console.log('Storage: Supabase');
    console.log('Projects → Campaigns → Deploy; scheduler runs deployed campaigns at their set times.');
  });
  // Allow long-running uploads (Railway proxy allows up to 15 min)
  server.timeout = 10 * 60 * 1000;
  server.keepAliveTimeout = 10 * 60 * 1000;
  server.headersTimeout = 10 * 60 * 1000;
})();
