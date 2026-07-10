#!/usr/bin/env node
/**
 * Sync ANSEM index start-list pools only (never full Meteora catalog)
 * → data/meteora/
 * Docs: https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview
 */
import { syncStartListPools, meteoraCacheStatus } from '../src/lib/meteora-api.js';
import { INDEX_CONSTITUENT_COUNT } from '../src/lib/ansem-index.js';

const started = Date.now();
console.log(
  `[meteora-sync] index-only · ${INDEX_CONSTITUENT_COUNT} constituents · ${meteoraCacheStatus().base}`,
);
const book = await syncStartListPools();
console.log(
  `[meteora-sync] wrote ${book.count} pools · ${book.errors?.length || 0} errors · ${Date.now() - started}ms`,
);
if (book.errors?.length) {
  for (const e of book.errors.slice(0, 5)) {
    console.warn(' ', e.ticker, e.error);
  }
}
console.log('[meteora-sync] cache', meteoraCacheStatus().dir);
