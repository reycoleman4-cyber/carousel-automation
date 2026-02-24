const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '.env') });
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
const LOGINS_PATH = path.join(DATA, 'logins.json');
const RUNS_DIR = path.join(DATA, 'runs');
const TEXT_USAGE_DIR = path.join(DATA, 'text-usage');
const AVATARS_DIR = path.join(DATA, 'avatars');
const CAMPAIGN_AVATARS_DIR = path.join(DATA, 'campaign-avatars');
const LOGIN_AVATARS_DIR = path.join(DATA, 'login-avatars');
const TRENDS_DIR = path.join(DATA, 'trends');

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
  if (!fsSync.existsSync(AVATARS_DIR)) fsSync.mkdirSync(AVATARS_DIR, { recursive: true });
  if (!fsSync.existsSync(CAMPAIGN_AVATARS_DIR)) fsSync.mkdirSync(CAMPAIGN_AVATARS_DIR, { recursive: true });
  if (!fsSync.existsSync(LOGIN_AVATARS_DIR)) fsSync.mkdirSync(LOGIN_AVATARS_DIR, { recursive: true });
  if (!fsSync.existsSync(PROJECTS_DIR)) fsSync.mkdirSync(PROJECTS_DIR, { recursive: true });
  if (!fsSync.existsSync(CAMPAIGNS_DIR)) fsSync.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
  if (!fsSync.existsSync(TRENDS_DIR)) fsSync.mkdirSync(TRENDS_DIR, { recursive: true });
}

/** Returns req.user.id or sends 401 and null. Use for routes that must be per-user. */
function requireUserId(req, res) {
  if (!req.user || !req.user.id) {
    res.status(401).json({ error: 'Sign in required' });
    return null;
  }
  return req.user.id;
}

function getProjectsPath(userId) {
  if (!userId) return null;
  return path.join(PROJECTS_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
}

function getCampaignsPath(userId) {
  if (!userId) return null;
  return path.join(CAMPAIGNS_DIR, `${String(userId).replace(/[/\\]/g, '_')}.json`);
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
  return readJson(CONFIG_PATH, { baseUrl: `http://localhost:${PORT}` });
}

function normalizeBaseUrl(baseUrl) {
  const s = (baseUrl || '').trim().replace(/\/$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
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
  return all.find((c) => c.id === id);
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

function usedDir(userId, projectId) {
  const uid = userId ? String(userId).replace(/[/\\]/g, '_') : '';
  return uid
    ? path.join(UPLOADS, uid, String(projectId), 'used')
    : path.join(UPLOADS, String(projectId), 'used');
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

async function moveToUsedFolder(userId, projectId, campaignId, sourcePath, folderNum) {
  const used = usedDir(userId, projectId);
  await fs.mkdir(used, { recursive: true });
  const basename = path.basename(sourcePath);
  const ext = path.extname(basename) || '.jpg';
  const nameWithoutExt = path.basename(basename, ext);
  const newName = `${Date.now()}-c${campaignId}-f${folderNum}-${nameWithoutExt}${ext}`;
  const destPath = path.join(used, newName);
  await fs.rename(sourcePath, destPath);
  return newName;
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
      if (stat && stat.isFile() && /\.(mp4|mov|webm|avi|mkv)$/i.test(name)) files.push({ path: full, filename: name });
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
 * Returns the chosen text (or 'Sample text' if list is empty).
 */
async function pickLeastUsedTextOptionAndIncrement(projectId, campaignId, postTypeId, folderIndex, options) {
  const opts = Array.isArray(options) ? options.filter((t) => t != null && String(t).trim()) : [];
  if (opts.length === 0) return 'Sample text';
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
  return String(opts[chosenIndex]).trim() || 'Sample text';
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
  const str = String(text).trim() || 'Sample text';
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
  const raw = (typeof text === 'string' && text.trim()) ? text.trim() : 'Sample text';
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
  let xPct = (s.x != null && s.x !== '' ? parseFloat(s.x) : 50);
  let yPct = (s.y != null && s.y !== '' ? parseFloat(s.y) : 92);
  if (isNaN(xPct)) xPct = 50;
  if (isNaN(yPct)) yPct = 92;
  if (xPct === 0 && yPct === 0) {
    xPct = 50;
    yPct = 50;
  }
  const xPx = Math.round((xPct / 100) * OUT_W);
  const yPx = Math.round((yPct / 100) * OUT_H);
  const marginX = Math.round(OUT_W * 0.08);
  const marginY = Math.round(OUT_H * 0.06);
  const safeWidth = OUT_W - 2 * marginX;
  const lineHeightPx = Math.round(fontSize * 1.25);
  const maxCharsPerLine = Math.max(8, Math.floor(safeWidth / (fontSize * 0.6)));
  const maxLines = Math.max(1, Math.floor((OUT_H - 2 * marginY) / lineHeightPx));
  let lines = wrapTextToLines(raw, maxCharsPerLine);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);
  const blockHeightPx = lines.length * lineHeightPx;
  const startY = yPx - Math.round(blockHeightPx / 2) + Math.round(lineHeightPx / 2);
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
    const y = startY + i * lineHeightPx;
    return `<tspan x="${xPx}" y="${y}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</tspan>`;
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
  const config = getConfig();
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const priorityVideos = await listVideos(folders[0]);
  const fallbackVideos = await listVideos(folders[1]);
  const chosen = priorityVideos.length ? pickRandom(priorityVideos) : (fallbackVideos.length ? pickRandom(fallbackVideos) : null);
  if (!chosen) throw new Error('No videos in Priority or Fallback folders');
  const filename = chosen.filename || path.basename(chosen.path || chosen);
  const folderNum = priorityVideos.length ? 1 : 2;
  const videoUrl = storage.useSupabase()
    ? storage.getFileUrl(projectIdStr, campaignIdStr, pt.id, folderNum, filename, userId)
    : `${baseUrl}/api/projects/${projectIdStr}/campaigns/${campaignIdStr}/folders/${folderNum}/media/${encodeURIComponent(filename)}?postTypeId=${encodeURIComponent(pt.id)}`;
  if (!videoUrl) throw new Error('Could not get video URL');
  const runData = {
    campaignId: campaignIdStr,
    runId: Date.now(),
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

/** Overlay text on video using ffmpeg; writes to outputPath (mp4). Used for both preview and final run output—
 *  so stroke, 1080x1920 crop, and text positioning apply to the final link. Uses textfile= to avoid quoting issues.
 *  options.preview: if true, limit output to a short clip and use fewer threads to avoid OOM (SIGKILL) on constrained hosts. */
async function addVideoTextOverlay(inputPath, text, textStyle, outputPath, options = {}) {
  const isPreview = options.preview === true;
  const raw = (typeof text === 'string' && text.trim()) ? text.trim() : 'Sample text';
  const s = textStyle || {};
  const fontSize = videoFontSizePx(s);
  const W = 1080;
  const H = 1920;
  const marginX = Math.round(W * 0.08);
  const marginY = Math.round(H * 0.06);
  const safeWidth = W - 2 * marginX;
  const approxCharWidth = fontSize * 0.6;
  const maxCharsPerLine = Math.max(8, Math.floor(safeWidth / approxCharWidth));
  const lineHeightPx = Math.round(fontSize * 1.25);
  const maxLines = Math.max(1, Math.floor((H - 2 * marginY) / lineHeightPx));
  const paragraphs = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
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
  if (lines.length === 0) lines = ['Sample text'];
  lines = lines.slice(0, maxLines);

  const fontcolor = fontColorToHex(s.color);
  const strokeWidth = Math.max(0, Math.min(20, Math.round(parseFloat(s.strokeWidth ?? s.stroke) || 0)));
  const strokeColor = fontColorToHex(s.strokeColor || s.strokeColor || 'black');
  const baseOpts = `fontsize=${fontSize}:fontcolor=${fontcolor}${strokeWidth > 0 ? `:borderw=${strokeWidth}:bordercolor=${strokeColor}` : ''}`;
  // 0 means "center"; otherwise use percentage (50 = center)
  const rawX = (s.x != null && s.x !== '' && !Number.isNaN(parseFloat(s.x))) ? parseFloat(s.x) : 50;
  const rawY = (s.y != null && s.y !== '' && !Number.isNaN(parseFloat(s.y))) ? parseFloat(s.y) : 50;
  const xPct = rawX === 0 ? 50 : rawX;
  const yPct = rawY === 0 ? 50 : rawY;
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
      const xExpr = `(w*${xPct}/100)-text_w/2`;
      const yOffsetPx = startYOffset + i * lineHeightPx;
      const yExpr = `(h*${yPct}/100)+${yOffsetPx}-text_h/2`;
      return `drawtext=textfile='${escapeDrawtextPath(textfilePath)}':${baseOpts}:x='${xExpr}':y='${yExpr}'`;
    });
    const cropW = W;
    const cropH = H;
    const cropFilter = `scale=${cropW}:${cropH}:force_original_aspect_ratio=increase,crop=${cropW}:${cropH}:(iw-${cropW})/2:(ih-${cropH})/2`;
    const vf = [cropFilter, ...drawtextFilters].join(',');
    const outputOpts = [`-vf`, vf, '-c:a', 'copy', '-threads', isPreview ? '1' : '2'];
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
  const chosen = pickRandom(videos);
  if (!chosen) throw new Error('No videos in folder. Upload videos first.');
  const filename = chosen.filename || path.basename(chosen.path || chosen);
  const fromOverride = Array.isArray(textOptionsOverride) && textOptionsOverride.length && Array.isArray(textOptionsOverride[0]) && textOptionsOverride[0].length
    ? textOptionsOverride[0]
    : null;
  const textOptions = fromOverride ||
    (Array.isArray(pt.textOptionsPerFolder) && pt.textOptionsPerFolder[0]?.length ? pt.textOptionsPerFolder[0] : null) ||
    (Array.isArray(campaign.textOptionsPerFolder) && campaign.textOptionsPerFolder[0]?.length ? campaign.textOptionsPerFolder[0] : null) ||
    DEFAULT_TEXT_OPTIONS;
  const text = await pickLeastUsedTextOptionAndIncrement(projectIdStr, campaignIdStr, postTypeId || 'default', 0, textOptions);
  const textStyle = textStyleOverride && textStyleOverride[0]
    ? textStyleOverride[0]
    : (pt.textStylePerFolder && pt.textStylePerFolder[0]) || {};
  let inputPath;
  try {
    inputPath = await getVideoPathForFfmpeg(userId, projectIdStr, campaignIdStr, pt.id, 1, filename);
    const outDir = generatedDir(userId, projectIdStr, campaignIdStr);
    const runId = Date.now();
    const outName = `video-${runId}.mp4`;
    const outPath = path.join(outDir, outName);
    await addVideoTextOverlay(inputPath, text, textStyle, outPath, { preview: opts.preview === true });
    const config = getConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    let url;
    if (storage.useSupabase()) {
      const outBuf = await fs.readFile(outPath);
      await storage.uploadGenerated(projectIdStr, campaignIdStr, outName, outBuf, 'video/mp4', userId);
      url = storage.getGeneratedUrl(projectIdStr, campaignIdStr, outName, userId);
      await fs.unlink(outPath).catch(() => {});
    } else {
      const uidSeg = String(userId).replace(/[/\\]/g, '_');
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
  const config = getConfig();
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const webContentUrls = [];
  const webContentBase64 = [];
  const usedSourcePaths = [];
  const runId = Date.now();

  const useFirstImage = !!textStyleOverride;
  for (let i = 0; i < folderCount; i++) {
    const images = await listImages(folders[i]);
    const chosen = useFirstImage && images.length ? images[0] : pickRandom(images);
    if (!chosen) continue;
    usedSourcePaths.push({ item: chosen, folderNum: i + 1, postTypeId: pt.id });
    const opts = textOptionsPerFolder[i];
    const text = useFirstImage && Array.isArray(opts) && opts.length
      ? opts[0]
      : (pickRandom(Array.isArray(opts) && opts.length ? opts : DEFAULT_TEXT_OPTIONS) || 'Follow for more');
    const folderStyle = (textStylePerFolder[i]) || campaign.textStyle || {};
    const outName = useFirstImage ? `preview-${i + 1}.jpg` : `carousel-${runId}-${i + 1}.jpg`;
    const outPath = path.join(outDir, outName);
    const imgBuf = await getImageBuffer(chosen, i, folders, projectIdStr, campaignIdStr, pt.id, userId);
    const buf = await addTextOverlay(imgBuf, text, outPath, folderStyle);
    if (storage.useSupabase()) {
      const url = await storage.uploadGenerated(projectIdStr, campaignIdStr, outName, buf, undefined, userId);
      webContentUrls.push(url);
    } else {
      const uidSeg = String(userId).replace(/[/\\]/g, '_');
      webContentUrls.push(`${baseUrl}/generated/${uidSeg}/${projectIdStr}/${campaignIdStr}/${outName}`);
    }
    webContentBase64.push(buf.toString('base64'));
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
    : (Array.isArray(trend.textOptions) && trend.textOptions.length ? trend.textOptions : [...DEFAULT_TEXT_OPTIONS]);
  const textStyle = (textStyleOverride && typeof textStyleOverride === 'object') ? textStyleOverride : (trend.textStyle || {});
  const folderCount = Math.max(1, parseInt(trend.folderCount, 10) || 1);
  const outDir = generatedDirForTrend(userId, trendId);
  await fs.mkdir(outDir, { recursive: true });
  const config = getConfig();
  const baseUrl = normalizeBaseUrl(config.baseUrl);
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
      const text = pickRandom(textOptions) || 'Follow for more';
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
        const projectId = req.params.projectId || req.query.projectId;
        const campaignId = req.params.campaignId || req.query.campaignId;
        const folderNum = Math.max(1, Math.min(999, parseInt(req.query.folder || '1', 10)));
        const postTypeId = req.query.postTypeId || 'default';
        const uid = req.user?.id ? String(req.user.id).replace(/[/\\]/g, '_') : '';
        const base = uid ? path.join(UPLOADS, uid, String(projectId), String(campaignId)) : path.join(UPLOADS, String(projectId), String(campaignId));
        const ptBase = postTypeId && postTypeId !== 'default' ? path.join(base, `pt_${postTypeId}`) : base;
        const dir = path.join(ptBase, `folder${folderNum}`);
        fsSync.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    });
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mediaType = req.query.mediaType;
    if (mediaType === 'video' || mediaType === 'video_text') {
      const ok = /^video\/(mp4|quicktime|webm|x-msvideo|x-matroska)$/i.test(file.mimetype) || /\.(mp4|mov|webm|avi|mkv)$/i.test(file.originalname);
      cb(null, !!ok);
    } else {
      const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
      cb(null, !!ok);
    }
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
    if (fsSync.existsSync(filePath)) return res.sendFile(path.resolve(filePath));
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

// --- API: Campaigns ---
api.get('/projects/:projectId/campaigns', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = parseInt(req.params.projectId, 10);
  const list = getCampaigns(projectId, uid);
  res.json(list);
});

api.post('/projects/:projectId/campaigns', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = parseInt(req.params.projectId, 10);
  const projects = getProjects(uid);
  if (!projects.find((p) => p.id === projectId)) return res.status(404).json({ error: 'Project not found' });
  const meta = getCampaignsMeta(uid);
  const name = (req.body.name || 'New campaign').trim() || 'New campaign';
  const campaign = {
    id: meta.nextId,
    projectId,
    name,
    pagePostTypes: {},
    deployedByPage: {},
    createdAt: new Date().toISOString(),
  };
  saveCampaign(campaign, uid);
  res.status(201).json(campaign);
});

function getPostTypesForPage(campaign, projectId) {
  const pid = parseInt(projectId, 10);
  if (campaign.pagePostTypes && typeof campaign.pagePostTypes === 'object' && Array.isArray(campaign.pagePostTypes[pid])) {
    return campaign.pagePostTypes[pid];
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
  const pt = pts.find((p) => p.id === postTypeId);
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

api.get('/projects/:projectId/campaigns/:campaignId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = req.params.projectId;
  const postTypeId = req.query.postTypeId || 'default';
  const campaign = getCampaignById(campaignId, uid);
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

api.put('/projects/:projectId/campaigns/:campaignId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const postTypeId = req.body.postTypeId || 'default';
  const campaign = getCampaignById(campaignId, uid);
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
  const updatedPt = {
    ...pt,
    folderCount,
    textOptionsPerFolder,
    textStylePerFolder: textStylePerFolder || undefined,
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
  };
  saveCampaign(updated, uid);
  res.json(ensurePostTypes(updated, projectId));
});

api.post('/projects/:projectId/campaigns/:campaignId/postTypes', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const campaign = getCampaignById(campaignId, uid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  const name = (req.body.name || 'New post type').trim() || 'New post type';
  const mediaType = req.body.mediaType === 'video_text' ? 'video_text' : (req.body.mediaType === 'video' ? 'video' : 'photo');
  const id = nextPostTypeIdForPage(campaign, projectId);
  const folderCount = mediaType === 'video' ? 2 : (mediaType === 'video_text' ? 1 : 3);
  const textOptionsPerFolder = mediaType === 'video'
    ? [[...DEFAULT_TEXT_OPTIONS], [...DEFAULT_TEXT_OPTIONS]]
    : mediaType === 'video_text'
      ? [[...DEFAULT_TEXT_OPTIONS]]
      : [[...DEFAULT_TEXT_OPTIONS], [...DEFAULT_TEXT_OPTIONS], [...DEFAULT_TEXT_OPTIONS]];
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
  saveCampaign(updated, uid);
  ensureDirs(uid, String(projectId), String(campaignId), folderCount, id);
  const result = ensurePostTypes(updated, projectId);
  res.status(201).json(result);
});

api.put('/projects/:projectId/campaigns/:campaignId/postTypes/:postTypeId', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const postTypeId = req.params.postTypeId;
  const campaign = getCampaignById(campaignId, uid);
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
  let updatedPt = { ...pt, name, mediaType };
  if (mediaType === 'video') {
    updatedPt = {
      ...updatedPt,
      folderCount: 2,
      textOptionsPerFolder: [[...DEFAULT_TEXT_OPTIONS], [...DEFAULT_TEXT_OPTIONS]],
      textStylePerFolder: [],
    };
    ensureDirs(uid, String(projectId), String(campaignId), 2, pt.id);
  }
  if (mediaType === 'video_text') {
    updatedPt = {
      ...updatedPt,
      folderCount: 1,
      textOptionsPerFolder: Array.isArray(pt.textOptionsPerFolder) && pt.textOptionsPerFolder.length ? [pt.textOptionsPerFolder[0]] : [[...DEFAULT_TEXT_OPTIONS]],
      textStylePerFolder: Array.isArray(pt.textStylePerFolder) && pt.textStylePerFolder.length ? [pt.textStylePerFolder[0]] : [{}],
    };
    ensureDirs(uid, String(projectId), String(campaignId), 1, pt.id);
  }
  if (ptIdx >= 0) pagePts[ptIdx] = updatedPt;
  else pagePts.push(updatedPt);
  pagePostTypes[projectId] = pagePts;
  const updated = { ...campaign, pagePostTypes };
  saveCampaign(updated, uid);
  res.json(ensurePostTypes(updated, projectId));
});

api.delete('/projects/:projectId/campaigns/:campaignId/postTypes/:postTypeId', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaignId = parseInt(req.params.campaignId, 10);
  const projectId = parseInt(req.params.projectId, 10);
  const postTypeId = req.params.postTypeId;
  const campaign = getCampaignById(campaignId, uid);
  if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
  try {
    await storage.deleteAllUploadsForPostType(String(projectId), String(campaignId), postTypeId, uid);
  } catch (e) {
    console.warn('[delete post type] storage cleanup:', e.message);
  }
  const pagePostTypes = { ...(campaign.pagePostTypes || {}) };
  const pagePts = (pagePostTypes[projectId] || []).filter((p) => p.id !== postTypeId);
  pagePostTypes[projectId] = pagePts;
  const updated = { ...campaign, pagePostTypes };
  saveCampaign(updated, uid);
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

api.get('/campaigns', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const campaigns = getAllCampaigns(uid);
  res.json(campaigns);
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
          pageTotal += Math.max(v1.length, v2.length);
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
  if (fsSync.existsSync(filePath)) return res.sendFile(path.resolve(filePath));
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
        if (!isNaN(pid) && (v === 'song_related' || v === 'not_related')) pageUgcTypes[pid] = v;
      }
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
    const updated = { ...campaign, name, pageIds: validPageIds, releaseDate, releaseType, campaignStartDate, campaignEndDate, memberUsernames: memberUsernames || [], notes, pagePostTypes, pageUgcTypes };
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
    const campaign = getCampaignById(campaignId, uid);
    const pt = getPostType(campaign, postTypeId, projectId);
    const isVideo = pt && (pt.mediaType === 'video' || pt.mediaType === 'video_text');
    const folderCount = pt && pt.mediaType === 'video_text' ? 1 : (pt && pt.mediaType === 'video' ? 2 : (pt ? Math.max(1, pt.folderCount || 3) : Math.max(1, (campaign && campaign.folderCount) || 3)));
    const dirs = campaignDirs(uid, projectId, campaignId, folderCount, pt ? pt.id : undefined);
    const result = {};
    const listFn = isVideo ? listVideos : listImages;
    for (let i = 0; i < folderCount; i++) {
      result[`folder${i + 1}`] = (await listFn(dirs[i])).map((f) => (f && f.filename) ? f.filename : path.basename(f && f.path ? f.path : f));
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
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    if (pt.mediaType === 'video') return res.status(400).json({ error: 'Video post types have fixed folders (Priority and Fallback)' });
    if (pt.mediaType === 'video_text') return res.status(400).json({ error: 'Videos (add text) post types have a single folder' });
    const newCount = Math.max(1, (pt.folderCount || 3) + 1);
    const textOptionsPerFolder = Array.isArray(pt.textOptionsPerFolder) ? [...pt.textOptionsPerFolder] : [];
    while (textOptionsPerFolder.length < newCount) textOptionsPerFolder.push([...DEFAULT_TEXT_OPTIONS]);
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
    saveCampaign(updated, uid);
    await ensureDirs(uid, String(projectId), String(campaignId), newCount, pt.id);
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
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    if (pt.mediaType === 'video') return res.status(400).json({ error: 'Video post types have fixed folders (Priority and Fallback)' });
    if (pt.mediaType === 'video_text') return res.status(400).json({ error: 'Videos (add text) post types have a single folder' });
    const currentCount = Math.max(1, pt.folderCount || 3);
    if (folderNum < 1 || folderNum > currentCount || currentCount <= 1) return res.status(400).json({ error: 'Invalid folder or cannot delete last folder' });
    const newCount = currentCount - 1;
    const ptSuffix = pt.id && pt.id !== 'default' ? `pt_${pt.id}` : '';
    const uidSeg = String(uid).replace(/[/\\]/g, '_');
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
    saveCampaign(updated, uid);
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
    return;
  }
  const folderCount = pt && pt.mediaType === 'video' ? 2 : (pt && pt.mediaType === 'video_text' ? 1 : (pt ? Math.max(1, pt.folderCount || 3) : 999));
  const dirs = campaignDirs(userId, projectId, campaignId, folderCount, pt ? pt.id : undefined);
  const dir = dirs[folderNum - 1];
  if (!dir) return;
  const filePath = path.join(dir, filename);
  await fs.unlink(filePath);
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
    await deleteFolderFile(uid, projectId, campaignId, folderNum, filename, postTypeId);
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
    await deleteFolderFile(uid, projectId, campaignId, folderNum, filename, postTypeId);
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
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    const folderCount = pt.mediaType === 'video' ? 2 : (pt.mediaType === 'video_text' ? 1 : Math.max(1, pt.folderCount || 3));
    const dirs = campaignDirs(uid, projectId, campaignId, folderCount, pt.id);
    const dir = dirs[folderNum - 1];
    if (!dir) return res.status(400).json({ error: 'Invalid folder' });
    const isVideo = pt.mediaType === 'video' || pt.mediaType === 'video_text';
    const files = isVideo ? await listVideos(dir) : await listImages(dir);
    for (const file of files) {
      const name = file.filename || (file.path && path.basename(file.path));
      if (name) await deleteFolderFile(uid, projectId, campaignId, folderNum, name, postTypeId).catch(() => {});
    }
    res.json({ ok: true, deleted: files.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/images/:filename', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId);
  const campaignId = String(req.params.campaignId);
  const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
  const postTypeId = req.query.postTypeId || 'default';
  const filename = req.params.filename;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  if (storage.useSupabase()) {
    const url = storage.getFileUrl(projectId, campaignId, postTypeId, folderNum, filename, uid);
    if (url) return res.redirect(302, url);
  }
  const campaign = getCampaignById(campaignId, uid);
  const pt = getPostType(campaign, postTypeId, projectId);
  const uidSeg = String(uid).replace(/[/\\]/g, '_');
  const ptBase = pt && pt.id && pt.id !== 'default' ? `pt_${pt.id}` : '';
  const base = path.join(UPLOADS, uidSeg, projectId, campaignId, ptBase);
  const filePath = path.join(base, `folder${folderNum}`, filename);
  if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS))) return res.status(403).end();
  res.sendFile(path.resolve(filePath), (err) => { if (err && err.statusCode) res.status(err.statusCode).end(); });
});

api.get('/projects/:projectId/campaigns/:campaignId/folders/:folderNum/media/:filename', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId);
  const campaignId = String(req.params.campaignId);
  const folderNum = Math.max(1, parseInt(req.params.folderNum, 10));
  const postTypeId = req.query.postTypeId || 'default';
  const filename = req.params.filename;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  if (storage.useSupabase()) {
    const url = storage.getFileUrl(projectId, campaignId, postTypeId, folderNum, filename, uid);
    if (url) return res.redirect(302, url);
  }
  const campaign = getCampaignById(campaignId, uid);
  const pt = getPostType(campaign, postTypeId, projectId);
  const uidSeg = String(uid).replace(/[/\\]/g, '_');
  const ptBase = pt && pt.id && pt.id !== 'default' ? `pt_${pt.id}` : '';
  const base = path.join(UPLOADS, uidSeg, projectId, campaignId, ptBase);
  const filePath = path.join(base, `folder${folderNum}`, filename);
  if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS))) return res.status(403).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(filePath), (err) => { if (err && err.statusCode) res.status(err.statusCode).end(); });
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
    const today = new Date();
    const items = [];
    const countByKey = {};
    const getMinFolderCount = async (projectId, campaignId, pt) => {
      if (!pt) return 0;
      if (pt.mediaType === 'video') return Infinity;
      if (pt.mediaType === 'video_text') {
        const folderCount = 1;
        const dirs = campaignDirs(uid, String(projectId), String(campaignId), folderCount, pt.id);
        const files = await listVideos(dirs[0]);
        return files.length;
      }
      const folderCount = Math.max(1, pt.folderCount || 3);
      const dirs = campaignDirs(uid, String(projectId), String(campaignId), folderCount, pt.id);
      let min = Infinity;
      for (let i = 0; i < folderCount; i++) {
        const files = await listImages(dirs[i]);
        if (files.length < min) min = files.length;
      }
      return min === Infinity ? 0 : min;
    };
    const calendarDays = 90;
    for (let d = 0; d < calendarDays; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      const dayOfWeek = date.getDay();
      for (const c of allCampaigns) {
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
          const capped = pt.mediaType === 'photo' || pt.mediaType === 'video_text';
          if (capped && added >= max) continue;
          for (const t of times) {
            if (capped && countByKey[key].added >= countByKey[key].max) break;
            const [h, m] = t.split(':').map(Number);
            items.push({
              date: dateStr,
              time: t,
              sortKey: dateStr + ' ' + String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0'),
              projectName: c.projectName,
              projectId: c.projectId,
              campaignName: c.name,
              campaignId: c.id,
            });
            if (capped) countByKey[key].added++;
          }
        }
      }
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/projects/:projectId/used', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const used = usedDir(uid, projectId);
    const files = await fs.readdir(used).catch(() => []);
    const items = [];
    for (const f of files) {
      const match = f.match(/^(\d+)-c(\d+)-f(\d+)-(.+)$/);
      if (match) {
        const movedAt = parseInt(match[1], 10);
        const campaignId = parseInt(match[2], 10);
        const folderNum = parseInt(match[3], 10);
        const originalName = match[4];
        const expiresAt = movedAt + USED_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        items.push({ filename: f, originalName, campaignId, folderNum, movedAt: new Date(movedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() });
      }
    }
    items.sort((a, b) => a.movedAt.localeCompare(b.movedAt));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

api.get('/projects/:projectId/used/images/:filename', (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const projectId = String(req.params.projectId);
  const filename = req.params.filename;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  const used = usedDir(uid, projectId);
  const filePath = path.join(used, filename);
  if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS))) return res.status(403).end();
  const match = filename.match(/^\d+-c\d+-f\d+-(.+)$/);
  const downloadName = match ? match[1] : path.basename(filename);
  res.set('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, "'")}"`);
  res.sendFile(path.resolve(filePath), (err) => { if (err && err.statusCode) res.status(err.statusCode).end(); });
});

api.post('/projects/:projectId/campaigns/:campaignId/upload', (req, res, next) => {
  req.setTimeout(5 * 60 * 1000); // 5 min for large video uploads
  res.setTimeout(5 * 60 * 1000);
  upload.array('photo', 100)(req, res, async (err) => {
    if (err) {
      console.error('[upload] multer error:', err.message);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files or invalid folder' });
    if (storage.useSupabase()) {
      const projectId = req.params.projectId;
      const campaignId = req.params.campaignId;
      const folderNum = Math.max(1, Math.min(999, parseInt(req.query.folder || '1', 10)));
      const postTypeId = req.query.postTypeId || 'default';
      const isVideo = req.query.mediaType === 'video' || req.query.mediaType === 'video_text';
      try {
        for (const file of files) {
          const ext = path.extname(file.originalname) || (isVideo ? '.mp4' : '.jpg');
          const filename = file.filename || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          const contentType = file.mimetype || (isVideo ? 'video/mp4' : 'image/jpeg');
          const buffer = file.buffer || await fs.readFile(file.path);
          const uid = req.user?.id;
          await storage.uploadFile(projectId, campaignId, postTypeId, folderNum, buffer, filename, contentType, uid);
          if (file.path) await fs.unlink(file.path).catch(() => {});
        }
      } catch (e) {
        console.error('[upload] Supabase upload error:', e.message);
        return res.status(500).json({ error: e.message || 'Upload to storage failed' });
      }
    }
    res.json({ ok: true, count: files.length });
  });
});

api.post('/projects/:projectId/campaigns/:campaignId/preview', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const projectId = String(req.params.projectId);
    const campaignId = String(req.params.campaignId);
    const postTypeId = req.body.postTypeId || 'default';
    const campaign = getCampaignById(campaignId, uid);
    if (!campaign || !campaignBelongsToPage(campaign, projectId)) return res.status(404).json({ error: 'Campaign not found' });
    const pt = getPostType(campaign, postTypeId, projectId);
    if (!pt) return res.status(404).json({ error: 'Post type not found' });
    if (pt.mediaType === 'video_text') {
      try {
        const textStyleOverride = Array.isArray(req.body.textStylePerFolder) ? req.body.textStylePerFolder : null;
        const textOptionsOverride = Array.isArray(req.body.textOptionsPerFolder) ? req.body.textOptionsPerFolder : null;
        const result = await runCampaignPipelineVideoWithText(uid, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId, { preview: true });
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
    const dirs = campaignDirs(uid, projectId, campaignId, folderCount, pt.id);
    const dir = dirs[folderNum - 1];
    if (!dir) return res.status(404).json({ error: 'Folder not found' });
    const images = await listImages(dir);
    const chosen = images[0] || null;
    if (!chosen) return res.status(400).json({ error: 'No images in folder. Add photos to preview.' });
    const imgBuf = await getImageBuffer(chosen, folderNum - 1, dirs, projectId, campaignId, postTypeId, uid);
    const uniqueId = Date.now();
    const outName = `preview-${folderNum}-${uniqueId}.jpg`;
    const uidSeg = String(uid).replace(/[/\\]/g, '_');
    const outPath = storage.useSupabase() ? null : path.join(GENERATED, uidSeg, projectId, campaignId, outName);
    if (!storage.useSupabase()) await fs.mkdir(path.join(GENERATED, uidSeg, projectId, campaignId), { recursive: true });
    const normStyle = {
      x: textStyle.x != null ? parseFloat(textStyle.x) : 50,
      y: textStyle.y != null ? parseFloat(textStyle.y) : 92,
      fontSize: textStyle.fontSize != null ? parseFloat(textStyle.fontSize) : 0.06,
      font: textStyle.font || 'Arial, sans-serif',
      color: textStyle.color || 'white',
      strokeWidth: textStyle.strokeWidth != null ? parseFloat(textStyle.strokeWidth) : 2,
    };
    const imageBuffer = await addTextOverlay(imgBuf, sampleText, outPath, normStyle);
    let url;
    if (storage.useSupabase()) {
      url = await storage.uploadGenerated(projectId, campaignId, outName, imageBuffer, undefined, uid);
    } else {
      const config = getConfig();
      let baseUrl = normalizeBaseUrl(config.baseUrl);
      if (!baseUrl && req && req.get('host')) {
        const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
        baseUrl = `${proto}://${req.get('host')}`;
      }
      const uidSeg = String(uid).replace(/[/\\]/g, '_');
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
    const textStyleOverride = Array.isArray(req.body?.textStylePerFolder) ? req.body.textStylePerFolder : null;
    const textOptionsOverride = Array.isArray(req.body?.textOptionsPerFolder) ? req.body.textOptionsPerFolder : null;
    const sendAsDraft = req.body?.sendAsDraft === true;
    const result = await runCampaignPipeline(uid, projectId, campaignId, textStyleOverride, textOptionsOverride, postTypeId);
    const config = getConfig();
    const project = getProjects(uid).find((p) => String(p.id) === String(projectId));
    const accountId = project?.blotatoAccountId;
    const apiKey = config?.blotatoApiKey;
    if (apiKey && accountId && result.webContentUrls?.length) {
      try {
        await sendToBlotato(apiKey, accountId, result.webContentUrls, { isDraft: sendAsDraft });
        result.blotatoSent = true;
        result.blotatoSentAsDraft = sendAsDraft;
      } catch (blotatoErr) {
        result.blotatoError = String(blotatoErr.message);
      }
    }
    for (const used of result.usedSourcePaths || []) {
      try {
        const { item, folderNum, postTypeId } = used;
        if (storage.useSupabase()) {
          await storage.moveToUsed(projectId, campaignId, { filename: item.filename, postTypeId }, folderNum, uid);
          console.log(`[run] Moved used image to used folder: ${item.filename}`);
        } else if (item.path && fsSync.existsSync(item.path)) {
          await moveToUsedFolder(uid, projectId, campaignId, item.path, folderNum);
          console.log(`[run] Moved used image to used folder: ${path.basename(item.path)}`);
        }
      } catch (moveErr) {
        console.warn(`[run] Failed to move used image:`, moveErr.message);
      }
    }
    res.json(result);
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
  const campaignId = req.query.campaignId != null ? String(req.query.campaignId) : null;
  if (campaignId) items = items.filter((t) => String(t.campaignId) === campaignId);
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
      campaignId: campaignId || undefined,
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
    const campaignId = req.body.campaignId !== undefined ? (req.body.campaignId != null ? String(req.body.campaignId) : undefined) : trend.campaignId;
    const updated = { ...trend, name, pageIds, textOptions, textStyle, pageSchedules, folderCount, campaignId };
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
  deleteTrend(trend.id, uid);
  res.json({ ok: true });
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

api.post('/trends/:trendId/pages/:pageIndex/folders/:folderNum/upload', upload.array('photo', 100), async (req, res) => {
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
    const textOptions = Array.isArray(req.body.textOptions) && req.body.textOptions.length ? req.body.textOptions : (trend.textOptions || DEFAULT_TEXT_OPTIONS);
    const sampleText = (req.body.sampleText && String(req.body.sampleText).trim()) || (textOptions[0] && String(textOptions[0]).trim()) || 'Sample text';
    const textStyle = req.body.textStyle && typeof req.body.textStyle === 'object' ? req.body.textStyle : (trend.textStyle || {});
    const normStyle = {
      x: textStyle.x != null ? parseFloat(textStyle.x) : 50,
      y: textStyle.y != null ? parseFloat(textStyle.y) : 92,
      fontSize: textStyle.fontSize != null ? parseFloat(textStyle.fontSize) : 48,
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
    const config = getConfig();
    let baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl && req && req.get('host')) {
      const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
      baseUrl = `${proto}://${req.get('host')}`;
    }
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
    const textStyleOverride = req.body.textStyle && typeof req.body.textStyle === 'object' ? req.body.textStyle : null;
    const textOptionsOverride = Array.isArray(req.body.textOptions) && req.body.textOptions.length ? req.body.textOptions : null;
    const result = await runTrendPipeline(uid, trendId, textStyleOverride, textOptionsOverride);
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
api.get('/profiles/lookup', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const { data, error } = await supabaseAdmin.from('profiles').select('id, username').ilike('username', username).maybeSingle();
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

// --- Config ---
api.get('/config', (req, res) => res.json(getConfig()));
api.put('/config', (req, res) => {
  const body = { ...req.body };
  if (body.baseUrl !== undefined) body.baseUrl = normalizeBaseUrl(body.baseUrl) || body.baseUrl;
  setConfig(body);
  res.json(getConfig());
});

// --- Logins (page credentials: email, username, password, platform) ---
function getLoginsData() {
  return readJson(LOGINS_PATH, { nextId: 1, items: [] });
}
function getLogins() {
  return (getLoginsData().items || []).slice();
}
function saveLogins(items, nextId) {
  const data = getLoginsData();
  writeJson(LOGINS_PATH, { nextId: nextId !== undefined ? nextId : data.nextId, items: items || data.items || [] });
}
api.get('/logins', (req, res) => {
  try {
    res.json(getLogins());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
api.post('/logins', (req, res) => {
  try {
    const data = getLoginsData();
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
    saveLogins(items, nextId + 1);
    res.status(201).json(item);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
api.put('/logins/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = getLoginsData();
    const items = (data.items || []).slice();
    const idx = items.findIndex((l) => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Login not found' });
    const { email, username, password, platform } = req.body || {};
    const validPlatforms = ['TikTok', 'Instagram', 'YouTube'];
    if (email !== undefined) items[idx].email = String(email).trim();
    if (username !== undefined) items[idx].username = String(username).trim();
    if (password !== undefined) items[idx].password = String(password);
    if (platform !== undefined) items[idx].platform = validPlatforms.includes(platform) ? platform : items[idx].platform;
    saveLogins(items);
    res.json(items[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});
api.delete('/logins/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = getLoginsData();
    const items = (data.items || []).filter((l) => l.id !== id);
    if (items.length === (data.items || []).length) return res.status(404).json({ error: 'Login not found' });
    saveLogins(items);
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
      const login = (getLogins() || []).find((l) => String(l.id) === id);
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

// --- Serve generated images: /generated/:userId/:projectId/:campaignId/:filename (per-profile) ---
function serveGeneratedImage(req, res) {
  const { userId, projectId, campaignId, filename } = req.params;
  if (!filename || /[\/\\]/.test(filename)) return res.status(400).end();
  if (storage.useSupabase()) {
    const url = storage.getGeneratedUrl(projectId, campaignId, filename, userId);
    if (url) return res.redirect(302, url);
  }
  const uidSeg = userId ? String(userId).replace(/[/\\]/g, '_') : '';
  const filePath = uidSeg
    ? path.resolve(GENERATED, uidSeg, projectId, campaignId, filename)
    : path.resolve(GENERATED, projectId, campaignId, filename);
  const generatedResolved = path.resolve(GENERATED);
  if (!filePath.startsWith(generatedResolved)) return res.status(403).end();
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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

const USED_IMAGE_RETENTION_DAYS = 14;

async function cleanupExpiredUsedImages() {
  const userIds = listUserIdsWithData();
  const cutoff = Date.now() - USED_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const uid of userIds) {
    const projects = getProjects(uid);
    for (const p of projects) {
      const used = usedDir(uid, p.id);
      try {
        const files = await fs.readdir(used).catch(() => []);
        for (const f of files) {
          const match = f.match(/^(\d+)-c\d+-f\d+-.+/);
          const movedAt = match ? parseInt(match[1], 10) : 0;
          if (movedAt > 0 && movedAt < cutoff) {
            await fs.unlink(path.join(used, f)).catch(() => {});
            deleted++;
          }
        }
      } catch (_) {}
    }
  }
  if (deleted > 0) console.log(`[cleanup] Deleted ${deleted} expired used image(s) (older than ${USED_IMAGE_RETENTION_DAYS} days)`);
}

let lastRunMinute = null;
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (lastRunMinute === key) return;
  const currentTime = getCurrentTimeString();
  const todayStr = now.toISOString().slice(0, 10);
  const dayOfWeek = now.getDay();
  const userIds = listUserIdsWithData();
  const runs = [];
  for (const uid of userIds) {
    const campaigns = getAllCampaigns(uid);
    for (const c of campaigns) {
      const pageIds = (c.pageIds && c.pageIds.length) ? c.pageIds : (c.projectId != null ? [c.projectId] : []);
      for (const projectId of pageIds) {
        const postTypes = getPostTypesForPage(c, projectId);
        for (const pt of postTypes) {
          if (!isPostTypeDeployed(c, projectId, pt.id)) continue;
          if (!pt.scheduleEnabled || !(pt.scheduleTimes || []).includes(currentTime)) continue;
          if (pt.scheduleStartDate && todayStr < pt.scheduleStartDate) continue;
          if (pt.scheduleEndDate && todayStr > pt.scheduleEndDate) continue;
          const days = pt.scheduleDaysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
          if (days.length === 0 || !days.includes(dayOfWeek)) continue;
          runs.push({ userId: uid, campaign: c, projectId, postTypeId: pt.id });
        }
      }
    }
  }
  if (!runs.length) return;
  lastRunMinute = key;
  const config = getConfig();
  for (const { userId: uid, campaign: c, projectId, postTypeId } of runs) {
    try {
      const result = await runCampaignPipeline(uid, projectId, c.id, null, null, postTypeId);
      console.log(`[scheduler] ${c.name} (page ${projectId}/${c.id} pt ${postTypeId}): ${result.webContentUrls.length} URLs`);
      const projects = getProjects(uid);
      const project = projects.find((p) => p.id === parseInt(String(projectId), 10));
      const accountId = project?.blotatoAccountId;
      const apiKey = config?.blotatoApiKey;
      if (apiKey && accountId && result.webContentUrls?.length) {
        await sendToBlotato(apiKey, accountId, result.webContentUrls, { isDraft: c.sendAsDraft });
        console.log(`[scheduler] Blotato post sent for ${c.name} page ${projectId}`);
        for (const used of result.usedSourcePaths || []) {
          try {
            const { item, folderNum, postTypeId } = used;
            if (storage.useSupabase()) {
              await storage.moveToUsed(projectId, c.id, { filename: item.filename, postTypeId }, folderNum, uid);
              console.log(`[scheduler] Moved used image to used folder: ${item.filename}`);
            } else if (item.path && fsSync.existsSync(item.path)) {
              await moveToUsedFolder(uid, projectId, c.id, item.path, folderNum);
              console.log(`[scheduler] Moved used image to used folder: ${path.basename(item.path)}`);
            }
          } catch (moveErr) {
            console.warn(`[scheduler] Failed to move used image:`, moveErr.message);
          }
        }
      }
    } catch (e) {
      console.error(`[scheduler] ${c.name} page ${projectId}:`, e.message);
    }
  }
});

cron.schedule('0 4 * * *', async () => {
  await cleanupExpiredUsedImages();
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
