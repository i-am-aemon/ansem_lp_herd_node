import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { ENV_PATH, ROOT, loadEnvFiles } from './load-env.js';
import { reloadConfig, config, saveCellJson, upsertEnvKeys } from './config.js';

function parseKeyFromEnvValue(raw) {
  if (!raw?.trim()) return { ok: false, reason: 'empty' };
  try {
    let kp;
    if (raw.trim().startsWith('[')) {
      kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.trim())));
    } else {
      kp = Keypair.fromSecretKey(bs58.decode(raw.trim()));
    }
    return { ok: true, keypair: kp, pubkey: kp.publicKey.toBase58() };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Keys from process.env (Railway) + .env file. */
function readEnvFileKeys() {
  const fromFile = parseEnvFile(ENV_PATH);
  const out = { ...fromFile };
  for (const k of [
    'LP_PRIVATE_KEY',
    'OPERATOR_PRIVATE_KEY',
    'DASHBOARD_PASSWORD',
    'DASHBOARD_TOKEN',
    'NODE_PASSWORD',
    'LP_WALLET_PUBLIC_KEY',
    'LP_WALLET',
  ]) {
    if (process.env[k]?.trim()) out[k] = process.env[k].trim();
  }
  return out;
}

function envFileModeOk() {
  if (!fs.existsSync(ENV_PATH)) return { ok: false, mode: null };
  const mode = fs.statSync(ENV_PATH).mode & 0o777;
  return { ok: mode <= 0o600, mode: mode.toString(8) };
}

/** Ensure .env exists (from example). Do not create a second secrets file.
 *  DASHBOARD_TOKEN is parked — not auto-scaffolded.
 */
export function scaffoldSecretsFile() {
  const example = path.join(ROOT, '.env.example');
  if (!fs.existsSync(ENV_PATH) && fs.existsSync(example)) {
    const text = fs.readFileSync(example, 'utf8');
    fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
    loadEnvFiles();
    reloadConfig();
    return { created: true, path: ENV_PATH };
  }
  return { created: false, path: ENV_PATH };
}

function statusForKey(envKey, expectedPubkey, label) {
  const keys = readEnvFileKeys();
  const raw = keys[envKey] || process.env[envKey];
  if (!raw) {
    return { label, envKey, present: false, matches: null, pubkey: null };
  }
  const parsed = parseKeyFromEnvValue(raw);
  if (!parsed.ok) {
    return { label, envKey, present: true, matches: false, error: parsed.reason };
  }
  const matches = expectedPubkey ? parsed.pubkey === expectedPubkey : null;
  return {
    label,
    envKey,
    present: true,
    matches,
    pubkey: parsed.pubkey,
    short: `${parsed.pubkey.slice(0, 4)}…${parsed.pubkey.slice(-4)}`,
  };
}

export function keyFileStatus() {
  const mode = envFileModeOk();
  return {
    path: ENV_PATH,
    exists: fs.existsSync(ENV_PATH) || Boolean(process.env.LP_PRIVATE_KEY),
    modeOk: mode.ok || Boolean(process.env.LP_PRIVATE_KEY),
    mode: mode.mode,
    lp: statusForKey('LP_PRIVATE_KEY', config.lpWallet, 'W1 LP'),
    operator: statusForKey(
      'OPERATOR_PRIVATE_KEY',
      config.operatorWallet,
      'W2 Operator',
    ),
    hasDashboardToken: Boolean(
      readEnvFileKeys().DASHBOARD_PASSWORD ||
        readEnvFileKeys().DASHBOARD_TOKEN ||
        process.env.DASHBOARD_PASSWORD ||
        process.env.DASHBOARD_TOKEN,
    ),
  };
}

/**
 * Generate new Phantom-compatible W1 + W2 (+ optional W0 main).
 * Writes keys into .env only — HTTP response returns pubkeys only.
 */
export function generateWalletKeypairs({ includeMain = true } = {}) {
  const secretsDir = path.join(ROOT, 'secrets');
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

  const roles = [
    ...(includeMain ? [['main', 'W0 main']] : []),
    ['lp', 'W1 LP'],
    ['operator', 'W2 operator'],
  ];

  const wallets = { ...(config.cell?.wallets || {}) };
  const keyPairs = {};

  for (const [role] of roles) {
    const kp = Keypair.generate();
    wallets[role] = kp.publicKey.toBase58();
    const secretPath = path.join(secretsDir, `${role}.json`);
    fs.writeFileSync(
      secretPath,
      JSON.stringify(Array.from(kp.secretKey)) + '\n',
      { mode: 0o600 },
    );
    keyPairs[role] = bs58.encode(kp.secretKey);
  }

  if (!wallets.ansemDest) wallets.ansemDest = config.ansemDestWallet || '';

  saveCellJson({ wallets });
  upsertEnvKeys({
    MAIN_WALLET: wallets.main || '',
    LP_WALLET_PUBLIC_KEY: wallets.lp || '',
    LP_WALLET: wallets.lp || '',
    OPERATOR_WALLET: wallets.operator || '',
    LP_PRIVATE_KEY: keyPairs.lp || '',
    OPERATOR_PRIVATE_KEY: keyPairs.operator || '',
  });
  try {
    fs.chmodSync(ENV_PATH, 0o600);
  } catch (_) {}

  loadEnvFiles();
  reloadConfig();

  return {
    wallets: {
      main: wallets.main || null,
      lp: wallets.lp,
      operator: wallets.operator,
      ansemDest: wallets.ansemDest || null,
    },
    secretsPath: ENV_PATH,
    secretsDir,
    note: 'Private keys written to .env and secrets/*.json only. Never commit .env.',
  };
}
