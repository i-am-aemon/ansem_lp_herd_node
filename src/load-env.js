import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
/** Optional legacy override if present — prefer single .env for new setups. */
export const SECRETS_ENV_PATH = path.join(ROOT, 'cell_secrets.env');
export const CELL_JSON_PATH = path.join(ROOT, 'cell.json');
export const ENV_PATH = path.join(ROOT, '.env');

/** Load .env (primary). If an old cell_secrets.env exists, it still overrides. */
export function loadEnvFiles() {
  if (process.env.CELL_JSON && !fs.existsSync(CELL_JSON_PATH)) {
    try {
      const parsed = JSON.parse(process.env.CELL_JSON);
      fs.writeFileSync(CELL_JSON_PATH, JSON.stringify(parsed, null, 2) + '\n');
    } catch (e) {
      console.warn('[load-env] CELL_JSON hydrate failed:', e.message);
    }
  }
  dotenv.config({ path: ENV_PATH });
  if (fs.existsSync(SECRETS_ENV_PATH)) {
    dotenv.config({ path: SECRETS_ENV_PATH, override: true });
  }
}

loadEnvFiles();
