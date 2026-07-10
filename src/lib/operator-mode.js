/**
 * Holder-based operator modes — what's next for the node.
 *
 * CONTROLLER_WALLET is the reference book. Mode decides whether we:
 *   cover  — min in all top-N controller LPs
 *   mirror — deepen/trim toward controller weights
 *   ape    — enter fresh TOKEN–ANSEM pairs at ~$1 dual-sided
 *   hold   — no seed / no trim proposals
 *
 * Fees stay on Setup /#config (separate plane).
 */
import { config, reloadConfig, saveCellJson } from '../config.js';
import { PAIR_MIN_ANSEM } from './whitepaper.js';
import { NODE_MIN_USD } from '../constants.js';

export const OPERATOR_MODES = ['cover', 'mirror', 'ape', 'hold'];
export const PAIR_MIN_USD_DEFAULT = NODE_MIN_USD || 1;

export function normalizeOperatorMode(mode, fallback = 'cover') {
  const m = String(mode || fallback).toLowerCase().trim();
  if (m === 'coverage' || m === 'pass1') return 'cover';
  if (m === 'depth' || m === 'pass2' || m === 'reaccumulate') return 'mirror';
  if (m === 'ape' || m === 'new' || m === 'enter') return 'ape';
  if (m === 'hold' || m === 'pause' || m === 'idle') return 'hold';
  return OPERATOR_MODES.includes(m) ? m : fallback;
}

/** Derive legacy SEED_PASS from operator mode. */
export function seedPassForMode(mode) {
  const m = normalizeOperatorMode(mode);
  if (m === 'mirror') return 'depth';
  if (m === 'ape') return 'coverage'; // still open mins on fresh names
  return 'coverage';
}

export function getOperatorMode() {
  const fromEnv = process.env.OPERATOR_MODE;
  const fromConfig = config.operatorMode;
  const fromCell = config.cell?.runtime?.operatorMode;
  const raw = fromEnv || fromConfig || fromCell;
  if (!raw) {
    const pass = config.seedPass || 'coverage';
    if (pass === 'depth' || pass === 'pass2') return 'mirror';
    return 'cover';
  }
  return normalizeOperatorMode(raw);
}

export function getPairMinUsd() {
  const env = process.env.PAIR_MIN_USD;
  const cell = config.cell?.runtime?.pairMinUsd;
  const n = Number(env != null && env !== '' ? env : cell != null ? cell : PAIR_MIN_USD_DEFAULT);
  return Number.isFinite(n) && n > 0 ? n : PAIR_MIN_USD_DEFAULT;
}

/**
 * Dual floor: max(PAIR_MIN_ANSEM, PAIR_MIN_USD / ansemPrice / 2).
 * Dual-sided LP ≈ 2× ANSEM notional, so $1 total → $0.50 ANSEM side.
 */
export function resolvePairMinAnsem(opts = {}) {
  const floorAnsem = Math.max(
    0.1,
    Number(opts.pairMinAnsem ?? config.pairMinAnsem ?? PAIR_MIN_ANSEM) || PAIR_MIN_ANSEM,
  );
  const minUsd = Number(opts.pairMinUsd ?? getPairMinUsd()) || PAIR_MIN_USD_DEFAULT;
  const px = Number(opts.ansemPriceUsd) || 0;
  if (!(px > 0) || !(minUsd > 0)) {
    return {
      ansem: floorAnsem,
      pairMinUsd: minUsd,
      ansemPriceUsd: px || null,
      fromUsd: null,
      rule: `≥${floorAnsem} ANSEM (no mark)`,
    };
  }
  // Dual-sided: total USD ≈ 2 * ansem * price → ansem = usd / (2 * price)
  const fromUsd = minUsd / (2 * px);
  const ansem = Math.max(floorAnsem, fromUsd);
  return {
    ansem: Math.round(ansem * 1e6) / 1e6,
    pairMinUsd: minUsd,
    ansemPriceUsd: px,
    fromUsd: Math.round(fromUsd * 1e6) / 1e6,
    rule: `max(${floorAnsem} ANSEM, $${minUsd} dual) → ${ansem.toFixed(4)} ANSEM @ $${px.toFixed(4)}`,
  };
}

/**
 * Persist mode (+ optional pairMinUsd). Syncs seedPass for legacy readers.
 */
export function setOperatorMode(modeOrPatch, extra = {}) {
  const patch =
    typeof modeOrPatch === 'string' || modeOrPatch == null
      ? { operatorMode: modeOrPatch, ...extra }
      : { ...modeOrPatch, ...extra };

  const mode = normalizeOperatorMode(patch.operatorMode ?? getOperatorMode());
  const runtime = {
    operatorMode: mode,
    seedPass: seedPassForMode(mode),
  };
  if (patch.pairMinUsd != null && patch.pairMinUsd !== '') {
    const n = Number(patch.pairMinUsd);
    if (Number.isFinite(n) && n > 0) runtime.pairMinUsd = n;
  }
  if (patch.pairMinAnsem != null && patch.pairMinAnsem !== '') {
    const n = Number(patch.pairMinAnsem);
    if (Number.isFinite(n) && n > 0) runtime.pairMinAnsem = n;
  }

  saveCellJson({ runtime });
  reloadConfig();
  return getOperatorSnapshot();
}

export function getOperatorSnapshot(opts = {}) {
  const mode = getOperatorMode();
  const pairMinUsd = getPairMinUsd();
  const pairMin = resolvePairMinAnsem({
    ansemPriceUsd: opts.ansemPriceUsd,
    pairMinUsd,
  });
  return {
    operatorMode: mode,
    seedPass: seedPassForMode(mode),
    pairMinUsd,
    pairMinAnsem: config.pairMinAnsem ?? PAIR_MIN_ANSEM,
    effectivePairMinAnsem: pairMin.ansem,
    pairMinRule: pairMin.rule,
    followController: mode !== 'hold',
    allowApeJump: mode === 'ape',
    allowSeed: mode !== 'hold',
    allowTakeOutProposals: mode === 'mirror' || mode === 'cover',
    labels: {
      cover: 'Cover — min in controller top-N',
      mirror: 'Mirror — deepen/trim to controller weights',
      ape: 'Ape — enter fresh pairs at ~$1',
      hold: 'Hold — no seed / no trim',
    },
  };
}

/**
 * One-line operator hint for coverage board / doctor.
 */
export function modeHint(coverage, snap = getOperatorSnapshot()) {
  const mode = snap.operatorMode;
  if (mode === 'hold') {
    return 'MODE hold — flip to cover / mirror / ape to act';
  }
  if (mode === 'ape') {
    return `MODE ape · enter fresh pairs (≥${snap.effectivePairMinAnsem} ANSEM / $${snap.pairMinUsd})`;
  }
  if (mode === 'mirror') {
    const uw = coverage?.needMin?.length
      ? `underweight gaps · need mins: ${coverage.needMin.join(', ')}`
      : 'deepen underweight vs controller · trim overweight';
    return `MODE mirror · ${uw}`;
  }
  // cover
  if (coverage?.complete) {
    return `MODE cover · ${coverage.line} · DONE — switch to mirror to reaccumulate`;
  }
  if (coverage?.blocked) {
    return (
      coverage.operatorHint ||
      `MODE cover · ${coverage?.line || 'Coverage'} · need capital`
    );
  }
  return (
    coverage?.operatorHint ||
    `MODE cover · ${coverage?.line || 'Coverage'} · ▶ Run`
  );
}
