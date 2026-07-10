/**
 * Versioned node policy banner — micro_trader strategy_policy / hardcoded_profile bone.
 * One source of truth printed at boot and exposed via /api/gates_status.
 */
import { config, isLive } from '../config.js';
import {
  SOL_RESERVE,
  SOL_OPERATING_FLOOR,
  SOL_TARGET_RESERVE,
  SOL_RENT_PER_PAIR,
  RESERVE_PCT,
  PAIR_MIN_ANSEM,
} from './whitepaper.js';
import {
  operatingFloor,
  targetReserve,
  gasFloor,
  reserveSnapshot,
} from './sol-reserve.js';
import { leaveInPoolPct, defaultTakeOutPct, loadFundPolicy } from './pool-prefs.js';
import { getOperatorMode, getPairMinUsd, seedPassForMode } from './operator-mode.js';

export const NODE_POLICY_VERSION = 'ansem_private_v1';

export function seedUniverse() {
  return String(
    process.env.SEED_UNIVERSE || config.seedUniverse || 'tracked_top10',
  ).trim();
}

export function seedSort() {
  return String(process.env.SEED_SORT || config.seedSort || 'dip24').trim();
}

/** Snapshot of knobs that govern seed + capital — for logs and gates_status. */
export function getNodePolicy() {
  const fund = loadFundPolicy();
  const operatorMode = getOperatorMode();
  return {
    version: NODE_POLICY_VERSION,
    live: isLive(),
    dryRun: config.dryRun,
    simulationMode: config.simulationMode,
    operatorMode,
    pairMinUsd: getPairMinUsd(),
    seedUniverse: seedUniverse(),
    seedSort: seedSort(),
    followController: fund.followController !== false && operatorMode !== 'hold',
    leaveInPoolPct: fund.leaveInPoolPct ?? leaveInPoolPct(),
    takeOutDefaultPct: fund.takeOutDefaultPct ?? defaultTakeOutPct(),
    solReserve: config.solReserve ?? SOL_RESERVE,
    solOperatingFloor: config.solOperatingFloor ?? SOL_OPERATING_FLOOR,
    solTargetReserve: config.solTargetReserve ?? SOL_TARGET_RESERVE,
    solRentPerPair: config.solRentPerPair ?? SOL_RENT_PER_PAIR,
    reservePct: config.reservePct ?? RESERVE_PCT,
    pairMinAnsem: config.pairMinAnsem ?? PAIR_MIN_ANSEM,
    nodeActiveLimit: config.nodeActiveLimit ?? 10,
    apeMaxAgeMinutes: config.apeMaxAgeMinutes ?? 15,
    seedPass: seedPassForMode(operatorMode) || config.seedPass || 'coverage',
    lpWallet: config.lpWallet || null,
    controllerWallet: config.controllerWallet || null,
    trackedWallet: config.trackedWallet || null,
  };
}

export function logPolicyActivation() {
  const p = getNodePolicy();
  const line =
    `🔒 NODE_POLICY ${p.version} · MODE=${p.operatorMode} · follow=${p.followController ? 'controller' : 'manual'} · ` +
    `universe=${p.seedUniverse} sort=${p.seedSort} · leave=${p.leaveInPoolPct}% in LP (take ${p.takeOutDefaultPct}%) · ` +
    `gas=${gasFloor()} op=${operatingFloor()} target=${targetReserve()} · ` +
    `pair≥${p.pairMinAnsem} ANSEM / $${p.pairMinUsd} · active≤${p.nodeActiveLimit} · ` +
    `live=${p.live ? 'LIVE' : 'DRY'}`;
  console.log(line);
  return p;
}

/**
 * Build gates_status payload (blockers + policy).
 * @param {object} [extra] seedKeyStatus, census, sessionPnl, etc.
 */
export function buildGatesStatus(extra = {}) {
  const policy = getNodePolicy();
  const sol = Number(extra.sol ?? 0);
  const snap = reserveSnapshot(sol);
  const blockers = [];
  if (!policy.live) {
    blockers.push({
      code: 'DRY_RUN',
      reason: 'DRY_RUN or SIMULATION_MODE — no spend',
      stage: 'mode',
    });
  }
  if (snap.lowSol) {
    blockers.push({
      code: 'LOW_SOL_RESERVE',
      reason: snap.lowSolReason || 'below operating floor',
      stage: 'sol',
    });
  }
  if (extra.keys && !extra.keys.canLiveSeed && policy.live) {
    blockers.push({
      code: 'LP_KEY_MISMATCH',
      reason: (extra.keys.errors || [])[0] || extra.keys.hint || 'LP key mismatch',
      stage: 'keys',
    });
  }
  if (extra.goLive && !extra.goLive.allowed && policy.live) {
    blockers.push({
      code: 'GO_LIVE_BLOCKED',
      reason: extra.goLive.reason || 'dry-tick proof required',
      stage: 'go_live',
    });
  }
  return {
    ok: blockers.length === 0 || (!policy.live && blockers.every((b) => b.code === 'DRY_RUN')),
    policy,
    reserve: snap,
    blockers,
    census: extra.census
      ? {
          sol: extra.census.sol,
          indexDust: (extra.census.indexDust || []).map((h) => ({
            ticker: h.ticker,
            ui: h.ui,
            pool: h.pool,
          })),
          ansem: extra.census.ansem?.ui ?? 0,
          positions: extra.census.positions,
          orphans: (extra.census.orphans || []).length,
        }
      : null,
    sessionPnl: extra.sessionPnl || null,
    coverage: extra.coverage || null,
    keys: extra.keys
      ? {
          canLiveSeed: extra.keys.canLiveSeed,
          lpMatches: extra.keys.lpMatches,
          hint: extra.keys.hint,
        }
      : null,
    goLive: extra.goLive || null,
    at: new Date().toISOString(),
  };
}
