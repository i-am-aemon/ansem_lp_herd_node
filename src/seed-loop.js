/**
 * Automated seed executor — micro_trader-style:
 * buildSeedPlan → Jupiter buy / Meteora deposit → sign with LP_PRIVATE_KEY.
 * Never logs private keys. Refuse live seed on pubkey mismatch.
 */
import { config, isLive } from './config.js';
import { ANSEM_MINT, WSOL_MINT } from './constants.js';
import { PAIR_MIN_ANSEM } from './lib/whitepaper.js';
import {
  deployableSol,
  lowSolBlocks,
  operatingFloor,
  rentPerPair,
  sizeBuyAnsem,
  sizeTopupSol,
  targetReserve,
} from './lib/sol-reserve.js';
import { buildSeedPlan } from './lib/seed-plan.js';
import { createJupiterAdapter } from './adapters/jupiter.js';
import { createMeteoraAdapter } from './adapters/meteora.js';
import {
  getSolBalance,
  getTokenBalanceRaw,
  signAndSendTransaction,
} from './adapters/solana.js';
import { loadLpKeypair, seedKeyStatus } from './wallet.js';
import { newTickId, logPhase, logTx } from './logger.js';
import {
  sleep,
  isRateLimit,
  backoffSeconds,
  withRpcRetry,
} from './lib/rpc-patience.js';

const LAMPORTS_PER_SOL = 1e9;

let seedRunning = false;
let seedAbort = false;
let continuousSeedRunning = false;

export function abortSeedPass() {
  seedAbort = true;
}

export function isSeedRunning() {
  return seedRunning || continuousSeedRunning;
}

function trackSeed(action, fields = {}) {
  return logPhase('seed', action, {
    component: 'seed',
    ...fields,
  });
}

async function roughSolUsd() {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${WSOL_MINT}`,
      { headers: { 'User-Agent': 'ansem-private-node/1.0' } },
    );
    if (!res.ok) return 150;
    const payload = await res.json();
    const pairs = Array.isArray(payload) ? payload : payload?.pairs ?? [];
    const p = Number(pairs[0]?.priceUsd);
    return Number.isFinite(p) && p > 0 ? p : 150;
  } catch {
    return 150;
  }
}

/** Absolute minimum SOL to attempt a Meteora createPosition (NFT rent + fees). */
function rentMinForDeposit() {
  return Math.max(0.012, rentPerPair() * 1.5);
}

/**
 * Execute one seed plan step (topup_sol | buy_ansem | buy_token | deposit | stop).
 */
export async function runSeedOnce(opts = {}) {
  const forceDry = opts.forceDry === true;
  const dry = forceDry || !isLive();
  const tickId = newTickId();
  const keys = seedKeyStatus();

  if (!dry && !keys.canLiveSeed) {
    trackSeed('blocked', {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: keys.errors.join('; ') || keys.hint,
    });
    return {
      ok: false,
      dry_run: false,
      blocked: true,
      error: keys.errors[0] || 'LP key mismatch — cannot live seed',
      keys,
      finished: new Date().toISOString(),
    };
  }

  const wallet = (opts.wallet || config.lpWallet || '').trim();
  if (!wallet) {
    return {
      ok: false,
      error: 'LP_WALLET unset',
      finished: new Date().toISOString(),
    };
  }

  const plan = await buildSeedPlan({
    wallet,
    pass: opts.pass || config.seedPass || 'coverage',
  });
  if (!plan.ok) {
    trackSeed('plan_error', {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: plan.error,
    });
    return {
      ok: false,
      error: plan.error,
      dry_run: dry,
      finished: new Date().toISOString(),
    };
  }

  const action = plan.nextAction;
  if (!action) {
    trackSeed('idle', {
      status: 'ok',
      tick_id: tickId,
      detail: 'no next action',
    });
    return {
      ok: true,
      dry_run: dry,
      done: true,
      action: null,
      balances: plan.balances,
      finished: new Date().toISOString(),
    };
  }

  trackSeed('step', {
    status: 'ok',
    tick_id: tickId,
    detail: `${action.type} · ${action.title || action.ticker || ''}`,
  });

  if (action.type === 'stop') {
    trackSeed('stop', {
      status: 'ok',
      tick_id: tickId,
      detail: action.detail || action.title,
    });
    return {
      ok: true,
      dry_run: dry,
      done: true,
      stopped: true,
      action,
      balances: plan.balances,
      finished: new Date().toISOString(),
    };
  }

  let result;
  try {
    if (action.type === 'topup_sol') {
      result = await execTopupSol(action, { wallet, dry, tickId });
    } else if (action.type === 'buy_ansem' || action.type === 'buy_token') {
      result = await execBuy(action, { wallet, dry, tickId });
    } else if (action.type === 'deposit') {
      result = await execDeposit(action, { wallet, dry, tickId });
    } else {
      result = {
        status: 'skip',
        error: `unknown action type ${action.type}`,
        code: 'UNKNOWN_ACTION',
      };
      trackSeed('skip', {
        status: 'skip',
        code: 'UNKNOWN_ACTION',
        tick_id: tickId,
        detail: result.error,
      });
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    trackSeed('error', {
      status: 'fail',
      code: 'SEED_EXCEPTION',
      level: 'error',
      tick_id: tickId,
      detail: err,
    });
    result = { status: 'error', error: err };
  }

  return {
    ok: result.status === 'ok' || result.status === 'dry_run',
    dry_run: dry,
    action,
    result,
    balances: plan.balances,
    keys: dry ? keys : undefined,
    finished: new Date().toISOString(),
  };
}

async function ansemDecimals() {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const conn = new Connection(config.rpcUrl, 'confirmed');
    const supply = await conn.getTokenSupply(
      new PublicKey(config.ansemMint || ANSEM_MINT),
      'confirmed',
    );
    return supply.value.decimals;
  } catch {
    return 6;
  }
}

async function execTopupSol(action, { wallet, dry, tickId }) {
  const solBal = await getSolBalance(wallet);
  const ansemMint = config.ansemMint || ANSEM_MINT;
  const rawBal = await getTokenBalanceRaw(wallet, ansemMint);
  const dec = await ansemDecimals();
  const uiBal = Number(rawBal) / 10 ** dec;
  const pairMin = config.pairMinAnsem ?? PAIR_MIN_ANSEM;
  const solUsd = await roughSolUsd();
  let ansemPriceUsd = 0;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${ansemMint}`,
      { headers: { 'User-Agent': 'ansem-private-node/1.0' } },
    );
    if (res.ok) {
      const payload = await res.json();
      const pairs = Array.isArray(payload) ? payload : payload?.pairs ?? [];
      ansemPriceUsd = Number(pairs[0]?.priceUsd) || 0;
    }
  } catch {
    // ignore
  }
  const top = sizeTopupSol(solBal, uiBal, {
    pairMinKeep: Number(action.pairMinKeep) >= 0 ? Number(action.pairMinKeep) : pairMin,
    ansemPriceUsd,
    solUsd,
    target: Number(action.targetSol) || targetReserve(),
  });
  // Prefer planner-sized amount; allow emergency sell of nearly all ANSEM when pairMinKeep=0
  const keepFloor =
    Number(action.pairMinKeep) >= 0 ? Number(action.pairMinKeep) : pairMin;
  const ansemInUi =
    Number(action.ansem) > 0
      ? Math.min(Number(action.ansem), Math.max(0, uiBal - keepFloor))
      : top.ansemUi;

  if (!(ansemInUi > 0)) {
    trackSeed('topup_sol', {
      status: 'skip',
      code: 'INSUFFICIENT_ANSEM',
      tick_id: tickId,
      detail: `cannot top up — ANSEM ${uiBal.toFixed(4)} (keep ≥${pairMin})`,
    });
    return {
      status: 'skip',
      code: 'INSUFFICIENT_ANSEM',
      reason: 'insufficient ANSEM for topup_sol',
      ansem: uiBal,
    };
  }

  const rawIn = Math.floor(ansemInUi * 10 ** dec);
  const jupiter = createJupiterAdapter();
  let swap;
  try {
    swap = await jupiter.swapTokenRaw(ansemMint, WSOL_MINT, rawIn, wallet);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (dry) {
      trackSeed('topup_sol', {
        status: 'ok',
        tick_id: tickId,
        detail: `DRY would sell ~${ansemInUi.toFixed(4)} ANSEM → SOL (quote unavailable: ${err})`,
      });
      return { status: 'dry_run', ansem: ansemInUi, note: 'would ANSEM→SOL top-up', quoteError: err };
    }
    trackSeed('topup_sol', {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: err,
    });
    return { status: 'error', error: err };
  }

  if (swap.status === 'SKIP') {
    trackSeed('topup_sol', { status: 'skip', tick_id: tickId, detail: swap.reason || swap.error });
    return swap;
  }
  if (swap.status !== 'READY') {
    trackSeed('topup_sol', { status: 'fail', level: 'warn', tick_id: tickId, detail: swap.error });
    return { status: 'error', error: swap.error, quote: swap.quote };
  }

  if (dry) {
    trackSeed('topup_sol', {
      status: 'ok',
      tick_id: tickId,
      detail: `DRY would sell ~${ansemInUi.toFixed(4)} ANSEM → SOL (target ${targetReserve().toFixed(4)}◎)`,
    });
    return {
      status: 'dry_run',
      ansem: ansemInUi,
      inAmount: swap.inAmount,
      outAmount: swap.quote?.outAmount,
      note: 'would ANSEM→SOL top-up — flip DRY_RUN=false to send',
    };
  }

  const lpKp = loadLpKeypair();
  if (!lpKp) {
    trackSeed('topup_sol', {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: 'LP_PRIVATE_KEY required',
    });
    return { status: 'error', error: 'LP_PRIVATE_KEY required' };
  }

  const sig = await signAndSendTransaction(swap.serialized, [lpKp], 'seed_topup_sol');
  trackSeed('topup_sol', {
    status: 'ok',
    tick_id: tickId,
    sig,
    detail: `sold ~${ansemInUi.toFixed(4)} ANSEM → SOL`,
  });
  await sleep(1500);
  return {
    status: 'ok',
    sig,
    inAmount: swap.inAmount,
    outAmount: swap.quote?.outAmount,
    ansem: ansemInUi,
    payWith: 'ANSEM',
  };
}

async function execBuy(action, { wallet, dry, tickId }) {
  const solBal = await getSolBalance(wallet);
  const deployable = deployableSol(solBal);
  const outMint =
    action.type === 'buy_ansem'
      ? config.ansemMint || ANSEM_MINT
      : action.mint;
  if (!outMint) {
    trackSeed(action.type, {
      status: 'fail',
      code: 'MISSING_MINT',
      level: 'error',
      tick_id: tickId,
      detail: 'output mint missing',
    });
    return { status: 'error', code: 'MISSING_MINT', error: 'output mint missing' };
  }

  // Gate: don't burn fees on doomed ATA creates when critically low on SOL.
  // Coverage exception: allow if ≥ gas floor (ATA rent) — operating floor is soft.
  if (action.type === 'buy_token') {
    const block = lowSolBlocks(solBal);
    const gas = (await import('./lib/sol-reserve.js')).gasFloor();
    if (block.blocked && solBal + 1e-12 < gas) {
      trackSeed(action.type, {
        status: 'skip',
        code: block.code || 'LOW_SOL_RESERVE',
        tick_id: tickId,
        detail: block.reason,
      });
      return {
        status: 'skip',
        code: block.code || 'LOW_SOL_RESERVE',
        reason: block.reason,
        sol: solBal,
      };
    }
  }

  const jupiter = createJupiterAdapter();
  let swap;
  let payWith = 'SOL';
  let wantSol = 0;
  let ansemInUi = 0;

  try {
    if (action.type === 'buy_ansem') {
      const activeN = config.nodeActiveLimit || 5;
      const sized = sizeBuyAnsem(solBal, activeN);
      wantSol = Math.min(Number(action.sol) || sized.swapSol, sized.swapSol);
      if (wantSol < 0.001) {
        trackSeed(action.type, {
          status: 'skip',
          code: 'INSUFFICIENT_DEPLOYABLE_SOL',
          tick_id: tickId,
          detail: `buy_ansem would leave < operating floor (bal ${solBal.toFixed(4)}, leave ${sized.leaveSol.toFixed(4)})`,
        });
        return {
          status: 'skip',
          code: 'INSUFFICIENT_DEPLOYABLE_SOL',
          reason: 'insufficient deployable SOL after reserve',
        };
      }
      // Refuse if post-swap SOL would be below operating floor
      if (solBal - wantSol + 1e-12 < operatingFloor()) {
        trackSeed(action.type, {
          status: 'skip',
          code: 'BREACH_OPERATING_FLOOR',
          tick_id: tickId,
          detail: `refusing buy_ansem — would leave ${(solBal - wantSol).toFixed(4)}◎ < operating ${operatingFloor().toFixed(4)}◎`,
        });
        return {
          status: 'skip',
          code: 'BREACH_OPERATING_FLOOR',
          reason: 'buy_ansem would breach operating floor',
        };
      }
      const maxLamports = Math.floor(solBal * LAMPORTS_PER_SOL);
      swap = await jupiter.swapSolLamports(wantSol, outMint, wallet, maxLamports);
    } else {
      // Prefer SOL→TOKEN when we have gas; operating floor is soft for coverage.
      // Below operating: still spend a tiny SOL slice if ≥ gas floor.
      const gas = (await import('./lib/sol-reserve.js')).gasFloor();
      const softDeploy =
        solBal >= operatingFloor()
          ? deployable
          : Math.max(0, solBal - gas - 0.005);
      wantSol = Math.min(Math.max(0.008, softDeploy * 0.35), softDeploy);
      if (wantSol >= 0.005 && solBal >= gas) {
        const maxLamports = Math.floor(solBal * LAMPORTS_PER_SOL);
        swap = await jupiter.swapSolLamports(wantSol, outMint, wallet, maxLamports);
      } else {
        payWith = 'ANSEM';
        if (solBal < gas) {
          trackSeed(action.type, {
            status: 'skip',
            code: 'LOW_SOL_ATA',
            tick_id: tickId,
            detail: `SOL too low for ATA rent (${solBal.toFixed(4)} < ${gas.toFixed(4)}) — send SOL`,
          });
          return {
            status: 'skip',
            code: 'LOW_SOL_ATA',
            reason: 'insufficient SOL for ATA rent',
            sol: solBal,
          };
        }
        const ansemMint = config.ansemMint || ANSEM_MINT;
        const rawBal = await getTokenBalanceRaw(wallet, ansemMint);
        const dec = await ansemDecimals();
        const uiBal = Number(rawBal) / 10 ** dec;
        const pairMin = Number(action.ansem) || config.pairMinAnsem || 1;
        ansemInUi = Math.min(pairMin, Math.max(0, uiBal - pairMin));
        if (ansemInUi < pairMin * 0.5) {
          trackSeed(action.type, {
            status: 'skip',
            code: 'INSUFFICIENT_ANSEM',
            tick_id: tickId,
            detail: `need ~${pairMin} ANSEM free to buy ${action.ticker || 'TOKEN'} (have ${uiBal.toFixed(4)})`,
          });
          return {
            status: 'skip',
            code: 'INSUFFICIENT_ANSEM',
            reason: 'insufficient ANSEM to fund TOKEN side',
            ansem: uiBal,
          };
        }
        const rawIn = Math.floor(ansemInUi * 10 ** dec);
        swap = await jupiter.swapTokenRaw(ansemMint, outMint, rawIn, wallet);
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (dry) {
      trackSeed(action.type, {
        status: 'ok',
        tick_id: tickId,
        detail: `DRY would swap ${payWith === 'ANSEM' ? `~${ansemInUi} ANSEM` : `~${wantSol.toFixed(4)} SOL`} → ${action.ticker || (action.type === 'buy_ansem' ? 'ANSEM' : 'TOKEN')} (quote unavailable: ${err})`,
      });
      return {
        status: 'dry_run',
        sol: wantSol,
        ansem: ansemInUi || undefined,
        note: 'would Jupiter swap — quote failed in dry (network); live needs working Jupiter',
        quoteError: err,
      };
    }
    trackSeed(action.type, {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: err,
    });
    if (/TOKEN_NOT_TRADABLE|not tradable/i.test(err)) {
      return {
        status: 'skip',
        code: 'TOKEN_NOT_TRADABLE',
        error: err,
        ticker: action.ticker,
      };
    }
    return { status: 'error', error: err };
  }

  if (swap.status === 'SKIP') {
    trackSeed(action.type, {
      status: 'skip',
      tick_id: tickId,
      detail: swap.reason || swap.error,
    });
    return swap;
  }
  if (swap.status !== 'READY') {
    const detail = swap.error || swap.status;
    trackSeed(action.type, {
      status: 'fail',
      level: 'warn',
      tick_id: tickId,
      detail,
    });
    if (/TOKEN_NOT_TRADABLE|not tradable/i.test(String(detail))) {
      return {
        status: 'skip',
        code: 'TOKEN_NOT_TRADABLE',
        error: detail,
        ticker: action.ticker,
      };
    }
    return { status: 'error', error: detail, quote: swap.quote };
  }

  const solUsd = await roughSolUsd();
  const usd =
    payWith === 'SOL'
      ? ((swap.lamports || 0) / LAMPORTS_PER_SOL) * solUsd
      : null;

  if (dry) {
    trackSeed(action.type, {
      status: 'ok',
      tick_id: tickId,
      usd,
      detail:
        payWith === 'ANSEM'
          ? `DRY would swap ~${ansemInUi} ANSEM → ${action.ticker || 'TOKEN'}`
          : `DRY would swap ${((swap.lamports || 0) / LAMPORTS_PER_SOL).toFixed(4)} SOL → ${action.ticker || (action.type === 'buy_ansem' ? 'ANSEM' : 'TOKEN')}`,
    });
    logTx({
      kind: 'buy',
      status: 'dry_run',
      usd,
      ticker: action.ticker || (action.type === 'buy_ansem' ? 'ANSEM' : null),
      delta: 0,
      tick_id: tickId,
      did:
        payWith === 'ANSEM'
          ? `would buy ${action.ticker || 'TOKEN'} with ANSEM (dry)`
          : `would buy ${action.ticker || (action.type === 'buy_ansem' ? 'ANSEM' : 'TOKEN')} (dry)`,
    });
    return {
      status: 'dry_run',
      lamports: swap.lamports,
      inAmount: swap.inAmount,
      outAmount: swap.quote?.outAmount,
      payWith,
      note: 'would Jupiter swap — flip DRY_RUN=false to send',
    };
  }

  const lpKp = loadLpKeypair();
  if (!lpKp) {
    trackSeed(action.type, {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: 'LP_PRIVATE_KEY required',
    });
    return { status: 'error', error: 'LP_PRIVATE_KEY required' };
  }

  const sig = await signAndSendTransaction(
    swap.serialized,
    [lpKp],
    `seed_${action.type}`,
  );
  trackSeed(action.type, {
    status: 'ok',
    tick_id: tickId,
    usd,
    sig,
    detail:
      payWith === 'ANSEM'
        ? `swapped ~${ansemInUi} ANSEM → ${action.ticker || 'TOKEN'}`
        : `swapped ${((swap.lamports || 0) / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
  });
  logTx({
    kind: 'buy',
    status: 'ok',
    usd,
    ticker: action.ticker || (action.type === 'buy_ansem' ? 'ANSEM' : null),
    sig,
    delta: 0,
    tick_id: tickId,
    did:
      payWith === 'ANSEM'
        ? `bought ${action.ticker || 'TOKEN'} with ANSEM`
        : `bought ${action.ticker || (action.type === 'buy_ansem' ? 'ANSEM' : 'TOKEN')}`,
  });
  await sleep(1500);
  return {
    status: 'ok',
    sig,
    lamports: swap.lamports,
    inAmount: swap.inAmount,
    outAmount: swap.quote?.outAmount,
    payWith,
  };
}

async function execDeposit(action, { wallet, dry, tickId }) {
  const pool = action.pool;
  const ansemAmount = Number(action.ansem) || config.pairMinAnsem || 1;
  if (!pool) {
    trackSeed('deposit', {
      status: 'fail',
      code: 'MISSING_POOL',
      level: 'error',
      tick_id: tickId,
      detail: 'pool missing',
    });
    return { status: 'error', code: 'MISSING_POOL', error: 'pool missing' };
  }

  const solBal = await getSolBalance(wallet);
  // New position NFT needs ~0.002 SOL rent — skip doomed sims when critically low
  // (held-token deposits still need some SOL; operating floor is the gate)
  const block = lowSolBlocks(solBal);
  if (block.blocked && solBal < rentMinForDeposit()) {
    trackSeed('deposit', {
      status: 'skip',
      code: block.code || 'LOW_SOL_RESERVE',
      tick_id: tickId,
      detail: `${block.reason} — deposit needs rent`,
    });
    return {
      status: 'skip',
      code: block.code || 'LOW_SOL_RESERVE',
      reason: block.reason,
      sol: solBal,
    };
  }

  const meteora = createMeteoraAdapter();
  const built = await meteora.buildAddLiquidityTx({
    pool,
    owner: wallet,
    ansemAmount,
    tokenMint: action.mint,
  });

  if (built.status === 'DEEP_LINK' && built.quote?.needTokenA != null) {
    // Missing TOKEN side — try a small SOL→TOKEN buy then retry once (live only)
    trackSeed('deposit', {
      status: 'skip',
      code: 'NEED_TOKEN_SIDE',
      tick_id: tickId,
      detail: built.error || 'need TOKEN side first',
    });
    return {
      status: 'need_token',
      code: 'NEED_TOKEN_SIDE',
      error: built.error,
      quote: built.quote,
      links: built.links,
    };
  }

  if (built.status !== 'READY' || !built.serialized) {
    trackSeed('deposit', {
      status: 'fail',
      code: 'DEPOSIT_BUILD_FAIL',
      level: 'warn',
      tick_id: tickId,
      detail: built.error || built.status,
    });
    return {
      status: 'error',
      code: 'DEPOSIT_BUILD_FAIL',
      error: built.error || `deposit ${built.status}`,
      links: built.links,
    };
  }

  if (dry) {
    trackSeed('deposit', {
      status: 'ok',
      tick_id: tickId,
      detail: `DRY would ${built.method || 'deposit'} ${action.ticker || ''} ~${ansemAmount} ANSEM`,
    });
    logTx({
      kind: 'deposit',
      status: 'dry_run',
      usd: null,
      ticker: action.ticker || null,
      delta: 1,
      tick_id: tickId,
      did: `would add liquidity ${action.ticker || 'pool'} ~${ansemAmount} ANSEM (dry)`,
    });
    return {
      status: 'dry_run',
      method: built.method,
      quote: built.quote,
      note: 'would Meteora deposit — flip DRY_RUN=false to send',
    };
  }

  const lpKp = loadLpKeypair();
  if (!lpKp) {
    trackSeed('deposit', {
      status: 'fail',
      level: 'error',
      tick_id: tickId,
      detail: 'LP_PRIVATE_KEY required',
    });
    return { status: 'error', error: 'LP_PRIVATE_KEY required' };
  }

  const signers = [lpKp, ...(built.extraSigners || [])];
  const sig = await signAndSendTransaction(
    built.serialized,
    signers,
    `seed_deposit_${action.ticker || 'pool'}`,
  );
  trackSeed('deposit', {
    status: 'ok',
    tick_id: tickId,
    sig,
    detail: `${built.method} · ${action.ticker || pool.slice(0, 8)}`,
  });
  logTx({
    kind: 'deposit',
    status: 'ok',
    ticker: action.ticker || null,
    sig,
    delta: 1,
    tick_id: tickId,
    did: `added liquidity ${action.ticker || 'pool'} · ${built.method || 'deposit'}`,
  });
  await sleep(2000);
  return { status: 'ok', sig, method: built.method, quote: built.quote };
}

/**
 * Run multiple seed steps until stop / capital / maxSteps / abort.
 */
export async function runSeedPass(opts = {}) {
  if (seedRunning) {
    return { ok: false, error: 'seed pass already running' };
  }
  seedRunning = true;
  seedAbort = false;
  const maxSteps = Math.max(
    1,
    Number(opts.maxSteps ?? process.env.SEED_MAX_STEPS ?? 40) || 40,
  );
  const forceDry = opts.forceDry === true;
  const steps = [];
  const started = new Date().toISOString();

  trackSeed('pass_start', {
    status: 'ok',
    detail: `maxSteps=${maxSteps} dry=${forceDry || !isLive()}`,
  });
  logTx({
    kind: 'session_start',
    status: 'ok',
    delta: 0,
    did: `seed pass start · max ${maxSteps} · ${forceDry || !isLive() ? 'dry' : 'live'}`,
  });

  try {
    let sameSkip = 0;
    let lastSkipId = '';

    // Stair: scan claimable fees first (add-only capital for next focus token)
    try {
      const { listOpenPositions } = await import('./adapters/meteora.js');
      const positions = await listOpenPositions(config.lpWallet);
      let claimableUsd = 0;
      for (const p of positions || []) {
        const f = p.current_position?.unclaimed_fees;
        const usd = Number(f?.total_usd ?? f?.fee_usd ?? p.unclaimed_fees_usd ?? 0);
        if (Number.isFinite(usd) && usd > 0) claimableUsd += usd;
      }
      const minClaim = Number(config.minClaimUsd) || 1;
      if (claimableUsd < minClaim) {
        trackSeed('waiting_claim', {
          status: 'skip',
          code: 'WAITING_CLAIM',
          detail: `Open · waiting for $${minClaim} claimable (now $${claimableUsd.toFixed(2)})`,
        });
        logTx({
          kind: 'skip',
          status: 'skip',
          usd: claimableUsd,
          min_usd: minClaim,
          delta: 0,
          did: `waiting · $${claimableUsd.toFixed(2)} < $${minClaim} claim min`,
        });
      } else {
        trackSeed('claim_ready', {
          status: 'ok',
          code: 'CLAIMABLE',
          detail: `$${claimableUsd.toFixed(2)} claimable ≥ $${minClaim} — claim then focus one token`,
          usd: claimableUsd,
        });
        if (!(forceDry || !isLive())) {
          try {
            const meteora = createMeteoraAdapter();
            const lpKp = loadLpKeypair();
            const eligible = (positions || [])
              .map((p) => ({
                position: p.position_address,
                feesUsd: Number(
                  p.current_position?.unclaimed_fees?.total_usd ??
                    p.unclaimed_fees_usd ??
                    0,
                ),
              }))
              .filter((r) => r.feesUsd >= minClaim)
              .sort((a, b) => b.feesUsd - a.feesUsd)
              .slice(0, 1);
            for (const row of eligible) {
              if (!lpKp) break;
              const built = await meteora.buildClaimFeesTx(
                row.position,
                config.lpWallet,
              );
              if (built.status !== 'READY' || !built.serialized) {
                trackSeed('claim', {
                  status: 'skip',
                  detail: built.error || 'not ready',
                  usd: row.feesUsd,
                });
                continue;
              }
              const sig = await withRpcRetry(
                () =>
                  signAndSendTransaction(
                    built.serialized,
                    [lpKp],
                    `seed_claim_${row.position?.slice(0, 8)}`,
                  ),
                {
                  label: 'seed_claim',
                  maxAttempts: 5,
                  onRetry: (info) =>
                    trackSeed('rpc_retry', {
                      status: 'skip',
                      code: 'RPC_429',
                      detail: `claim backoff ${info.waitSec}s (try ${info.attempt})`,
                    }),
                },
              );
              trackSeed('claim', {
                status: 'ok',
                usd: row.feesUsd,
                sig,
                detail: `claimed ~$${row.feesUsd.toFixed(2)}`,
              });
              logTx({
                kind: 'claim',
                status: 'ok',
                usd: row.feesUsd,
                min_usd: minClaim,
                sig,
                delta: 0,
                did: `claimed ~$${row.feesUsd.toFixed(2)} fees`,
              });
              await sleep(2500);
            }
          } catch (e) {
            trackSeed('claim', {
              status: 'fail',
              detail: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
    } catch (e) {
      trackSeed('waiting_claim', {
        status: 'skip',
        detail: `claim scan failed: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          160,
        ),
      });
    }

    // Print coverage board once at start
    try {
      const { buildSeedPlan } = await import('./lib/seed-plan.js');
      const plan0 = await buildSeedPlan({
        wallet: config.lpWallet,
        maxActions: 2,
        skipControllerSync: true,
      });
      if (plan0.coverage) {
        console.log(
          `MODE ${plan0.coverage.operatorMode || 'cover'} · ${plan0.coverage.line}`,
        );
        if (plan0.coverage.pairMinRule) {
          console.log(`PAIR min ${plan0.coverage.pairMinRule}`);
        }
        console.log(`NEXT ${plan0.coverage.operatorHint}`);
        trackSeed('coverage', {
          status: plan0.coverage.complete ? 'ok' : 'skip',
          code: 'COVERAGE',
          detail: plan0.coverage.line,
          meta_json: {
            done: plan0.coverage.done,
            total: plan0.coverage.total,
            needMin: plan0.coverage.needMin,
            next: plan0.coverage.next,
            operatorMode: plan0.coverage.operatorMode,
            pairMin: plan0.coverage.effectivePairMinAnsem,
            focusTicker: plan0.coverage.focusTicker,
            stair: plan0.coverage.stair,
          },
        });
        if (plan0.coverage.focusTicker) {
          trackSeed('focus', {
            status: 'ok',
            code: 'FOCUS_TOKEN',
            detail: `Focus ${plan0.coverage.focusTicker} · add-only (never remove)`,
          });
        }
      }
    } catch {
      /* non-fatal */
    }
    for (let i = 0; i < maxSteps; i++) {
      if (seedAbort) {
        trackSeed('pass_abort', { status: 'ok', detail: 'user stop' });
        break;
      }
      const step = await runSeedOnce({ ...opts, forceDry });
      steps.push(step);
      if (step.blocked) break;
      if (step.done || step.stopped) break;
      if (!step.ok && step.result?.status === 'error') {
        const err = String(step.result?.error || '');
        // Patient RPC ladder (micro_trader): 3s, 6s, 12s… up to 6 tries
        if (isRateLimit(err) && sameSkip < 6) {
          const waitSec = backoffSeconds(sameSkip, { patient: true });
          sameSkip += 1;
          trackSeed('rpc_retry', {
            status: 'skip',
            code: 'RPC_429',
            detail: `backoff ${waitSec}s after 429 (try ${sameSkip}/6)`,
          });
          await sleep(waitSec * 1000);
          continue;
        }
        break;
      }
      if (step.result?.status === 'need_token') {
        const id = step.action?.id || 'need_token';
        const ticker = step.action?.ticker;
        // Auto-buy TOKEN side once, then retry deposit on next loop
        if (ticker && sameSkip < 1 && step.action?.mint) {
          trackSeed('auto_buy_token', {
            status: 'ok',
            code: 'NEED_TOKEN_SIDE',
            detail: `deposit needs ${ticker} — buying TOKEN side`,
          });
          try {
            const buyAction = {
              id: `buy_token_${ticker}`,
              type: 'buy_token',
              ticker,
              mint: step.action.mint,
              pool: step.action.pool,
              ansem: step.action.ansem,
              title: `Buy ${ticker} (TOKEN side)`,
            };
            const buyResult = await execBuy(buyAction, {
              wallet: config.lpWallet,
              dry: forceDry || !isLive(),
              tickId: `auto_${Date.now()}`,
            });
            steps.push({
              ok: buyResult.status === 'ok' || buyResult.status === 'dry_run',
              action: buyAction,
              result: buyResult,
              finished: new Date().toISOString(),
            });
            if (buyResult.status === 'ok' || buyResult.status === 'dry_run') {
              sameSkip = 0;
              lastSkipId = '';
              await sleep(800);
              continue;
            }
          } catch (e) {
            trackSeed('auto_buy_token', {
              status: 'fail',
              detail: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (id === lastSkipId) sameSkip += 1;
        else {
          lastSkipId = id;
          sameSkip = 1;
        }
        // Same deposit stuck needing TOKEN — stop (don't spin maxSteps)
        if (sameSkip >= 2) {
          trackSeed('pass_stuck', {
            status: 'skip',
            code: 'NEED_TOKEN_SIDE',
            detail: `stuck on ${id} — buy more TOKEN or skip`,
          });
          break;
        }
        await sleep(500);
        continue;
      }
      if (step.result?.status === 'skip') {
        const id = step.action?.id || step.result?.reason || 'skip';
        const code = step.result?.code || '';
        // Untradable TOKEN — park pool as hold so coverage doesn't spin forever
        if (
          code === 'TOKEN_NOT_TRADABLE' &&
          step.action?.pool &&
          step.action?.type === 'buy_token'
        ) {
          try {
            const { savePoolPref } = await import('./lib/pool-prefs.js');
            savePoolPref(step.action.pool, {
              mode: 'hold',
              note: `auto: Jupiter TOKEN_NOT_TRADABLE ${new Date().toISOString().slice(0, 10)}`,
            });
            trackSeed('pool_hold', {
              status: 'ok',
              code: 'TOKEN_NOT_TRADABLE',
              detail: `${step.action.ticker || step.action.pool} → hold (not tradable)`,
            });
          } catch (_) {
            /* non-fatal */
          }
          sameSkip = 0;
          lastSkipId = '';
          await sleep(300);
          continue;
        }
        if (id === lastSkipId) sameSkip += 1;
        else {
          lastSkipId = id;
          sameSkip = 1;
        }
        // Same action skipped twice → capital/plan stuck; stop the pass
        if (sameSkip >= 2 || !step.action) break;
        await sleep(500);
        continue;
      }
      sameSkip = 0;
      lastSkipId = '';
      // Patient gap between successful steps (avoid RPC storms)
      await sleep(2500);
    }
  } finally {
    seedRunning = false;
    seedAbort = false;
  }

  trackSeed('pass_end', {
    status: 'ok',
    detail: `${steps.length} steps`,
  });
  logTx({
    kind: 'session_end',
    status: seedAbort ? 'skip' : 'ok',
    delta: 0,
    did: seedAbort ? 'seed pass stopped' : `seed pass end · ${steps.length} steps`,
  });

  return {
    ok: true,
    dry_run: forceDry || !isLive(),
    started,
    finished: new Date().toISOString(),
    steps,
    last: steps[steps.length - 1] || null,
    aborted: seedAbort,
  };
}

/**
 * Keep seeding until Shut down / abort. Between passes, pause briefly so RPC cools.
 * Used by ▶ Start for always-on cover→mirror toward goals.
 */
export async function runContinuousSeed(opts = {}) {
  if (seedRunning || continuousSeedRunning) {
    return { ok: false, error: 'seed pass already running' };
  }
  const forceDry = opts.forceDry === true;
  const maxSteps =
    Math.max(1, Number(opts.maxSteps ?? process.env.SEED_MAX_STEPS ?? 40) || 40);
  const gapMs = Math.max(
    3000,
    Number(opts.gapMs ?? process.env.SEED_PASS_GAP_MS ?? 12_000) || 12_000,
  );
  const passes = [];
  seedAbort = false;
  continuousSeedRunning = true;

  trackSeed('continuous_start', {
    status: 'ok',
    detail: `continuous seed · gap ${gapMs}ms`,
  });

  try {
    while (!seedAbort) {
      const pass = await runSeedPass({
        forceDry,
        maxSteps,
      });
      passes.push({
        finished: pass.finished,
        steps: pass.steps?.length || 0,
        aborted: pass.aborted,
      });
      if (seedAbort || pass.aborted) break;
      const until = Date.now() + gapMs;
      while (!seedAbort && Date.now() < until) {
        await sleep(500);
      }
    }
  } finally {
    continuousSeedRunning = false;
  }

  trackSeed('continuous_end', {
    status: 'ok',
    detail: `${passes.length} passes`,
  });
  return {
    ok: true,
    dry_run: forceDry || !isLive(),
    continuous: true,
    passes,
    finished: new Date().toISOString(),
  };
}
