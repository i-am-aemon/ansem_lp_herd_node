/**
 * Wallet census — list SPL holdings, map to ANSEM index, classify dust for LP.
 * Day-1 bone from micro_trader wallet_census (read-only; no orphan adopt).
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { ANSEM_MINT, WSOL_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../constants.js';
import { START_LIST, findConstituent, effectiveStartList } from './ansem-index.js';
import { getSolBalance } from '../adapters/solana.js';
import { listOpenPositions } from '../adapters/meteora.js';
import { withRpcRetry, sleep, rpcMinDelayMs } from './rpc-patience.js';

const TOKEN_PROG = new PublicKey(TOKEN_PROGRAM_ID);
const TOKEN_2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);

function mintMap() {
  const m = new Map();
  for (const row of effectiveStartList(START_LIST)) {
    if (row.mint) m.set(row.mint, row);
  }
  return m;
}

/**
 * @param {string} [wallet]
 * @returns {Promise<{
 *   wallet: string,
 *   sol: number,
 *   holdings: Array<object>,
 *   indexDust: Array<object>,
 *   ansem: object|null,
 *   orphans: Array<object>,
 *   positions: number,
 *   positionPools: string[],
 *   deployableDust: Array<object>,
 * }>}
 */
export async function runWalletCensus(wallet = config.lpWallet) {
  const ownerStr = (wallet || '').trim();
  if (!ownerStr) {
    return {
      wallet: '',
      sol: 0,
      holdings: [],
      indexDust: [],
      ansem: null,
      orphans: [],
      positions: 0,
      positionPools: [],
      deployableDust: [],
      error: 'wallet required',
    };
  }

  const conn = new Connection(config.rpcUrl, 'confirmed');
  const owner = new PublicKey(ownerStr);
  const byMint = mintMap();
  const ansemMint = config.ansemMint || ANSEM_MINT;
  const gap = Math.max(150, rpcMinDelayMs());

  // Sequential — micro_trader paces calls; Promise.all stamps public RPC → 429
  const sol = await getSolBalance(ownerStr);
  await sleep(gap);
  const tok = await withRpcRetry(
    () => conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROG }),
    { label: 'tokenAccounts', maxAttempts: 5 },
  );
  await sleep(gap);
  let tok22 = { value: [] };
  try {
    tok22 = await withRpcRetry(
      () => conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022 }),
      { label: 'token2022Accounts', maxAttempts: 4 },
    );
  } catch {
    tok22 = { value: [] };
  }
  await sleep(gap);
  const positions = await listOpenPositions(ownerStr).catch(() => []);

  const holdings = [];
  for (const a of [...(tok.value || []), ...(tok22.value || [])]) {
    const info = a.account.data.parsed?.info;
    if (!info) continue;
    const mint = info.mint;
    const ui = Number(info.tokenAmount?.uiAmount || 0);
    if (!(ui > 0)) continue;
    const row = byMint.get(mint);
    const isAnsem = mint === ansemMint;
    const isWsol = mint === WSOL_MINT;
    holdings.push({
      mint,
      ticker: row?.ticker || (isAnsem ? 'ANSEM' : isWsol ? 'WSOL' : `${mint.slice(0, 6)}…`),
      pool: row?.pool || null,
      ui,
      index: Boolean(row) || isAnsem,
      isAnsem,
      isWsol,
      isNftDust: ui === 1 && !row && !isAnsem && !isWsol, // position NFTs often show as 1
    });
  }
  holdings.sort((a, b) => b.ui - a.ui);

  const ansem = holdings.find((h) => h.isAnsem) || null;
  const indexDust = holdings.filter((h) => h.index && !h.isAnsem && !h.isWsol);
  const orphans = holdings.filter((h) => !h.index && !h.isWsol && !h.isNftDust);
  const positionPools = (positions || [])
    .map((p) => p.pool_address || p.pool || '')
    .filter(Boolean);
  // Dust we can still push into LPs (held TOKEN with an index pool)
  const deployableDust = indexDust.filter((h) => h.pool && h.ui > 0);

  return {
    wallet: ownerStr,
    sol,
    holdings,
    indexDust,
    ansem,
    orphans,
    positions: (positions || []).length,
    positionPools,
    deployableDust,
    at: new Date().toISOString(),
  };
}

/** Map mint → ui amount for seed planner (index TOKEN sides only). */
export function heldByMintFromCensus(census) {
  const m = new Map();
  for (const h of census?.holdings || []) {
    if (h.mint) m.set(h.mint, h.ui);
  }
  return m;
}

export function findIndexRowForMint(mint) {
  return findConstituent({ mint }) || START_LIST.find((r) => r.mint === mint) || null;
}
