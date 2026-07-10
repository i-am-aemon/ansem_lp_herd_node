#!/usr/bin/env node
import { execSync } from 'child_process';

const port = process.argv[2] || '8080';
try {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (pids) {
      for (const pid of pids.split('\n')) {
        try {
          process.kill(Number(pid), 'SIGTERM');
          console.log(`[prestart] killed pid ${pid} on :${port}`);
        } catch {
          // ignore
        }
      }
    }
  }
} catch {
  // nothing listening
}
