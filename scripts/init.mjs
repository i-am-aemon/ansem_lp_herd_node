#!/usr/bin/env node
/**
 * Scaffold ANSEM Herd Node config.
 * Usage: npm run init [-- --keys] [-- --force] [-- --label "…"]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const genKeys = args.includes('--keys');
const force = args.includes('--force');
const labelIdx = args.indexOf('--label');
const label = labelIdx >= 0 ? args[labelIdx + 1] : 'ANSEM Herd Node';

const OLD_BOOK = 'HpJbzERP44V21mKGRDDUArb9JJaL9NdPSgXzZ9uyieVB';

function main() {
  const cellPath = path.join(ROOT, 'cell.json');
  const envPath = path.join(ROOT, '.env');
  const secretsDir = path.join(ROOT, 'secrets');

  if (fs.existsSync(cellPath) && !force) {
    console.error('[init] cell.json already exists. Use --force to overwrite.');
    process.exit(1);
  }

  const version = fs.existsSync(path.join(ROOT, 'VERSION'))
    ? fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim()
    : '1.0.0';
  const cellId = `ansem-herd-${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  const wallets = { main: '', lp: '', operator: '', ansemDest: '' };
  let lpKey = '';
  let opKey = '';

  if (genKeys) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    for (const role of ['main', 'lp', 'operator']) {
      const kp = Keypair.generate();
      wallets[role] = kp.publicKey.toBase58();
      fs.writeFileSync(
        path.join(secretsDir, `${role}.json`),
        JSON.stringify(Array.from(kp.secretKey)) + '\n',
        { mode: 0o600 },
      );
      console.log(`[init] wrote secrets/${role}.json`);
    }
    lpKey = bs58.encode(
      Uint8Array.from(JSON.parse(fs.readFileSync(path.join(secretsDir, 'lp.json'), 'utf8'))),
    );
    opKey = bs58.encode(
      Uint8Array.from(
        JSON.parse(fs.readFileSync(path.join(secretsDir, 'operator.json'), 'utf8')),
      ),
    );
  }

  const template = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'cell.example.json'), 'utf8'),
  );
  const cell = {
    ...template,
    cellId,
    deployVersion: version,
    createdAt: now,
    label,
    trackedWallet: OLD_BOOK,
    wallets,
    runtime: {
      dryRun: true,
      simulationMode: true,
      demoMode: false,
      operatorMode: 'cover',
    },
  };
  fs.writeFileSync(cellPath, JSON.stringify(cell, null, 2) + '\n');
  console.log('[init] wrote cell.json');

  let env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  env = env.replace(/^LP_WALLET_PUBLIC_KEY=.*$/m, `LP_WALLET_PUBLIC_KEY=${wallets.lp}`);
  if (lpKey) {
    env = env.replace(/^LP_PRIVATE_KEY=.*$/m, `LP_PRIVATE_KEY=${lpKey}`);
  }
  if (opKey && wallets.operator && wallets.operator !== wallets.lp) {
    env += `\nOPERATOR_WALLET=${wallets.operator}\nOPERATOR_PRIVATE_KEY=${opKey}\n`;
  } else if (opKey) {
    env = env.includes('OPERATOR_PRIVATE_KEY=')
      ? env.replace(/^#? ?OPERATOR_PRIVATE_KEY=.*$/m, `OPERATOR_PRIVATE_KEY=${opKey}`)
      : env + `\nOPERATOR_PRIVATE_KEY=${opKey}\n`;
  }
  if (wallets.main) env += `MAIN_WALLET=${wallets.main}\n`;
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  console.log('[init] wrote .env (chmod 600)');

  console.log(`
Next:
  npm install
  npm run start          # http://127.0.0.1:8080/
  ${genKeys ? 'Import secrets/*.json into Phantom if you want mobile access' : 'Fill LP_WALLET_PUBLIC_KEY + LP_PRIVATE_KEY + DASHBOARD_PASSWORD in .env'}
  npm run doctor
`);
}

main();
