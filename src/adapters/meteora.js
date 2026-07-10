import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CpAmm, getUnClaimLpFee } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import { config } from '../config.js';
import { ANSEM_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../constants.js';
import { fetchOpenPositions } from '../lib/meteora-api.js';
import { getTokenBalanceRaw } from './solana.js';

const SLIPPAGE_BPS = 300; // 3% — volatile meme pools trip 1% on addLiquidity

function bnToUi(raw, decimals) {
  return Number(raw.toString()) / 10 ** decimals;
}

async function resolveTokenProgram(conn, mint) {
  const info = await conn.getAccountInfo(mint, 'confirmed');
  if (info?.owner.equals(new PublicKey(TOKEN_2022_PROGRAM_ID))) {
    return new PublicKey(TOKEN_2022_PROGRAM_ID);
  }
  return new PublicKey(TOKEN_PROGRAM_ID);
}

async function mintDecimals(conn, mint) {
  const supply = await conn.getTokenSupply(mint, 'confirmed');
  return supply.value.decimals;
}

/**
 * List open DAMM v2 positions for a wallet via public datapi (no key).
 * Uses shared meteora-api client (memory + optional disk cache).
 */
export async function listOpenPositions(wallet = config.lpWallet) {
  const open = await fetchOpenPositions(wallet, { persist: true });
  return open.positions;
}

function serializeTx(tx, feePayer) {
  return {
    status: 'READY',
    serialized: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64'),
    feePayer: feePayer.toBase58(),
    note: 'Unsigned — approve in Phantom. Site never holds your key for this path.',
  };
}

export function createMeteoraAdapter() {
  const conn = new Connection(config.rpcUrl, 'confirmed');
  const amm = new CpAmm(conn);
  const ansemMint = new PublicKey(config.ansemMint || ANSEM_MINT);

  async function readUnclaimedUsd(positionAddress) {
    try {
      const positionState = await amm.fetchPositionState(new PublicKey(positionAddress));
      const poolState = await amm.fetchPoolState(positionState.pool);
      const [decA, decB] = await Promise.all([
        mintDecimals(conn, poolState.tokenAMint),
        mintDecimals(conn, poolState.tokenBMint),
      ]);
      const fees = getUnClaimLpFee(poolState, positionState);
      return {
        feeTokenA: bnToUi(fees.feeTokenA, decA),
        feeTokenB: bnToUi(fees.feeTokenB, decB),
        tokenAMint: poolState.tokenAMint.toBase58(),
        tokenBMint: poolState.tokenBMint.toBase58(),
        hasAnsem:
          poolState.tokenAMint.equals(ansemMint) || poolState.tokenBMint.equals(ansemMint),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function buildClaimFeesTx(positionAddress, owner) {
    try {
      const pos = await amm.fetchPositionState(new PublicKey(positionAddress));
      const pool = pos.pool;
      const ownerPk = new PublicKey(owner);
      const poolState = await amm.fetchPoolState(pool);
      const positions = await amm.getUserPositionByPool(pool, ownerPk);
      const match = positions.find((p) => p.position.toBase58() === positionAddress);

      if (!match) {
        return {
          status: 'ERROR',
          error: 'Position not owned by LP wallet — verify LP_WALLET owns this position',
        };
      }

      const fees = getUnClaimLpFee(poolState, match.positionState);
      const hasFees = fees.feeTokenA.gtn(0) || fees.feeTokenB.gtn(0);
      if (!hasFees) {
        return { status: 'SKIP', error: 'No unclaimed fees on position' };
      }

      const [tokenAProgram, tokenBProgram] = await Promise.all([
        resolveTokenProgram(conn, poolState.tokenAMint),
        resolveTokenProgram(conn, poolState.tokenBMint),
      ]);

      const tx = await amm.claimPositionFee2({
        owner: ownerPk,
        position: match.position,
        pool,
        positionNftAccount: match.positionNftAccount,
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram,
        tokenBProgram,
        receiver: ownerPk,
        feePayer: ownerPk,
      });

      if (!tx?.instructions?.length) {
        return { status: 'ERROR', error: 'Claim tx has no instructions' };
      }

      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = ownerPk;

      return {
        ...serializeTx(tx, ownerPk),
        pool: pool.toBase58(),
        position: positionAddress,
      };
    } catch (e) {
      return { status: 'ERROR', error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Quote + optional unsigned removeLiquidity / removeAllLiquidity tx.
   * pct 1–100 of unlocked liquidity. Never signs.
   */
  async function buildWithdrawPlan({ pool, owner, pct = 25, buildTx = true }) {
    try {
      const poolPk = new PublicKey(pool);
      const ownerPk = new PublicKey(owner);
      const poolState = await amm.fetchPoolState(poolPk);
      const userPositions = await amm.getUserPositionByPool(poolPk, ownerPk);
      if (!userPositions?.length) {
        return {
          status: 'EMPTY',
          error: 'No on-chain position for this wallet on pool',
          pool,
          links: { meteora: `https://app.meteora.ag/pools/${pool}` },
        };
      }

      const [decA, decB] = await Promise.all([
        mintDecimals(conn, poolState.tokenAMint),
        mintDecimals(conn, poolState.tokenBMint),
      ]);
      const [tokenAProgram, tokenBProgram] = await Promise.all([
        resolveTokenProgram(conn, poolState.tokenAMint),
        resolveTokenProgram(conn, poolState.tokenBMint),
      ]);

      const pctClamped = Math.max(1, Math.min(100, Number(pct) || 25));
      const quotes = [];
      const txs = [];

      for (const match of userPositions) {
        const unlocked = match.positionState.unlockedLiquidity || new BN(0);
        if (unlocked.isZero()) {
          quotes.push({
            position: match.position.toBase58(),
            status: 'SKIP',
            detail: 'No unlocked liquidity',
          });
          continue;
        }

        const liquidityDelta =
          pctClamped >= 100
            ? unlocked
            : unlocked.mul(new BN(Math.round(pctClamped * 100))).div(new BN(10_000));

        if (liquidityDelta.isZero()) {
          quotes.push({
            position: match.position.toBase58(),
            status: 'SKIP',
            detail: 'Liquidity delta rounds to zero',
          });
          continue;
        }

        const withdrawQuote = await amm.getWithdrawQuote({
          liquidityDelta,
          sqrtPrice: poolState.sqrtPrice,
          minSqrtPrice: poolState.sqrtMinPrice,
          maxSqrtPrice: poolState.sqrtMaxPrice,
          collectFeeMode: poolState.collectFeeMode,
          tokenAAmount: poolState.tokenAAmount,
          tokenBAmount: poolState.tokenBAmount,
          liquidity: poolState.liquidity,
        });

        const outA = bnToUi(withdrawQuote.outAmountA, decA);
        const outB = bnToUi(withdrawQuote.outAmountB, decB);
        const thrA = withdrawQuote.outAmountA
          .mul(new BN(10_000 - SLIPPAGE_BPS))
          .div(new BN(10_000));
        const thrB = withdrawQuote.outAmountB
          .mul(new BN(10_000 - SLIPPAGE_BPS))
          .div(new BN(10_000));
        quotes.push({
          position: match.position.toBase58(),
          pct: pctClamped,
          liquidityDelta: liquidityDelta.toString(),
          tokenAMint: poolState.tokenAMint.toBase58(),
          tokenBMint: poolState.tokenBMint.toBase58(),
          outAmountA: outA,
          outAmountB: outB,
          slippageBps: SLIPPAGE_BPS,
          tokenASymbol: poolState.tokenAMint.equals(ansemMint) ? 'ANSEM' : 'TOKEN_A',
          tokenBSymbol: poolState.tokenBMint.equals(ansemMint) ? 'ANSEM' : 'TOKEN_B',
        });

        if (!buildTx) continue;

        const removeAll = pctClamped >= 100;
        const tx = removeAll
          ? await amm.removeAllLiquidity({
              owner: ownerPk,
              pool: poolPk,
              position: match.position,
              positionNftAccount: match.positionNftAccount,
              tokenAAmountThreshold: thrA,
              tokenBAmountThreshold: thrB,
              tokenAMint: poolState.tokenAMint,
              tokenBMint: poolState.tokenBMint,
              tokenAVault: poolState.tokenAVault,
              tokenBVault: poolState.tokenBVault,
              tokenAProgram,
              tokenBProgram,
            })
          : await amm.removeLiquidity({
              owner: ownerPk,
              pool: poolPk,
              position: match.position,
              positionNftAccount: match.positionNftAccount,
              liquidityDelta,
              tokenAAmountThreshold: thrA,
              tokenBAmountThreshold: thrB,
              tokenAMint: poolState.tokenAMint,
              tokenBMint: poolState.tokenBMint,
              tokenAVault: poolState.tokenAVault,
              tokenBVault: poolState.tokenBVault,
              tokenAProgram,
              tokenBProgram,
            });

        if (!tx?.instructions?.length) {
          txs.push({
            position: match.position.toBase58(),
            status: 'ERROR',
            error: 'Withdraw tx has no instructions',
          });
          continue;
        }

        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = ownerPk;

        txs.push({
          position: match.position.toBase58(),
          method: removeAll ? 'removeAllLiquidity' : 'removeLiquidity',
          ...serializeTx(tx, ownerPk),
        });
      }

      return {
        status: quotes.some((q) => q.outAmountA != null) ? 'READY' : 'EMPTY',
        pool,
        pct: pctClamped,
        tokenAMint: poolState.tokenAMint.toBase58(),
        tokenBMint: poolState.tokenBMint.toBase58(),
        quotes,
        txs,
        links: { meteora: `https://app.meteora.ag/pools/${pool}` },
        autoSign: false,
        note: 'SDK quote from on-chain pool/position state. Sign txs in Phantom only.',
      };
    } catch (e) {
      return {
        status: 'ERROR',
        error: e instanceof Error ? e.message : String(e),
        pool,
        links: { meteora: `https://app.meteora.ag/pools/${pool}` },
      };
    }
  }

  /**
   * Best-effort unsigned add-liquidity / create+add.
   * Falls back to DEEP_LINK when balances/quote/build fail — never pretends success.
   */
  async function buildAddLiquidityTx(opts = {}) {
    const pool = String(opts.pool || '').trim();
    const owner = String(opts.owner || '').trim();
    const links = pool ? { meteora: `https://app.meteora.ag/pools/${pool}` } : {};
    if (!pool || !owner) {
      return {
        status: 'DEEP_LINK',
        error: 'pool and owner required',
        links,
        autoSign: false,
      };
    }

    try {
      const poolPk = new PublicKey(pool);
      const ownerPk = new PublicKey(owner);
      const poolState = await amm.fetchPoolState(poolPk);
      const [decA, decB] = await Promise.all([
        mintDecimals(conn, poolState.tokenAMint),
        mintDecimals(conn, poolState.tokenBMint),
      ]);
      const [tokenAProgram, tokenBProgram] = await Promise.all([
        resolveTokenProgram(conn, poolState.tokenAMint),
        resolveTokenProgram(conn, poolState.tokenBMint),
      ]);

      const isAAnsem = poolState.tokenAMint.equals(ansemMint);
      const isBAnsem = poolState.tokenBMint.equals(ansemMint);
      if (!isAAnsem && !isBAnsem) {
        return {
          status: 'DEEP_LINK',
          error: 'Pool is not an ANSEM pair — use Meteora UI',
          links,
          autoSign: false,
        };
      }

      const ansemUi = Math.max(0.1, Number(opts.ansemAmount) || 1);
      const ansemDec = isAAnsem ? decA : decB;
      const ansemRaw = new BN(Math.floor(ansemUi * 10 ** ansemDec));

      const balA = await getTokenBalanceRaw(owner, poolState.tokenAMint.toBase58());
      const balB = await getTokenBalanceRaw(owner, poolState.tokenBMint.toBase58());
      const balABn = new BN(balA.toString());
      const balBBn = new BN(balB.toString());

      const isTokenA = isAAnsem;
      const inAmount = ansemRaw;
      const haveIn = isTokenA ? balABn : balBBn;
      if (haveIn.lt(inAmount)) {
        return {
          status: 'DEEP_LINK',
          error: `Need ~${ansemUi} ANSEM in wallet (have ${bnToUi(haveIn, ansemDec).toFixed(4)}). Buy ANSEM first, or deposit on Meteora.`,
          links: {
            ...links,
            jupiterAnsem: `https://jup.ag/swap/SOL-${ansemMint.toBase58()}`,
          },
          autoSign: false,
          balances: {
            tokenA: bnToUi(balABn, decA),
            tokenB: bnToUi(balBBn, decB),
          },
        };
      }

      const depositQuote = amm.getDepositQuote({
        inAmount,
        isTokenA,
        minSqrtPrice: poolState.sqrtMinPrice,
        maxSqrtPrice: poolState.sqrtMaxPrice,
        sqrtPrice: poolState.sqrtPrice,
        collectFeeMode: poolState.collectFeeMode,
        tokenAAmount: poolState.tokenAAmount,
        tokenBAmount: poolState.tokenBAmount,
        liquidity: poolState.liquidity,
      });

      const maxA = isTokenA ? depositQuote.consumedInputAmount : depositQuote.outputAmount;
      const maxB = isTokenA ? depositQuote.outputAmount : depositQuote.consumedInputAmount;
      const haveOut = isTokenA ? balBBn : balABn;
      const needOut = isTokenA ? maxB : maxA;
      if (haveOut.lt(needOut)) {
        return {
          status: 'DEEP_LINK',
          error: `Need matching TOKEN side (~${bnToUi(needOut, isTokenA ? decB : decA).toPrecision(4)}). Buy TOKEN or deposit on Meteora.`,
          links: {
            ...links,
            jupiterToken: opts.tokenMint ? `https://jup.ag/swap/SOL-${opts.tokenMint}` : links.meteora,
          },
          autoSign: false,
          quote: {
            ansemUi,
            needTokenA: bnToUi(maxA, decA),
            needTokenB: bnToUi(maxB, decB),
            liquidityDelta: depositQuote.liquidityDelta.toString(),
          },
        };
      }

      const thrA = maxA.mul(new BN(10_000 + SLIPPAGE_BPS)).div(new BN(10_000));
      const thrB = maxB.mul(new BN(10_000 + SLIPPAGE_BPS)).div(new BN(10_000));
      const userPositions = await amm.getUserPositionByPool(poolPk, ownerPk);
      const existing = userPositions?.[0];

      let tx;
      let method;
      let extraSigners = [];
      if (existing) {
        method = 'addLiquidity';
        tx = await amm.addLiquidity({
          owner: ownerPk,
          position: existing.position,
          pool: poolPk,
          positionNftAccount: existing.positionNftAccount,
          liquidityDelta: depositQuote.liquidityDelta,
          maxAmountTokenA: thrA,
          maxAmountTokenB: thrB,
          tokenAAmountThreshold: thrA,
          tokenBAmountThreshold: thrB,
          tokenAMint: poolState.tokenAMint,
          tokenBMint: poolState.tokenBMint,
          tokenAVault: poolState.tokenAVault,
          tokenBVault: poolState.tokenBVault,
          tokenAProgram,
          tokenBProgram,
        });
      } else {
        method = 'createPositionAndAddLiquidity';
        const positionNft = Keypair.generate();
        tx = await amm.createPositionAndAddLiquidity({
          owner: ownerPk,
          pool: poolPk,
          positionNft: positionNft.publicKey,
          liquidityDelta: depositQuote.liquidityDelta,
          maxAmountTokenA: thrA,
          maxAmountTokenB: thrB,
          tokenAAmountThreshold: thrA,
          tokenBAmountThreshold: thrB,
          tokenAMint: poolState.tokenAMint,
          tokenBMint: poolState.tokenBMint,
          tokenAProgram,
          tokenBProgram,
        });
        extraSigners = [positionNft];
      }

      if (!tx?.instructions?.length) {
        return {
          status: 'DEEP_LINK',
          error: 'Deposit tx has no instructions — use Meteora UI',
          links,
          autoSign: false,
        };
      }

      // Blockhash + feePayer must be set before partialSign (NFT mint) or serialize.
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = ownerPk;
      if (extraSigners.length) {
        if (tx.partialSign) tx.partialSign(...extraSigners);
        else if (tx.sign) tx.sign(...extraSigners);
      }

      return {
        ...serializeTx(tx, ownerPk),
        method,
        pool,
        detail: `${method} · ~${ansemUi} ANSEM dual-sided · ${SLIPPAGE_BPS}bps slip buffer`,
        quote: {
          ansemUi,
          needTokenA: bnToUi(maxA, decA),
          needTokenB: bnToUi(maxB, decB),
          liquidityDelta: depositQuote.liquidityDelta.toString(),
        },
        /** In-process only — never serialize NFT secret to disk/API JSON */
        extraSigners,
        links,
        autoSign: false,
      };
    } catch (e) {
      return {
        status: 'DEEP_LINK',
        error: e instanceof Error ? e.message : String(e),
        links,
        autoSign: false,
        note: 'SDK deposit failed — open Meteora and approve in Phantom.',
      };
    }
  }

  return {
    readUnclaimedUsd,
    buildClaimFeesTx,
    buildWithdrawPlan,
    buildAddLiquidityTx,
    amm,
    conn,
  };
}
