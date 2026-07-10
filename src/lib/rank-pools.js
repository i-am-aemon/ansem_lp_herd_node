/**
 * Two-lane ranker over the ANSEM index start list:
 *   Lane A — APE: TOKEN–ANSEM pair age < apeMaxAgeMinutes → jump queue
 *   Lane B — DIP: buy recent lows (5m/1h/6h/24h) with liq/vol floors
 *
 * Active smoke universe = top NODE_ACTIVE_LIMIT dip names + any live APE.
 * Full START_LIST remains the index gate (isIndexPool).
 */
import {
  START_LIST,
  PAIR_MIN_ANSEM,
} from './whitepaper.js';
import {
  NODE_ACTIVE_LIMIT_DEFAULT,
  APE_MAX_AGE_MINUTES_DEFAULT,
  APE_MIN_LIQ_USD_DEFAULT,
  effectiveStartList,
  resolveHerdPool,
} from './ansem-index.js';
import { ANSEM_MINT, isHerdPoolLive } from '../constants.js';
import { fetchDexBatch } from './portfolio.js';
import { config } from '../config.js';
import {
  loadPoolPrefs,
  loadQueuePrefs,
  prefForRow,
  resolveRedirectTarget,
} from './pool-prefs.js';

function orderIndex(row, manualOrder) {
  if (!manualOrder?.length) return 1e9;
  const iPool = row.pool ? manualOrder.indexOf(row.pool) : -1;
  const iTick = row.ticker ? manualOrder.indexOf(row.ticker) : -1;
  const i = iPool >= 0 ? iPool : iTick;
  return i >= 0 ? i : 1e9;
}

const DEFAULT_MIN_LIQ_USD = 5_000;
const DEFAULT_MIN_VOL_24H = 500;

function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Estimate ANSEM tokens deposited in a Meteora open-position row.
 */
export function estimateAnsemInPosition(p, ansemMint = ANSEM_MINT) {
  if (!p) return 0;
  const d = p.current_position?.current_deposits;
  if (d) {
    if (p.token_x?.address === ansemMint) {
      const raw = d.amount_x ?? d.token_x_amount ?? d.amount_x_ui;
      if (raw != null && Number(raw) > 0) return Number(raw);
    }
    if (p.token_y?.address === ansemMint) {
      const raw = d.amount_y ?? d.token_y_amount ?? d.amount_y_ui;
      if (raw != null && Number(raw) > 0) return Number(raw);
    }
    const xUsd = num(d.amount_x_usd);
    const yUsd = num(d.amount_y_usd);
    const ansemUsd =
      p.token_x?.address === ansemMint
        ? xUsd
        : p.token_y?.address === ansemMint
          ? yUsd
          : 0;
    const px = num(p.price_usd) || num(p.ansem_token?.price_usd);
    if (ansemUsd > 0 && px > 0) return ansemUsd / px;
  }
  const val = num(p.position_value_usd);
  const px = num(p.price_usd);
  if (val > 0 && px > 0) return val / 2 / px;
  return 0;
}

/**
 * Lane A — immediate ape on fresh TOKEN–ANSEM pairs.
 */
export function scoreApe(row, opts = {}) {
  const maxAge = opts.apeMaxAgeMinutes ?? APE_MAX_AGE_MINUTES_DEFAULT;
  const minLiq = opts.apeMinLiqUsd ?? APE_MIN_LIQ_USD_DEFAULT;
  const age = row.age_minutes != null ? num(row.age_minutes, Infinity) : Infinity;
  const liq = num(row.liquidity_usd, num(row._liq));

  if (!(age < maxAge)) {
    return { ape: false, score: -1e9, reason: null };
  }
  if (liq > 0 && liq < minLiq) {
    return {
      ape: false,
      score: -1e9,
      reason: `fresh but thin (<$${minLiq})`,
      age_minutes: age,
    };
  }
  return {
    ape: true,
    lane: 'ape',
    score: 1e12 - age,
    reason: `APE · <${maxAge}m (${age.toFixed(1)}m)`,
    age_minutes: age,
  };
}

/**
 * Lane B — buy the dip: recent lows with real books.
 * Weights short windows heavier than 24h.
 */
export function scoreBuyTheDip(row, opts = {}) {
  const minLiq = opts.minLiqUsd ?? DEFAULT_MIN_LIQ_USD;
  const minVol = opts.minVol24h ?? DEFAULT_MIN_VOL_24H;
  const liq = num(row.liquidity_usd, num(row._liq));
  const vol = num(row.volume_24h);
  const ch5 = num(row.price_change_5m);
  const ch1h = num(row.price_change_1h);
  const ch6 = num(row.price_change_6h);
  const ch24 = num(row.price_change_24h);

  const dead = liq < minLiq && vol < minVol;
  if (dead && liq <= 0 && vol <= 0) {
    return {
      lane: 'dip',
      score: -1e9,
      dead: true,
      reason: 'no liquidity/volume',
    };
  }

  // Prefer recent lows: 5m/1h dominate
  const dipScore = -(ch5 * 3 + ch1h * 2.5 + ch6 * 1.5 + ch24);
  const bookScore =
    Math.log10(1 + Math.max(liq, 0)) + Math.log10(1 + Math.max(vol, 0));
  const upPenalty =
    Math.max(0, ch5) * 3 +
    Math.max(0, ch1h) * 2 +
    Math.max(0, ch6) +
    Math.max(0, ch24);

  let score = dipScore + bookScore * 2 - upPenalty;
  if (dead) score -= 50;

  const down =
    ch5 < 0 || ch1h < 0 || ch6 < 0 || ch24 < 0;
  return {
    lane: 'dip',
    score,
    dead,
    reason: dead
      ? 'thin book'
      : down
        ? 'dip · recent low'
        : 'liquid / ranked',
  };
}

/**
 * Enrich start-list rows with DexScreener fields (incl. pair age).
 */
export async function enrichStartList(list = START_LIST) {
  const mints = list.map((n) => n.mint).filter(Boolean);
  const dex = await fetchDexBatch(mints);
  return list.map((n) => {
    const e = dex.get(n.mint) || {};
    return {
      ...n,
      price_usd: e.price_usd,
      volume_24h: e.volume_24h,
      price_change_5m: e.price_change_5m,
      price_change_1h: e.price_change_1h,
      price_change_6h: e.price_change_6h,
      price_change_24h: e.price_change_24h,
      liquidity_usd: e.liquidity_usd,
      market_cap: e.market_cap,
      image_url: e.image_url,
      pair_created_at: e.pair_created_at,
      age_minutes: e.age_minutes,
    };
  });
}

/**
 * Build ranked queue for Pass 1 / Pass 2.
 * SEED_UNIVERSE=tracked_top10 (default): active = CONTROLLER/TRACKED top-N by value.
 * SEED_SORT=dip24 (default): lowest 24h change first; no APE jump in that mode.
 */
export async function rankPools(opts = {}) {
  const startList = effectiveStartList(opts.startList || START_LIST);
  const positions = opts.w1Positions || [];
  const globalPairMin = opts.pairMinAnsem ?? config.pairMinAnsem ?? PAIR_MIN_ANSEM;
  const pass = opts.pass || config.seedPass || 'coverage';
  const prefs = opts.poolPrefs || loadPoolPrefs();
  const queuePrefs = opts.queuePrefs || loadQueuePrefs();
  const activeLimit = Math.max(
    10,
    Number(opts.nodeActiveLimit ?? config.nodeActiveLimit ?? NODE_ACTIVE_LIMIT_DEFAULT) ||
      NODE_ACTIVE_LIMIT_DEFAULT,
  );
  const universe = String(
    opts.seedUniverse || process.env.SEED_UNIVERSE || config.seedUniverse || 'tracked_top10',
  ).trim();
  // tracked_top10 defaults to dip24; queuePrefs.sort must not override that product default
  const sortMode = String(
    opts.seedSort ||
      process.env.SEED_SORT ||
      config.seedSort ||
      (universe === 'tracked_top10' ? 'dip24' : queuePrefs.sort || 'ranker'),
  ).trim();
  /** tracked_top10 + dip24: do not ape-chase unless operatorMode=ape */
  const operatorMode = String(
    opts.operatorMode || process.env.OPERATOR_MODE || config.operatorMode || '',
  )
    .toLowerCase()
    .trim();
  const apeJump =
    opts.allowApeJump === true ||
    operatorMode === 'ape' ||
    (universe !== 'tracked_top10' && sortMode !== 'dip24');
  const apeMaxAge =
    opts.apeMaxAgeMinutes ?? config.apeMaxAgeMinutes ?? APE_MAX_AGE_MINUTES_DEFAULT;
  const apeMinLiq =
    opts.apeMinLiqUsd ?? config.apeMinLiqUsd ?? APE_MIN_LIQ_USD_DEFAULT;

  // CONTROLLER/TRACKED book → top-N pools by value (index only).
  // Use buildControllerBook — raw getOpenPositions has no position_value_usd, so
  // a naive sum was always 0 and we fell back to dip24 (stuck on RIF forever).
  let trackedTopPools = null;
  if (universe === 'tracked_top10') {
    try {
      const { buildControllerBook } = await import('./controller-book.js');
      const dustUsd = Number(process.env.CONTROLLER_DUST_USD) || 1;
      const ctrlBook = await buildControllerBook({ persistLedger: false });
      trackedTopPools = (ctrlBook.rows || [])
        .filter((r) => r.inPool && num(r.valueUsd) >= dustUsd && r.pool)
        .sort((a, b) => num(b.valueUsd) - num(a.valueUsd))
        .slice(0, activeLimit)
        .map((r) => r.pool);
      if (!trackedTopPools.length) trackedTopPools = null;
    } catch {
      trackedTopPools = null;
    }
  }

  const byPool = new Map();
  for (const p of positions) {
    const addr = p.pool_address;
    if (!addr) continue;
    const prev = byPool.get(addr) || { ansem: 0, positions: 0, value: 0 };
    prev.ansem += estimateAnsemInPosition(p, config.ansemMint || ANSEM_MINT);
    prev.positions += 1;
    prev.value += num(p.position_value_usd);
    byPool.set(addr, prev);
  }

  const enriched = await enrichStartList(startList);
  const bookValue = [...byPool.values()].reduce((s, h) => s + (h.value || 0), 0);

  // Controller book (cached) — you vs them on the same pools
  let ctrlByPool = new Map();
  try {
    const { buildControllerBook } = await import('./controller-book.js');
    const ctrlBook = await buildControllerBook({ persistLedger: false });
    for (const row of ctrlBook.rows || []) {
      if (row.pool) ctrlByPool.set(row.pool, row);
    }
  } catch {
    /* non-fatal */
  }

  const ranked = enriched.map((n, i) => {
    const hit = n.pool ? byPool.get(n.pool) : null;
    const inPool = Boolean(hit && hit.positions > 0);
    const ansemIn = hit?.ansem ?? 0;
    const pref = prefForRow(n, prefs, queuePrefs);
    const pairMin =
      pref.pairMinAnsem != null && pref.pairMinAnsem > 0
        ? pref.pairMinAnsem
        : globalPairMin;
    // Dust tolerance: 0.05 ANSEM or 3% — avoids endless top-ups for 2.09 vs 2.10
    const minEps = Math.max(0.05, pairMin * 0.03);
    const atMinimum = inPool && ansemIn + 1e-9 >= pairMin - minEps;

    const ape = apeJump
      ? scoreApe(n, { apeMaxAgeMinutes: apeMaxAge, apeMinLiqUsd: apeMinLiq })
      : { ape: false, score: 0, reason: 'ape off (tracked_top10/dip24)' };
    const dip = scoreBuyTheDip(n);
    const scored = ape.ape ? { ...ape, dead: false } : dip;

    const coverageOk =
      pass === 'depth' || pass === 'pass2' ? true : !atMinimum;
    const treatDead = scored.dead && !pref.force && !ape.ape;
    const passEligible = pref.seedNew && coverageOk;
    const valueUsd = hit?.value ?? 0;
    const weightPct = bookValue > 0 ? (valueUsd / bookValue) * 100 : 0;
    const gapPct =
      pref.targetWeightPct != null ? pref.targetWeightPct - weightPct : null;
    const ctrl = n.pool ? ctrlByPool.get(n.pool) : null;
    const controllerAnsem = num(ctrl?.ansem);
    const controllerValueUsd = num(ctrl?.valueUsd);
    const controllerWeightPct = num(ctrl?.weightPct);
    const redirectDest =
      pref.mode === 'off'
        ? resolveRedirectTarget(n.pool || n.ticker, prefs) || pref.redirectTo || null
        : null;
    const ch24 = num(n.price_change_24h);
    // Stupid transparent score for UI: lower 24h = higher priority; missing min boosts.
    const coverGap = Math.max(0, pairMin - ansemIn);
    const simpleScore = Math.round((-ch24 + coverGap * 2 + (gapPct || 0)) * 10) / 10;
    let scoreReason = scored.reason || 'ranked';
    if (pref.holdExisting) scoreReason = 'hold — keep existing, no new';
    else if (pref.excluded) {
      scoreReason = redirectDest
        ? `off → redirect ${redirectDest}`
        : 'off — skipped';
    } else if (pref.pin) scoreReason = `pinned · ${scoreReason}`;
    else if (pref.priority) scoreReason = `prio ${pref.priority} · ${scoreReason}`;
    if (gapPct != null && gapPct > 0.5) {
      scoreReason = `underweight +${gapPct.toFixed(1)}% · ${scoreReason}`;
    }
    if (pref.pairMinAnsem != null) scoreReason += ` · min ${pairMin}`;
    if (pref.note) scoreReason += ` · ${pref.note}`;

    const why = atMinimum
      ? `ok · you ${ansemIn.toFixed(2)} ≥ min ${pairMin.toFixed(2)}`
      : `need · you ${ansemIn.toFixed(2)} / min ${pairMin.toFixed(2)} · ctrl ${controllerAnsem.toFixed(2)} · 24h ${ch24.toFixed(1)}%`;

    return {
      rank: 0,
      n: i + 1,
      ticker: n.ticker,
      mint: n.mint || '',
      pool: n.pool || '',
      minUsd: n.minUsd,
      pairMinAnsem: pairMin,
      price_usd: n.price_usd,
      volume_24h: n.volume_24h,
      price_change_5m: n.price_change_5m,
      price_change_1h: n.price_change_1h,
      price_change_6h: n.price_change_6h,
      price_change_24h: n.price_change_24h,
      liquidity_usd: n.liquidity_usd,
      age_minutes: n.age_minutes,
      pair_created_at: n.pair_created_at,
      lane: scored.lane || (ape.ape ? 'ape' : 'dip'),
      ape: Boolean(ape.ape),
      score: scored.score,
      simpleScore,
      scoreReason,
      why,
      dead: treatDead,
      rawDead: Boolean(scored.dead),
      inPool,
      ansemInPool: ansemIn,
      atMinimum,
      position_value_usd: valueUsd,
      weightPct,
      targetWeightPct: pref.targetWeightPct,
      gapPct,
      controllerAnsem,
      controllerValueUsd,
      controllerWeightPct,
      controllerInPool: Boolean(ctrl?.inPool),
      redirectTo: pref.redirectTo,
      redirectDest,
      mode: pref.mode,
      pin: pref.pin,
      priority: pref.priority,
      force: pref.force,
      note: pref.note,
      seedNew: pref.seedNew,
      holdExisting: pref.holdExisting,
      excluded: pref.excluded,
      passEligible,
      active: false,
      herd: Boolean(n.herd),
    };
  });

  // When off names redirect, boost destination priority so Pass 2 / deposits follow
  const redirectBoost = new Map();
  for (const r of ranked) {
    if (!r.redirectDest) continue;
    const dest = String(r.redirectDest);
    redirectBoost.set(dest, (redirectBoost.get(dest) || 0) + 1);
  }
  for (const r of ranked) {
    const boost =
      redirectBoost.get(r.pool) ||
      redirectBoost.get(r.ticker) ||
      0;
    if (boost > 0 && r.mode === 'active') {
      r.priority = (r.priority || 0) + boost * 10;
      r.scoreReason = `redirect target · ${r.scoreReason}`;
    }
  }

  const sort = sortMode || (universe === 'tracked_top10' ? 'dip24' : 'ranker');
  ranked.sort((a, b) => {
    if (sort === 'manual') {
      const oa = orderIndex(a, queuePrefs.manualOrder);
      const ob = orderIndex(b, queuePrefs.manualOrder);
      if (oa !== ob) return oa - ob;
      return String(a.ticker).localeCompare(String(b.ticker));
    }
    if (sort === 'alpha') {
      return String(a.ticker).localeCompare(String(b.ticker));
    }
    // Bottom-up: most negative 24h first (do not chase highs)
    if (sort === 'dip24') {
      if (a.passEligible !== b.passEligible) return a.passEligible ? -1 : 1;
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      const ca = num(a.price_change_24h, 0);
      const cb = num(b.price_change_24h, 0);
      if (ca !== cb) return ca - cb; // lowest (most negative) first
      if (a.dead !== b.dead) return a.dead ? 1 : -1;
      return num(b.liquidity_usd) - num(a.liquidity_usd);
    }
    // APE always before DIP when using ranker sort
    if (a.ape !== b.ape) return a.ape ? -1 : 1;
    if (a.passEligible !== b.passEligible) return a.passEligible ? -1 : 1;
    if (a.pin !== b.pin) return a.pin ? -1 : 1;
    const ga = a.gapPct != null ? a.gapPct : 0;
    const gb = b.gapPct != null ? b.gapPct : 0;
    if (ga !== gb && (a.gapPct != null || b.gapPct != null)) return gb - ga;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.dead !== b.dead) return a.dead ? 1 : -1;
    return b.score - a.score;
  });

  // Mark active set
  const herdPool = resolveHerdPool();
  const herdLive = isHerdPoolLive(herdPool);

  if (trackedTopPools?.length) {
    const topSet = new Set(trackedTopPools);
    // Always include live HERD–ANSEM pool in the active set (key part of running a node)
    if (herdLive) topSet.add(herdPool);
    for (const r of ranked) {
      r.active = topSet.has(r.pool) || r.pin || r.force || (herdLive && r.pool === herdPool);
      if (herdLive && r.pool === herdPool) {
        r.pin = true;
        r.active = true;
        r.herd = true;
        if (!r.scoreReason.includes('HERD–ANSEM')) {
          r.scoreReason = `HERD–ANSEM pool · ${r.scoreReason}`;
        }
      }
      if (r.active && !r.scoreReason.includes('tracked top') && !(herdLive && r.pool === herdPool)) {
        r.scoreReason = `tracked top${activeLimit} · ${r.scoreReason}`;
      }
    }
  } else {
    let dipSlots = 0;
    for (const r of ranked) {
      if (herdLive && r.pool === herdPool) {
        r.pin = true;
        r.active = true;
        r.herd = true;
        if (!r.scoreReason.includes('HERD–ANSEM')) {
          r.scoreReason = `HERD–ANSEM pool · ${r.scoreReason}`;
        }
        continue;
      }
      if (apeJump && r.ape) {
        r.active = true;
        continue;
      }
      if (dipSlots < activeLimit) {
        r.active = true;
        dipSlots += 1;
      } else {
        r.active = false;
      }
    }
  }

  // Pass 1 coverage: non-active names are not passEligible unless pin/force/(ape if allowed)
  if (pass !== 'depth' && pass !== 'pass2') {
    for (const r of ranked) {
      if (!r.active && !r.pin && !r.force && !(apeJump && r.ape)) {
        r.passEligible = false;
        if (!r.excluded && !r.holdExisting) {
          r.scoreReason = `outside top ${activeLimit} · ${r.scoreReason}`;
        }
      }
    }
  }

  // Coverage-first: uncovered before covered. Within uncovered, follow controller
  // book weight (BIF → CASHCAT → …) — not dip24, which locked focus on dust RIF.
  if (pass !== 'depth' && pass !== 'pass2') {
    ranked.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.passEligible !== b.passEligible) return a.passEligible ? -1 : 1;
      if (a.atMinimum !== b.atMinimum) return a.atMinimum ? 1 : -1;
      if (a.herd !== b.herd) return a.herd ? -1 : 1;
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      const cw = num(b.controllerWeightPct) - num(a.controllerWeightPct);
      if (cw !== 0) return cw;
      if (sort === 'dip24') {
        const d = num(a.price_change_24h, 0) - num(b.price_change_24h, 0);
        if (d !== 0) return d;
      }
      return (b.gapPct ?? 0) - (a.gapPct ?? 0);
    });
  }

  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });

  const next =
    ranked.find((r) => r.herd && r.passEligible && !r.atMinimum) ||
    (apeJump && ranked.find((r) => r.ape && r.passEligible && !r.dead)) ||
    ranked.find((r) => r.passEligible && !r.dead && !r.atMinimum) ||
    ranked.find((r) => r.passEligible && !r.dead) ||
    ranked.find((r) => r.passEligible) ||
    null;

  const underweight = ranked.filter((r) => r.gapPct != null && r.gapPct > 0.5);
  const apeHits = ranked.filter((r) => r.ape);
  const activeQueue = ranked.filter((r) => r.active);

  return {
    pass: pass === 'depth' || pass === 'pass2' ? 'pass2' : 'pass1',
    pairMinAnsem: globalPairMin,
    nodeActiveLimit: activeLimit,
    apeMaxAgeMinutes: apeMaxAge,
    seedUniverse: universe,
    seedSort: sort,
    sort,
    queuePrefs,
    bookValue,
    underweightCount: underweight.length,
    apeCount: apeHits.length,
    activeCount: activeQueue.length,
    trackedTopPools: trackedTopPools || [],
    fetched_at: new Date().toISOString(),
    prefs,
    next,
    queue: ranked,
    active: activeQueue,
    ape: apeHits,
  };
}
