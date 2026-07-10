/**
 * Mirror @i_am_aemon CONTROLLER_WALLET LP book weights onto this node.
 * Controller pubkey is hardcoded in src/constants.js (not env).
 *
 * If controller has ~15% BIF, our targetWeightPct for BIF = 15.
 * Seed toward underweight; propose take-out when we are overweight
 * (they trimmed / we overshot) — leave leaveInPoolPct in the LP.
 */
import { config } from '../config.js';
import { ANSEM_MINT } from '../constants.js';
import { START_LIST, effectiveStartList } from './whitepaper.js';
import { isIndexPool } from './ansem-index.js';
import { buildPortfolio } from './portfolio.js';
import { estimateAnsemInPosition } from './rank-pools.js';
import {
  loadFundPolicy,
  loadPoolPrefs,
  savePoolPrefsBulk,
  defaultTakeOutPct,
  leaveInPoolPct,
} from './pool-prefs.js';

function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function round1(x) {
  return Math.round(num(x) * 10) / 10;
}

function round4(x) {
  return Math.round(num(x) * 1e4) / 1e4;
}

let _ctrlCache = null;
const CTRL_CACHE_MS = 120_000;

/**
 * Controller index LP book: value + weight % + ANSEM per START_LIST pool.
 */
export async function buildControllerBook(opts = {}) {
  const wallet = (
    opts.wallet ||
    config.controllerWallet ||
    config.trackedWallet ||
    ''
  ).trim();
  if (!wallet) {
    return {
      ok: false,
      error: 'CONTROLLER_WALLET unset',
      wallet: null,
      bookValue: 0,
      rows: [],
      topPools: [],
    };
  }

  if (
    !opts.force &&
    !opts.positions &&
    _ctrlCache &&
    _ctrlCache.wallet === wallet &&
    Date.now() - _ctrlCache.at < CTRL_CACHE_MS
  ) {
    return { ..._ctrlCache.book, cached: true };
  }

  let positions = opts.positions;
  if (!positions) {
    try {
      const p = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT, {
        role: 'controller_ro',
        persistLedger: opts.persistLedger !== false,
      });
      positions = p.positions || [];
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        wallet,
        bookValue: 0,
        rows: [],
        topPools: [],
      };
    }
  }

  const ansemMint = config.ansemMint || ANSEM_MINT;
  const byPool = new Map();
  for (const p of positions || []) {
    const addr = p.pool_address || p.pool;
    if (!addr || !isIndexPool(addr)) continue;
    const prev = byPool.get(addr) || { value: 0, fees: 0, count: 0, ansem: 0 };
    prev.value += num(p.position_value_usd);
    prev.fees += num(p.unclaimed_fees_usd);
    prev.count += 1;
    prev.ansem += estimateAnsemInPosition(p, ansemMint);
    byPool.set(addr, prev);
  }

  const bookValue = [...byPool.values()].reduce((s, h) => s + h.value, 0);
  const universe = effectiveStartList(START_LIST);
  const rows = universe.map((n) => {
    const hit = n.pool ? byPool.get(n.pool) : null;
    const valueUsd = hit?.value || 0;
    const weightPct = bookValue > 0 ? (valueUsd / bookValue) * 100 : 0;
    const ansem = round4(hit?.ansem || 0);
    return {
      ticker: n.ticker,
      mint: n.mint || '',
      pool: n.pool || '',
      herd: Boolean(n.herd),
      valueUsd,
      ansem,
      feesUsd: hit?.fees || 0,
      inPool: Boolean(hit && hit.count > 0),
      positionCount: hit?.count || 0,
      weightPct,
      /** Mirror target for the node */
      targetWeightPct: weightPct > 0.05 ? round1(weightPct) : 0,
    };
  });

  rows.sort((a, b) => b.valueUsd - a.valueUsd);
  const topN = Math.max(1, Number(opts.topN || config.nodeActiveLimit || 10) || 10);
  const dustUsd = Number(
    opts.dustUsd ?? loadFundPolicy().controllerDustUsd ?? 1,
  );
  // Simple 10-at-a-time tests: skip controller dust (< ~$1) from active top-N
  const topPools = rows
    .filter((r) => r.inPool && r.valueUsd >= dustUsd)
    .slice(0, topN)
    .map((r) => r.pool);

  const book = {
    ok: true,
    wallet,
    bookValue,
    rows,
    topPools,
    fetched_at: new Date().toISOString(),
  };
  _ctrlCache = { wallet, at: Date.now(), book };
  return book;
}

/**
 * Write controller weight % → poolPrefs.
 * - Meaningful controller weight → target %
 * - Controller dusted/exited + we still hold → mode=hold (leave LP to grow for years)
 * - Never auto-withdraw unless fundPolicy.autoTrimOnControllerExit
 * Does not flip mode=off (operator may keep a stub LP).
 */
export async function syncControllerTargets(opts = {}) {
  const fund = loadFundPolicy();
  if (fund.followController === false && opts.force !== true) {
    return { ok: true, skipped: true, reason: 'followController=false' };
  }

  const ctrl = await buildControllerBook(opts);
  if (!ctrl.ok) {
    return { ok: false, error: ctrl.error, skipped: false };
  }

  const nodeInPools = new Set(opts.nodeInPools || []);
  if (opts.nodePositions) {
    for (const p of opts.nodePositions) {
      const addr = p.pool_address || p.pool;
      if (addr && isIndexPool(addr)) nodeInPools.add(addr);
    }
  }

  const MIN_CTRL_W = 0.5;
  const dustUsd = Number(fund.controllerDustUsd) || 1;
  const patch = {};
  let set = 0;
  let heldGrow = 0;
  let zeroed = 0;
  let cleared = 0;
  const heldGrowTickers = [];

  for (const r of ctrl.rows) {
    if (!r.pool) continue;
    const ctrlDust =
      !r.inPool ||
      r.valueUsd < dustUsd ||
      (r.inPool && r.weightPct > 0 && r.weightPct < MIN_CTRL_W);
    const meaningful = r.inPool && r.valueUsd >= dustUsd && r.weightPct >= MIN_CTRL_W;

    if (meaningful) {
      const tgt = round1(r.weightPct);
      const existing = loadPoolPrefs()[r.pool];
      const patchRow = {
        targetWeightPct: tgt,
        note: `mirror controller ${tgt}%`,
      };
      // If was auto-held for dust, clear back to active when controller rebuilds
      if (
        existing?.mode === 'hold' &&
        /controller dust|leave LP to grow|controller exited/i.test(
          String(existing.note || ''),
        )
      ) {
        patchRow.mode = 'active';
        patchRow.note = `mirror controller ${tgt}% · re-active`;
      }
      patch[r.pool] = patchRow;
      set += 1;
    } else if (nodeInPools.has(r.pool) && ctrlDust) {
      // We hold; controller dusted/exited → leave to grow (default). No withdraw.
      patch[r.pool] = {
        mode: 'hold',
        targetWeightPct: 0,
        note: `controller dusted (~$${dustUsd}) — leave LP to grow`,
      };
      heldGrow += 1;
      if (r.ticker) heldGrowTickers.push(r.ticker);
      zeroed += 1;
    } else if (r.inPool && r.weightPct > 0 && r.weightPct < MIN_CTRL_W) {
      patch[r.pool] = { targetWeightPct: null, note: '' };
      cleared += 1;
    } else {
      patch[r.pool] = { targetWeightPct: null, note: '' };
      cleared += 1;
    }
  }

  const prefs = savePoolPrefsBulk(patch);
  return {
    ok: true,
    skipped: false,
    wallet: ctrl.wallet,
    bookValue: ctrl.bookValue,
    set,
    zeroed,
    heldGrow,
    heldGrowTickers,
    cleared,
    dustUsd,
    autoTrimOnControllerExit: Boolean(fund.autoTrimOnControllerExit),
    topPools: ctrl.topPools,
    prefs,
    controller: ctrl,
    synced_at: new Date().toISOString(),
  };
}

/**
 * Propose take-outs when node weight > controller-mirrored target.
 * Default: OFF — leave LPs to grow for years when controller dusts.
 * Opt in with fundPolicy.autoTrimOnControllerExit=true.
 */
export function proposeControllerTakeOuts(nodeRows, opts = {}) {
  const fund = loadFundPolicy();
  if (!fund.autoTrimOnControllerExit && opts.force !== true) {
    return [];
  }
  const takePct =
    opts.takePct != null
      ? Number(opts.takePct)
      : fund.takeOutDefaultPct ?? defaultTakeOutPct();
  const leavePct = fund.leaveInPoolPct ?? leaveInPoolPct();
  const limit = Math.max(1, Number(opts.limit) || 8);
  const gapFloor = Number(opts.gapFloor) || -0.5;

  return (nodeRows || [])
    .filter(
      (r) =>
        r.inPool &&
        r.gapPct != null &&
        r.gapPct < gapFloor &&
        r.mode !== 'hold',
    )
    .sort((a, b) => (a.gapPct || 0) - (b.gapPct || 0))
    .slice(0, limit)
    .map((r) => ({
      ticker: r.ticker,
      pool: r.pool,
      mint: r.mint,
      gapPct: r.gapPct,
      weightPct: r.weightPct,
      targetWeightPct: r.targetWeightPct,
      suggestedTakeOutPct: takePct,
      leaveInPoolPct: leavePct,
      reason:
        r.targetWeightPct === 0
          ? 'controller exited / 0% — trim leave stub'
          : `overweight vs controller ${Number(r.targetWeightPct).toFixed(0)}% (we ${Number(r.weightPct).toFixed(0)}%)`,
      links: {
        meteora: `https://app.meteora.ag/pools/${r.pool}`,
        fund: `/pool?pool=${encodeURIComponent(r.pool)}&action=take_out`,
      },
    }));
}
