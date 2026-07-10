/**
 * Main ANSEM Index universe — TOKEN–ANSEM pools this node seeds and tracks.
 * Strategic pulls only touch this list (never the full Meteora catalog).
 * When HERD_POOL is live, HERD–ANSEM is always in-index (required to run a node).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  NODE_MIN_USD,
  INDEX_TOKEN_SYMBOL,
  INDEX_TOKEN_MINT,
  INDEX_POOL_ADDRESS,
  isHerdPoolLive,
} from '../constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');

function readCellField(key) {
  try {
    const p = path.join(ROOT, 'cell.json');
    if (!fs.existsSync(p)) return '';
    const cell = JSON.parse(fs.readFileSync(p, 'utf8'));
    const v = cell?.[key];
    return v != null && String(v).trim() !== '' ? String(v).trim() : '';
  } catch {
    return '';
  }
}

/** Canonical start-list constituents (~25 TOKEN–ANSEM DAMM v2 pools). */
export const START_LIST = [
  { ticker: 'BIF', mint: '62YE1d4sRArBQzR5bdbxsx2k9LV3MdPV4xMC4Di2pump', pool: '74bgudzA62dkB4oGfhR8TUmd9dphVsrqJdFoW4xnWRX2', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'LIFE', mint: 'J8cXU1EFi1SCTJ9XYpBnjqQ7nVLETNLFaRaHCP3RLiFE', pool: 'B86oFNeAXyt1TKVM9S2qe6JPE9rV7EVD9rqbvMPnZx7Y', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'CASHCAT', mint: '3grmULXrnQyN2A5LFStKFeSQsWvZjzNDsDVVLknFpump', pool: '5gyd9HHpyQ4XdJUEm2DTaugXQBQgU315Cy7LKhGDLEUy', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'RIF', mint: 'G7zeUXZzTUa8iXeUcW5J8oK9zoK4WY75fzmwFMe5pump', pool: '9jnrVQbWac1g7cReQ1B6XzHu37E7bAG8xeu89zndmF4', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'CATWIF', mint: '5pYB12kEhfhSFXJjZ7JtyqDpt6uUqhsF6iu6Ee9spump', pool: 'Fw1HfwTsCrsSMZ5rVofC8sZEPw2dJepWvT95FFpkysim', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'ANSUM', mint: 'GaZb3DE2U3Jcjx7ddAVwobsBKnCaDoJWLbzTvJYhpump', pool: '4n5vr17BX8f2FvvVfR8yWR8Xwx6yjVykw6kVmyAXm6Yv', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'aemon', mint: 'G6ykv1kozjKFjrqs6cAHSmRgeD12EVGRL78AkHsqZTpz', pool: '8zYMVEaZCbHqKvJXZRQ2jXnrQeC6UehDBMde1JhfPD6x', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'manlet', mint: 'DdPrHYqM8Ueovnk9kAnAgoGhswkuaTqmxcoZzU3Zpump', pool: 'GRvt13cYfQN2yW8MKBDhytwLxY1FvMbCVPsKog3Q6a1D', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'IMG', mint: 'znv3FZt2HFAvzYf5LxzVyryh3mBXWuTRRng25gEZAjh', pool: 'CPFU1K2Wv6dJ3La7fzn9xHJXyxheneFGM2qoo9jDFSrX', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'BTCBANK', mint: '9s96G11xGsHczudfJqKQzQxzvubQgJXSySJ1wRgxpump', pool: 'BCPgWK8diJk1de6DNpLymbFgQfzEq1M1wthQVRJfLEAY', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'world', mint: 'FMqh9mqR6drPZqqW6wPqLHxX4rqNDWGhYLaMfoaJpump', pool: 'EsbAi8SCHgUEWXWYqDRjMPqvEKqxw9Y7YGsGZ1kVTQ5j', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'BABYANSEM', mint: 'DLvuaz18bKnh1hEaCZsZ5NgJi7wYFm5RvgZVA2M5pump', pool: '5Js3kkt49dvnY8ep9R9vNDNycHGvHhT5NWEoKuXLcNhE', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'Jotchua', mint: 'BcHEaaTCvycPwwsJ9yQTXdHP9X2gCLkznDbZ8VySpump', pool: 'EjrSeTvU5UfruHXf44ETUSJ1HL83CcWR7k48oCyccXxT', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'SCAM', mint: '6AVAUKa9uxQpruHZUinFECpXEh1usRVtzQWK8N2wpump', pool: 'EHbZGrXhkvXpLMazvGhHUAFD48DgUMhtYQ1trF3eLGWK', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'VINE', mint: '6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump', pool: '7wS9mtdZfJ56CRmzdugxZPSMSzkaxdGgwVNRuTALGhnQ', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'MET', mint: 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', pool: '5xivWhJiSXMHRTWKimkCxZiQdwS2QhAbUrtKHQtF2pqJ', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'TOESCOIN', mint: '6ehEcTMCc85aNF4x9CWx8HuvWGhxQtvKdhKVf2HDpump', pool: 'HESE9MkqPvbG8vTrW1waThrqS4nA8C9PQKoLvXm2EGKt', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'DADDY', mint: '4Cnk9EPnW5ixfLZatCPJjDB1PUtcRpVVgTQukm9epump', pool: 'J5ygtzpk5gxEmn1FXxi3UMYpVsQi8ZpTuHNX6923B4Fh', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'BIH', mint: '35zP1UMDVG89BZBk8kg771Cfj7h9WzbYVwdgZmVwpump', pool: 'A77pPPT1rXUN8oRMqSgzMhz4muhx4KdSbTb1V1LTEekj', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'WLFI', mint: 'WLFinEv6ypjkczcS83FZqFpgFZYwQXutRbxGe7oC16g', pool: 'BTcAaWfxJkn2zdEjvKksBg6RvyGMNW4hVbFv9G6KkLdg', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'WYNN', mint: '9E2Q4KKxLS5Y4bu6RKvjg5wQ2kzaLkiVsMt7zwMZpump', pool: '3n5noqZByDWRUx4yr4AkzoPzrSYc1n7vG3jt16XB7smV', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'NORMIE', mint: '4MrsXQzaosYNyFd4wKDvgnC5xRtRqgXRrijFTGj9pump', pool: '6UNCwJNw5zmYCUF4W8d8mk2uDm44PMFfzGnznv6oG9hV', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'Fartcoin', mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', pool: '92hXQu4BzHymaQNo5nXjwXS14jApmLgWutWSoAak7HbX', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: 'Bank', mint: '2jCt3hj9vd7YpV7Sr3VA5nk3tdSpJtZezeoJXW4Xpump', pool: '7qcRBKAyiuFXeK68RMbYtHBzQcPpSjuqyEV13ER4CWEz', minUsd: NODE_MIN_USD, status: 'queued' },
  { ticker: '$WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', pool: 'HesbDEM6vAVpScMiZbVUzWkNt9BHB7jp15HcDEuz7XXY', minUsd: NODE_MIN_USD, status: 'queued' },
];

export const INDEX_CONSTITUENT_COUNT = START_LIST.length;

/** Smoke / $10 capital: active Pass-1 universe size (full START_LIST stays the index gate). */
export const NODE_ACTIVE_LIMIT_DEFAULT = 10;

/** APE lane: pair younger than this many minutes jumps the seed queue. */
export const APE_MAX_AGE_MINUTES_DEFAULT = 15;

export const APE_MIN_LIQ_USD_DEFAULT = 500;

const _pools = new Set(START_LIST.map((n) => n.pool).filter(Boolean));
const _mints = new Set(START_LIST.map((n) => n.mint).filter(Boolean));
const _byPool = new Map(START_LIST.filter((n) => n.pool).map((n) => [n.pool, n]));
const _byTicker = new Map(START_LIST.map((n) => [n.ticker, n]));
const _byMint = new Map(START_LIST.filter((n) => n.mint).map((n) => [n.mint, n]));

/** Resolve live HERD–ANSEM pool address from env / cell / constants. */
export function resolveHerdPool() {
  return String(
    process.env.HERD_POOL ||
      process.env.INDEX_POOL_ADDRESS ||
      readCellField('herdPool') ||
      INDEX_POOL_ADDRESS ||
      '',
  ).trim();
}

/** Resolve $HERD mint when set. */
export function resolveHerdMint() {
  return String(
    process.env.HERD_MINT ||
      process.env.INDEX_TOKEN_MINT ||
      readCellField('indexTokenMint') ||
      INDEX_TOKEN_MINT ||
      '',
  ).trim();
}

/**
 * Synthetic start-list row for HERD–ANSEM when the pool is live.
 * Every node should cover this pool (v2).
 */
export function herdPoolRow() {
  const pool = resolveHerdPool();
  if (!isHerdPoolLive(pool)) return null;
  const mint = resolveHerdMint();
  const ticker = String(
    process.env.HERD_SYMBOL || process.env.INDEX_TOKEN_SYMBOL || INDEX_TOKEN_SYMBOL || 'HERD',
  ).trim() || 'HERD';
  return {
    ticker,
    mint: mint || '',
    pool,
    minUsd: NODE_MIN_USD,
    status: 'herd',
    herd: true,
  };
}

/**
 * START_LIST plus live HERD–ANSEM (prepended). Use for ranking / seed / fund boards.
 */
export function effectiveStartList(list = START_LIST) {
  const herd = herdPoolRow();
  if (!herd) return list;
  if (list.some((n) => n.pool === herd.pool || n.ticker === herd.ticker)) {
    return list.map((n) =>
      n.pool === herd.pool || n.ticker === herd.ticker ? { ...n, ...herd, herd: true } : n,
    );
  }
  return [herd, ...list];
}

export function indexPoolSet() {
  const herd = resolveHerdPool();
  if (isHerdPoolLive(herd)) {
    const s = new Set(_pools);
    s.add(herd);
    return s;
  }
  return _pools;
}

export function indexMintSet() {
  const mint = resolveHerdMint();
  if (mint && mint.length >= 32) {
    const s = new Set(_mints);
    s.add(mint);
    return s;
  }
  return _mints;
}

export function isIndexPool(addr) {
  if (!addr) return false;
  const a = String(addr);
  if (_pools.has(a)) return true;
  const herd = resolveHerdPool();
  return isHerdPoolLive(herd) && a === herd;
}

export function isIndexMint(mint) {
  if (!mint) return false;
  const m = String(mint);
  if (_mints.has(m)) return true;
  const herdMint = resolveHerdMint();
  return Boolean(herdMint && herdMint.length >= 32 && m === herdMint);
}

export function isIndexTicker(ticker) {
  if (!ticker) return false;
  const t = String(ticker);
  if (_byTicker.has(t)) return true;
  const herd = herdPoolRow();
  return Boolean(herd && t === herd.ticker);
}

/** Position is in-index if its pool_address is on START_LIST (or live HERD pool). */
export function isIndexPosition(pos) {
  if (!pos) return false;
  const pool = pos.pool_address || pos.pool || '';
  if (pool && isIndexPool(pool)) return true;
  const mint =
    pos.constituent_token?.address ||
    pos.token_x?.address ||
    pos.token_y?.address ||
    pos.mint ||
    '';
  return mint ? isIndexMint(mint) : false;
}

export function filterToIndex(positions = []) {
  return (positions || []).filter(isIndexPosition);
}

export function findConstituent(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const hit = _byPool.get(k) || _byTicker.get(k) || _byMint.get(k);
  if (hit) return hit;
  const herd = herdPoolRow();
  if (!herd) return null;
  if (k === herd.pool || k === herd.ticker || (herd.mint && k === herd.mint)) return herd;
  return null;
}

export function startListFloorUsd(list = START_LIST) {
  return list.reduce((s, n) => s + (n.minUsd ?? NODE_MIN_USD), 0);
}

/**
 * Vision one-liner for UI / docs.
 * Example: $10 SOL you control → plan → Phantom approve → ANSEM index LPs.
 */
export const INDEX_VISION = {
  headline: 'You keep the key. Capital seeds only the ANSEM index.',
  flow: 'SOL you control → keep operating reserve → buy ANSEM → cover ranked TOKEN–ANSEM pools → join HERD–ANSEM when live → deepen (HODL, only add)',
  not: 'Not a custodian. Not an auto-signer. Not a scrape of all Meteora pools.',
  smokeTest:
    'Example: ~$25+ SOL → top NODE_ACTIVE_LIMIT HODL tickets (≥5 ANSEM dual) then only add. Full 25-list is the index gate. v2: HERD_POOL pins HERD–ANSEM for every node.',
  copycat:
    'CONTROLLER_WALLET = hardcoded @i_am_aemon map book (constants.js). LP_WALLET = node hands. Fees claim/route only on node LPs. HERD_POOL = required join when live.',
};
