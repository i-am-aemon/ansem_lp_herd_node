/**
 * Total flexibility for the node seed queue + fund control.
 *
 * Per-pool (keyed by pool address or ticker):
 *   mode              active | hold | off
 *   pin               force to front of eligible queue
 *   priority          higher = sooner (default 0)
 *   pairMinAnsem      override global PAIR_MIN_ANSEM (null = use global)
 *   force             include even if ranker marks “dead”
 *   note              free-text operator note
 *   targetWeightPct   0–100 share of LP book for future capital (null = none)
 *   redirectTo        pool/ticker key — future capital when this name is off
 *   takeOutDefaultPct optional default take-out slider
 *
 * Queue-level (cell.queuePrefs):
 *   sort / manualOrder / defaultMode
 *
 * Fund-level (cell.fundPolicy):
 *   takeOutProceeds / autoSellOnTakeOut / closeSetsMode / reinvestFollowsWeights
 */
import { config, saveCellJson } from '../config.js';
import { START_LIST, PAIR_MIN_ANSEM } from './whitepaper.js';

export const POOL_MODES = ['active', 'hold', 'off'];
export const QUEUE_SORTS = ['ranker', 'manual', 'alpha'];
export const TAKE_OUT_PROCEEDS = [
  'reserve',
  'ansem_send',
  'aemon_donate',
];

export function normalizeMode(mode, fallback = 'active') {
  const m = String(mode || fallback).toLowerCase();
  if (m === 'on' || m === 'seed' || m === 'yes') return 'active';
  if (m === 'keep' || m === 'hold' || m === 'freeze') return 'hold';
  if (m === 'off' || m === 'skip' || m === 'no') return 'off';
  return POOL_MODES.includes(m) ? m : fallback;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolish(v, fallback = false) {
  if (v == null) return fallback;
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function clampWeight(v) {
  const n = numOrNull(v);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

/** Normalize one pref object from cell.json. */
export function normalizePref(val, defaultMode = 'active') {
  if (val == null) {
    return {
      mode: defaultMode,
      pin: false,
      priority: 0,
      pairMinAnsem: null,
      force: false,
      note: '',
      targetWeightPct: null,
      redirectTo: '',
      takeOutDefaultPct: null,
    };
  }
  if (typeof val === 'string') {
    return {
      mode: normalizeMode(val, defaultMode),
      pin: false,
      priority: 0,
      pairMinAnsem: null,
      force: false,
      note: '',
      targetWeightPct: null,
      redirectTo: '',
      takeOutDefaultPct: null,
    };
  }
  return {
    mode: normalizeMode(val.mode, defaultMode),
    pin: boolish(val.pin, false),
    priority: Number.isFinite(Number(val.priority)) ? Number(val.priority) : 0,
    pairMinAnsem: numOrNull(val.pairMinAnsem),
    force: boolish(val.force, false),
    note: val.note != null ? String(val.note) : '',
    targetWeightPct: clampWeight(val.targetWeightPct),
    redirectTo: val.redirectTo != null ? String(val.redirectTo).trim() : '',
    takeOutDefaultPct: clampWeight(val.takeOutDefaultPct),
  };
}

/** True if pref equals defaults (can drop from cell.json). */
export function isDefaultPref(pref, defaultMode = 'active') {
  const p = normalizePref(pref, defaultMode);
  return (
    p.mode === defaultMode &&
    !p.pin &&
    p.priority === 0 &&
    p.pairMinAnsem == null &&
    !p.force &&
    !p.note &&
    p.targetWeightPct == null &&
    !p.redirectTo &&
    p.takeOutDefaultPct == null
  );
}

export function loadQueuePrefs() {
  const raw = config.cell?.queuePrefs || {};
  const sort = QUEUE_SORTS.includes(raw.sort) ? raw.sort : 'ranker';
  const defaultMode = normalizeMode(raw.defaultMode, 'active');
  const manualOrder = Array.isArray(raw.manualOrder)
    ? raw.manualOrder.map(String).filter(Boolean)
    : [];
  return { sort, defaultMode, manualOrder };
}

/** Always leave this % in an LP on take-out (controller-follow trim). Close = 100% is explicit. */
export const LEAVE_IN_POOL_PCT_DEFAULT = 10;

export function leaveInPoolPct() {
  const raw = config.cell?.fundPolicy?.leaveInPoolPct;
  const env = process.env.LEAVE_IN_POOL_PCT;
  const n = Number(raw != null && raw !== '' ? raw : env != null && env !== '' ? env : LEAVE_IN_POOL_PCT_DEFAULT);
  if (!Number.isFinite(n)) return LEAVE_IN_POOL_PCT_DEFAULT;
  return Math.max(0, Math.min(50, n));
}

/** Default take-out % = 100 − leave-in (e.g. 90 when leave 10). */
export function defaultTakeOutPct() {
  return Math.max(1, Math.min(100, 100 - leaveInPoolPct()));
}

/**
 * Cap a requested take-out % so leave-in stub remains (unless close = 100).
 * @param {number} [_valueUsd] unused — kept for call-site compatibility
 * @param {number} requestedPct
 */
export function cappedTakeOutPct(_valueUsd, requestedPct) {
  const req = Number(requestedPct);
  if (!Number.isFinite(req) || req <= 0) return 0;
  if (req >= 100) return 100;
  const max = defaultTakeOutPct();
  return Math.max(0, Math.min(max, req));
}

export function loadFundPolicy() {
  const raw = config.cell?.fundPolicy || {};
  let takeOutProceeds = String(raw.takeOutProceeds || 'reserve');
  if (
    !TAKE_OUT_PROCEEDS.includes(takeOutProceeds) &&
    !takeOutProceeds.startsWith('redeploy:')
  ) {
    takeOutProceeds = 'reserve';
  }
  const leavePct = leaveInPoolPct();
  return {
    takeOutProceeds,
    autoSellOnTakeOut: boolish(raw.autoSellOnTakeOut, true),
    closeSetsMode: normalizeMode(raw.closeSetsMode || 'off', 'off'),
    reinvestFollowsWeights: boolish(raw.reinvestFollowsWeights, true),
    /** Follow CONTROLLER/TRACKED top-N for seed universe */
    followController: boolish(raw.followController, true),
    /**
     * When controller dusts/exits a pool we hold: default leave LP to grow (mode=hold).
     * Only propose withdraw/trim when this is true.
     */
    autoTrimOnControllerExit: boolish(raw.autoTrimOnControllerExit, false),
    /** Controller position below this USD = dust / out of active top-N */
    controllerDustUsd: (() => {
      const n = Number(
        raw.controllerDustUsd ?? process.env.CONTROLLER_DUST_USD ?? 1,
      );
      return Number.isFinite(n) && n >= 0 ? n : 1;
    })(),
    leaveInPoolPct: leavePct,
    takeOutDefaultPct: defaultTakeOutPct(),
  };
}

export function saveFundPolicy(patch = {}) {
  const cur = loadFundPolicy();
  const next = {
    takeOutProceeds:
      patch.takeOutProceeds != null
        ? String(patch.takeOutProceeds)
        : cur.takeOutProceeds,
    autoSellOnTakeOut:
      patch.autoSellOnTakeOut != null
        ? boolish(patch.autoSellOnTakeOut)
        : cur.autoSellOnTakeOut,
    closeSetsMode:
      patch.closeSetsMode != null
        ? normalizeMode(patch.closeSetsMode, 'off')
        : cur.closeSetsMode,
    reinvestFollowsWeights:
      patch.reinvestFollowsWeights != null
        ? boolish(patch.reinvestFollowsWeights)
        : cur.reinvestFollowsWeights,
    followController:
      patch.followController != null
        ? boolish(patch.followController)
        : cur.followController,
    autoTrimOnControllerExit:
      patch.autoTrimOnControllerExit != null
        ? boolish(patch.autoTrimOnControllerExit)
        : cur.autoTrimOnControllerExit,
    controllerDustUsd:
      patch.controllerDustUsd != null
        ? Math.max(0, Number(patch.controllerDustUsd) || 0)
        : cur.controllerDustUsd,
    leaveInPoolPct:
      patch.leaveInPoolPct != null
        ? Math.max(0, Math.min(50, Number(patch.leaveInPoolPct) || 0))
        : cur.leaveInPoolPct,
  };
  if (
    !TAKE_OUT_PROCEEDS.includes(next.takeOutProceeds) &&
    !next.takeOutProceeds.startsWith('redeploy:')
  ) {
    next.takeOutProceeds = 'reserve';
  }
  saveCellJson({ fundPolicy: next });
  return loadFundPolicy();
}

export function loadPoolPrefs() {
  const q = loadQueuePrefs();
  const raw = config.cell?.poolPrefs || {};
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    out[key] = normalizePref(val, q.defaultMode);
  }
  return out;
}

/** Resolve pref for a start-list / queue row (pool address, then ticker). */
export function prefForRow(row, prefs = loadPoolPrefs(), queuePrefs = loadQueuePrefs()) {
  const byPool = row.pool ? prefs[row.pool] : null;
  const byTicker = row.ticker ? prefs[row.ticker] : null;
  const merged = {
    ...normalizePref(null, queuePrefs.defaultMode),
    ...(byTicker || {}),
    ...(byPool || {}),
  };
  const pref = normalizePref(merged, queuePrefs.defaultMode);
  return {
    ...pref,
    seedNew: pref.mode === 'active',
    holdExisting: pref.mode === 'hold',
    excluded: pref.mode === 'off',
  };
}

/** Follow redirect chain when a name is off (max 8 hops). */
export function resolveRedirectTarget(key, prefs = loadPoolPrefs(), depth = 0) {
  if (!key || depth > 8) return null;
  const pref = prefs[key] || prefForRow({ pool: key, ticker: key }, prefs);
  if (pref.mode !== 'off' || !pref.redirectTo) return null;
  const dest = pref.redirectTo;
  const destPref = prefs[dest] || prefForRow({ pool: dest, ticker: dest }, prefs);
  if (destPref.mode === 'off') {
    return resolveRedirectTarget(dest, prefs, depth + 1) || dest;
  }
  return dest;
}

function prefToStored(next) {
  return {
    mode: next.mode,
    ...(next.pin ? { pin: true } : {}),
    ...(next.priority ? { priority: next.priority } : {}),
    ...(next.pairMinAnsem != null ? { pairMinAnsem: next.pairMinAnsem } : {}),
    ...(next.force ? { force: true } : {}),
    ...(next.note ? { note: next.note } : {}),
    ...(next.targetWeightPct != null ? { targetWeightPct: next.targetWeightPct } : {}),
    ...(next.redirectTo ? { redirectTo: next.redirectTo } : {}),
    ...(next.takeOutDefaultPct != null
      ? { takeOutDefaultPct: next.takeOutDefaultPct }
      : {}),
  };
}

function mergePrefPatch(existing, patch, defaultMode) {
  const base = normalizePref(existing, defaultMode);
  const next = { ...base };
  if (patch.mode != null) next.mode = normalizeMode(patch.mode, defaultMode);
  if (patch.pin != null) next.pin = boolish(patch.pin);
  if (patch.priority != null) next.priority = Number(patch.priority) || 0;
  if (Object.prototype.hasOwnProperty.call(patch, 'pairMinAnsem')) {
    next.pairMinAnsem = numOrNull(patch.pairMinAnsem);
  }
  if (patch.force != null) next.force = boolish(patch.force);
  if (patch.note != null) next.note = String(patch.note);
  if (Object.prototype.hasOwnProperty.call(patch, 'targetWeightPct')) {
    next.targetWeightPct =
      patch.targetWeightPct == null || patch.targetWeightPct === ''
        ? null
        : clampWeight(patch.targetWeightPct);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'redirectTo')) {
    next.redirectTo = patch.redirectTo != null ? String(patch.redirectTo).trim() : '';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'takeOutDefaultPct')) {
    next.takeOutDefaultPct = clampWeight(patch.takeOutDefaultPct);
  }
  return next;
}

export function savePoolPref(poolOrTicker, modeOrPatch) {
  const key = String(poolOrTicker || '').trim();
  if (!key) throw new Error('pool or ticker required');
  const q = loadQueuePrefs();
  const current = { ...(config.cell?.poolPrefs || {}) };
  const patch =
    typeof modeOrPatch === 'string' || modeOrPatch == null
      ? { mode: modeOrPatch || 'active' }
      : modeOrPatch;

  const next = mergePrefPatch(current[key], patch, q.defaultMode);
  if (isDefaultPref(next, q.defaultMode)) {
    saveCellJson({ poolPrefs: { [key]: null } });
  } else {
    saveCellJson({ poolPrefs: { [key]: prefToStored(next) } });
  }
  return { key, pref: prefForRow({ pool: key, ticker: key }), prefs: loadPoolPrefs() };
}

export function savePoolPrefsBulk(map) {
  const q = loadQueuePrefs();
  const patch = {};
  for (const [key, val] of Object.entries(map || {})) {
    const k = String(key || '').trim();
    if (!k) continue;
    if (val == null) {
      patch[k] = null;
      continue;
    }
    const next =
      typeof val === 'string'
        ? normalizePref(val, q.defaultMode)
        : mergePrefPatch(config.cell?.poolPrefs?.[k], val, q.defaultMode);
    patch[k] = isDefaultPref(next, q.defaultMode) ? null : prefToStored(next);
  }
  saveCellJson({ poolPrefs: patch });
  return loadPoolPrefs();
}

export function saveQueuePrefs(patch = {}) {
  const cur = loadQueuePrefs();
  const next = {
    sort: QUEUE_SORTS.includes(patch.sort) ? patch.sort : cur.sort,
    defaultMode: patch.defaultMode != null ? normalizeMode(patch.defaultMode) : cur.defaultMode,
    manualOrder: Array.isArray(patch.manualOrder)
      ? patch.manualOrder.map(String).filter(Boolean)
      : cur.manualOrder,
  };
  saveCellJson({ queuePrefs: next });
  return loadQueuePrefs();
}

export function applyBulkMode(mode, filter = 'all', list = START_LIST, positionsByPool = new Map()) {
  const m = normalizeMode(mode);
  const patch = {};
  for (const n of list) {
    const key = n.pool || n.ticker;
    if (!key) continue;
    const inPool = n.pool ? positionsByPool.has(n.pool) : false;
    if (filter === 'in' && !inPool) continue;
    if (filter === 'out' && inPool) continue;
    patch[key] = { mode: m };
  }
  return savePoolPrefsBulk(patch);
}

export function poolPrefsBoard(list = START_LIST, prefs = loadPoolPrefs(), queuePrefs = loadQueuePrefs()) {
  return list.map((n) => {
    const pref = prefForRow(n, prefs, queuePrefs);
    return {
      ticker: n.ticker,
      pool: n.pool || '',
      mint: n.mint || '',
      ...pref,
    };
  });
}

/** Sum of targetWeightPct across prefs (active names with targets). */
export function sumTargetWeights(prefs = loadPoolPrefs()) {
  let sum = 0;
  for (const p of Object.values(prefs)) {
    if (p.targetWeightPct != null && p.mode === 'active') sum += p.targetWeightPct;
  }
  return sum;
}

export function flexibilityMeta() {
  return {
    modes: POOL_MODES,
    sorts: QUEUE_SORTS,
    takeOutProceeds: TAKE_OUT_PROCEEDS,
    fields: {
      mode: 'active | hold | off',
      pin: 'boolean — force front of eligible queue',
      priority: 'number — higher sooner',
      pairMinAnsem: 'number | null — per-pool min override',
      force: 'boolean — ignore dead filter',
      note: 'string',
      targetWeightPct: '0–100 | null — LP book target for future capital',
      redirectTo: 'pool/ticker key when off',
      takeOutDefaultPct: '0–100 | null',
    },
    queue: {
      sort: 'ranker | manual | alpha',
      manualOrder: 'string[] pool or ticker keys',
      defaultMode: 'active | hold | off',
    },
    fundPolicy: {
      takeOutProceeds: 'reserve | ansem_send | aemon_donate | redeploy:<key>',
      autoSellOnTakeOut: 'boolean',
      closeSetsMode: 'off (default)',
      reinvestFollowsWeights: 'boolean',
    },
    bulk: ['all_seed', 'all_hold', 'all_off', 'hold_in', 'seed_out'],
  };
}

export { PAIR_MIN_ANSEM };
