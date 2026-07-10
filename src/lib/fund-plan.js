/**
 * Fund control planner — book snapshot + take_out / close plans.
 * Never signs; Phantom (or operator) approves each step.
 */
import { config } from '../config.js';
import { ANSEM_MINT, OLD_BOOK_WALLET, INDEX_TOKEN_SYMBOL, isHerdPoolLive } from '../constants.js';
import { START_LIST, SOL_RESERVE, PAIR_MIN_ANSEM, effectiveStartList } from './whitepaper.js';
import { findConstituent, isIndexPool, resolveHerdPool, resolveHerdMint } from './ansem-index.js';
import { buildPortfolio } from './portfolio.js';
import { getSolBalance, getTokenBalanceRaw } from '../adapters/solana.js';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  loadPoolPrefs,
  loadQueuePrefs,
  loadFundPolicy,
  prefForRow,
  resolveRedirectTarget,
  sumTargetWeights,
  savePoolPref,
  cappedTakeOutPct,
} from './pool-prefs.js';
import {
  ensureStartListPoolCache,
  loadCachedStartListPools,
  meteoraCacheStatus,
} from './meteora-api.js';
import { createMeteoraAdapter } from '../adapters/meteora.js';

async function mintDecimals(mintStr) {
  try {
    const conn = new Connection(config.rpcUrl, 'confirmed');
    const supply = await conn.getTokenSupply(new PublicKey(mintStr), 'confirmed');
    return supply.value.decimals;
  } catch {
    return 6;
  }
}

async function tokenUiBalance(owner, mint) {
  if (!owner || !mint) return 0;
  const raw = await getTokenBalanceRaw(owner, mint);
  const dec = await mintDecimals(mint);
  return Number(raw) / 10 ** dec;
}

function findStartRow(poolOrTicker) {
  const key = String(poolOrTicker || '').trim();
  if (!key) return null;
  return (
    findConstituent(key) ||
    START_LIST.find((n) => n.pool === key || n.ticker === key) || {
      ticker: key.slice(0, 8),
      pool: key,
      mint: '',
    }
  );
}

function positionValueForPool(positions, poolAddr) {
  let value = 0;
  let fees = 0;
  let count = 0;
  for (const p of positions) {
    if (p.pool_address !== poolAddr) continue;
    value += Number(p.position_value_usd) || 0;
    fees += Number(p.unclaimed_fees_usd) || 0;
    count += 1;
  }
  return { value, fees, count };
}

/**
 * Build LP book rows with current weight, target, gap.
 */
export function buildBookRows(
  positions = [],
  prefs = loadPoolPrefs(),
  queuePrefs = loadQueuePrefs(),
  poolMetricsByPool = {},
) {
  const universe = effectiveStartList(START_LIST);
  const rows = universe.map((n) => {
    const hit = n.pool ? positionValueForPool(positions, n.pool) : { value: 0, fees: 0, count: 0 };
    const pref = prefForRow(n, prefs, queuePrefs);
    const met = (n.pool && poolMetricsByPool[n.pool]) || {};
    return {
      ticker: n.ticker,
      mint: n.mint || '',
      pool: n.pool || '',
      herd: Boolean(n.herd),
      valueUsd: hit.value,
      feesUsd: hit.fees,
      inPool: hit.count > 0,
      positionCount: hit.count,
      mode: pref.mode,
      pin: pref.pin || Boolean(n.herd),
      priority: pref.priority,
      targetWeightPct: pref.targetWeightPct,
      redirectTo: pref.redirectTo,
      takeOutDefaultPct: pref.takeOutDefaultPct ?? null,
      seedNew: pref.seedNew,
      holdExisting: pref.holdExisting,
      excluded: pref.excluded,
      weightPct: 0,
      gapPct: null,
      // Live Meteora datapi pool metrics (local cache)
      poolTvl: met.tvl ?? null,
      poolVolume24h: met.volume_24h ?? null,
      poolFees24h: met.fees_24h ?? null,
      poolFeeTvlRatio24h: met.fee_tvl_ratio_24h ?? null,
      poolBaseFeePct: met.base_fee_pct ?? null,
      poolBlacklisted: met.is_blacklisted ?? false,
    };
  });

  const bookValue = rows.reduce((s, r) => s + r.valueUsd, 0);
  for (const r of rows) {
    r.weightPct = bookValue > 0 ? (r.valueUsd / bookValue) * 100 : 0;
    if (r.targetWeightPct != null) {
      r.gapPct = r.targetWeightPct - r.weightPct;
    }
  }

  rows.sort((a, b) => {
    const ga = a.gapPct != null ? a.gapPct : -1e9;
    const gb = b.gapPct != null ? b.gapPct : -1e9;
    if (ga !== gb) return gb - ga; // most underweight first
    return b.valueUsd - a.valueUsd;
  });

  return { bookValue, rows, targetSumPct: sumTargetWeights(prefs) };
}

const BOOK_PIE_COLORS = [
  '#c4a574',
  '#5b8def',
  '#3d9a6a',
  '#9b7bb8',
  '#c45c5c',
  '#8b8b93',
  '#d4a017',
  '#4a9ea0',
  '#b87b9b',
  '#6a8f4e',
  '#7a7a9a',
  '#a07050',
];

function feeSplitPie(fs = config.feeSplit) {
  return [
    { id: 'ansem_send', label: 'Buy ANSEM', pct: (fs.ansemSend || 0) * 100, color: '#c4a574' },
    { id: 'ansem_hold', label: 'Hold ANSEM', pct: (fs.ansemHold || 0) * 100, color: '#a08050' },
    { id: 'index_burn', label: 'Burn index', pct: (fs.indexBurn || 0) * 100, color: '#c45c5c' },
    { id: 'aemon_donate', label: 'Donate aemon', pct: (fs.aemonDonate || 0) * 100, color: '#3d9a6a' },
    { id: 'reserve', label: 'Reserve', pct: (fs.reserve || 0) * 100, color: '#8b8b93' },
    { id: 'reinvest', label: 'Reinvest', pct: (fs.reinvest || 0) * 100, color: '#9b7bb8' },
  ].filter((x) => x.pct > 0.01);
}

/** Weight slices for a book (controller or node). Top N + Other. */
export function bookWeightPie(rows = [], { limit = 8 } = {}) {
  const inBook = (rows || [])
    .filter((r) => (Number(r.weightPct) || 0) > 0.05 || (Number(r.valueUsd) || 0) > 0)
    .slice()
    .sort((a, b) => (Number(b.weightPct) || 0) - (Number(a.weightPct) || 0));
  if (!inBook.length) return [];
  const top = inBook.slice(0, limit);
  const rest = inBook.slice(limit);
  const slices = top.map((r, i) => ({
    id: r.pool || r.ticker,
    label: r.ticker || '?',
    pct: Math.round((Number(r.weightPct) || 0) * 10) / 10,
    valueUsd: Number(r.valueUsd) || 0,
    color: BOOK_PIE_COLORS[i % BOOK_PIE_COLORS.length],
  }));
  const otherPct = rest.reduce((s, r) => s + (Number(r.weightPct) || 0), 0);
  if (otherPct > 0.05) {
    slices.push({
      id: '_other',
      label: 'Other',
      pct: Math.round(otherPct * 10) / 10,
      valueUsd: rest.reduce((s, r) => s + (Number(r.valueUsd) || 0), 0),
      color: '#3a3a3e',
    });
  }
  return slices.filter((x) => x.pct > 0.01);
}

/**
 * Full fund snapshot for /run and GET /api/fund.
 */
export async function buildFundSnapshot(opts = {}) {
  const wallet = (opts.wallet || config.lpWallet || '').trim();
  const prefs = loadPoolPrefs();
  const queuePrefs = loadQueuePrefs();
  const fundPolicy = loadFundPolicy();

  let positions = opts.positions;
  if (!positions && wallet) {
    try {
      const p = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT);
      positions = p.positions || [];
    } catch {
      positions = [];
    }
  }
  positions = positions || [];

  let poolCache = loadCachedStartListPools();
  if (!opts.skipPoolSync) {
    try {
      poolCache = (await ensureStartListPoolCache()) || poolCache;
    } catch {
      // keep stale / empty
    }
  }
  const poolMetricsByPool = poolCache?.byPool || {};

  const book = buildBookRows(positions, prefs, queuePrefs, poolMetricsByPool);
  let underweight = book.rows.filter((r) => r.gapPct != null && r.gapPct > 0.5);
  let overweight = book.rows.filter((r) => r.gapPct != null && r.gapPct < -0.5);

  let sol = 0;
  let ansem = 0;
  if (wallet) {
    sol = opts.solBalance != null ? Number(opts.solBalance) : await getSolBalance(wallet);
    ansem =
      opts.ansemBalance != null
        ? Number(opts.ansemBalance)
        : await tokenUiBalance(wallet, config.ansemMint || ANSEM_MINT);
  }

  // Controller book (RO) — live weights for mirror UI / take-out proposals.
  // Pref writes only when opts.syncController === true (button / seed).
  let controllerSync = null;
  let controllerBook = null;
  try {
    const { syncControllerTargets, buildControllerBook } = await import(
      './controller-book.js'
    );
    controllerBook = await buildControllerBook({ persistLedger: false });
    if (
      fundPolicy.followController !== false &&
      opts.syncController === true
    ) {
      controllerSync = await syncControllerTargets({
        nodePositions: positions,
        persistLedger: false,
        force: opts.forceSync === true,
      });
      if (controllerSync.ok && !controllerSync.skipped) {
        const prefs2 = loadPoolPrefs();
        const book2 = buildBookRows(positions, prefs2, queuePrefs, poolMetricsByPool);
        book.rows = book2.rows;
        book.bookValue = book2.bookValue;
        book.targetSumPct = book2.targetSumPct;
        underweight = book.rows.filter((r) => r.gapPct != null && r.gapPct > 0.5);
        overweight = book.rows.filter((r) => r.gapPct != null && r.gapPct < -0.5);
      }
    } else if (
      fundPolicy.followController !== false &&
      controllerBook?.ok &&
      // Overlay live controller weights as display targets when prefs empty
      book.rows.every((r) => r.targetWeightPct == null)
    ) {
      const byPool = new Map((controllerBook.rows || []).map((r) => [r.pool, r]));
      for (const r of book.rows) {
        const c = byPool.get(r.pool);
        if (c?.inPool && c.weightPct > 0.05) {
          r.targetWeightPct = Math.round(c.weightPct * 10) / 10;
          r.gapPct = r.targetWeightPct - (r.weightPct || 0);
          r.mirroredLive = true;
        } else if (r.inPool && !(c?.inPool)) {
          r.targetWeightPct = 0;
          r.gapPct = 0 - (r.weightPct || 0);
          r.mirroredLive = true;
        }
      }
      underweight = book.rows.filter((r) => r.gapPct != null && r.gapPct > 0.5);
      overweight = book.rows.filter((r) => r.gapPct != null && r.gapPct < -0.5);
    }
  } catch (e) {
    controllerSync = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const { proposeControllerTakeOuts } = await import('./controller-book.js');
  let takeOutProposals = proposeControllerTakeOuts(book.rows);
  try {
    const { getOperatorSnapshot } = await import('./operator-mode.js');
    const op = getOperatorSnapshot();
    if (!op.allowTakeOutProposals) takeOutProposals = [];
  } catch {
    /* keep proposals */
  }

  const nextReinvest =
    fundPolicy.reinvestFollowsWeights && (config.feeSplit?.reinvest || 0) > 0
      ? underweight.find((r) => r.mode === 'active') || null
      : null;

  return {
    ok: true,
    wallet: wallet || null,
    fetched_at: new Date().toISOString(),
    policy: {
      solReserve: config.solReserve ?? SOL_RESERVE,
      pairMinAnsem: config.pairMinAnsem ?? PAIR_MIN_ANSEM,
      nodeActiveLimit: config.nodeActiveLimit ?? 10,
      fundPolicy,
      feeSplit: config.feeSplit,
    },
    balances: {
      sol,
      deployableSol: Math.max(0, sol - (config.solReserve ?? SOL_RESERVE)),
      ansem,
    },
    book: {
      valueUsd: book.bookValue,
      targetSumPct: book.targetSumPct,
      unassignedPct: Math.max(0, 100 - book.targetSumPct),
      rows: book.rows,
      underweight,
      overweight,
      holdCount: book.rows.filter((r) => r.mode === 'hold').length,
      offCount: book.rows.filter((r) => r.mode === 'off').length,
      inCount: book.rows.filter((r) => r.inPool).length,
    },
    controller: controllerBook
      ? {
          wallet: controllerBook.wallet,
          bookValue: controllerBook.bookValue,
          topPools: controllerBook.topPools,
          rows: (controllerBook.rows || [])
            .filter((r) => r.inPool)
            .slice(0, 15)
            .map((r) => ({
              ticker: r.ticker,
              pool: r.pool,
              weightPct: r.weightPct,
              valueUsd: r.valueUsd,
            })),
          pie: bookWeightPie(controllerBook.rows || []),
        }
      : null,
    controllerSync,
    takeOutProposals,
    feePie: feeSplitPie(),
    nodePie: bookWeightPie(book.rows),
    nextReinvest,
    meteora: {
      ...meteoraCacheStatus(),
      startListFetchedAt: poolCache?.fetched_at || null,
      startListCount: poolCache?.count || 0,
    },
    trackedWallet: config.trackedWallet || OLD_BOOK_WALLET,
    aemonDonateWallet: config.aemonDonateWallet,
    note: 'Fund snapshot — Meteora datapi + local cache. Plans never auto-sign. Approve withdraws/swaps in Phantom.',
  };
}

function proceedsActions(proceeds, estUsd, redeployKey) {
  const actions = [];
  const p = String(proceeds || 'reserve');
  if (p === 'reserve') {
    actions.push({
      id: 'hold_sol',
      type: 'reserve',
      title: 'Keep SOL in reserve',
      detail: `~$${estUsd.toFixed(2)} stays on operator as gas/reserve.`,
      autoSign: false,
    });
  } else if (p === 'ansem_send') {
    actions.push({
      id: 'buy_ansem_proceeds',
      type: 'buy_ansem',
      title: 'Buy ANSEM with proceeds',
      detail: `Jupiter SOL → ANSEM (~$${estUsd.toFixed(2)}). Approve in Phantom.`,
      links: {
        jupiter: `https://jup.ag/swap/SOL-${config.ansemMint || ANSEM_MINT}`,
      },
      autoSign: false,
    });
  } else if (p === 'aemon_donate') {
    actions.push({
      id: 'donate_proceeds',
      type: 'donate_sol',
      title: 'Donate proceeds to aemon',
      detail: `Send ~$${estUsd.toFixed(2)} SOL to creator fam (${(config.aemonDonateWallet || '').slice(0, 8)}…).`,
      recipient: config.aemonDonateWallet,
      autoSign: false,
    });
  } else if (p.startsWith('redeploy:') || redeployKey) {
    const key = redeployKey || p.slice('redeploy:'.length);
    const row = findStartRow(key);
    actions.push({
      id: `redeploy_${row?.ticker || key}`,
      type: 'redeploy',
      title: `Redeploy into ${row?.ticker || key}`,
      detail: `Use proceeds to buy TOKEN + deposit dual-sided on Meteora. Approve in Phantom.`,
      ticker: row?.ticker,
      pool: row?.pool,
      mint: row?.mint,
      links: {
        meteora: row?.pool ? `https://app.meteora.ag/pools/${row.pool}` : undefined,
        jupiter: row?.mint ? `https://jup.ag/swap/SOL-${row.mint}` : undefined,
      },
      autoSign: false,
    });
  }
  return actions;
}

/**
 * Build take_out or close plan (unsigned).
 * @param {object} opts
 * @param {'take_out'|'close'} opts.action
 * @param {string} opts.pool — pool address or ticker
 * @param {number} [opts.pct] — 1–100 (default ~90 leave 10%; close forces 100)
 * @param {string} [opts.proceeds] — override fundPolicy.takeOutProceeds
 * @param {boolean} [opts.applyClosePrefs] — persist mode=off on close (default true for close)
 */
export async function buildFundPlan(opts = {}) {
  const action = String(opts.action || 'take_out').toLowerCase();
  const poolKey = String(opts.pool || opts.ticker || '').trim();
  if (!poolKey) {
    return { ok: false, error: 'pool or ticker required' };
  }
  if (action !== 'take_out' && action !== 'close') {
    return { ok: false, error: 'action must be take_out or close' };
  }

  const fundPolicy = loadFundPolicy();
  const prefs = loadPoolPrefs();
  const rowMeta = findStartRow(poolKey);
  if (!rowMeta?.pool || !isIndexPool(rowMeta.pool)) {
    return {
      ok: false,
      error: `Pool not on ANSEM index start list — refuse non-index take-out/close plan (${poolKey})`,
    };
  }
  const pref = prefForRow(rowMeta, prefs);
  // Default trim = leave ~10% in pool (take 90%). Close is the only 100% exit.
  // Also cap so remaining book ≥ LEAVE_IN_POOL_MIN_USD (~$1).
  const requestedPct =
    action === 'close'
      ? 100
      : Math.max(
          1,
          Math.min(
            100,
            Number(opts.pct) ||
              pref.takeOutDefaultPct ||
              fundPolicy.takeOutDefaultPct ||
              90,
          ),
        );

  const wallet = (opts.wallet || config.lpWallet || '').trim();
  let positions = [];
  if (wallet) {
    try {
      const p = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT);
      positions = p.positions || [];
    } catch {
      positions = [];
    }
  }

  const poolAddr = rowMeta.pool || poolKey;
  const hit = positionValueForPool(positions, poolAddr);
  const pct =
    action === 'close'
      ? 100
      : cappedTakeOutPct(hit.value, requestedPct);
  if (action === 'take_out' && pct <= 0) {
    return {
      ok: false,
      error: `Pool book ~$${Number(hit.value || 0).toFixed(2)} ≤ leave-in floor ($${fundPolicy.leaveInPoolMinUsd ?? 1}) — trim refused; use Close to exit`,
      leaveInPoolMinUsd: fundPolicy.leaveInPoolMinUsd ?? 1,
      bookUsd: hit.value,
    };
  }
  const estUsd = hit.value * (pct / 100);
  const autoSell =
    opts.autoSell != null ? Boolean(opts.autoSell) : fundPolicy.autoSellOnTakeOut;
  const proceeds = opts.proceeds || fundPolicy.takeOutProceeds || 'reserve';

  let withdrawSdk = null;
  if (wallet && poolAddr && opts.skipWithdrawQuote !== true) {
    try {
      const adapter = createMeteoraAdapter();
      withdrawSdk = await adapter.buildWithdrawPlan({
        pool: poolAddr,
        owner: wallet,
        pct,
        buildTx: opts.buildWithdrawTx !== false,
      });
    } catch (e) {
      withdrawSdk = {
        status: 'ERROR',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const quoteLines = (withdrawSdk?.quotes || [])
    .filter((q) => q.outAmountA != null)
    .map(
      (q) =>
        `pos ${q.position.slice(0, 6)}… → ${Number(q.outAmountA).toPrecision(4)} A + ${Number(q.outAmountB).toPrecision(4)} B`,
    );

  const actions = [];

  actions.push({
    id: 'withdraw',
    type: 'withdraw',
    title: `Withdraw ~${pct}% of ${rowMeta.ticker} LP`,
    detail: hit.count
      ? `Meteora DAMM v2 · remove ~${pct}% liquidity (~$${estUsd.toFixed(2)} book). ${
          quoteLines.length ? `SDK quote: ${quoteLines.join('; ')}. ` : ''
        }Phantom must approve.`
      : `No open LP detected for ${rowMeta.ticker} — open Meteora anyway if you know you are in.`,
    ticker: rowMeta.ticker,
    pool: poolAddr,
    mint: rowMeta.mint,
    pct,
    estUsd,
    withdrawQuote: withdrawSdk,
    txs: (withdrawSdk?.txs || []).filter((t) => t.status === 'READY'),
    links: {
      meteora: `https://app.meteora.ag/pools/${poolAddr}`,
      cockpit: `/pool?pool=${encodeURIComponent(poolAddr)}&action=${action === 'close' ? 'close' : 'withdraw'}`,
    },
    autoSign: false,
  });

  if (autoSell && rowMeta.mint) {
    actions.push({
      id: 'sell_token',
      type: 'sell_token',
      title: `Sell ${rowMeta.ticker} → SOL`,
      detail: 'After withdraw you hold TOKEN + ANSEM. Sell TOKEN (and ANSEM if you want full cash) on Jupiter.',
      ticker: rowMeta.ticker,
      mint: rowMeta.mint,
      links: {
        jupiter: `https://jup.ag/swap/${rowMeta.mint}-SOL`,
        jupiterAnsem: `https://jup.ag/swap/${config.ansemMint || ANSEM_MINT}-SOL`,
      },
      autoSign: false,
    });
  }

  actions.push(...proceedsActions(proceeds, estUsd));

  let closePrefs = null;
  if (action === 'close') {
    const redirect =
      opts.redirectTo != null ? String(opts.redirectTo).trim() : pref.redirectTo;
    closePrefs = {
      mode: fundPolicy.closeSetsMode || 'off',
      ...(redirect ? { redirectTo: redirect } : {}),
    };
    // Only mutate when explicitly requested (POST apply) — GET plans stay read-only
    if (opts.applyClosePrefs === true) {
      savePoolPref(poolAddr || rowMeta.ticker, closePrefs);
    }
    actions.push({
      id: 'set_off',
      type: 'set_pref',
      title: `Mark ${rowMeta.ticker} Off`,
      detail: redirect
        ? `mode=off · future capital redirects to ${redirect}`
        : 'mode=off — no new deposits',
      autoSign: false,
    });
  }

  const redirectResolved = resolveRedirectTarget(poolAddr, loadPoolPrefs()) ||
    resolveRedirectTarget(rowMeta.ticker, loadPoolPrefs());

  return {
    ok: true,
    action,
    wallet: wallet || null,
    pool: {
      ticker: rowMeta.ticker,
      mint: rowMeta.mint,
      pool: poolAddr,
      valueUsd: hit.value,
      inPool: hit.count > 0,
    },
    pct,
    estUsd,
    proceeds,
    autoSell,
    closePrefs,
    redirectResolved,
    withdrawQuote: withdrawSdk,
    nextAction: actions[0] || null,
    actions,
    fundPolicy,
    note: 'Plan only — no transactions signed. SDK withdraw quotes from Meteora cp-amm. Approve each step in Phantom.',
  };
}

/**
 * Suggest reinvest targets (underweight active pools) for dry-run keeper.
 * When HERD_POOL is live, pin HERD–ANSEM first (hub launch join).
 */
export function proposeReinvestTargets(bookRows, limit = 5) {
  const underweight = (bookRows || [])
    .filter((r) => r.mode === 'active' && r.gapPct != null && r.gapPct > 0.5)
    .slice(0, Math.max(0, limit))
    .map((r) => ({
      ticker: r.ticker,
      pool: r.pool,
      mint: r.mint,
      gapPct: r.gapPct,
      targetWeightPct: r.targetWeightPct,
      weightPct: r.weightPct,
      herd: Boolean(r.herd),
      links: {
        meteora: `https://app.meteora.ag/pools/${r.pool}`,
        jupiter: `https://jup.ag/swap/SOL-${r.mint}`,
      },
    }));

  const herdPool = resolveHerdPool();
  if (!isHerdPoolLive(herdPool)) {
    return underweight.slice(0, limit);
  }

  const herdMint = resolveHerdMint() || config.indexTokenMint || '';
  const herdTicker = config.indexTokenSymbol || INDEX_TOKEN_SYMBOL || 'HERD';
  const fromBook = (bookRows || []).find(
    (r) => r.pool && String(r.pool).toLowerCase() === String(herdPool).toLowerCase(),
  );
  const herdTarget = {
    ticker: fromBook?.ticker || herdTicker,
    pool: herdPool,
    mint: fromBook?.mint || herdMint || null,
    gapPct: fromBook?.gapPct ?? null,
    targetWeightPct: fromBook?.targetWeightPct ?? null,
    weightPct: fromBook?.weightPct ?? null,
    herd: true,
    note: 'reinvest → HERD_POOL first when live',
    links: {
      meteora: `https://app.meteora.ag/pools/${herdPool}`,
      jupiter: herdMint
        ? `https://jup.ag/swap/SOL-${herdMint}`
        : `https://jup.ag/swap/SOL-${ANSEM_MINT}`,
    },
  };

  const rest = underweight.filter(
    (r) => String(r.pool || '').toLowerCase() !== String(herdPool).toLowerCase(),
  );
  return [herdTarget, ...rest].slice(0, Math.max(1, limit));
}
