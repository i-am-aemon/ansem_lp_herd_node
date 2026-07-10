/**
 * Tick summary grow-file (no database).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TICKS_PATH = path.join(ROOT, 'logs', 'ticks.jsonl');

function ensureLogs() {
  const dir = path.join(ROOT, 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function appendTickRecord(record) {
  ensureLogs();
  const line =
    JSON.stringify({ ...record, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(TICKS_PATH, line);
}

export function countDryRunTicks() {
  ensureLogs();
  if (!fs.existsSync(TICKS_PATH)) return 0;
  const lines = fs.readFileSync(TICKS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  let count = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec.status === 'dry_run' || rec.dry_run === true || rec.dryRun === true) count += 1;
    } catch {
      /* skip */
    }
  }
  return count;
}

export function getRecentTicks(n = 10) {
  ensureLogs();
  if (!fs.existsSync(TICKS_PATH)) return [];
  const lines = fs.readFileSync(TICKS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-n)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export { TICKS_PATH };
