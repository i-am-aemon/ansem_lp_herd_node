#!/usr/bin/env node
/**
 * Push local .env + cell.json → Railway (skips private keys).
 * Usage: RAILWAY_SYNC_CONFIRM=yes npm run railway:sync-env
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val !== '') out[key] = val;
  }
  return out;
}

function railwaySet(pairs, { skipDeploys = true } = {}) {
  const args = ['variable', 'set'];
  if (skipDeploys) args.push('--skip-deploys');
  for (const [k, v] of pairs) {
    args.push(`${k}=${v}`);
  }
  const res = spawnSync('railway', args, { stdio: 'inherit', encoding: 'utf8' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function main() {
  console.warn('\n⚠  Railway sync uploads config to the cloud.');
  console.warn('   Private keys are SKIPPED — live signing stays local.\n');
  if (process.env.RAILWAY_SYNC_CONFIRM !== 'yes') {
    console.error(
      'Set RAILWAY_SYNC_CONFIRM=yes to proceed (e.g. RAILWAY_SYNC_CONFIRM=yes npm run railway:sync-env)',
    );
    process.exit(1);
  }

  const env = {
    ...parseEnvFile(path.join(ROOT, '.env')),
    ...parseEnvFile(path.join(ROOT, 'cell_secrets.env')),
  };

  const skipped = [];
  for (const key of Object.keys(env)) {
    if (
      key.includes('PRIVATE_KEY') ||
      key === 'DASHBOARD_TOKEN' ||
      key === 'DASHBOARD_PASSWORD' ||
      key === 'NODE_PASSWORD'
    ) {
      skipped.push(key);
      delete env[key];
    }
  }
  if (skipped.length) {
    console.warn(`Skipping sensitive keys (local-only): ${skipped.join(', ')}\n`);
  }

  const cellPath = path.join(ROOT, 'cell.json');
  if (fs.existsSync(cellPath)) {
    env.CELL_JSON = fs.readFileSync(cellPath, 'utf8').trim();
  }

  delete env.DASHBOARD_PORT;
  delete env.HEALTH_PORT;

  const live = String(process.env.RAILWAY_LIVE || '').toLowerCase() === 'yes';
  env.DASHBOARD_HOST = '0.0.0.0';
  env.DASHBOARD_ENABLED = 'true';
  env.MANUAL = env.MANUAL ?? 'false';

  if (live) {
    // Live cell — do not force demo locks. Operator sets DRY_RUN / keys in Railway.
    console.log('RAILWAY_LIVE=yes — keeping DRY_RUN/SIMULATION/DEMO from local .env (not forcing demo).\n');
    if (env.DEMO_PUBLIC === undefined) env.DEMO_PUBLIC = 'false';
  } else {
    // Safe cloud defaults (public demo)
    env.DRY_RUN = 'true';
    env.SIMULATION_MODE = 'true';
    env.DEMO_PUBLIC = 'true';
  }

  const keys = Object.keys(env).sort();
  if (!keys.length) {
    console.error('No variables found — run npm run init first');
    process.exit(1);
  }

  console.log(`Syncing ${keys.length} variables to Railway…`);
  for (const key of keys) {
    if (key.includes('SECRET') || key === 'CELL_JSON') console.log(`  · ${key}=***`);
    else console.log(`  · ${key}=${env[key]}`);
  }

  const pairs = keys.map((k) => [k, env[k]]);
  for (let i = 0; i < pairs.length; i += 20) {
    railwaySet(pairs.slice(i, i + 20), { skipDeploys: true });
  }

  console.log('\n✓ Railway variables synced (keys skipped by default).');
  if (live) {
    console.log('  LIVE profile — set LP_PRIVATE_KEY + DASHBOARD_PASSWORD in Railway UI if missing.');
  } else {
    console.log('  DEMO profile — Start blocked. Use RAILWAY_LIVE=yes for a live cell sync.');
    console.log('  Set DASHBOARD_PASSWORD manually in Railway if you need UI unlock.');
  }
  console.log('  Then: npm run railway:deploy');
}

main();
