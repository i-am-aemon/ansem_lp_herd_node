/**
 * micro_trader-style SOL reserve rules for seed.
 * Never dump almost all SOL into ANSEM — leave rent for ATAs / position NFTs.
 * If already below the operating floor, size an ANSEM→SOL top-up.
 */
import { config } from '../config.js';
import {
  SOL_RESERVE,
  SOL_OPERATING_FLOOR,
  SOL_TARGET_RESERVE,
  SOL_RENT_PER_PAIR,
  RESERVE_PCT,
} from './whitepaper.js';

function envNum(key, fallback) {
  const v = process.env[key];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Gas floor — never spend this (config / whitepaper). */
export function gasFloor() {
  return Math.max(
    0.005,
    Number(config.solReserve ?? envNum('SOL_RESERVE', SOL_RESERVE)) || SOL_RESERVE,
  );
}

/** Block new ATA / buys below this. */
export function operatingFloor() {
  return Math.max(
    gasFloor(),
    Number(config.solOperatingFloor ?? envNum('SOL_OPERATING_FLOOR', SOL_OPERATING_FLOOR)) ||
      SOL_OPERATING_FLOOR,
  );
}

/** Target after topup_sol recovery. */
export function targetReserve() {
  return Math.max(
    operatingFloor(),
    Number(config.solTargetReserve ?? envNum('SOL_TARGET_RESERVE', SOL_TARGET_RESERVE)) ||
      SOL_TARGET_RESERVE,
  );
}

export function rentPerPair() {
  return Math.max(
    0.002,
    Number(config.solRentPerPair ?? envNum('SOL_RENT_PER_PAIR', SOL_RENT_PER_PAIR)) ||
      SOL_RENT_PER_PAIR,
  );
}

export function reservePct() {
  const p = Number(config.reservePct ?? envNum('RESERVE_PCT', RESERVE_PCT));
  return Number.isFinite(p) && p > 0 ? Math.min(0.5, p) : RESERVE_PCT;
}

/** max(gasFloor, wallet × RESERVE_PCT) — micro_trader _effective_sol_reserve. */
export function effectiveSolReserve(solBal) {
  const bal = Math.max(0, Number(solBal) || 0);
  const pct = reservePct();
  return Math.max(gasFloor(), bal * pct);
}

export function deployableSol(solBal) {
  return Math.max(0, (Number(solBal) || 0) - effectiveSolReserve(solBal));
}

export function rentBufferForPairs(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  return count * rentPerPair();
}

/**
 * Block new spends (except topup_sol) when free SOL is below operating floor.
 * @returns {{ blocked: boolean, reason: string, floor: number, sol: number }}
 */
export function lowSolBlocks(solBal) {
  const sol = Math.max(0, Number(solBal) || 0);
  const floor = operatingFloor();
  if (sol + 1e-12 >= floor) {
    return { blocked: false, reason: '', floor, sol };
  }
  return {
    blocked: true,
    code: 'LOW_SOL_RESERVE',
    reason: `LOW_SOL: ${sol.toFixed(4)}◎ < operating ${floor.toFixed(4)}◎ — top up via ANSEM→SOL`,
    floor,
    sol,
  };
}

/**
 * How much SOL to swap → ANSEM while leaving rent for active pairs + operating floor.
 * @param {number} solBal
 * @param {number} [activePairCount=10]
 * @returns {{ swapSol: number, leaveSol: number, deployable: number }}
 */
export function sizeBuyAnsem(solBal, activePairCount = 10) {
  const bal = Math.max(0, Number(solBal) || 0);
  const pairs = Math.max(0, Math.floor(Number(activePairCount) || 0));
  // Cap rent buffer so a small pot can still buy ANSEM for coverage
  const rentCap = Math.min(rentBufferForPairs(pairs), Math.max(0, bal - operatingFloor() - 0.005));
  const leaveSol = Math.max(
    operatingFloor(),
    effectiveSolReserve(bal),
    rentCap,
  );
  const swapSol = Math.max(0, bal - leaveSol);
  return {
    swapSol: swapSol >= 0.001 ? swapSol : 0,
    leaveSol,
    deployable: deployableSol(bal),
  };
}

/**
 * Size ANSEM→SOL top-up to reach SOL_TARGET_RESERVE.
 * Keeps at least `pairMinKeep` ANSEM for LP.
 * @returns {{ needSol: number, ansemUi: number, keepAnsem: number, reachable: boolean }}
 */
export function sizeTopupSol(solBal, ansemUi, opts = {}) {
  const sol = Math.max(0, Number(solBal) || 0);
  const ansem = Math.max(0, Number(ansemUi) || 0);
  const target = Number(opts.target) || targetReserve();
  const pairMinKeep = Math.max(0, Number(opts.pairMinKeep) ?? 1);
  const ansemPriceUsd = Number(opts.ansemPriceUsd) || 0;
  const solUsd = Number(opts.solUsd) || 150;

  const needSol = Math.max(0, target - sol);
  if (needSol < 0.001) {
    return { needSol: 0, ansemUi: 0, keepAnsem: ansem, reachable: true };
  }

  const freeAnsem = Math.max(0, ansem - pairMinKeep);
  if (freeAnsem <= 0 || ansemPriceUsd <= 0 || solUsd <= 0) {
    return { needSol, ansemUi: 0, keepAnsem: ansem, reachable: false };
  }

  const ansemNeeded = (needSol * solUsd) / ansemPriceUsd;
  const sell = Math.min(freeAnsem, ansemNeeded * 1.02); // small slip buffer
  // Reachable if we can cover ≥50% of the gap, OR at least push past operating floor
  const proceedsSol = (sell * ansemPriceUsd) / solUsd;
  const reachesOperating = sol + proceedsSol + 1e-12 >= operatingFloor();
  const reachable =
    sell * ansemPriceUsd >= needSol * solUsd * 0.5 || reachesOperating;
  return {
    needSol,
    ansemUi: sell,
    keepAnsem: ansem - sell,
    reachable,
  };
}

export function reserveSnapshot(solBal) {
  const sol = Math.max(0, Number(solBal) || 0);
  const block = lowSolBlocks(sol);
  return {
    sol,
    gasFloor: gasFloor(),
    operatingFloor: operatingFloor(),
    targetReserve: targetReserve(),
    effectiveReserve: effectiveSolReserve(sol),
    deployable: deployableSol(sol),
    rentPerPair: rentPerPair(),
    reservePct: reservePct(),
    lowSol: block.blocked,
    lowSolReason: block.reason || null,
  };
}
