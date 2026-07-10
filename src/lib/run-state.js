/**
 * Persist whether Start is armed so Railway/local redeploy can resume.
 * File: data/run-state.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const STATE_PATH = path.join(ROOT, 'data', 'run-state.json');

export function readRunState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      return { running: false, feeBot: false, seed: false, at: null };
    }
    const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      running: Boolean(j.running),
      feeBot: Boolean(j.feeBot),
      seed: j.seed !== false,
      at: j.at || null,
      operatorMode: j.operatorMode || null,
    };
  } catch {
    return { running: false, feeBot: false, seed: false, at: null };
  }
}

export function writeRunState(patch = {}) {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cur = readRunState();
    const next = {
      ...cur,
      ...patch,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
    return next;
  } catch (e) {
    console.warn('[run-state] write failed:', e?.message || e);
    return readRunState();
  }
}

export function clearRunState() {
  return writeRunState({ running: false, feeBot: false, seed: false });
}
