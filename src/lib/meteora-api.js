/**
 * Meteora DAMM v2 Data API client (https://damm-v2.datapi.meteora.ag)
 * Docs: https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview
 *
 * Rate limit: 10 RPS. Memory TTL + on-disk cache under data/meteora/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { METEORA_DAMM_V2_BASE } from '../constants.js';
import { START_LIST, isIndexPool } from './ansem-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const DISK_DIR = path.join(ROOT, 'data', 'meteora');

const mem = new Map();

const TTL = {
  pool: 60_000,
  positions: 20_000,
  protocol: 120_000,
  diskPool: 15 * 60_000,
  diskBook: 5 * 60_000,
};

function ensureDisk() {
  if (!fs.existsSync(DISK_DIR)) fs.mkdirSync(DISK_DIR, { recursive: true });
}

function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}

function memSet(key, value, ttlMs) {
  mem.set(key, { value, expires: Date.now() + ttlMs });
}

function diskPath(name) {
  return path.join(DISK_DIR, name);
}

function diskRead(name, maxAgeMs) {
  try {
    const p = diskPath(name);
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    if (maxAgeMs != null && Date.now() - st.mtimeMs > maxAgeMs) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function diskWrite(name, value) {
  try {
    ensureDisk();
    const payload = {
      fetched_at: new Date().toISOString(),
      source: METEORA_DAMM_V2_BASE,
      ...value,
    };
    fs.writeFileSync(diskPath(name), JSON.stringify(payload, null, 2) + '\n');
    return payload;
  } catch {
    return value;
  }
}

/**
 * Low-level GET against DAMM v2 datapi.
 * @param {string} apiPath — e.g. `/pools/{addr}`
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]
 * @param {string} [opts.diskName] — also persist under data/meteora/
 * @param {number} [opts.diskMaxAgeMs]
 * @param {boolean} [opts.allowStaleDisk] — if network fails, return stale disk
 */
export async function meteoraGet(apiPath, opts = {}) {
  const ttlMs = opts.ttlMs ?? 20_000;
  const memKey = `get:${apiPath}`;
  const cached = memGet(memKey);
  if (cached) return cached;

  if (opts.diskName) {
    const disk = diskRead(opts.diskName, opts.diskMaxAgeMs ?? null);
    if (disk && opts.preferDisk) {
      memSet(memKey, disk, ttlMs);
      return disk;
    }
  }

  const url = `${METEORA_DAMM_V2_BASE}${apiPath}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ansem-private-node/1.0',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Meteora ${res.status} ${apiPath}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    memSet(memKey, data, ttlMs);
    if (opts.diskName) diskWrite(opts.diskName, { path: apiPath, data });
    return data;
  } catch (e) {
    if (opts.diskName && opts.allowStaleDisk !== false) {
      const stale = diskRead(opts.diskName, null);
      if (stale) {
        memSet(memKey, stale.data ?? stale, Math.min(ttlMs, 10_000));
        return stale.data ?? stale;
      }
    }
    throw e;
  }
}

export function flattenOpenPositions(raw) {
  const data = raw?.data ?? raw;
  if (!Array.isArray(data) || data.length === 0) return [];
  const first = data[0];
  // Grouped-by-pool shape
  if (first && Array.isArray(first.positions)) {
    return data.flatMap((g) =>
      g.positions.map((p) => ({
        ...p,
        pool_address: p.pool_address || g.pool_address,
        pool_name: p.pool_name || g.pool_name || p.pool_name,
      })),
    );
  }
  // Flat position list (old-book / some wallets)
  return data;
}

/** GET /wallets/{wallet}/open_positions */
export async function fetchOpenPositions(wallet, opts = {}) {
  if (!wallet) throw new Error('wallet required');
  const raw = await meteoraGet(`/wallets/${wallet}/open_positions`, {
    ttlMs: opts.ttlMs ?? TTL.positions,
    diskName: opts.persist ? `wallet_${wallet}_open_positions.json` : undefined,
    diskMaxAgeMs: TTL.diskBook,
    allowStaleDisk: true,
  });
  // diskWrite wraps {path,data} — unwrap if needed
  const body = raw?.data && raw?.path ? raw.data : raw;
  const positions = flattenOpenPositions(body);
  return {
    ...body,
    positions,
    total_positions: body.total_positions ?? positions.length,
    total_pools:
      body.total_pools ?? new Set(positions.map((p) => p.pool_address).filter(Boolean)).size,
    fetched_at: new Date().toISOString(),
  };
}

/** GET /pools/{address} */
export async function fetchPool(address, opts = {}) {
  if (!address) throw new Error('pool address required');
  const raw = await meteoraGet(`/pools/${address}`, {
    ttlMs: opts.ttlMs ?? TTL.pool,
    diskName: `pool_${address}.json`,
    diskMaxAgeMs: TTL.diskPool,
    allowStaleDisk: true,
  });
  return raw?.data && raw?.path ? raw.data : raw;
}

/** Single pool TVL (USD). Prefers disk/mem cache from fetchPool. */
export async function getPoolTvlUsd(address) {
  if (!address) return null;
  try {
    const pool = await fetchPool(address);
    const tvl = Number(pool?.tvl ?? pool?.data?.tvl);
    return Number.isFinite(tvl) && tvl > 0 ? tvl : null;
  } catch {
    return null;
  }
}

/**
 * Batch TVL lookups (light concurrency — Meteora ~10 RPS).
 * @param {string[]} addresses
 * @returns {Promise<Map<string, number>>}
 */
export async function getPoolsTvlUsd(addresses) {
  const map = new Map();
  const unique = [...new Set((addresses || []).filter(Boolean))];
  const concurrency = 4;
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (addr) => [addr, await getPoolTvlUsd(addr)]),
    );
    for (const [addr, tvl] of results) {
      if (tvl != null) map.set(addr, tvl);
    }
  }
  return map;
}

/** Slim pool metrics for fund / ops UI */
export function summarizePool(pool) {
  if (!pool || typeof pool !== 'object') return null;
  return {
    address: pool.address,
    name: pool.name,
    tvl: Number(pool.tvl) || 0,
    current_price: Number(pool.current_price) || 0,
    volume_24h: Number(pool.volume?.['24h']) || 0,
    fees_24h: Number(pool.fees?.['24h']) || 0,
    fee_tvl_ratio_24h: Number(pool.fee_tvl_ratio?.['24h']) || 0,
    base_fee_pct: Number(pool.pool_config?.base_fee_pct) || null,
    is_blacklisted: Boolean(pool.is_blacklisted),
    token_x: pool.token_x
      ? {
          address: pool.token_x.address,
          symbol: pool.token_x.symbol,
          price: pool.token_x.price,
        }
      : null,
    token_y: pool.token_y
      ? {
          address: pool.token_y.address,
          symbol: pool.token_y.symbol,
          price: pool.token_y.price,
        }
      : null,
    appUrl: pool.address ? `https://app.meteora.ag/pools/${pool.address}` : null,
    poolUrl: pool.address ? `https://app.meteora.ag/pools/${pool.address}` : null,
  };
}

/**
 * Fetch + cache start-list pool metrics (rate-limit friendly).
 * @param {Array<{pool?:string,ticker?:string}>} [list]
 */
export async function syncStartListPools(list = START_LIST, opts = {}) {
  const delayMs = opts.delayMs ?? 120; // stay under 10 RPS
  const out = [];
  const errors = [];
  // Strategic pull: only ANSEM index constituents — never browse /pools catalog
  const targets = (list || []).filter((row) => row.pool && isIndexPool(row.pool));
  for (const row of targets) {
    const addr = row.pool;
    try {
      const pool = await fetchPool(addr);
      const summary = summarizePool(pool);
      out.push({
        ticker: row.ticker,
        mint: row.mint,
        pool: addr,
        ...summary,
      });
    } catch (e) {
      errors.push({
        ticker: row.ticker,
        pool: addr,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  const book = diskWrite('start_list_pools.json', {
    count: out.length,
    index_only: true,
    pools: out,
    errors,
  });
  return book;
}

/** Read last synced start-list pool cache (may be stale). */
export function loadCachedStartListPools() {
  const raw = diskRead('start_list_pools.json', null);
  if (!raw) return null;
  return {
    fetched_at: raw.fetched_at,
    count: raw.count ?? raw.pools?.length ?? 0,
    pools: raw.pools || [],
    errors: raw.errors || [],
    byPool: Object.fromEntries((raw.pools || []).map((p) => [p.pool || p.address, p])),
    byTicker: Object.fromEntries((raw.pools || []).map((p) => [p.ticker, p])),
  };
}

/**
 * Ensure start-list cache exists / is fresh enough; refresh if missing or old.
 */
export async function ensureStartListPoolCache(maxAgeMs = TTL.diskPool) {
  const existing = diskRead('start_list_pools.json', maxAgeMs);
  if (existing?.pools?.length) {
    return loadCachedStartListPools();
  }
  await syncStartListPools();
  return loadCachedStartListPools();
}

export function meteoraCacheStatus() {
  ensureDisk();
  const files = fs.existsSync(DISK_DIR)
    ? fs.readdirSync(DISK_DIR).filter((f) => f.endsWith('.json'))
    : [];
  const start = loadCachedStartListPools();
  return {
    dir: DISK_DIR,
    files: files.length,
    startList: start
      ? { fetched_at: start.fetched_at, count: start.count }
      : null,
    base: METEORA_DAMM_V2_BASE,
    docs: 'https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview',
  };
}

export { DISK_DIR, TTL as METEORA_TTL };
