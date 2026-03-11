#!/usr/bin/env node
// One-time script: copies avatar files from singular paths (project/, campaign/)
// to plural paths (projects/, campaigns/) that the current server code expects.
// Safe to run multiple times (upsert: true).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const UID = process.env.SYNC_USER_ID;
const BUCKET = 'avatars';

async function copyFolder(oldFolder, newFolder) {
  const { data: files, error } = await supabase.storage.from(BUCKET).list(`${UID}/${oldFolder}`, { limit: 200 });
  if (error) { console.error(`List error for ${oldFolder}:`, error.message); return; }
  if (!files || files.length === 0) { console.log(`No files in ${oldFolder}/`); return; }
  console.log(`Found ${files.length} files in ${oldFolder}/: ${files.map(f => f.name).join(', ')}`);

  for (const f of files) {
    const oldPath = `${UID}/${oldFolder}/${f.name}`;
    const newPath = `${UID}/${newFolder}/${f.name}`;
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(oldPath);
    if (dlErr) { console.error(`  Download failed ${oldPath}:`, dlErr.message); continue; }
    const buf = Buffer.from(await blob.arrayBuffer());
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, buf, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) { console.error(`  Upload failed ${newPath}:`, upErr.message); continue; }
    console.log(`  Copied ${oldPath} → ${newPath}`);
  }
}

async function main() {
  console.log('Migrating avatar paths in Supabase Storage...');
  await copyFolder('project', 'projects');
  await copyFolder('campaign', 'campaigns');
  console.log('Done. Photos should now appear on the production site.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
