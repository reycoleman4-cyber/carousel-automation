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
  }
}

// --- Local disk helpers (used when not using Supabase) ---
function getDataRoot() {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
}
function localUploadsPath(projectId, campaignId, postTypeId, folderNum, userId) {
  const uploadsBase = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(getDataRoot(), 'uploads');
  const base = userId
    ? path.join(uploadsBase, String(userId).replace(/[/\\]/g, '_'), String(projectId), String(campaignId))
    : path.join(uploadsBase, String(projectId), String(campaignId));
  const pt = postTypeId && postTypeId !== 'default' ? path.join(base, `pt_${postTypeId}`) : base;
  return path.join(pt, `folder${folderNum}`);
}

function localGeneratedPath(projectId, campaignId, userId) {
  const genBase = process.env.GENERATED_DIR ? path.resolve(process.env.GENERATED_DIR) : path.join(getDataRoot(), 'generated');
  return userId
    ? path.join(genBase, String(userId).replace(/[/\\]/g, '_'), String(projectId), String(campaignId))
    : path.join(genBase, String(projectId), String(campaignId));
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
  return listFolderFiles(projectId, campaignId, postTypeId, folderNum, ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'], userId);
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

/** Delete all uploaded files (photos/videos) for a single post type. Call when deleting a post type. */
async function deleteAllUploadsForPostType(projectId, campaignId, postTypeId, userId) {
  if (supabase) {
    const prefix = pathPrefix(userId);
    const base = postTypeId && postTypeId !== 'default'
      ? `${projectId}/${campaignId}/pt_${postTypeId}`
      : `${projectId}/${campaignId}`;
    const folderPath = `${prefix}${base}`;
    const { data: topLevel, error: listError } = await supabase.storage.from(UPLOADS_BUCKET).list(folderPath, { limit: 100 });
    if (listError || !topLevel) return;
    const toRemove = [];
    for (const item of topLevel) {
      if (!item.name || item.name.startsWith('.')) continue;
      const subPath = `${folderPath}/${item.name}`;
      const { data: files, error: subError } = await supabase.storage.from(UPLOADS_BUCKET).list(subPath, { limit: 2000 });
      if (subError || !files) continue;
      for (const f of files) {
        if (f.name && !f.name.startsWith('.')) toRemove.push(`${subPath}/${f.name}`);
      }
    }
    for (let i = 0; i < toRemove.length; i += 500) {
      const batch = toRemove.slice(i, i + 500);
      await supabase.storage.from(UPLOADS_BUCKET).remove(batch);
    }
    return;
  }
  const uploadsBase = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(getDataRoot(), 'uploads');
  const base = userId
    ? path.join(uploadsBase, String(userId).replace(/[/\\]/g, '_'), String(projectId), String(campaignId))
    : path.join(uploadsBase, String(projectId), String(campaignId));
  const ptDir = postTypeId && postTypeId !== 'default' ? path.join(base, `pt_${postTypeId}`) : base;
  try {
    const entries = await fs.readdir(ptDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || !ent.name.startsWith('folder')) continue;
      const folderPath = path.join(ptDir, ent.name);
      const names = await fs.readdir(folderPath);
      for (const name of names) {
        await fs.unlink(path.join(folderPath, name)).catch(() => {});
      }
      await fs.rmdir(folderPath).catch(() => {});
    }
  } catch (_) {}
}

/** Delete all uploaded files for every post type on a given page in a campaign. Call when removing a page from a campaign. */
async function deleteAllUploadsForPageInCampaign(projectId, campaignId, postTypeIds, userId) {
  for (const postTypeId of postTypeIds) {
    await deleteAllUploadsForPostType(projectId, campaignId, postTypeId, userId);
  }
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

module.exports = {
  useSupabase: () => useSupabase,
  initStorage,
  listImages,
  listVideos,
  readFileBuffer,
  uploadFile,
  getFileUrl,
  deleteFile,
  deleteAllUploadsForPostType,
  deleteAllUploadsForPageInCampaign,
  uploadGenerated,
  getGeneratedUrl,
  readGeneratedBuffer,
  folderStoragePath,
  localUploadsPath,
  localGeneratedPath,
};
