#!/usr/bin/env node
/**
 * Encoding worker for VPS. Polls the app for jobs, runs ffmpeg, uploads to Supabase, callbacks.
 * Set RAILWAY_APP_URL, ENCODING_WORKER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE_URL = (process.env.RAILWAY_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
const SECRET = process.env.ENCODING_WORKER_SECRET;

if (!BASE_URL || !SECRET) {
  console.error('Set RAILWAY_APP_URL (or APP_URL) and ENCODING_WORKER_SECRET');
  process.exit(1);
}

const storage = require('./storage');
if (!storage.useSupabase()) {
  console.error('Worker requires Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const ffmpeg = require('fluent-ffmpeg');
const FFMPEG_LOW_MEM_OPTS = ['-threads', '2', '-preset', 'superfast'];

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

function videoFontSizePx(textStyle) {
  const v = parseFloat(textStyle && textStyle.fontSize);
  if (Number.isNaN(v) || v <= 0) return 48;
  if (v >= 12 && v <= 200) return Math.round(v);
  const frac = v > 1 ? v / 100 : v;
  return Math.max(12, Math.min(Math.round(720 * frac), 200));
}

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

function escapeDrawtextPath(p) {
  return String(p).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

async function addVideoTextOverlay(inputPath, text, textStyle, outputPath) {
  const W = 1080;
  const H = 1920;
  const cropFilter = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})/2`;
  const hasText = text != null && typeof text === 'string' && String(text).trim().length > 0;
  if (!hasText) {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vf', cropFilter, '-c:a', 'copy', ...FFMPEG_LOW_MEM_OPTS])
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
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vf', vf, '-c:a', 'copy', ...FFMPEG_LOW_MEM_OPTS])
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

async function overlayPresetOnVideo(sourcePath, presetPath, outputPath) {
  const W = 1080;
  const H = 1920;
  const filterComplex = [
    '[0:v]scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H + '[base]',
    '[1:v]scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2:color=black,colorkey=0x000000:0.08:0.15,format=yuva420p[ck]',
    '[base][ck]overlay=0:0:format=auto:shortest=1[out]',
  ].join(';');
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .inputOptions(['-stream_loop', '-1'])
      .input(presetPath)
      .outputOptions([
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-c:a', 'copy',
        '-t', '60',
        ...FFMPEG_LOW_MEM_OPTS,
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(err.message || 'Preset overlay failed')))
      .run();
  });
}

async function fetchNextJob() {
  const res = await fetch(`${BASE_URL}/api/encoding/jobs/next`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Jobs/next ${res.status}`);
  return res.json();
}

async function completeJob(jobId, body) {
  const res = await fetch(`${BASE_URL}/api/encoding/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Complete ${res.status}: ${await res.text()}`);
}

async function processJob(job) {
  const { id, payload } = job;
  const { type, sourceUrl, outputFilename, projectId, campaignId, userId } = payload;
  const ext = path.extname(sourceUrl) || '.mp4';
  const tmpIn = path.join(os.tmpdir(), `worker-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  const tmpOut = path.join(os.tmpdir(), `worker-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);

  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`Download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(tmpIn, buf);

    let outBuf;
    if (type === 'video') {
      outBuf = buf;
    } else if (type === 'video_text') {
      await addVideoTextOverlay(tmpIn, payload.text, payload.textStyle || {}, tmpOut);
      outBuf = await fs.readFile(tmpOut);
    } else if (type === 'video_preset') {
      const presetExt = path.extname(payload.presetUrl.split('?')[0]) || '.mp4';
      const tmpPreset = path.join(os.tmpdir(), `worker-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${presetExt}`);
      try {
        const presetRes = await fetch(payload.presetUrl, { headers: { Authorization: `Bearer ${SECRET}` } });
        if (!presetRes.ok) throw new Error(`Preset download ${presetRes.status}`);
        await fs.writeFile(tmpPreset, Buffer.from(await presetRes.arrayBuffer()));
        await overlayPresetOnVideo(tmpIn, tmpPreset, tmpOut);
        outBuf = await fs.readFile(tmpOut);
      } finally {
        await fs.unlink(tmpPreset).catch(() => {});
      }
    } else {
      throw new Error('Unknown job type: ' + type);
    }

    await storage.uploadGenerated(projectId, campaignId, outputFilename, outBuf, 'video/mp4', userId);
    const url = storage.getGeneratedUrl(projectId, campaignId, outputFilename, userId);
    if (!url) throw new Error('Could not get generated URL');
    await completeJob(id, { url });
    console.log(`[worker] Job ${id} completed: ${outputFilename}`);
  } catch (err) {
    console.error(`[worker] Job ${id} failed:`, err.message);
    await completeJob(id, { error: err.message }).catch((e) => console.error('[worker] Complete error:', e.message));
  } finally {
    await fs.unlink(tmpIn).catch(() => {});
    await fs.unlink(tmpOut).catch(() => {});
  }
}

const POLL_MS = 15000;

async function run() {
  console.log('[worker] Started, polling', BASE_URL);
  while (true) {
    try {
      const job = await fetchNextJob();
      if (job) {
        await processJob(job);
      } else {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      console.error('[worker] Poll error:', e.message);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

run();
