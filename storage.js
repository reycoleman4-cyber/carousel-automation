/**
 * Storage abstraction: local disk or Supabase Storage.
 * Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use Supabase.
 */
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const ROOT = path.resolve(__dirname);

const UPLOADS_BUCKET = 'uploads';
const GENERATED_BUCKET = 'generated';
const USED_BUCKET = 'used';

let supabase = null;
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseUrl() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return url ? `${url}/storage/v1/object/public` : '';
}

function pathPrefix(userId) {
  return userId ? `${String(userId).replace(/[/\\]/g, '_')}/` : '';
}

/** Storage path for folder image: [userId/]projectId/campaignId/pt_X/folderN/filename */
function folderStoragePath(projectId, campaignId, postTypeId, folderNum, filename, userId) {
  const prefix = pathPrefix(userId);
  const pt = postTypeId && postTypeId !== 'default' ? `pt_${postTypeId}` : '';
  const base = pt ? `${projectId}/${campaignId}/${pt}` : `${projectId}/${campaignId}`;
  return `${prefix}${base}/folder${folderNum}/${filename || ''}`;
}

/** Storage path for generated: [userId/]projectId/campaignId/filename */
function generatedStoragePath(projectId, campaignId, filename, userId) {
  return `${pathPrefix(userId)}${projectId}/${campaignId}/${filename}`;
}

/** Storage path for used: [userId/]projectId/filename */
function usedStoragePath(projectId, filename, userId) {
  return `${pathPrefix(userId)}${projectId}/${filename}`;
}

async function ensureBucket(bucket) {
  if (!supabase) return;
  try {
    const { error } = await supabase.storage.createBucket(bucket, { public: true });
    if (error && error.message && !error.message.includes('already exists')) throw error;
  } catch (e) {
    if (e?.message && !e.message.includes('already exists')) console.warn(`[storage] Bucket ${bucket}:`, e.message);
  }
}

async function initStorage() {
  if (supabase) {
    await ensureBucket(UPLOADS_BUCKET);
    await ensureBucket(GENERATED_BUCKET);
    await ensureBucket(USED_BUCKET);
  }
}

// --- Local disk helpers (used when not using Supabase) ---
function localUploadsPath(projectId, campaignId, postTypeId, folderNum, userId) {
  const uploadsBase = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(ROOT, 'uploads');
  const base = userId
    ? path.join(uploadsBase, String(userId).replace(/[/\\]/g, '_'), String(projectId), String(campaignId))
    : path.join(uploadsBase, String(projectId), String(campaignId));
  const pt = postTypeId && postTypeId !== 'default' ? path.join(base, `pt_${postTypeId}`) : base;
  return path.join(pt, `folder${folderNum}`);
}

function localGeneratedPath(projectId, campaignId, userId) {
  const genBase = process.env.GENERATED_DIR ? path.resolve(process.env.GENERATED_DIR) : path.join(ROOT, 'generated');
  return userId
    ? path.join(genBase, String(userId).replace(/[/\\]/g, '_'), String(projectId), String(campaignId))
    : path.join(genBase, String(projectId), String(campaignId));
}

function localUsedPath(projectId, userId) {
  const uploadsBase = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(ROOT, 'uploads');
  return userId
    ? path.join(uploadsBase, String(userId).replace(/[/\\]/g, '_'), String(projectId), 'used')
    : path.join(uploadsBase, String(projectId), 'used');
}

// --- List files ---
async function listFolderFiles(projectId, campaignId, postTypeId, folderNum, extensions, userId) {
  if (supabase) {
    const prefix = pathPrefix(userId);
    const base = postTypeId && postTypeId !== 'default'
      ? `${projectId}/${campaignId}/pt_${postTypeId}`
      : `${projectId}/${campaignId}`;
    const folderPath = `${prefix}${base}/folder${folderNum}`;
    const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).list(folderPath, { limit: 1000 });
    if (error) return [];
    const names = (data || [])
      .filter((f) => f.name && !f.name.startsWith('.') && extensions.some((ext) => (f.name || '').toLowerCase().endsWith(ext)))
      .map((f) => f.name);
    names.sort();
    return names.map((name) => ({ filename: name, storagePath: `${folderPath}/${name}` }));
  }
  const dir = localUploadsPath(projectId, campaignId, postTypeId, folderNum, userId);
  try {
    const names = await fs.readdir(dir);
    const filtered = names.filter((n) => extensions.some((ext) => n.toLowerCase().endsWith(ext)));
    filtered.sort();
    return filtered.map((name) => ({ filename: name, localPath: path.join(dir, name) }));
  } catch {
    return [];
  }
}

async function listImages(projectId, campaignId, postTypeId, folderNum, userId) {
  return listFolderFiles(projectId, campaignId, postTypeId, folderNum, ['.jpg', '.jpeg', '.png', '.webp', '.gif'], userId);
}

async function listVideos(projectId, campaignId, postTypeId, folderNum, userId) {
  return listFolderFiles(projectId, campaignId, postTypeId, folderNum, ['.mp4', '.mov', '.webm', '.avi', '.mkv'], userId);
}

// --- Read file (for processing) ---
async function readFileBuffer(projectId, campaignId, postTypeId, folderNum, filename, userId) {
  if (supabase) {
    const storagePath = folderStoragePath(projectId, campaignId, postTypeId, folderNum, filename, userId);
    const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).download(storagePath);
    if (error || !data) throw new Error(error?.message || 'Download failed');
    return Buffer.from(await data.arrayBuffer());
  }
  const dir = localUploadsPath(projectId, campaignId, postTypeId, folderNum, userId);
  return fs.readFile(path.join(dir, filename));
}

// --- Upload ---
async function uploadFile(projectId, campaignId, postTypeId, folderNum, buffer, filename, contentType, userId) {
  if (supabase) {
    const storagePath = folderStoragePath(projectId, campaignId, postTypeId, folderNum, filename, userId);
    const { error } = await supabase.storage.from(UPLOADS_BUCKET).upload(storagePath, buffer, {
      contentType: contentType || 'image/jpeg',
      upsert: true,
    });
    if (error) throw new Error(error.message);
    return { storagePath };
  }
  const dir = localUploadsPath(projectId, campaignId, postTypeId, folderNum, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return { localPath: path.join(dir, filename) };
}

// --- Get public URL ---
function getFileUrl(projectId, campaignId, postTypeId, folderNum, filename, userId) {
  if (supabase) {
    const base = getSupabaseUrl();
    const storagePath = folderStoragePath(projectId, campaignId, postTypeId, folderNum, filename, userId);
    return `${base}/${UPLOADS_BUCKET}/${storagePath}`;
  }
  return null;
}

// --- Delete ---
async function deleteFile(projectId, campaignId, postTypeId, folderNum, filename, userId) {
  if (supabase) {
    const storagePath = folderStoragePath(projectId, campaignId, postTypeId, folderNum, filename, userId);
    await supabase.storage.from(UPLOADS_BUCKET).remove([storagePath]);
    return;
  }
  const dir = localUploadsPath(projectId, campaignId, postTypeId, folderNum, userId);
  await fs.unlink(path.join(dir, filename));
}

// --- Generated images / videos ---
async function uploadGenerated(projectId, campaignId, filename, buffer, contentType, userId) {
  if (supabase) {
    const storagePath = generatedStoragePath(projectId, campaignId, filename, userId);
    const { error } = await supabase.storage.from(GENERATED_BUCKET).upload(storagePath, buffer, {
      contentType: contentType || 'image/jpeg',
      upsert: true,
    });
    if (error) throw new Error(error.message);
    const base = getSupabaseUrl();
    return `${base}/${GENERATED_BUCKET}/${storagePath}`;
  }
  const dir = localGeneratedPath(projectId, campaignId, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return null;
}

function getGeneratedUrl(projectId, campaignId, filename, userId) {
  if (supabase) {
    const base = getSupabaseUrl();
    const storagePath = generatedStoragePath(projectId, campaignId, filename, userId);
    return `${base}/${GENERATED_BUCKET}/${storagePath}`;
  }
  return null;
}

async function readGeneratedBuffer(projectId, campaignId, filename, userId) {
  if (supabase) {
    const storagePath = generatedStoragePath(projectId, campaignId, filename, userId);
    const { data, error } = await supabase.storage.from(GENERATED_BUCKET).download(storagePath);
    if (error || !data) throw new Error(error?.message || 'Download failed');
    return Buffer.from(await data.arrayBuffer());
  }
  const dir = localGeneratedPath(projectId, campaignId, userId);
  return fs.readFile(path.join(dir, filename));
}

// --- Move to used ---
async function moveToUsed(projectId, campaignId, sourceInfo, folderNum, userId) {
  const ext = sourceInfo.filename ? path.extname(sourceInfo.filename) : '.jpg';
  const nameWithoutExt = sourceInfo.filename ? path.basename(sourceInfo.filename, ext) : 'img';
  const newName = `${Date.now()}-c${campaignId}-f${folderNum}-${nameWithoutExt}${ext}`;

  if (supabase) {
    const buffer = await readFileBuffer(projectId, campaignId, sourceInfo.postTypeId, folderNum, sourceInfo.filename, userId);
    const storagePath = usedStoragePath(projectId, newName, userId);
    await supabase.storage.from(USED_BUCKET).upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true });
    await deleteFile(projectId, campaignId, sourceInfo.postTypeId, folderNum, sourceInfo.filename, userId);
    return newName;
  }
  const srcDir = localUploadsPath(projectId, campaignId, sourceInfo.postTypeId, folderNum, userId);
  const srcPath = path.join(srcDir, sourceInfo.filename);
  const used = localUsedPath(projectId, userId);
  await fs.mkdir(used, { recursive: true });
  const destPath = path.join(used, newName);
  await fs.rename(srcPath, destPath);
  return newName;
}

module.exports = {
  useSupabase: () => useSupabase,
  initStorage,
  listImages,
  listVideos,
  readFileBuffer,
  uploadFile,
  getFileUrl,
  deleteFile,
  uploadGenerated,
  getGeneratedUrl,
  readGeneratedBuffer,
  moveToUsed,
  folderStoragePath,
  localUploadsPath,
  localGeneratedPath,
  localUsedPath,
};
