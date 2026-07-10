import { config, isLive, reloadConfig } from './config.js';
import { runKeeperTick } from './loop.js';
import { verifyKeysMatchPubkeys } from './wallet.js';
import { scaffoldSecretsFile } from './secrets.js';
import { logPolicyActivation } from './lib/node-policy.js';
import {
  startDashboard,
  setTickRunner,
  setLastTick,
  startTicking,
  resumeArmedMission,
} from './dashboard/server.js';

let running = false;

async function tickOnce(opts = {}) {
  if (running) {
    console.log('[node] tick already running — skip');
    return null;
  }
  running = true;
  try {
    reloadConfig();
    const forceDry = opts.forceDry === true;
    const dry = forceDry || !isLive();
    const result = await runKeeperTick({ dryRun: dry });
    setLastTick(result);
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error('[node] tick failed:', err);
    const result = {
      error: err,
      finished: new Date().toISOString(),
      dry_run: !isLive(),
    };
    setLastTick(result);
    return result;
  } finally {
    running = false;
  }
}

async function main() {
  scaffoldSecretsFile();
  reloadConfig();

  console.log('═══════════════════════════════════════════');
  console.log(' ANSEM HERD NODE');
  console.log(` cell=${config.cellId}`);
  console.log(` mode=${isLive() ? 'LIVE' : 'DRY_RUN'}`);
  console.log(` tracked(RO)=${config.trackedWallet}`);
  console.log(` controller(RO)=${config.controllerWallet}`);
  console.log(` LP(W1)=${config.lpWallet || '(unset — generate on /)'}`);
  console.log(` OP(W2)=${config.operatorWallet || '(unset)'}`);
  console.log(` ANSEM dest=${config.ansemDestWallet || '(unset)'}`);
  console.log(` active≤${config.nodeActiveLimit} APE<${config.apeMaxAgeMinutes}m`);
  console.log(' fee flow: claim → sweep → buy ANSEM → send (no burn)');
  console.log('═══════════════════════════════════════════');
  logPolicyActivation();

  const keys = verifyKeysMatchPubkeys();
  if (!keys.ok) console.warn('[node] key checks:', keys.errors);

  setTickRunner(tickOnce);

  if (config.dashboardEnabled) {
    startDashboard({ onTick: tickOnce });
  }

  // Skip boot tick when dashboard is on — avoids RPC 429 storms that stall the UI.
  // Fee bot / ▶ Start still trigger ticks on demand.
  if (!config.dashboardEnabled) {
    await tickOnce();
  } else {
    console.log('[node] dashboard on — skip boot keeper tick');
  }

  if (config.manual) {
    console.log('[node] MANUAL=true — exiting after one tick');
    process.exit(0);
  }

  if (!config.dashboardEnabled) {
    startTicking(config.tickMs);
  } else {
    // Resume ▶ Start mission after Railway/local redeploy if armed
    setTimeout(() => {
      resumeArmedMission().catch((e) =>
        console.warn('[run-state] resume failed:', e?.message || e),
      );
    }, 2500);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
