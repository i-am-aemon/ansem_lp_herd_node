/**
 * Per-pool Phantom cockpit — snapshot + unsigned claim/withdraw/close/deposit plans.
 * Index-only · owner-checked · never auto-signs.
 */
import { config } from '../config.js';
import { ANSEM_MINT } from '../constants.js';
import {
  findConstituent,
  isIndexPool,
  INDEX_VISION,
} from './ansem-index.js';
import {
  loadPoolPrefs,
  loadQueuePrefs,
  loadFundPolicy,
  prefForRow,
  savePoolPref,
} from './pool-prefs.js';
import { buildPortfolio, positionValueUsd, unclaimedFeesUsd } from './portfolio.js';
import {
  fetchPool,
  summarizePool,
  loadCachedStartListPools,
} from './meteora-api.js';
import { createMeteoraAdapter } from '../adapters/meteora.js';
import { PAIR_MIN_ANSEM } from './whitepaper.js';

function resolvePoolMeta(poolOrTicker) {
  const key = String(poolOrTicker || '').trim();
  if (!key) return null;
  return findConstituent(key);
}

function assertIndexPool(meta, key) {
  if (!meta?.pool || !isIndexPool(meta.pool)) {
    return {
      ok: false,
      error: `Pool not on ANSEM index start list — refuse (${key || 'empty'})`,
    };
  }
  return null;
}

/**
 * Owner must match configured LP wallet when one is set.
 * If LP unset, allow the requested wallet (Phantom connect-first).
 */
export function assertOwnerWallet(wallet) {
  const w = String(wallet || '').trim();
  if (!w || w.length < 32) {
    return { ok: false, error: 'wallet required (connect Phantom)' };
  }
  const lp = (config.lpWallet || '').trim();
  if (lp && lp !== w) {
    return {
      ok: false,
      error: `wallet must match node LP_WALLET (${lp.slice(0, 4)}…${lp.slice(-4)}). Connect that Phantom on Setup.`,
    };
  }
  return { ok: true, wallet: w };
}

/**
 * GET /api/pool snapshot
 */
export async function buildPoolSnapshot(opts = {}) {
  const key = String(opts.pool || opts.ticker || '').trim();
  const meta = resolvePoolMeta(key);
  const bad = assertIndexPool(meta, key);
  if (bad) return bad;

  const wallet = (opts.wallet || config.lpWallet || '').trim();
  const prefs = loadPoolPrefs();
  const queuePrefs = loadQueuePrefs();
  const pref = prefForRow(meta, prefs, queuePrefs);

  let poolMetrics = null;
  const cache = loadCachedStartListPools();
  if (cache?.byPool?.[meta.pool]) {
    poolMetrics = cache.byPool[meta.pool];
  } else {
    try {
      poolMetrics = summarizePool(await fetchPool(meta.pool));
    } catch (e) {
      poolMetrics = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  let positions = [];
  let portfolio = null;
  if (wallet) {
    try {
      portfolio = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT, {
        indexOnly: true,
        role: 'node',
        persistLedger: false,
      });
      positions = (portfolio.positions || []).filter((p) => p.pool_address === meta.pool);
    } catch {
      positions = [];
    }
  }

  const valueUsd = positions.reduce((s, p) => s + positionValueUsd(p), 0);
  const feesUsd = positions.reduce((s, p) => s + unclaimedFeesUsd(p), 0);

  const adapter = createMeteoraAdapter();
  const feeDetails = [];
  for (const p of positions) {
    const addr = p.position_address;
    if (!addr) continue;
    try {
      feeDetails.push({
        position: addr,
        ...(await adapter.readUnclaimedUsd(addr)),
      });
    } catch (_) {}
  }

  return {
    ok: true,
    fetched_at: new Date().toISOString(),
    vision: INDEX_VISION.headline,
    security: {
      indexOnly: true,
      autoSign: false,
      note: 'You approve every tx in Phantom. This site cannot move funds without Phantom.',
    },
    wallet: wallet || null,
    pool: {
      ticker: meta.ticker,
      mint: meta.mint,
      pool: meta.pool,
      minUsd: meta.minUsd,
      status: meta.status,
    },
    pref,
    metrics: poolMetrics,
    position: {
      count: positions.length,
      valueUsd,
      feesUsd,
      positions: positions.map((p) => ({
        position_address: p.position_address,
        valueUsd: positionValueUsd(p),
        feesUsd: unclaimedFeesUsd(p),
        pool_name: p.pool_name,
      })),
      feeDetails,
    },
    links: {
      meteora: `https://app.meteora.ag/pools/${meta.pool}`,
      jupiterToken: meta.mint ? `https://jup.ag/swap/SOL-${meta.mint}` : null,
      jupiterAnsem: `https://jup.ag/swap/SOL-${config.ansemMint || ANSEM_MINT}`,
      cockpit: `/pool?pool=${encodeURIComponent(meta.pool)}`,
    },
    policy: {
      pairMinAnsem: pref.pairMinAnsem ?? config.pairMinAnsem ?? PAIR_MIN_ANSEM,
      solReserve: config.solReserve,
      fundPolicy: loadFundPolicy(),
    },
  };
}

/**
 * GET/POST /api/pool-plan — unsigned claim | withdraw | close | deposit
 */
export async function buildPoolPlan(opts = {}) {
  const action = String(opts.action || 'claim').toLowerCase();
  const key = String(opts.pool || opts.ticker || '').trim();
  const meta = resolvePoolMeta(key);
  const bad = assertIndexPool(meta, key);
  if (bad) return bad;

  const ownerCheck = assertOwnerWallet(opts.wallet || config.lpWallet);
  if (!ownerCheck.ok) return ownerCheck;
  const wallet = ownerCheck.wallet;

  const fundPolicy = loadFundPolicy();
  const prefs = loadPoolPrefs();
  const pref = prefForRow(meta, prefs);
  const adapter = createMeteoraAdapter();
  const poolAddr = meta.pool;

  if (action === 'claim') {
    let positions = [];
    try {
      const p = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT, {
        indexOnly: true,
        persistLedger: false,
      });
      positions = (p.positions || []).filter((x) => x.pool_address === poolAddr);
    } catch {
      positions = [];
    }
    if (!positions.length) {
      return {
        ok: true,
        action: 'claim',
        wallet,
        pool: meta,
        status: 'EMPTY',
        actions: [],
        note: 'No open position on this pool for wallet',
        autoSign: false,
      };
    }
    const actions = [];
    for (const pos of positions) {
      const addr = pos.position_address;
      if (!addr) continue;
      const built = await adapter.buildClaimFeesTx(addr, wallet);
      actions.push({
        id: `claim_${addr.slice(0, 8)}`,
        type: 'claim',
        title: `Claim fees · ${meta.ticker}`,
        position: addr,
        ...built,
        autoSign: false,
      });
    }
    return {
      ok: true,
      action: 'claim',
      wallet,
      pool: meta,
      status: actions.some((a) => a.status === 'READY') ? 'READY' : 'EMPTY',
      actions,
      nextAction: actions.find((a) => a.status === 'READY') || actions[0] || null,
      autoSign: false,
      note: 'Unsigned claim txs — approve each in Phantom. Fresh blockhash on every build.',
    };
  }

  if (action === 'withdraw' || action === 'take_out' || action === 'close') {
    const pct =
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

    const withdraw = await adapter.buildWithdrawPlan({
      pool: poolAddr,
      owner: wallet,
      pct,
      buildTx: true,
    });

    const actions = (withdraw.txs || [])
      .filter((t) => t.status === 'READY')
      .map((t, i) => ({
        id: `withdraw_${i}`,
        type: 'withdraw',
        title: `Withdraw ~${pct}% · ${meta.ticker}`,
        detail: withdraw.quotes?.[i]
          ? `Expect ~${Number(withdraw.quotes[i].outAmountA).toPrecision(4)} A + ${Number(withdraw.quotes[i].outAmountB).toPrecision(4)} B`
          : undefined,
        ...t,
        autoSign: false,
      }));

    let closePrefs = null;
    if (action === 'close') {
      const redirect =
        opts.redirectTo != null ? String(opts.redirectTo).trim() : pref.redirectTo;
      closePrefs = {
        mode: fundPolicy.closeSetsMode || 'off',
        ...(redirect ? { redirectTo: redirect } : {}),
      };
      if (opts.applyClosePrefs === true) {
        savePoolPref(poolAddr, closePrefs);
      }
      actions.push({
        id: 'set_off',
        type: 'set_pref',
        title: `Mark ${meta.ticker} Off`,
        detail: closePrefs.redirectTo
          ? `mode=off · redirect → ${closePrefs.redirectTo}`
          : 'mode=off — no new deposits',
        autoSign: false,
      });
    }

    return {
      ok: true,
      action,
      wallet,
      pool: meta,
      pct,
      status: withdraw.status,
      quotes: withdraw.quotes,
      closePrefs,
      actions,
      nextAction: actions.find((a) => a.serialized) || actions[0] || null,
      links: withdraw.links,
      autoSign: false,
      note: 'Unsigned withdraw — approve in Phantom. Slippage thresholds applied in SDK builder.',
    };
  }

  if (action === 'deposit') {
    const pairMin = pref.pairMinAnsem ?? config.pairMinAnsem ?? PAIR_MIN_ANSEM;
    const ansemAmount = Number(opts.ansemAmount) || pairMin;
    const built = await adapter.buildAddLiquidityTx({
      pool: poolAddr,
      owner: wallet,
      ansemAmount,
      tokenMint: meta.mint,
    });

    const actions = [];
    if (built.status === 'READY' && built.serialized) {
      actions.push({
        id: 'deposit_sdk',
        type: 'deposit',
        title: `Deposit ${meta.ticker}–ANSEM (SDK)`,
        detail: built.detail || `~${ansemAmount} ANSEM dual-sided`,
        ...built,
        autoSign: false,
      });
    } else {
      actions.push({
        id: 'deposit_link',
        type: 'deposit',
        title: `Deposit ${meta.ticker} on Meteora`,
        detail:
          built.error ||
          built.note ||
          'SDK deposit unavailable — open Meteora, approve in Phantom.',
        status: built.status || 'DEEP_LINK',
        links: {
          meteora: `https://app.meteora.ag/pools/${poolAddr}`,
          jupiterToken: meta.mint ? `https://jup.ag/swap/SOL-${meta.mint}` : null,
          jupiterAnsem: `https://jup.ag/swap/SOL-${config.ansemMint || ANSEM_MINT}`,
        },
        autoSign: false,
      });
    }

    return {
      ok: true,
      action: 'deposit',
      wallet,
      pool: meta,
      status: built.status,
      ansemAmount,
      actions,
      nextAction: actions[0],
      deposit: built,
      autoSign: false,
      note: 'Deposit never auto-signs. Prefer SDK tx when READY; else Meteora deep link.',
    };
  }

  return { ok: false, error: 'action must be claim | withdraw | take_out | close | deposit' };
}
