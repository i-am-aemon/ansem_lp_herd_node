#!/usr/bin/env node
/**
 * One automated seed pass (dry unless DRY_RUN=false SIMULATION_MODE=false).
 * Usage: npm run seed
 *        npm run seed -- --once
 */
import { config, isLive, reloadConfig } from '../src/config.js';
import { scaffoldSecretsFile } from '../src/secrets.js';
import { seedKeyStatus } from '../src/wallet.js';
import { runSeedOnce, runSeedPass } from '../src/seed-loop.js';

async function main() {
  scaffoldSecretsFile();
  reloadConfig();

  const once = process.argv.includes('--once');
  const forceDry = process.argv.includes('--dry') || !isLive();
  const keys = seedKeyStatus();

  console.log('═══════════════════════════════════════════');
  console.log(' ANSEM SEED');
  console.log(` mode=${forceDry ? 'DRY' : 'LIVE'}`);
  console.log(` LP=${config.lpWallet || '(unset)'}`);
  console.log(` keyMatch=${keys.lpMatches} canLive=${keys.canLiveSeed}`);
  if (keys.errors.length) console.log(` keys: ${keys.errors.join(' · ')}`);
  console.log('═══════════════════════════════════════════');

  if (!forceDry && !keys.canLiveSeed) {
    console.error('[seed] blocked — fix LP_PRIVATE_KEY to match LP_WALLET in .env');
    process.exit(1);
  }

  const result = once
    ? await runSeedOnce({ forceDry })
    : await runSeedPass({ forceDry, maxSteps: Number(process.env.SEED_MAX_STEPS || 40) });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.blocked) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
