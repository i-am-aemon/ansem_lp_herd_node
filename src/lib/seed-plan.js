/**
 * Deploy planner — ordered buy/deposit actions from wallet balances.
 * Never signs; Phantom (or the operator) approves each step.
 * SOL management: never dump all SOL into ANSEM; topup_sol when below operating floor.
 */
import { config } from '../config.js';
import { ANSEM_MINT, WSOL_MINT } from '../constants.js';
import { PAIR_MIN_ANSEM, SOL_RESERVE, START_LIST } from './whitepaper.js';
import {
  deployableSol,
  effectiveSolReserve,
  lowSolBlocks,
  operatingFloor,
  rentBufferForPairs,
  reserveSnapshot,
  sizeBuyAnsem,
  sizeTopupSol,
  targetReserve,
} from './sol-reserve.js';
import { isIndexPool } from './ansem-index.js';
import { rankPools } from './rank-pools.js';
import { buildPortfolio } from './portfolio.js';
import { getSolBalance, getTokenBalanceRaw } from '../adapters/solana.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { runWalletCensus, heldByMintFromCensus } from './wallet-census.js';
import { getNodePolicy } from './node-policy.js';
import { withRpcRetry, sleep, rpcMinDelayMs } from './rpc-patience.js';

async function mintDecimals(mintStr) {
  try {
    const conn = new Connection(config.rpcUrl, 'confirmed');
    const supply = await withRpcRetry(
      () => conn.getTokenSupply(new PublicKey(mintStr), 'confirmed'),
      { label: 'getTokenSupply', maxAttempts: 4 },
    );
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

/**
 * @param {object} opts
 * @param {string} opts.wallet
 * @param {number} [opts.solBalance] — override (skip RPC)
 * @param {number} [opts.ansemBalance]
 * @param {Array} [opts.positions] — skip portfolio fetch if provided
 * @param {'coverage'|'depth'} [opts.pass]
 * @param {number} [opts.maxActions]
 */
export async function buildSeedPlan(opts = {}) {
  const wallet = (opts.wallet || config.lpWallet || '').trim();
  if (!wallet) {
    return {
      ok: false,
      error: 'wallet required (query ?wallet= or set LP_WALLET / Connect Phantom)',
    };
  }

  const solReserve = opts.solReserve ?? config.solReserve ?? SOL_RESERVE;
  const {
    getOperatorMode,
    getOperatorSnapshot,
    resolvePairMinAnsem,
    modeHint,
    seedPassForMode,
  } = await import('./operator-mode.js');
  const operatorMode = opts.operatorMode || getOperatorMode();
  // Effective pass from mode (cover→coverage, mirror→depth)
  const pass =
    opts.pass ||
    seedPassForMode(operatorMode) ||
    config.seedPass ||
    'coverage';
  const maxActions = opts.maxActions ?? 40;

  let positions = opts.positions;
  if (!positions) {
    try {
      const portfolio = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT);
      positions = portfolio.positions || [];
    } catch {
      positions = [];
    }
  }

  // Hold: no seed actions
  if (operatorMode === 'hold') {
    const ansemPriceHold = await roughAnsemUsd();
    const pairMinHold = resolvePairMinAnsem({ ansemPriceUsd: ansemPriceHold });
    const opSnap = getOperatorSnapshot({ ansemPriceUsd: ansemPriceHold });
    return {
      ok: true,
      wallet,
      policy: {
        ...getNodePolicy(),
        ...opSnap,
        operatorMode: 'hold',
        solReserve,
        pairMinAnsem: pairMinHold.ansem,
        seedPass: 'coverage',
        autoSign: false,
      },
      balances: {
        sol: opts.solBalance != null ? Number(opts.solBalance) : await getSolBalance(wallet),
        deployableSol: 0,
        ansem:
          opts.ansemBalance != null
            ? Number(opts.ansemBalance)
            : await tokenUiBalance(wallet, config.ansemMint || ANSEM_MINT),
        ansemPriceUsd: ansemPriceHold,
        estPairUsd: pairMinHold.ansem * (ansemPriceHold || 0) * 2,
        reserve: reserveSnapshot(
          opts.solBalance != null ? Number(opts.solBalance) : await getSolBalance(wallet),
        ),
      },
      census: null,
      coverage: {
        goal: `MODE hold · pair min ${pairMinHold.rule}`,
        done: 0,
        total: 0,
        pct: 0,
        complete: false,
        atMin: [],
        needMin: [],
        inPool: [],
        line: 'MODE hold — no seed',
        operatorHint: modeHint(null, opSnap),
        next: { id: 'hold', type: 'stop', title: 'Hold', ticker: null },
        blocked: true,
        blockReason: 'operatorMode=hold',
        operatorMode: 'hold',
        pairMinUsd: opSnap.pairMinUsd,
        effectivePairMinAnsem: pairMinHold.ansem,
      },
      nextAction: {
        id: 'hold',
        type: 'stop',
        title: 'Hold — flip mode to cover / mirror / ape',
        detail: 'MODE hold: no buys, deposits, or trim proposals.',
        autoSign: false,
      },
      actions: [
        {
          id: 'hold',
          type: 'stop',
          title: 'Hold — flip mode to cover / mirror / ape',
          detail: 'MODE hold: no buys, deposits, or trim proposals.',
          autoSign: false,
        },
      ],
      ranking: { pass: 'pass1', active: [], queue: [], next: null },
      fundHints: { underweight: [], redirects: [] },
    };
  }

  // Mirror controller LP weights → targetWeightPct before ranking
  try {
    const { loadFundPolicy } = await import('./pool-prefs.js');
    const follow =
      operatorMode === 'mirror' ||
      operatorMode === 'cover' ||
      (loadFundPolicy().followController !== false && operatorMode !== 'ape');
    if (follow && opts.skipControllerSync !== true) {
      const { syncControllerTargets } = await import('./controller-book.js');
      await syncControllerTargets({
        nodePositions: positions,
        persistLedger: false,
      });
    }
  } catch {
    /* non-fatal */
  }

  // Price first so dual $1 floor can size pair min
  const ansemPriceEarly = await roughAnsemUsd();
  const pairMinResolved = resolvePairMinAnsem({
    ansemPriceUsd: ansemPriceEarly,
    pairMinAnsem: opts.pairMinAnsem ?? config.pairMinAnsem ?? PAIR_MIN_ANSEM,
  });
  const pairMin = pairMinResolved.ansem;

  const ranking = await rankPools({
    startList: START_LIST, // rankPools prepends live HERD–ANSEM via effectiveStartList
    w1Positions: positions,
    pass,
    pairMinAnsem: pairMin,
    operatorMode,
    allowApeJump: operatorMode === 'ape',
  });

  const solBal =
    opts.solBalance != null ? Number(opts.solBalance) : await getSolBalance(wallet);
  const ansemBal =
    opts.ansemBalance != null
      ? Number(opts.ansemBalance)
      : await tokenUiBalance(wallet, config.ansemMint || ANSEM_MINT);

  const snap = reserveSnapshot(solBal);
  const deployable = deployableSol(solBal);
  const tokenPriceSample =
    ranking.queue.find((q) => q.price_usd > 0)?.price_usd || null;
  const ansemPrice = ansemPriceEarly > 0 ? ansemPriceEarly : await roughAnsemUsd();
  /** Prefer real ANSEM USD; fall back only for rough pair USD estimates. */
  const ansemPriceForPair = ansemPrice > 0 ? ansemPrice : tokenPriceSample;

  /** Rough USD of pairMin ANSEM dual-sided. */
  const estPairUsd =
    ansemPriceForPair != null ? pairMin * ansemPriceForPair * 2 : null;

  const actions = [];
  let remainingSol = deployable;
  let remainingAnsem = ansemBal;
  const activePairCount =
    ranking.activeCount ||
    ranking.active?.length ||
    config.nodeActiveLimit ||
    10;
  // Rent buffer for pairs we still need to open (not already covered)
  const uncoveredCount = Math.max(
    1,
    (ranking.active || []).filter((r) => !r.atMinimum && r.mode !== 'off').length ||
      activePairCount,
  );
  const opFloor = operatingFloor();
  // Coverage: allow opening if we have rent+gas even when below operating floor
  // (otherwise a small pot stalls forever after topups).
  const rentMinOpen = Math.max(0.02, rentBufferForPairs(1) * 2);
  const canOpenNewPairs =
    solBal >= opFloor ||
    (uncoveredCount > 0 && solBal >= rentMinOpen && remainingAnsem >= pairMin * 0.5);

  // Priority 0: refill SOL from ANSEM when below operating floor
  const low = lowSolBlocks(solBal);
  const uncoveredForTopup = (ranking.active || []).filter(
    (r) => !r.atMinimum && r.mode !== 'off' && !r.excluded,
  ).length;
  if (low.blocked && remainingAnsem > 0.05) {
    const solUsd = await roughSolUsd();
    // Cover: keep ANSEM for remaining mins — only sell enough SOL to clear the floor.
    // Dumping most of the bag into SOL then stop_capital is the old stall.
    const emergencyKeep =
      uncoveredForTopup > 0 && remainingAnsem < pairMin * 1.5 ? 0 : null;
    const coverKeep =
      uncoveredForTopup > 0
        ? Math.min(remainingAnsem, Math.max(pairMin, uncoveredForTopup * pairMin))
        : pairMin;
    const pairMinKeep = emergencyKeep === 0 ? 0 : coverKeep;
    // During cover, aim for operating floor + small buffer (not full target) so we
    // sell less ANSEM and can still deposit mins in the same pass.
    const topupTarget =
      operatorMode === 'cover' && uncoveredForTopup > 0
        ? Math.max(opFloor + 0.01, solBal + 0.015)
        : targetReserve();
    const top = sizeTopupSol(solBal, remainingAnsem, {
      pairMinKeep,
      ansemPriceUsd: ansemPrice || 0,
      solUsd,
      target: topupTarget,
    });
    if (top.ansemUi > 0 && top.reachable) {
      actions.push({
        id: 'topup_sol',
        type: 'topup_sol',
        pass: ranking.pass,
        priority: 0,
        title: 'Top up SOL (ANSEM → SOL)',
        detail: `Wallet ${solBal.toFixed(4)}◎ < operating ${opFloor.toFixed(4)}◎. Sell ~${top.ansemUi.toFixed(4)} ANSEM → ~${top.needSol.toFixed(4)} SOL (target ${topupTarget.toFixed(4)}◎ · keep ≥${pairMinKeep.toFixed(2)} ANSEM for mins)${pairMinKeep === 0 ? ' · emergency keep=0' : ''}.`,
        ansem: top.ansemUi,
        needSol: top.needSol,
        targetSol: topupTarget,
        pairMinKeep,
        links: {
          jupiter: `https://jup.ag/swap/${config.ansemMint || ANSEM_MINT}-SOL`,
        },
        autoSign: false,
      });
      remainingAnsem = Math.max(0, remainingAnsem - top.ansemUi);
      // Assume top-up succeeds for planning subsequent deposits
      remainingSol = Math.max(remainingSol, solBal + top.needSol);
    } else if (low.blocked) {
      actions.push({
        id: 'stop_sol_rent',
        type: 'stop',
        pass: ranking.pass,
        priority: 0,
        title: 'Stop — need SOL (top-up unreachable)',
        detail: `${low.reason}. Need ANSEM price + free ANSEM above pair min to auto top-up, or send ~${targetReserve().toFixed(2)} SOL to LP.`,
        autoSign: false,
      });
    }
  }

  // Step: buy ANSEM if we have deployable SOL and little/no ANSEM for coverage
  // Only when not already planning a top-up (would fight itself)
  const planningTopup = actions.some((a) => a.type === 'topup_sol');
  // After a planned top-up, treat pairs as openable (executor runs topup first).
  const canOpenAfterPlan =
    canOpenNewPairs || planningTopup || remainingSol >= opFloor;
  // Buy ANSEM only when we lack token mins — not a USD dust check (that caused
  // buy_ansem ↔ topup_sol thrash when we already held ≥ pairMin ANSEM).
  const needAnsemBuy =
    !planningTopup &&
    !low.blocked &&
    remainingSol > 0.001 &&
    remainingAnsem < pairMin * 0.9;

  if (needAnsemBuy) {
    // Size against uncovered mins — not full top-10 rent (that zeroed swapSol at ~0.08 SOL)
    const sized = sizeBuyAnsem(solBal, uncoveredCount);
    const swapSol = sized.swapSol;
    // Skip dust buys that only burn rent then force another topup
    if (swapSol > 0.005) {
      actions.push({
        id: 'buy_ansem',
        type: 'buy_ansem',
        pass: ranking.pass,
        priority: actions.length,
        title: 'Buy ANSEM with deployable SOL',
        detail: `Swap ~${swapSol.toFixed(4)} SOL → ANSEM (leave ${sized.leaveSol.toFixed(4)}◎ for rent ×${uncoveredCount} uncovered + operating floor).`,
        sol: swapSol,
        leaveSol: sized.leaveSol,
        links: {
          jupiter: `https://jup.ag/swap/SOL-${config.ansemMint || ANSEM_MINT}`,
        },
        autoSign: false,
      });
      if (ansemPriceForPair && ansemPriceForPair > 0) {
        const solUsd = await roughSolUsd();
        remainingAnsem += (swapSol * solUsd) / ansemPriceForPair;
      } else {
        remainingAnsem = Math.max(remainingAnsem, pairMin);
      }
      remainingSol = Math.min(remainingSol, sized.leaveSol - solReserve);
    }
  }

  let ansemBudget = remainingAnsem;
  let n = 0;
  const seedRows =
    (ranking.active?.length ? ranking.active : null) ||
    (ranking.queue || []).filter((r) => r.active || r.ape || r.passEligible);
  const workRows = seedRows.length ? seedRows : ranking.queue || [];

  // Wallet census: prefer depositing index dust we already hold (no re-buy).
  let census = null;
  try {
    census = await runWalletCensus(wallet);
  } catch {
    census = null;
  }
  const heldByMint = census
    ? heldByMintFromCensus(census)
    : new Map();
  if (!census) {
    // Only probe active work rows — spaced like micro_trader batch_delay
    const gap = Math.max(200, rpcMinDelayMs());
    for (const row of workRows) {
      if (!row.mint || heldByMint.has(row.mint)) continue;
      try {
        heldByMint.set(row.mint, await tokenUiBalance(wallet, row.mint));
      } catch {
        heldByMint.set(row.mint, 0);
      }
      await sleep(gap);
    }
  }
  // Coverage-first: uncovered mins before deepening already-covered LPs.
  // Within each bucket: held TOKEN (no re-buy) → underweight gap → rest.
  const byCtrl = (a, b) =>
    (b.controllerWeightPct ?? 0) - (a.controllerWeightPct ?? 0) ||
    (b.gapPct ?? -1e9) - (a.gapPct ?? -1e9);
  const byGap = (a, b) => (b.gapPct ?? -1e9) - (a.gapPct ?? -1e9);
  // Cover: chase controller book order (biggest bags first). Mirror/depth: gap.
  const orderUncovered = operatorMode === 'cover' ? byCtrl : byGap;
  const uncovered = workRows.filter((r) => !r.atMinimum).sort(orderUncovered);
  const covered = workRows.filter((r) => r.atMinimum).sort(byGap);
  const splitHeld = (rows) => {
    const held = rows
      .filter((r) => (heldByMint.get(r.mint) || 0) > 0)
      .sort(byGap);
    const needBuy = rows
      .filter((r) => (heldByMint.get(r.mint) || 0) <= 0)
      .sort(byGap);
    return [...held, ...needBuy];
  };
  const orderedRows =
    operatorMode === 'mirror' || ranking.pass === 'pass2' || pass === 'depth'
      ? [...splitHeld(covered), ...splitHeld(uncovered)]
      : operatorMode === 'ape'
        ? [
            ...workRows.filter((r) => r.ape).sort(byGap),
            ...splitHeld(uncovered.filter((r) => !r.ape)),
            ...splitHeld(covered.filter((r) => !r.ape)),
          ]
        : [...splitHeld(uncovered), ...splitHeld(covered)];

  // After topup is planned, allow deposits of held TOKEN even if current SOL is low
  // (executor runs topup first). New ATA buys still need operating floor post-topup.
  const allowHeldDeposits =
    planningTopup || canOpenAfterPlan || solBal >= rentBufferForPairs(1);

  /** Cover stair: only one NEW focus ticker per plan (add-only, never trim). */
  let focusTicker = null;
  const oneFocus =
    operatorMode === 'cover' &&
    ranking.pass !== 'pass2' &&
    pass !== 'depth';

  for (const row of orderedRows) {
    if (n >= maxActions) break;
    // Never remove / trim in seed plan — deposits only
    if (row.mode === 'hold' || row.mode === 'off' || row.holdExisting || row.excluded) {
      continue;
    }
    const tokenHeld = heldByMint.get(row.mint) || 0;
    const hasTokenSide = tokenHeld > 0;
    // Dust accumulation: allow deposit into existing LP even if atMinimum / not passEligible
    // During coverage (pass1): skip dust top-ups while uncovered mins remain
    const dustTopUp = hasTokenSide && row.inPool && row.atMinimum;
    const uncoveredRemain = orderedRows.some(
      (r) =>
        !r.atMinimum &&
        r.mode !== 'off' &&
        !r.excluded &&
        r.passEligible !== false,
    );
    // During cover: skip dust top-ups while uncovered mins remain
    // Mirror/ape: allow deepen / fresh entries
    if (
      dustTopUp &&
      uncoveredRemain &&
      operatorMode === 'cover' &&
      ranking.pass !== 'pass2' &&
      pass !== 'depth'
    ) {
      continue;
    }
    if (!row.passEligible && !dustTopUp) continue;
    if (!row.pool || !isIndexPool(row.pool)) continue;
    // One-focus: lock onto first uncovered name; ignore other new tickers this plan
    if (oneFocus && !dustTopUp && !row.atMinimum) {
      if (!focusTicker) focusTicker = row.ticker;
      else if (row.ticker !== focusTicker) continue;
    } else if (oneFocus && focusTicker && row.ticker !== focusTicker && !dustTopUp) {
      continue;
    }
    // Don't deepen pools we're already overweight vs controller — but always allow
    // uncovered mins in cover mode (coverage beats mirror trim rules).
    if (
      row.gapPct != null &&
      row.gapPct < -0.5 &&
      !(operatorMode === 'cover' && !row.atMinimum)
    ) {
      continue;
    }
    // Cover: still open mins on thin/dead controller names (otherwise aemon stalls forever).
    // Depth/mirror: skip dead unless forced.
    if (
      row.dead &&
      pass !== 'depth' &&
      !(operatorMode === 'cover' && !row.atMinimum && row.passEligible)
    ) {
      continue;
    }

    const needAnsem = Math.max(0, (row.pairMinAnsem || pairMin) - (row.ansemInPool || 0));
    const rowMin = row.pairMinAnsem || pairMin;
    const depositAnsemRaw =
      ranking.pass === 'pass2' || dustTopUp
        ? Math.min(rowMin, ansemBudget)
        : needAnsem || rowMin;
    const depositAnsem = Math.round(depositAnsemRaw * 1e4) / 1e4;
    const lane = row.ape ? 'ape' : row.lane || 'dip';
    const youAnsem = Math.round((row.ansemInPool || 0) * 100) / 100;
    const ctrlAnsem = Math.round((row.controllerAnsem || 0) * 100) / 100;

    if (depositAnsem < 0.1) {
      // Dust gap — treat as covered enough; don't abort the whole pass
      continue;
    }
    if (ansemBudget < depositAnsem - 1e-9) {
      if (!dustTopUp) {
        actions.push({
          id: `stop_capital_${row.ticker}`,
          type: 'stop',
          pass: ranking.pass,
          priority: actions.length + 1,
          title: 'Stop — not enough ANSEM for next minimum',
          detail: `Need ~${depositAnsem} ANSEM for ${row.ticker}; budget ~${ansemBudget.toFixed(4)}. Buy more ANSEM or end this pass.`,
          ticker: row.ticker,
          lane,
          autoSign: false,
        });
        break;
      }
      continue;
    }

    // Low SOL: only deposit pairs we already hold TOKEN for (no new ATA buys).
    // After planned topup, canOpenAfterPlan lets buy_token+deposit queue in same plan.
    if (!hasTokenSide && !canOpenAfterPlan) {
      continue;
    }
    if (hasTokenSide && !allowHeldDeposits) {
      continue;
    }

    if (!hasTokenSide) {
      actions.push({
        id: `buy_token_${row.ticker}`,
        type: 'buy_token',
        pass: ranking.pass,
        priority: actions.length + 1,
        title: `Buy ${row.ticker} (TOKEN side)`,
        detail: `Small Jupiter buy of ${row.ticker} sized to pair with ~${depositAnsem} ANSEM.`,
        ticker: row.ticker,
        mint: row.mint,
        pool: row.pool,
        ansem: depositAnsem,
        lane,
        links: {
          jupiter: `https://jup.ag/swap/SOL-${row.mint}`,
          jupiterAnsem: `https://jup.ag/swap/${config.ansemMint || ANSEM_MINT}-${row.mint}`,
        },
        autoSign: false,
      });
    }

    actions.push({
      id: `deposit_${row.ticker}`,
      type: 'deposit',
      pass: ranking.pass,
      priority: actions.length + 1,
      title: dustTopUp
        ? `Add dust ${row.ticker}→LP (≥ ${depositAnsem} ANSEM)`
        : `Cover ${row.ticker}: deposit ≥ ${depositAnsem} ANSEM (you ${youAnsem} · ctrl ${ctrlAnsem})`,
      detail: hasTokenSide
        ? `You ${youAnsem} ANSEM in LP · controller ${ctrlAnsem} · bag ~${Number(tokenHeld).toFixed(2)} ${row.ticker}. Put ≥ ${depositAnsem} ANSEM into ${row.ticker}–ANSEM to hit min ${Math.round(rowMin * 100) / 100}.`
        : `You ${youAnsem} · ctrl ${ctrlAnsem} ANSEM. Buy a little ${row.ticker}, then deposit ≥ ${depositAnsem} ANSEM (min ${Math.round(rowMin * 100) / 100}).`,
      ticker: row.ticker,
      mint: row.mint,
      pool: row.pool,
      ansem: depositAnsem,
      youAnsem,
      controllerAnsem: ctrlAnsem,
      rank: row.rank,
      lane,
      ape: Boolean(row.ape),
      scoreReason: row.scoreReason,
      why: row.why,
      tokenHeld,
      dustTopUp,
      links: {
        meteora: `https://app.meteora.ag/pools/${row.pool}`,
        cockpit: `/pool?pool=${encodeURIComponent(row.pool)}&action=deposit`,
      },
      autoSign: false,
    });

    ansemBudget -= depositAnsem;
    n += 1;
  }

  if (
    !planningTopup &&
    !canOpenAfterPlan &&
    !(actions.some((a) => a.type === 'deposit' || a.type === 'topup_sol'))
  ) {
    actions.push({
      id: 'stop_sol_rent',
      type: 'stop',
      pass: ranking.pass,
      priority: actions.length + 1,
      title: 'Stop — need more SOL for rent',
      detail: `Wallet has ${solBal.toFixed(4)} SOL (need ≥ ${opFloor.toFixed(4)} operating). Auto top-up needs free ANSEM; or send ~${targetReserve().toFixed(2)} SOL to LP.`,
      autoSign: false,
    });
  }

  const nextAction = actions.find((a) => a.type !== 'stop') || actions[0] || null;
  const underweight = (ranking.queue || []).filter(
    (r) => r.gapPct != null && r.gapPct > 0.5 && r.mode === 'active',
  );
  const redirects = (ranking.queue || []).filter((r) => r.redirectDest);

  // Coverage board — day-1 goal (exclude mode=off / hold / excluded / controller dust)
  const dustUsd = Number(process.env.CONTROLLER_DUST_USD) || 1;
  const activeRows = (ranking.active || []).filter((r) => {
    if (r.mode === 'off' || r.mode === 'hold' || r.excluded || r.holdExisting) return false;
    const ctrlUsd = Number(r.controllerValueUsd) || 0;
    const ctrlW = Number(r.controllerWeightPct) || 0;
    // Don't nag "need RIF" when controller has dusted/exited that name
    return ctrlUsd >= dustUsd || ctrlW >= 0.5;
  });
  const limit = ranking.nodeActiveLimit || activeRows.length || 10;
  const atMinRows = activeRows.filter((r) => r.atMinimum);
  const needMinRows = activeRows.filter((r) => !r.atMinimum);
  const inPoolRows = activeRows.filter((r) => r.inPool);
  const coverageDone = atMinRows.length;
  const coverageGoal = Math.min(limit, activeRows.length || limit);
  const coverageComplete = coverageDone >= coverageGoal && coverageGoal > 0;
  let operatorHint = '';
  const opSnap = getOperatorSnapshot({ ansemPriceUsd: ansemPriceForPair || ansemPrice });
  if (operatorMode === 'ape') {
    operatorHint = modeHint(
      { complete: false, line: `APE · pair ≥${pairMin} ANSEM / $${opSnap.pairMinUsd}` },
      opSnap,
    );
  } else if (coverageComplete) {
    operatorHint =
      operatorMode === 'mirror'
        ? modeHint({ complete: true, line: `Coverage ${coverageDone}/${coverageGoal}`, needMin: [] }, opSnap)
        : `Coverage complete ${coverageDone}/${coverageGoal}. Switch MODE to mirror to reaccumulate.`;
  } else if (nextAction?.type === 'topup_sol') {
    operatorHint = `MODE ${operatorMode} · Next: top up SOL then cover ${needMinRows.map((r) => r.ticker).join(' → ') || 'mins'}. ▶ Run chains automatically.`;
  } else if (nextAction?.type === 'stop') {
    operatorHint = `MODE ${operatorMode} · Need capital: send ~${targetReserve().toFixed(2)}–0.15 SOL to LP, then ▶ Run. Still need min on: ${needMinRows.map((r) => r.ticker).join(', ') || '—'}.`;
  } else if (nextAction) {
    operatorHint = `MODE ${operatorMode} · Next: ${nextAction.title || nextAction.id}. Then: ${needMinRows.map((r) => r.ticker).join(' → ') || 'done'}.`;
  } else {
    operatorHint = modeHint(
      { complete: false, line: `Coverage ${coverageDone}/${coverageGoal}`, needMin: needMinRows.map((r) => r.ticker) },
      opSnap,
    );
  }

  const coverage = {
    goal:
      operatorMode === 'ape'
        ? `Enter fresh pairs · ≥${Math.round(pairMin * 100) / 100} ANSEM ($${opSnap.pairMinUsd} dual)`
        : operatorMode === 'mirror'
          ? `Mirror controller weights · leave 10% on trim`
          : `Min ≥${Math.round(pairMin * 100) / 100} ANSEM in all ${coverageGoal} controller LPs`,
    done: coverageDone,
    total: coverageGoal,
    pct: coverageGoal > 0 ? Math.round((coverageDone / coverageGoal) * 100) : 0,
    complete: coverageComplete,
    atMin: atMinRows.map((r) => r.ticker),
    needMin: needMinRows.map((r) => r.ticker),
    inPool: inPoolRows.map((r) => r.ticker),
    line: `MODE ${operatorMode} · Coverage ${coverageDone}/${coverageGoal} · ${
      coverageComplete
        ? 'DONE'
        : `need ${needMinRows.map((r) => r.ticker).join(', ')}`
    }`,
    operatorHint,
    /** You vs controller — transparent cover board */
    board: activeRows.map((r) => ({
      rank: r.rank,
      ticker: r.ticker,
      pool: r.pool || '',
      you: Math.round((r.ansemInPool || 0) * 100) / 100,
      ctrl: Math.round((r.controllerAnsem || 0) * 100) / 100,
      min: Math.round((r.pairMinAnsem || pairMin) * 100) / 100,
      need: Math.round(Math.max(0, (r.pairMinAnsem || pairMin) - (r.ansemInPool || 0)) * 100) / 100,
      chg24: Math.round(Number(r.price_change_24h || 0) * 10) / 10,
      youW: Math.round((r.weightPct || 0) * 10) / 10,
      ctrlW: Math.round((r.controllerWeightPct || 0) * 10) / 10,
      youUsd: Math.round((r.position_value_usd || 0) * 100) / 100,
      score: r.simpleScore,
      status: r.atMinimum ? 'ok' : 'need',
      why: r.why || r.scoreReason || '',
    })),
    scoreLegend:
      'Each bubble is a pool. Claim / Zap / Close = Meteora-style cockpit. Raise Active limit on Config to add another bubble.',
    next: nextAction
      ? {
          id: nextAction.id,
          type: nextAction.type,
          title: nextAction.title,
          ticker: nextAction.ticker || null,
        }
      : null,
    blocked: Boolean(
      (snap.lowSol && nextAction?.type !== 'topup_sol') ||
        nextAction?.type === 'stop' ||
        (actions[0] && actions[0].type === 'stop' && !actions.some((a) => a.type !== 'stop')),
    ),
    blockReason:
      snap.lowSol && nextAction?.type !== 'topup_sol'
        ? snap.lowSolReason
        : nextAction?.type === 'stop'
          ? nextAction.detail || nextAction.title
          : null,
    operatorMode,
    pairMinUsd: opSnap.pairMinUsd,
    effectivePairMinAnsem: Math.round(pairMin * 100) / 100,
    pairMinRule: pairMinResolved.rule,
    focusTicker: focusTicker || nextAction?.ticker || needMinRows[0]?.ticker || null,
    stair:
      nextAction?.type === 'stop'
        ? 'blocked'
        : nextAction?.type === 'topup_sol'
          ? 'topup_sol'
          : nextAction?.ticker
            ? `focus_${nextAction.ticker}`
            : coverageComplete
              ? 'covered'
              : 'waiting_claim',
  };

  return {
    ok: true,
    wallet,
    policy: {
      ...getNodePolicy(),
      ...opSnap,
      operatorMode,
      solReserve,
      solOperatingFloor: opFloor,
      solTargetReserve: targetReserve(),
      effectiveReserve: effectiveSolReserve(solBal),
      pairMinAnsem: pairMin,
      effectivePairMinAnsem: pairMin,
      pairMinUsd: opSnap.pairMinUsd,
      pairMinRule: pairMinResolved.rule,
      seedPass: ranking.pass,
      nodeActiveLimit: ranking.nodeActiveLimit,
      apeMaxAgeMinutes: ranking.apeMaxAgeMinutes,
      seedUniverse: ranking.seedUniverse,
      seedSort: ranking.seedSort,
      singleWallet: config.isSingleWallet,
      autoSign: false,
      followsTargetGaps: true,
    },
    balances: {
      sol: solBal,
      deployableSol: deployable,
      ansem: ansemBal,
      ansemPriceUsd: ansemPrice,
      estPairUsd,
      reserve: snap,
    },
    census: census
      ? {
          indexDust: (census.indexDust || []).map((h) => ({
            ticker: h.ticker,
            ui: h.ui,
            pool: h.pool,
          })),
          positions: census.positions,
          orphans: (census.orphans || []).length,
        }
      : null,
    coverage,
    ranking: {
      pass: ranking.pass,
      next: ranking.next,
      queue: ranking.queue,
      active: ranking.active,
      ape: ranking.ape,
      bookValue: ranking.bookValue,
      underweightCount: ranking.underweightCount ?? underweight.length,
      apeCount: ranking.apeCount ?? 0,
      activeCount: ranking.activeCount ?? 0,
      nodeActiveLimit: ranking.nodeActiveLimit,
      seedUniverse: ranking.seedUniverse,
      seedSort: ranking.seedSort,
      fetched_at: ranking.fetched_at,
    },
    fundHints: {
      underweight: underweight.slice(0, 8).map((r) => ({
        ticker: r.ticker,
        gapPct: r.gapPct,
        targetWeightPct: r.targetWeightPct,
        weightPct: r.weightPct,
      })),
      redirects: redirects.slice(0, 8).map((r) => ({
        from: r.ticker,
        to: r.redirectDest,
      })),
    },
    nextAction,
    actions,
    prefs: ranking.prefs || {},
    note:
      'Plan only — no transactions are signed by this API. Approve each step in Phantom. ' +
      'Queue prefers underweight targets (gap) then ranker; Off+redirect boosts destination. ' +
      'Hold/Off pools are excluded from new deposits. See /run for take-out / close / point.',
  };
}

let _solUsdCache = { t: 0, v: 150 };
async function roughSolUsd() {
  if (Date.now() - _solUsdCache.t < 60_000) return _solUsdCache.v;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${WSOL_MINT}`,
      { headers: { 'User-Agent': 'ansem-private-node/1.0' } },
    );
    if (res.ok) {
      const payload = await res.json();
      const pairs = Array.isArray(payload) ? payload : payload?.pairs ?? [];
      const px = Number(pairs[0]?.priceUsd);
      if (px > 0) {
        _solUsdCache = { t: Date.now(), v: px };
        return px;
      }
    }
  } catch {
    // keep cache
  }
  return _solUsdCache.v;
}

let _ansemUsdCache = { t: 0, v: 0 };
async function roughAnsemUsd() {
  if (Date.now() - _ansemUsdCache.t < 60_000 && _ansemUsdCache.v > 0) {
    return _ansemUsdCache.v;
  }
  try {
    const mint = config.ansemMint || ANSEM_MINT;
    const res = await fetch(
      `https://api.dexscreener.com/tokens/v1/solana/${mint}`,
      { headers: { 'User-Agent': 'ansem-private-node/1.0' } },
    );
    if (res.ok) {
      const payload = await res.json();
      const pairs = Array.isArray(payload) ? payload : payload?.pairs ?? [];
      const px = Number(pairs[0]?.priceUsd);
      if (px > 0) {
        _ansemUsdCache = { t: Date.now(), v: px };
        return px;
      }
    }
  } catch {
    // keep cache
  }
  return _ansemUsdCache.v;
}
