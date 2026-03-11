#!/usr/bin/env node
/**
 * Syncs production data (projects + campaigns) to your local data directory.
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

async function sync() {
  console.log(`Fetching production data from ${PROD_URL}...`);
  const res = await fetch(`${PROD_URL}/api/admin/export-data?userId=${encodeURIComponent(USER_ID)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Export failed ${res.status}: ${txt}`);
  }
  const { projects, campaigns } = await res.json();

  const safeId = String(USER_ID).replace(/[/\\]/g, '_');
  const projectsDir  = path.join(DATA_DIR, 'projects');
  const campaignsDir = path.join(DATA_DIR, 'campaigns');
  fs.mkdirSync(projectsDir,  { recursive: true });
  fs.mkdirSync(campaignsDir, { recursive: true });

  fs.writeFileSync(path.join(projectsDir,  `${safeId}.json`), JSON.stringify(projects,  null, 2));
  fs.writeFileSync(path.join(campaignsDir, `${safeId}.json`), JSON.stringify(campaigns, null, 2));

  console.log(`Done. Synced ${projects.length} projects, ${campaigns.length} campaigns → ${DATA_DIR}`);
}

sync().catch(e => { console.error(e.message); process.exit(1); });
