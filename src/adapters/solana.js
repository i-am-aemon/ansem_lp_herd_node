import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { config } from '../config.js';
import { withRpcRetry } from '../lib/rpc-patience.js';

let _conn;

export function getConnection() {
  if (!_conn) _conn = new Connection(config.rpcUrl, 'confirmed');
  return _conn;
}

export async function getSolBalance(pubkeyStr) {
  if (!pubkeyStr) return 0;
  try {
    const lamports = await withRpcRetry(
      () => getConnection().getBalance(new PublicKey(pubkeyStr), 'confirmed'),
      { label: 'getBalance', maxAttempts: 5 },
    );
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

export async function resolveTokenProgram(mintStr) {
  const info = await withRpcRetry(
    () => getConnection().getAccountInfo(new PublicKey(mintStr), 'confirmed'),
    { label: 'getAccountInfo', maxAttempts: 6 },
  );
  if (info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

export async function getTokenBalanceRaw(ownerStr, mintStr) {
  const owner = new PublicKey(ownerStr);
  const mint = new PublicKey(mintStr);
  const program = await resolveTokenProgram(mintStr);
  const ata = await getAssociatedTokenAddress(mint, owner, false, program);
  try {
    const bal = await withRpcRetry(
      () => getConnection().getTokenAccountBalance(ata, 'confirmed'),
      { label: 'getTokenAccountBalance', maxAttempts: 5 },
    );
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

function deserializeTx(serializedBase64) {
  const raw = Buffer.from(serializedBase64, 'base64');
  try {
    return { kind: 'versioned', tx: VersionedTransaction.deserialize(raw) };
  } catch {
    return { kind: 'legacy', tx: Transaction.from(raw) };
  }
}

export async function signAndSendTransaction(serializedBase64, signers, label = 'tx') {
  const conn = getConnection();
  const parsed = deserializeTx(serializedBase64);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

  if (parsed.kind === 'versioned') {
    parsed.tx.sign(signers);
    const sig = await conn.sendRawTransaction(parsed.tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[solana] ${label} confirmed: ${sig}`);
    return sig;
  }

  parsed.tx.sign(...signers);
  if (!parsed.tx.recentBlockhash) parsed.tx.recentBlockhash = blockhash;
  const sig = await conn.sendRawTransaction(parsed.tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(`[solana] ${label} confirmed: ${sig}`);
  return sig;
}

export async function buildSolTransferTx(fromPubkey, toPubkey, lamports) {
  const from = new PublicKey(fromPubkey);
  const to = new PublicKey(toPubkey);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );
  const { blockhash } = await getConnection().getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

export async function sweepSol(fromKeypair, toPubkeyStr, reserveSol = 0.01) {
  const from = fromKeypair.publicKey.toBase58();
  if (from && toPubkeyStr && from === toPubkeyStr) {
    return {
      status: 'skipped',
      reason: 'single-wallet mode: LP === operator (sweep no-op)',
    };
  }
  const balance = await getConnection().getBalance(fromKeypair.publicKey, 'confirmed');
  const reserveLamports = Math.floor(reserveSol * LAMPORTS_PER_SOL);
  const feeBuffer = 10_000;
  const sendLamports = balance - reserveLamports - feeBuffer;
  if (sendLamports <= 0) {
    return { status: 'skipped', reason: 'insufficient SOL to sweep after reserve' };
  }
  const serialized = await buildSolTransferTx(
    fromKeypair.publicKey.toBase58(),
    toPubkeyStr,
    sendLamports,
  );
  return {
    status: 'ready',
    serialized,
    lamports: sendLamports,
    sol: sendLamports / LAMPORTS_PER_SOL,
  };
}

/** Build SPL transfer of `amount` raw units of `mint` from owner → recipient. */
export async function buildTokenTransferTx(mint, amount, owner, recipient) {
  const ownerPk = new PublicKey(owner);
  const recipientPk = new PublicKey(recipient);
  const mintPk = new PublicKey(mint);
  const program = await resolveTokenProgram(mint);
  const fromAta = await getAssociatedTokenAddress(mintPk, ownerPk, false, program);
  const toAta = await getAssociatedTokenAddress(mintPk, recipientPk, false, program);
  const raw = BigInt(Math.floor(Number(amount)));
  if (raw <= 0n) return { status: 'ERROR', error: 'transfer amount zero' };

  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      ownerPk,
      toAta,
      recipientPk,
      mintPk,
      program,
    ),
  );
  tx.add(createTransferInstruction(fromAta, toAta, ownerPk, raw, [], program));

  const { blockhash } = await getConnection().getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = ownerPk;

  return {
    status: 'READY',
    serialized: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64'),
    amount: Number(raw),
  };
}

export { LAMPORTS_PER_SOL, PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID };
