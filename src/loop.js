import { config, isLive } from './config.js';
import { splitFees, applyAnsemSendCap, ROUTE_TYPES } from './router.js';
import {
  createMeteoraAdapter,
  listOpenPositions,
} from './adapters/meteora.js';
import { createJupiterAdapter } from './adapters/jupiter.js';
import {
  sweepSol,
  getSolBalance,
  getTokenBalanceRaw,
  signAndSendTransaction,
  buildTokenTransferTx,
  buildSolTransferTx,
  LAMPORTS_PER_SOL,
} from './adapters/solana.js';
import { loadLpKeypair, loadOperatorKeypair } from './wallet.js';
import { ESTIMATED_GAS_SOL } from './constants.js';
import { newTickId, logPhase, tickSummary, logError, logTx } from './logger.js';
import { appendTickRecord } from './audit.js';
import { buildPortfolio } from './lib/portfolio.js';

function trackPhase(phase, action, fields = {}) {
  const level = fields.level || 'info';
  return logPhase(phase, action, {
    cell_id: config.cellId,
    level,
    ...fields,
  });
}

async function fetchSolUsd() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    return Number(j?.solana?.usd) || 0;
  } catch {
    return 0;
  }
}

function feesUsdFromApiPosition(p) {
  const f = p.current_position?.unclaimed_fees;
  if (!f) return 0;
  return (f.amount_x_usd ?? 0) + (f.amount_y_usd ?? 0);
}

export function planTick({ operatorSol, solUsd, claimableFeesUsd }) {
  const operatorUsd = operatorSol * (solUsd || 0);
  const spendableFromOp = Math.max(0, operatorUsd - config.minReserveUsd);
  const pool = Math.min(
    spendableFromOp,
    claimableFeesUsd > 0 ? claimableFeesUsd : spendableFromOp,
    config.maxBuyUsdPerRun,
  );

  if (pool < config.minRouteUsd) {
    return {
      status: 'skip',
      reason: `spendable $${pool.toFixed(2)} < MIN_ROUTE_USD $${config.minRouteUsd}`,
      legs: [],
      totalUsd: 0,
    };
  }

  let legs = splitFees(pool).legs;
  legs = applyAnsemSendCap(legs, pool, config.ansemSendCapUsd);
  legs = legs.filter(
    (l) => l.usd >= config.minRouteUsd || l.type === ROUTE_TYPES.SOL_RESERVE,
  );

  return {
    status: 'ready',
    totalUsd: pool,
    legs,
    operatorUsd,
    solUsd,
  };
}

async function claimEligiblePositions(meteora, dryRun) {
  const positions = await listOpenPositions(config.lpWallet);
  const withFees = positions
    .map((p) => ({
      position: p.position_address,
      pool: p.pool_address,
      name: p.pool_name,
      feesUsd: feesUsdFromApiPosition(p),
    }))
    .filter((p) => p.feesUsd >= config.minClaimUsd)
    .sort((a, b) => b.feesUsd - a.feesUsd)
    .slice(0, config.maxClaimPerTick);

  const results = [];
  let claimedUsd = 0;

  if (!withFees.length) {
    const claimableAll = positions.reduce((s, p) => s + feesUsdFromApiPosition(p), 0);
    trackPhase('claim', 'none', {
      status: 'ok',
      detail: `scanned ${positions.length}, none above MIN_CLAIM_USD`,
    });
    logTx({
      kind: 'skip',
      status: 'skip',
      usd: claimableAll,
      min_usd: config.minClaimUsd,
      delta: 0,
      did: `fees under minimum — $${Number(claimableAll).toFixed(2)} < $${config.minClaimUsd}`,
    });
    return { results, claimedUsd, scanned: positions.length };
  }

  const lpKp = loadLpKeypair();
  if (!dryRun && !lpKp) {
    trackPhase('claim', 'blocked', {
      status: 'fail',
      level: 'error',
      detail: 'LP_PRIVATE_KEY required to claim',
    });
    return {
      results: [{ status: 'blocked', error: 'LP_PRIVATE_KEY required to claim' }],
      claimedUsd: 0,
      scanned: positions.length,
    };
  }

  for (const row of withFees) {
    const built = await meteora.buildClaimFeesTx(row.position, config.lpWallet);
    if (built.status === 'SKIP') {
      results.push({ ...row, status: 'skip', reason: built.error });
      trackPhase('claim', 'skip', {
        status: 'skip',
        usd: row.feesUsd,
        detail: built.error,
      });
      continue;
    }
    if (built.status !== 'READY') {
      results.push({ ...row, status: 'error', error: built.error });
      trackPhase('claim', 'error', {
        status: 'fail',
        level: 'warn',
        usd: row.feesUsd,
        detail: built.error,
      });
      continue;
    }

    if (dryRun) {
      results.push({
        ...row,
        status: 'dry_run',
        note: 'would claimPositionFee2',
      });
      claimedUsd += row.feesUsd;
      trackPhase('claim', 'dry_run', {
        status: 'ok',
        usd: row.feesUsd,
        detail: row.position?.slice(0, 8),
      });
      logTx({
        kind: 'claim',
        status: 'dry_run',
        usd: row.feesUsd,
        min_usd: config.minClaimUsd,
        ticker: row.name || null,
        delta: 0,
        did: `would claim ~$${row.feesUsd.toFixed(2)} (dry)`,
      });
      continue;
    }

    try {
      const sig = await signAndSendTransaction(
        built.serialized,
        [lpKp],
        `claim:${row.position.slice(0, 8)}`,
      );
      results.push({ ...row, status: 'claimed', sig });
      claimedUsd += row.feesUsd;
      trackPhase('claim', 'claimed', { status: 'ok', usd: row.feesUsd, sig });
      logTx({
        kind: 'claim',
        status: 'ok',
        usd: row.feesUsd,
        min_usd: config.minClaimUsd,
        ticker: row.name || null,
        sig,
        delta: 0,
        did: `claimed ~$${row.feesUsd.toFixed(2)} fees`,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ ...row, status: 'error', error: err });
      trackPhase('claim', 'error', {
        status: 'fail',
        level: 'error',
        detail: err,
      });
      logTx({
        kind: 'claim',
        status: 'fail',
        usd: row.feesUsd,
        ticker: row.name || null,
        delta: 0,
        did: `claim failed — ${err}`.slice(0, 160),
      });
    }
  }

  return { results, claimedUsd, scanned: positions.length };
}

async function maybeSweep(dryRun) {
  if (!config.operatorWallet) {
    trackPhase('sweep', 'skip', {
      status: 'skip',
      detail: 'OPERATOR_WALLET not set',
    });
    return { status: 'skip', reason: 'OPERATOR_WALLET not set' };
  }
  if (config.isSingleWallet || config.lpWallet === config.operatorWallet) {
    trackPhase('sweep', 'skip', {
      status: 'skip',
      detail: 'single-wallet: W1=W2 (sweep no-op)',
    });
    return { status: 'skip', reason: 'single-wallet: LP === operator' };
  }
  const lpKp = loadLpKeypair();
  if (!lpKp) {
    trackPhase('sweep', 'skip', {
      status: 'skip',
      detail: 'LP key missing for sweep',
    });
    return { status: 'skip', reason: 'LP key missing for sweep' };
  }

  const sweep = await sweepSol(lpKp, config.operatorWallet, config.lpReserveSol);
  if (sweep.status !== 'ready') {
    trackPhase('sweep', sweep.status || 'skip', {
      status: sweep.status,
      detail: sweep.reason || sweep.error,
    });
    return sweep;
  }

  if (dryRun) {
    trackPhase('sweep', 'dry_run', {
      status: 'ok',
      usd: undefined,
      detail: `would sweep ${sweep.sol?.toFixed?.(4) ?? sweep.sol} SOL W1→W2`,
    });
    return { status: 'dry_run', sol: sweep.sol, note: 'would sweep W1→W2' };
  }

  const sig = await signAndSendTransaction(sweep.serialized, [lpKp], 'sweep');
  trackPhase('sweep', 'swept', { status: 'ok', sig, detail: `${sweep.sol} SOL` });
  return { status: 'swept', sig, sol: sweep.sol };
}

async function executeBuySendLeg(leg, solUsd, dryRun) {
  if (!leg.recipient) {
    trackPhase('leg', 'buy_send_error', {
      status: 'fail',
      level: 'error',
      detail: 'ANSEM_DEST_WALLET / recipient missing',
    });
    return { status: 'error', error: 'ANSEM_DEST_WALLET / recipient missing' };
  }
  if (leg.usd < config.minRouteUsd) {
    trackPhase('leg', 'buy_send_skip', {
      status: 'skip',
      usd: leg.usd,
      detail: 'below MIN_ROUTE_USD',
    });
    return { status: 'skip', reason: 'below MIN_ROUTE_USD' };
  }

  const opKp = loadOperatorKeypair();
  const owner = config.operatorWallet || opKp?.publicKey.toBase58();
  if (!owner) {
    trackPhase('leg', 'buy_send_error', {
      status: 'fail',
      level: 'error',
      detail: 'OPERATOR_WALLET missing',
    });
    return { status: 'error', error: 'OPERATOR_WALLET missing' };
  }

  const jupiter = createJupiterAdapter();
  const opBal = await getSolBalance(owner);
  const maxLamports = Math.floor(opBal * 1e9);

  const swap = await jupiter.swapSolForToken(
    leg.usd,
    leg.mint || config.ansemMint,
    solUsd,
    owner,
    maxLamports,
  );

  if (swap.status === 'SKIP') {
    trackPhase('leg', 'buy_send_skip', {
      status: 'skip',
      usd: leg.usd,
      detail: swap.error || swap.reason,
    });
    return swap;
  }
  if (swap.status !== 'READY') {
    trackPhase('leg', 'buy_send_error', {
      status: 'fail',
      level: 'warn',
      usd: leg.usd,
      detail: swap.error,
    });
    return { status: 'error', error: swap.error, quote: swap.quote };
  }

  if (dryRun) {
    trackPhase('leg', 'buy_send_dry', {
      status: 'ok',
      usd: leg.usd,
      detail: `would buy ANSEM → ${leg.recipient?.slice(0, 8)}…`,
    });
    return {
      status: 'dry_run',
      action: 'buy_send_ansem',
      usd: leg.usd,
      outAmount: swap.quote?.outAmount,
      recipient: leg.recipient,
      note: 'would Jupiter buy ANSEM then SPL transfer to dest',
    };
  }

  if (!opKp) {
    trackPhase('leg', 'buy_send_error', {
      status: 'fail',
      level: 'error',
      detail: 'OPERATOR_PRIVATE_KEY required',
    });
    return { status: 'error', error: 'OPERATOR_PRIVATE_KEY required' };
  }

  const swapSig = await signAndSendTransaction(
    swap.serialized,
    [opKp],
    'jupiter_buy_ansem',
  );

  const bal = await getTokenBalanceRaw(owner, leg.mint || config.ansemMint);
  const amount = bal > 0n ? bal : BigInt(swap.quote?.outAmount || 0);
  if (amount <= 0n) {
    trackPhase('leg', 'buy_send_partial', {
      status: 'fail',
      level: 'warn',
      sig: swapSig,
      detail: 'swap ok but no ANSEM balance to send',
    });
    return {
      status: 'partial',
      swapSig,
      error: 'swap ok but no ANSEM balance to send',
    };
  }

  const transfer = await buildTokenTransferTx(
    leg.mint || config.ansemMint,
    amount,
    owner,
    leg.recipient,
  );
  if (transfer.status !== 'READY') {
    trackPhase('leg', 'buy_send_partial', {
      status: 'fail',
      level: 'warn',
      sig: swapSig,
      detail: transfer.error,
    });
    return { status: 'partial', swapSig, error: transfer.error };
  }

  const sendSig = await signAndSendTransaction(
    transfer.serialized,
    [opKp],
    'send_ansem',
  );

  trackPhase('leg', 'buy_send_live', {
    status: 'ok',
    usd: leg.usd,
    sig: sendSig,
    detail: `swap=${swapSig?.slice?.(0, 8)}`,
  });

  return {
    status: 'live',
    swapSig,
    sendSig,
    amount: Number(amount),
    recipient: leg.recipient,
    usd: leg.usd,
  };
}

async function executeDonateSolLeg(leg, solUsd, dryRun) {
  if (!leg.recipient) {
    trackPhase('leg', 'donate_error', {
      status: 'fail',
      level: 'error',
      detail: 'AEMON_DONATE_WALLET / recipient missing',
    });
    return { status: 'error', error: 'AEMON_DONATE_WALLET missing' };
  }
  if (leg.usd < config.minRouteUsd) {
    trackPhase('leg', 'donate_skip', {
      status: 'skip',
      usd: leg.usd,
      detail: 'below MIN_ROUTE_USD',
    });
    return { status: 'skip', reason: 'below MIN_ROUTE_USD' };
  }
  if (!solUsd || solUsd <= 0) {
    return { status: 'error', error: 'SOL price unavailable' };
  }

  const opKp = loadOperatorKeypair();
  const owner = config.operatorWallet || opKp?.publicKey.toBase58();
  if (!owner) return { status: 'error', error: 'OPERATOR_WALLET missing' };

  const lamports = Math.floor((leg.usd / solUsd) * LAMPORTS_PER_SOL);
  if (lamports <= 0) return { status: 'skip', reason: 'donate lamports zero' };

  if (dryRun) {
    trackPhase('leg', 'donate_dry', {
      status: 'ok',
      usd: leg.usd,
      detail: `would donate ~${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL → aemon`,
    });
    return {
      status: 'dry_run',
      action: 'donate_aemon',
      usd: leg.usd,
      lamports,
      recipient: leg.recipient,
    };
  }
  if (!opKp) return { status: 'error', error: 'OPERATOR_PRIVATE_KEY required' };

  const serialized = await buildSolTransferTx(owner, leg.recipient, lamports);
  const sig = await signAndSendTransaction(serialized, [opKp], 'donate_aemon');
  trackPhase('leg', 'donate_live', {
    status: 'ok',
    usd: leg.usd,
    sig,
    detail: leg.recipient?.slice?.(0, 8),
  });
  return { status: 'live', sig, usd: leg.usd, lamports, recipient: leg.recipient };
}

async function executeBurnIndexLeg(leg, solUsd, dryRun) {
  const mint = leg.mint || config.indexTokenMint;
  if (!mint) {
    trackPhase('leg', 'burn_skip', {
      status: 'skip',
      usd: leg.usd,
      detail: 'INDEX_TOKEN_MINT not set — set when $ANSEMINDEX launches',
    });
    return {
      status: 'skip',
      reason: 'INDEX_TOKEN_MINT not set yet',
      usd: leg.usd,
      note: 'Burn leg armed but mint empty — set INDEX_TOKEN_MINT',
    };
  }
  if (leg.usd < config.minRouteUsd) {
    return { status: 'skip', reason: 'below MIN_ROUTE_USD', usd: leg.usd };
  }

  const opKp = loadOperatorKeypair();
  const owner = config.operatorWallet || opKp?.publicKey.toBase58();
  if (!owner) return { status: 'error', error: 'OPERATOR_WALLET missing' };

  const jupiter = createJupiterAdapter();
  const opBal = await getSolBalance(owner);
  const swap = await jupiter.swapSolForToken(
    leg.usd,
    mint,
    solUsd,
    owner,
    Math.floor(opBal * 1e9),
  );

  if (swap.status === 'SKIP') {
    return { status: 'skip', reason: swap.error || swap.reason, usd: leg.usd };
  }
  if (swap.status !== 'READY') {
    return { status: 'error', error: swap.error, usd: leg.usd };
  }

  if (dryRun) {
    trackPhase('leg', 'burn_dry', {
      status: 'ok',
      usd: leg.usd,
      detail: `would buy $${config.indexTokenSymbol || 'ANSEMINDEX'} → burn`,
    });
    return {
      status: 'dry_run',
      action: 'buy_burn_index',
      usd: leg.usd,
      outAmount: swap.quote?.outAmount,
      mint,
    };
  }
  if (!opKp) return { status: 'error', error: 'OPERATOR_PRIVATE_KEY required' };

  const swapSig = await signAndSendTransaction(
    swap.serialized,
    [opKp],
    'jupiter_buy_index',
  );
  const bal = await getTokenBalanceRaw(owner, mint);
  const amount = bal > 0n ? bal : BigInt(swap.quote?.outAmount || 0);
  if (amount <= 0n) {
    return {
      status: 'partial',
      swapSig,
      error: 'swap ok but no index token to burn',
    };
  }

  const burn = await jupiter.buildBurnTx(mint, amount, owner);
  if (burn.status !== 'READY') {
    return { status: 'partial', swapSig, error: burn.error };
  }
  const burnSig = await signAndSendTransaction(
    burn.serialized,
    [opKp],
    'burn_index',
  );
  trackPhase('leg', 'burn_live', {
    status: 'ok',
    usd: leg.usd,
    sig: burnSig,
    detail: `swap=${swapSig?.slice?.(0, 8)}`,
  });
  return {
    status: 'live',
    swapSig,
    burnSig,
    amount: Number(amount),
    mint,
    usd: leg.usd,
  };
}

async function executeLegs(legs, solUsd, dryRun) {
  const out = [];
  for (const leg of legs) {
    if (leg.type === ROUTE_TYPES.SOL_RESERVE) {
      out.push({ ...leg, status: 'ok', note: 'held on operator' });
      trackPhase('leg', 'reserve', { status: 'ok', usd: leg.usd });
      continue;
    }

    if (leg.type === ROUTE_TYPES.METEORA_REINVEST) {
      let proposals = [];
      try {
        const { loadFundPolicy } = await import('./lib/pool-prefs.js');
        const { buildBookRows, proposeReinvestTargets } = await import('./lib/fund-plan.js');
        const { buildPortfolio } = await import('./lib/portfolio.js');
        const fp = loadFundPolicy();
        if (fp.reinvestFollowsWeights) {
          let positions = [];
          if (config.lpWallet) {
            try {
              const p = await buildPortfolio(config.lpWallet, config.ansemMint);
              positions = p.positions || [];
            } catch (_) {}
          }
          const book = buildBookRows(positions);
          proposals = proposeReinvestTargets(book.rows, 5);
        }
      } catch (_) {}
      out.push({
        ...leg,
        status: dryRun ? 'dry_run' : 'propose',
        note: proposals.some((p) => p.herd)
          ? 'Reinvest proposal — HERD_POOL first when live (Phantom; no auto-sign)'
          : 'Reinvest proposal — Phantom deposit toward underweight targets (no auto-sign)',
        proposals,
      });
      trackPhase('fund', 'reinvest_propose', {
        status: 'ok',
        usd: leg.usd,
        detail:
          proposals.length > 0
            ? (proposals[0]?.herd ? 'HERD_POOL first · ' : '') +
              proposals.map((p) => `${p.ticker}+${Number(p.gapPct || 0).toFixed(1)}%`).join(',')
            : 'no underweight targets — set targetWeightPct on /run',
        meta: { proposals },
      });
      continue;
    }
    if (leg.type === ROUTE_TYPES.PENNY_SPREAD) {
      let proposals = [];
      try {
        const { buildBookRows } = await import('./lib/fund-plan.js');
        const { buildPortfolio } = await import('./lib/portfolio.js');
        let positions = [];
        if (config.lpWallet) {
          try {
            const p = await buildPortfolio(config.lpWallet, config.ansemMint);
            positions = p.positions || [];
          } catch (_) {}
        }
        const book = buildBookRows(positions);
        
        // Find active pools with 0 value (not in pool)
        const emptyActive = (book.rows || [])
          .filter((r) => r.mode === 'active' && !r.inPool && r.pool)
          .slice(0, 5) // propose up to 5 at a time to spread out
          .map((r) => ({
            ticker: r.ticker,
            pool: r.pool,
            mint: r.mint,
            herd: Boolean(r.herd),
            note: `Auto-seed penny deposit`,
            links: {
              meteora: `https://app.meteora.ag/pools/${r.pool}`,
              jupiter: r.mint ? `https://jup.ag/swap/SOL-${r.mint}` : undefined,
            },
          }));
        proposals = emptyActive;
      } catch (e) {
        // ignore
      }
      out.push({
        ...leg,
        status: dryRun ? 'dry_run' : 'propose',
        note: 'Penny Spread proposal — Phantom deposit to seed empty active pools',
        proposals,
      });
      trackPhase('fund', 'penny_spread_propose', {
        status: 'ok',
        usd: leg.usd,
        detail: proposals.length > 0
          ? proposals.map((p) => `seed:${p.ticker}`).join(',')
          : 'no empty active pools to seed',
        meta: { proposals },
      });
      continue;
    }
    if (leg.type === ROUTE_TYPES.JUPITER_BUY_SEND) {
      out.push({
        ...(await executeBuySendLeg(leg, solUsd, dryRun)),
        legId: leg.id,
      });
      continue;
    }
    if (leg.type === ROUTE_TYPES.DONATE_SOL) {
      out.push({
        ...(await executeDonateSolLeg(leg, solUsd, dryRun)),
        legId: leg.id,
      });
      continue;
    }
    if (leg.type === ROUTE_TYPES.JUPITER_BURN) {
      out.push({
        ...(await executeBurnIndexLeg(leg, solUsd, dryRun)),
        legId: leg.id,
      });
      continue;
    }
    if (leg.type === ROUTE_TYPES.JUPITER_BUY_HOLD) {
      const jupiter = createJupiterAdapter();
      const opKp = loadOperatorKeypair();
      const owner = config.operatorWallet || opKp?.publicKey.toBase58();
      const opBal = await getSolBalance(owner);
      const swap = await jupiter.swapSolForToken(
        leg.usd,
        leg.mint || config.ansemMint,
        solUsd,
        owner,
        Math.floor(opBal * 1e9),
      );
      if (dryRun || swap.status !== 'READY') {
        out.push({
          status: dryRun ? 'dry_run' : swap.status,
          error: swap.error,
          usd: leg.usd,
        });
        trackPhase('leg', 'buy_hold', {
          status: dryRun ? 'ok' : 'fail',
          usd: leg.usd,
          detail: swap.error,
        });
        continue;
      }
      if (!opKp) {
        out.push({ status: 'error', error: 'OPERATOR_PRIVATE_KEY required' });
        continue;
      }
      const sig = await signAndSendTransaction(swap.serialized, [opKp], 'buy_hold');
      out.push({ status: 'live', sig, usd: leg.usd });
      trackPhase('leg', 'buy_hold', { status: 'ok', usd: leg.usd, sig });
      continue;
    }
    out.push({ status: 'skip', reason: `unknown leg ${leg.type}` });
  }
  return out;
}

async function snapshotWallets(tickId) {
  const wallets = [];
  const seen = new Set();
  const push = (wallet, role) => {
    const w = String(wallet || '').trim();
    if (!w || seen.has(`${role}:${w}`)) return;
    seen.add(`${role}:${w}`);
    wallets.push({ wallet: w, role });
  };
  // Copycat reference (RO) — fees never claimed from this wallet
  push(config.controllerWallet, 'controller_ro');
  // Old book eyes (may equal controller)
  push(config.trackedWallet, 'tracked_ro');
  // Node LP — only wallet that claims / routes fees
  push(config.lpWallet, 'w1_lp');
  for (const w of wallets) {
    if (!w.wallet) continue;
    try {
      const p = await buildPortfolio(w.wallet, config.ansemMint);
      const balances = p.totals?.balances ?? 0;
      const fees = p.totals?.unclaimed_fees ?? 0;
      trackPhase('summary', 'portfolio_snapshot', {
        status: 'ok',
        usd: balances + fees,
        detail: `${w.role} ${p.total_positions}pos`,
      });
      // Session PnL baseline on first W1 LP mark
      if (w.role === 'w1_lp') {
        try {
          const { getSessionBaseline, startSession, printSessionPnl } = await import(
            './lib/session-pnl.js'
          );
          const mark = balances + fees;
          if (!getSessionBaseline()) {
            startSession(mark, { wallet: w.wallet, tickId });
            console.log(`SESSION_PNL: baseline $${mark.toFixed(2)}`);
          } else {
            printSessionPnl(mark);
          }
        } catch {
          /* optional */
        }
      }
    } catch (e) {
      trackPhase('summary', 'portfolio_snapshot', {
        status: 'fail',
        level: 'warn',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/**
 * One keeper tick:
 *   probe → claim → sweep → plan → buy ANSEM → send to dest
 */
export async function runKeeperTick(opts = {}) {
  const dryRun = opts.dryRun ?? !isLive();
  const started = new Date().toISOString();
  const tickId = newTickId();

  trackPhase('summary', 'tick_start', {
    status: 'ok',
    detail: dryRun ? 'dry_run' : 'live',
  });
  logTx({
    kind: 'session_start',
    status: 'ok',
    delta: 0,
    did: dryRun ? 'fee tick start · dry' : 'fee tick start · live',
  });

  if (!config.lpWallet) {
    const summary = {
      tick_id: tickId,
      cellId: config.cellId,
      started,
      finished: new Date().toISOString(),
      dry_run: dryRun,
      status: 'skip',
      reason: 'LP_WALLET unset — generate W1 on / or npm run init -- --keys',
      claims: [],
      plan: null,
      legs: [],
      tracked_readonly: config.trackedWallet,
    };
    trackPhase('summary', 'tick_end', {
      status: 'skip',
      detail: summary.reason,
    });
    logTx({
      kind: 'session_end',
      status: 'skip',
      delta: 0,
      did: summary.reason,
    });
    tickSummary(tickId, { status: 'skip', dry_run: dryRun });
    appendTickRecord(summary);
    return summary;
  }

  try {
    const meteora = createMeteoraAdapter();

    let solUsd = await fetchSolUsd();
    trackPhase('probe', 'sol_usd', {
      status: solUsd ? 'ok' : 'warn',
      usd: solUsd || null,
    });

    const positions = await listOpenPositions(config.lpWallet);
    const claimableFeesUsd = positions.reduce(
      (s, p) => s + feesUsdFromApiPosition(p),
      0,
    );
    trackPhase('probe', 'positions', {
      status: 'ok',
      usd: claimableFeesUsd,
      detail: `${positions.length} open`,
    });

    if (!solUsd && positions[0]) {
      try {
        const { fetchOpenPositions } = await import('./lib/meteora-api.js');
        const open = await fetchOpenPositions(config.lpWallet, { persist: true });
        solUsd = Number(open.sol_price) || 0;
      } catch {
        /* ignore */
      }
    }

    const claim = await claimEligiblePositions(meteora, dryRun);
    const sweep = await maybeSweep(dryRun);

    const opWallet = config.operatorWallet || config.lpWallet;
    const operatorSol = await getSolBalance(opWallet);

    const routeBudgetUsd = dryRun
      ? Math.max(claimableFeesUsd, claim.claimedUsd)
      : claim.claimedUsd || 0;

    const plan = planTick({
      operatorSol: dryRun
        ? operatorSol + claimableFeesUsd / (solUsd || 1)
        : operatorSol,
      solUsd,
      claimableFeesUsd: dryRun ? claimableFeesUsd : Math.max(claim.claimedUsd, 0),
    });

    const planForExec =
      dryRun && plan.status === 'skip' && claimableFeesUsd >= config.minRouteUsd
        ? planTick({
            operatorSol: claimableFeesUsd / (solUsd || 80) + 1,
            solUsd: solUsd || 80,
            claimableFeesUsd,
          })
        : plan;

    trackPhase('route', planForExec.status, {
      status: planForExec.status === 'ready' ? 'ok' : 'skip',
      usd: planForExec.totalUsd || 0,
      detail: planForExec.reason || `${planForExec.legs?.length || 0} legs`,
    });
    if (planForExec.status === 'ready' && planForExec.legs?.length) {
      const parts = planForExec.legs
        .filter((l) => (l.pct ?? l.portion ?? l.usd) > 0)
        .map((l) => {
          const name = l.label || l.type || l.route || 'leg';
          const p = l.pct ?? l.portion;
          const pct =
            p != null
              ? `${Math.round((Number(p) <= 1.0001 ? Number(p) * 100 : Number(p)))}%`
              : '';
          return pct ? `${name} ${pct}` : name;
        })
        .slice(0, 6);
      logTx({
        kind: 'route',
        status: 'ok',
        usd: planForExec.totalUsd || routeBudgetUsd || null,
        delta: 0,
        did: `routing fees → ${parts.join(' / ') || 'legs'}`,
      });
    } else {
      logTx({
        kind: 'route',
        status: 'skip',
        usd: planForExec.totalUsd || claimableFeesUsd || null,
        delta: 0,
        did: planForExec.reason || 'no fee route this tick',
      });
    }

    let legResults = [];
    if (planForExec.status === 'ready') {
      legResults = await executeLegs(planForExec.legs, solUsd || 80, dryRun);
    }

    await snapshotWallets(tickId);

    const summary = {
      tick_id: tickId,
      cellId: config.cellId,
      started,
      finished: new Date().toISOString(),
      dry_run: dryRun,
      live: isLive(),
      status: planForExec.status,
      wallets: {
        lp: config.lpWallet,
        operator: config.operatorWallet || null,
        ansem_dest: config.ansemDestWallet || null,
        tracked: config.trackedWallet,
      },
      sol_usd: solUsd,
      positions_scanned: claim.scanned,
      claimable_fees_usd: claimableFeesUsd,
      claim,
      sweep,
      plan: planForExec,
      legs: legResults,
      gas_estimate_sol: ESTIMATED_GAS_SOL,
      route_budget_usd: routeBudgetUsd,
    };

    trackPhase('summary', 'tick_end', {
      status: 'ok',
      usd: claimableFeesUsd,
      detail: `pos=${claim.scanned} plan=${planForExec.status}`,
    });
    logTx({
      kind: 'session_end',
      status: 'ok',
      usd: claimableFeesUsd,
      delta: 0,
      did: `tick end · ${claim.scanned} pos · plan ${planForExec.status}`,
    });
    tickSummary(tickId, {
      status: planForExec.status,
      dry_run: dryRun,
      claimable_fees_usd: claimableFeesUsd,
      positions_scanned: claim.scanned,
    });
    appendTickRecord(summary);

    return summary;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logError('tick failed', { detail: err, tick_id: tickId });
    trackPhase('summary', 'tick_error', {
      status: 'fail',
      level: 'error',
      detail: err,
    });
    logTx({
      kind: 'session_end',
      status: 'fail',
      delta: 0,
      did: `tick error — ${err}`.slice(0, 160),
    });
    const summary = {
      tick_id: tickId,
      cellId: config.cellId,
      started,
      finished: new Date().toISOString(),
      dry_run: dryRun,
      status: 'error',
      error: err,
    };
    appendTickRecord(summary);
    return summary;
  }
}
