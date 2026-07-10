#!/usr/bin/env node
/**
 * Alignment check — prove the public/production surface matches the contract:
 * Setup → Config → Run, tx log in SQLite (+ jsonl mirror), no Postgres/stub ledger.
 * Exit 0 = ok; 1 = fail.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const fails = [];
const warns = [];

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  fails.push(msg);
  console.log(`✗ ${msg}`);
}
function warn(msg) {
  warns.push(msg);
  console.log(`⚠ ${msg}`);
}

function mustExist(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) fail(`missing ${rel}`);
  else ok(rel);
  return p;
}

// 1. No stub ledger / Postgres layer
if (fs.existsSync(path.join(ROOT, 'src/db.js'))) fail('src/db.js stub still present — remove it');
else ok('no src/db.js stub');
if (fs.existsSync(path.join(ROOT, 'src/db'))) fail('src/db/ still present — remove Postgres/SQLite ledger drivers');
else ok('no src/db/ ledger drivers');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.dependencies?.pg) fail('package.json still depends on pg');
else ok('no pg dependency');

// 2. Orphan dashboard pages must stay gone
for (const dead of [
  'src/dashboard/pages-fund.js',
  'src/dashboard/pages-manage.js',
  'src/dashboard/pages-config.js',
  'src/dashboard/pages-seed.js',
  'src/dashboard/pages-log.js',
  'src/lib/run-status.js',
  'src/ai/advisor.js',
]) {
  if (fs.existsSync(path.join(ROOT, dead))) fail(`dead module still present: ${dead}`);
  else ok(`removed ${dead}`);
}

// 3. Logger = tx.sqlite + mirrors
const loggerSrc = fs.readFileSync(mustExist('src/logger.js'), 'utf8');
if (!loggerSrc.includes('tx.sqlite') || !loggerSrc.includes('CREATE TABLE IF NOT EXISTS txs')) {
  fail('logger.js missing tx.sqlite / txs table');
} else ok('logger.js → logs/tx.sqlite (txs)');
if (!loggerSrc.includes('export function queryTx') || !loggerSrc.includes('export function getTxBackend')) {
  fail('logger.js missing queryTx / getTxBackend');
} else ok('logger queryTx + getTxBackend');

// 4. Allowed log surfaces
const logsDir = path.join(ROOT, 'logs');
const allowedJsonl = new Set(['events.jsonl', 'ticks.jsonl', 'tx.jsonl']);
if (fs.existsSync(logsDir)) {
  const jsonl = fs.readdirSync(logsDir).filter((f) => f.endsWith('.jsonl'));
  const extra = jsonl.filter((f) => !allowedJsonl.has(f));
  if (extra.length) fail(`unexpected JSONL logs: ${extra.join(', ')}`);
  else ok(`jsonl surfaces ok (${jsonl.join(', ') || 'none yet'})`);
  if (fs.existsSync(path.join(logsDir, 'tx.sqlite'))) ok('logs/tx.sqlite present');
  else warn('logs/tx.sqlite not created yet (first /run or tick will create it)');
} else {
  warn('logs/ missing — created on first tick');
}

// 5. Live operator routes
const serverSrc = fs.readFileSync(mustExist('src/dashboard/server.js'), 'utf8');
for (const route of ['/run', '/api/tx', '/api/gates_status', '/whitepaper', '/ansem']) {
  if (!serverSrc.includes(route)) fail(`server missing ${route}`);
  else ok(`route ${route}`);
}
if (!serverSrc.includes("Location: '/run'") && !serverSrc.includes('Location: "/run"')) {
  warn('no /run redirects detected for legacy paths');
} else ok('legacy paths redirect toward /run');

const layoutSrc = fs.readFileSync(mustExist('src/dashboard/layout.js'), 'utf8');
for (const label of ['Setup', 'Index', 'Config', 'Run', 'Whitepaper']) {
  if (!layoutSrc.includes(`label: '${label}'`)) fail(`nav missing ${label}`);
  else ok(`nav ${label}`);
}

// 6. Policy + seed ranking still wired
const policySrc = fs.readFileSync(mustExist('src/lib/node-policy.js'), 'utf8');
if (!policySrc.includes('NODE_POLICY_VERSION') || !policySrc.includes('buildGatesStatus')) {
  fail('node-policy missing version / gates');
} else ok('node-policy banner + gates');

const rankSrc = fs.readFileSync(mustExist('src/lib/rank-pools.js'), 'utf8');
if (!rankSrc.includes('tracked_top10') || !rankSrc.includes('dip24')) {
  fail('rank-pools missing tracked_top10 / dip24');
} else ok('seed universe tracked_top10 · dip24');
if (rankSrc.includes('scoreGoodButDown')) fail('deprecated scoreGoodButDown still present');
else ok('no deprecated scoreGoodButDown');

const censusSrc = fs.readFileSync(mustExist('src/lib/wallet-census.js'), 'utf8');
if (!censusSrc.includes('indexDust')) fail('wallet-census missing indexDust');
else ok('wallet census (dust→LP)');

// 7. Secrets story is .env-first
if (fs.existsSync(path.join(ROOT, 'cell_secrets.env.example'))) {
  fail('cell_secrets.env.example still present — use .env.example only');
} else ok('no cell_secrets.env.example');
mustExist('.env.example');

// 8. Docker image must not reference deleted secrets example
const dockerfile = fs.readFileSync(mustExist('Dockerfile'), 'utf8');
if (dockerfile.includes('cell_secrets.env.example')) {
  fail('Dockerfile still COPYs cell_secrets.env.example');
} else ok('Dockerfile .env-first (no cell_secrets.env.example)');
if (dockerfile.includes('IMPERIAL') || dockerfile.includes('pg')) {
  fail('Dockerfile references removed Imperial/pg surface');
} else ok('Dockerfile free of Imperial/pg');

console.log('');
if (fails.length) {
  console.log(`ALIGNMENT FAIL · ${fails.length} issue(s)`);
  process.exit(1);
}
console.log(`ALIGNMENT OK${warns.length ? ` · ${warns.length} warn(s)` : ''}`);
process.exit(0);
