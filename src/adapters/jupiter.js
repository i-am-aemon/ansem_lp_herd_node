import { config } from '../config.js';
import { WSOL_MINT } from '../constants.js';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createBurnInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const JUPITER_QUOTE_API = process.env.JUPITER_QUOTE_API || 'https://lite-api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_API = process.env.JUPITER_SWAP_API || 'https://lite-api.jup.ag/swap/v1/swap';
const MAX_PRICE_IMPACT_PCT = Number(process.env.MAX_PRICE_IMPACT_PCT || 2);
const OPERATOR_FEE_RESERVE_LAMPORTS = 5_000_000;

async function resolveTokenProgram(conn, mint) {
  const info = await conn.getAccountInfo(mint, 'confirmed');
  if (info?.owner.equals(new PublicKey(TOKEN_2022_PROGRAM_ID))) {
    return new PublicKey(TOKEN_2022_PROGRAM_ID);
  }
  return new PublicKey(TOKEN_PROGRAM_ID);
}

export function createJupiterAdapter() {
  const conn = new Connection(config.rpcUrl, 'confirmed');

  async function getQuote(inputMint, outputMint, amount) {
    const url = new URL(JUPITER_QUOTE_API);
    url.searchParams.set('inputMint', inputMint);
    url.searchParams.set('outputMint', outputMint);
    url.searchParams.set('amount', String(Math.floor(amount)));
    url.searchParams.set('slippageBps', String(config.slippageBps));

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return {
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inAmount: Number(data.inAmount),
      outAmount: Number(data.outAmount),
      priceImpactPct: Number(data.priceImpactPct ?? 0),
      raw: data,
    };
  }

  async function buildSwapTx(quoteResponse, userPublicKey) {
    try {
      const body = JSON.stringify({
        quoteResponse: quoteResponse.raw ?? quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      });
      let res = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) {
        return { status: 'ERROR', error: `Jupiter swap build failed: ${res.status}` };
      }
      const data = await res.json();
      if (!data.swapTransaction) {
        return { status: 'ERROR', error: 'Jupiter returned no swapTransaction' };
      }
      return { status: 'READY', serialized: data.swapTransaction };
    } catch (e) {
      return { status: 'ERROR', error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function buildBurnTx(mint, amount, owner) {
    try {
      const ownerPk = new PublicKey(owner);
      const mintPk = new PublicKey(mint);
      const program = await resolveTokenProgram(conn, mintPk);
      const ata = await getAssociatedTokenAddress(mintPk, ownerPk, false, program);
      const burnAmount = BigInt(Math.floor(Number(amount)));
      if (burnAmount <= 0n) {
        return { status: 'ERROR', error: 'burn amount zero' };
      }
      const ix = createBurnInstruction(ata, mintPk, ownerPk, burnAmount, [], program);
      const tx = new Transaction().add(ix);
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = ownerPk;
      return {
        status: 'READY',
        serialized: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString('base64'),
        amount: Number(burnAmount),
      };
    } catch (e) {
      return { status: 'ERROR', error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function swapSolForToken(usdAmount, outputMint, solUsd, ownerPubkey, maxLamports = null) {
    if (!solUsd || solUsd <= 0) {
      return { status: 'ERROR', error: 'SOL price unavailable — cannot size swap' };
    }
    let lamports = Math.floor((usdAmount / solUsd) * 1e9);
    if (maxLamports != null) {
      lamports = Math.min(lamports, Math.max(0, maxLamports - OPERATOR_FEE_RESERVE_LAMPORTS));
    }
    if (lamports <= 0) return { status: 'SKIP', reason: 'amount too small after balance cap' };

    return swapSolLamports(lamports, outputMint, ownerPubkey, maxLamports);
  }

  /** Seed path: size by SOL amount (not USD). */
  async function swapSolLamports(solAmountOrLamports, outputMint, ownerPubkey, maxLamports = null) {
    let lamports =
      solAmountOrLamports >= 1e6
        ? Math.floor(Number(solAmountOrLamports))
        : Math.floor(Number(solAmountOrLamports) * 1e9);
    if (maxLamports != null) {
      lamports = Math.min(lamports, Math.max(0, maxLamports - OPERATOR_FEE_RESERVE_LAMPORTS));
    }
    if (lamports <= 5_000) {
      return { status: 'SKIP', reason: 'amount too small after balance cap' };
    }

    const quote = await getQuote(WSOL_MINT, outputMint, lamports);
    if (quote.priceImpactPct > MAX_PRICE_IMPACT_PCT) {
      return {
        status: 'ERROR',
        error: `price impact ${quote.priceImpactPct.toFixed(2)}% exceeds max ${MAX_PRICE_IMPACT_PCT}%`,
        quote,
      };
    }
    const swap = await buildSwapTx(quote, ownerPubkey);
    return { ...swap, quote, lamports, quoteRaw: quote.raw };
  }

  /** Seed path: swap raw token amount (e.g. ANSEM → TOKEN when SOL is reserved). */
  async function swapTokenRaw(inputMint, outputMint, rawAmount, ownerPubkey) {
    const amount = Math.floor(Number(rawAmount));
    if (!inputMint || !outputMint || !(amount > 0)) {
      return { status: 'SKIP', reason: 'token swap amount too small' };
    }
    const quote = await getQuote(inputMint, outputMint, amount);
    if (quote.priceImpactPct > MAX_PRICE_IMPACT_PCT) {
      return {
        status: 'ERROR',
        error: `price impact ${quote.priceImpactPct.toFixed(2)}% exceeds max ${MAX_PRICE_IMPACT_PCT}%`,
        quote,
      };
    }
    const swap = await buildSwapTx(quote, ownerPubkey);
    return { ...swap, quote, inAmount: amount, quoteRaw: quote.raw };
  }

  return {
    getQuote,
    buildSwapTx,
    buildBurnTx,
    swapSolForToken,
    swapSolLamports,
    swapTokenRaw,
    MAX_PRICE_IMPACT_PCT,
  };
}
