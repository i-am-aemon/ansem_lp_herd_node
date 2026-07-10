/**
 * LP book for Run — hub homepage shape:
 * total portfolio · unclaimed fees · bot active N · full/hidden list.
 */
import { config } from '../config.js';
import { ANSEM_MINT } from '../constants.js';
import { buildPortfolio, positionValueUsd, unclaimedFeesUsd } from './portfolio.js';
import { buildControllerBook } from './controller-book.js';
import { findConstituent, effectiveStartList } from './ansem-index.js';
import { loadPoolPrefs, loadQueuePrefs, prefForRow } from './pool-prefs.js';

/** Green-only slice palette (black UI · green accent). */
const PALETTE = [
  '#34d399',
  '#10b981',
  '#6ee7b7',
  '#059669',
  '#a7f3d0',
  '#047857',
  '#22c55e',
  '#86efac',
  '#16a34a',
  '#4ade80',
  '#15803d',
  '#bbf7d0',
];

/** Accent for Holder Pools · targets calc pie (not a live book). */
const POOLS_GREEN = '#34d399';

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Stable color per pool/ticker so Controller · Holder Pools · Node match. */
function colorForKey(key) {
  const s = String(key || '');
  if (!s || s === '__other') return '#555555';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function consolidate(slices, { maxSlices = 10, minPct = 1.2 } = {}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return [];
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const kept = [];
  let other = 0;
  for (const s of sorted) {
    const pct = (s.value / total) * 100;
    if (kept.length < maxSlices - 1 && pct >= minPct) kept.push(s);
    else other += s.value;
  }
  if (other > 0) kept.push({ id: '__other', label: 'Other', value: other });
  return kept.map((s) => ({
    ...s,
    color: s.color || colorForKey(s.id || s.label),
    pct: Math.round((s.value / total) * 1000) / 10,
  }));
}

function lifetimeFeesUsd(p) {
  const cur = p.current_position || {};
  // Prefer explicit lifetime fields when Meteora sends them; else unclaimed only.
  const gen =
    num(cur.total_fees_usd) ||
    num(cur.fee_usd) ||
    num(p.total_fees_usd) ||
    num(p.fees_generated_usd) ||
    0;
  const unclaimed = unclaimedFeesUsd(p);
  return Math.max(gen, unclaimed);
}

let _cache = null;
const CACHE_MS = 40_000;

/**
 * Full LP portfolio book for the node wallet (hub homepage layout).
 */
export async function buildLpBook(opts = {}) {
  const wallet = (opts.wallet || config.lpWallet || '').trim();
  const activeLimit = Math.max(
    10,
    Number(opts.activeLimit ?? config.nodeActiveLimit ?? 10) || 10,
  );

  if (
    !opts.force &&
    _cache &&
    _cache.wallet === wallet &&
    Date.now() - _cache.at < CACHE_MS
  ) {
    return { ..._cache.payload, cached: true };
  }

  const prefs = loadPoolPrefs();
  const queuePrefs = loadQueuePrefs();

  let positions = [];
  let totals = {};
  if (wallet) {
    try {
      const port = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT, {
        role: 'node',
        persistLedger: false,
        indexOnly: true,
      });
      positions = port.positions || [];
      totals = port.totals || {};
    } catch {
      positions = [];
    }
  }

  // Aggregate by pool
  const byPool = new Map();
  for (const p of positions) {
    const pool = p.pool_address || p.pool || '';
    if (!pool) continue;
    const hit = findConstituent(pool);
    const ticker =
      hit?.ticker ||
      p.ticker ||
      p.constituent_token?.symbol ||
      pool.slice(0, 6);
    const prev = byPool.get(pool) || {
      pool,
      ticker,
      mint: hit?.mint || p.constituent_token?.address || '',
      valueUsd: 0,
      unclaimedUsd: 0,
      feesEarnedUsd: 0,
      positions: 0,
      chg24: null,
    };
    prev.valueUsd += positionValueUsd(p) || num(p.position_value_usd);
    prev.unclaimedUsd += unclaimedFeesUsd(p) || num(p.unclaimed_fees_usd);
    prev.feesEarnedUsd += lifetimeFeesUsd(p);
    prev.positions += 1;
    if (p.price_change_24h != null) prev.chg24 = num(p.price_change_24h);
    byPool.set(pool, prev);
  }

  const rowsRaw = [...byPool.values()].map((r) => {
    const meta = { ticker: r.ticker, pool: r.pool, mint: r.mint };
    const pref = prefForRow(meta, prefs, queuePrefs);
    return {
      ...r,
      valueUsd: Math.round(r.valueUsd * 100) / 100,
      unclaimedUsd: Math.round(r.unclaimedUsd * 100) / 100,
      feesEarnedUsd: Math.round(r.feesEarnedUsd * 100) / 100,
      mode: pref.mode || 'active',
      pin: Boolean(pref.pin),
      holdExisting: Boolean(pref.holdExisting),
      note: pref.note || '',
      targetWeightPct: pref.targetWeightPct != null ? num(pref.targetWeightPct) : null,
    };
  });

  let ctrlByPool = new Map();
  let ctrlSlices = [];
  let ctrlTotal = 0;
  let ctrlWallet = config.controllerWallet || '';
  try {
    const book = await buildControllerBook({ persistLedger: false });
    ctrlWallet = book.wallet || ctrlWallet;
    ctrlTotal = num(book.bookValue);
    for (const r of book.rows || []) {
      if (r.pool) ctrlByPool.set(r.pool, r);
    }
    ctrlSlices = consolidate(
      (book.rows || [])
        .filter((r) => num(r.valueUsd) > 0)
        .map((r) => ({
          id: r.pool || r.ticker,
          label: r.ticker,
          value: num(r.valueUsd),
        })),
    );
  } catch {
    /* non-fatal */
  }

  const bookValue =
    num(totals.balances) || rowsRaw.reduce((s, r) => s + r.valueUsd, 0);

  const rows = rowsRaw.map((r) => {
    const ctrl = ctrlByPool.get(r.pool);
    const youPct = bookValue > 0 ? (r.valueUsd / bookValue) * 100 : 0;
    const ctrlPct = num(ctrl?.weightPct);
    // Goal = config target, else controller weight (mirror)
    const goalPct =
      r.targetWeightPct != null
        ? num(r.targetWeightPct)
        : ctrlPct > 0.05
          ? Math.round(ctrlPct * 10) / 10
          : null;
    const gapPct = goalPct != null ? goalPct - youPct : null;
    return {
      ...r,
      youPct: Math.round(youPct * 10) / 10,
      ctrlPct: Math.round(ctrlPct * 10) / 10,
      goalPct: goalPct != null ? Math.round(goalPct * 10) / 10 : null,
      gapPct: gapPct != null ? Math.round(gapPct * 10) / 10 : null,
      ctrlValueUsd: Math.round(num(ctrl?.valueUsd) * 100) / 100,
    };
  });

  rows.sort((a, b) => b.valueUsd + b.unclaimedUsd - (a.valueUsd + a.unclaimedUsd));

  const totalUsd = Math.round(bookValue * 100) / 100;
  const unclaimedUsd =
    Math.round(
      (num(totals.unclaimed_fees) || rows.reduce((s, r) => s + r.unclaimedUsd, 0)) *
        100,
    ) / 100;
  const feesEarnedUsd =
    Math.round(rows.reduce((s, r) => s + r.feesEarnedUsd, 0) * 100) / 100;

  // Bot management set = active mode, pinned first, then by value, capped at activeLimit
  const activeCandidates = rows
    .filter((r) => r.mode !== 'off')
    .sort((a, b) => {
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      if ((a.mode === 'active') !== (b.mode === 'active')) {
        return a.mode === 'active' ? -1 : 1;
      }
      // Prefer underweight vs goal for bot care
      const ga = a.gapPct != null ? a.gapPct : -1e9;
      const gb = b.gapPct != null ? b.gapPct : -1e9;
      if (ga !== gb) return gb - ga;
      return b.valueUsd - a.valueUsd;
    });

  const bot = [];
  const hidden = [];
  for (const r of activeCandidates) {
    if (r.mode === 'hold' || r.holdExisting) {
      hidden.push({ ...r, lane: 'hold' });
      continue;
    }
    if (bot.length < activeLimit && r.mode === 'active') {
      bot.push({ ...r, lane: 'bot' });
    } else {
      hidden.push({ ...r, lane: 'overflow' });
    }
  }
  for (const r of rows.filter((x) => x.mode === 'off')) {
    if (!hidden.some((h) => h.pool === r.pool) && !bot.some((h) => h.pool === r.pool)) {
      hidden.push({ ...r, lane: 'off' });
    }
  }

  const youSlices = consolidate(
    rows
      .filter((r) => r.valueUsd > 0)
      .map((r) => ({ id: r.pool, label: r.ticker, value: r.valueUsd })),
  );

  // Holder Pools · targets = derived mix (targetWeightPct, else controller weight).
  // Calc pie only — not a wallet. Display may use controller fallback before sync.
  const goalSlices = consolidate(
    rows
      .filter((r) => r.goalPct != null && r.goalPct > 0)
      .map((r) => ({
        id: r.pool,
        label: r.ticker,
        value: r.goalPct,
      })),
  );

  const payload = {
    ok: true,
    wallet,
    ctrlWallet,
    activeLimit,
    totalUsd,
    unclaimedUsd,
    feesEarnedUsd,
    pools: rows.length,
    positions: positions.length,
    bot,
    hidden,
    all: rows,
    you: {
      title: 'This node',
      totalUsd,
      slices: youSlices,
      positions: positions.length,
    },
    ctrl: {
      title: '$HERD Controller · Creator',
      totalUsd: Math.round(ctrlTotal * 100) / 100,
      slices: ctrlSlices,
      wallet: ctrlWallet,
    },
    goal: {
      title: 'Holder Pools · targets',
      accent: POOLS_GREEN,
      centerLabel: 'targets',
      slices: goalSlices,
      note: 'Calc pie: targetWeightPct else controller weight · green agent chases this · not a live book',
    },
    composition: youSlices,
    startListCount: effectiveStartList().length,
    at: new Date().toISOString(),
  };

  _cache = { wallet, at: Date.now(), payload };
  return payload;
}

/** Back-compat alias used by /api/portfolio-pies */
export async function buildPortfolioPies(opts = {}) {
  const book = await buildLpBook(opts);
  return {
    ok: book.ok,
    wallet: book.wallet,
    ctrlWallet: book.ctrlWallet,
    you: book.you,
    ctrl: book.ctrl,
    book,
    at: book.at,
    cached: book.cached,
  };
}
