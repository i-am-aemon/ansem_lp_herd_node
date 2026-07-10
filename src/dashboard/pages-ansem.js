import { layout, esc } from './layout.js';
import {
  indexSheetHtml,
  indexSheetClientJs,
  normalizeIndexRows,
} from './index-sheet.js';
import { INDEX_NAME, INDEX_TOKEN_SYMBOL, isHerdPoolLive } from '../constants.js';
import { resolveHerdPool, resolveHerdMint } from '../lib/ansem-index.js';

/**
 * /ansem — read-only tracked Index book (website HomeIndex table language).
 */
export function renderAnsem({ wallet, indexName, herdLive, herdPool, herdMint }) {
  const short = wallet
    ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
    : '—';
  const live = herdLive != null ? herdLive : isHerdPoolLive(herdPool || resolveHerdPool());
  const title = indexName || INDEX_NAME || 'ANSEM INDEX';

  // Empty shell — client fills from /api/portfolio; placeholder HERD until live.
  const initialRows = normalizeIndexRows([], { herdLive: live });

  return layout({
    title,
    active: '/ansem',
    body: `
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <h1 style="margin:0">${esc(title)}</h1>
        <div class="row">
          <span class="pill dry">RO</span>
          <span class="pill" id="index-filter-pill">index</span>
          ${live ? '<span class="pill ok">$HERD live</span>' : '<span class="pill dry">$HERD pre-launch</span>'}
          <button type="button" class="secondary" id="btn-toggle-all" style="padding:4px 8px;font-size:10px" title="Show all pools">All</button>
          <button type="button" class="secondary" id="btn-refresh" style="padding:4px 8px">↻</button>
        </div>
      </div>

      <p class="muted" style="margin:0 0 10px;font-size:11px;line-height:1.45">
        Tracked book · ${esc(short)} · node capital on <a href="/run">Run</a>
        ${live ? '' : ' · $HERD CA not set — TOKEN–ANSEM only'}
      </p>

      <div class="grid" id="metrics" style="margin-bottom:10px"></div>

      <div class="card">
        ${indexSheetHtml({
          id: 'ansem-index',
          rows: initialRows,
          title: 'Portfolio',
          herdLive: live,
          showFilter: true,
        })}
      </div>

      <script>
        ${indexSheetClientJs()}
        const wallet = ${JSON.stringify(wallet)};
        const herdLive = ${JSON.stringify(!!live)};
        const herdPool = ${JSON.stringify(herdPool || resolveHerdPool() || '')};
        const herdTicker = ${JSON.stringify(INDEX_TOKEN_SYMBOL || 'HERD')};
        let positions = [];
        let indexOnly = true;

        function renderMetrics(p) {
          const t = p.totals || {};
          document.getElementById('metrics').innerHTML = [
            ['Balance', fmtMoney(t.balances), 'USD'],
            ['Fees', fmtMoney(t.unclaimed_fees), 'unclaimed'],
            ['PnL', fmtMoney(t.pnl), fmtPctChange(t.pnl_pct_change)],
          ].map(([k,v,s]) => '<div class="metric"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>').join('');
          const pill = document.getElementById('index-filter-pill');
          if (pill) pill.textContent = p.index_only ? 'index' : 'all';
        }

        async function load() {
          const q = '/api/portfolio?wallet=' + encodeURIComponent(wallet) + (indexOnly ? '' : '&all=1');
          const p = await (await fetch(q, { cache: 'no-store' })).json();
          if (p.error) throw new Error(p.error);
          positions = p.positions || [];
          renderMetrics(p);
          const rows = portfolioToIndexRows(positions, { herdLive: herdLive, herdPool: herdPool, herdTicker: herdTicker });
          renderIndexSheet('ansem-index', rows);
        }

        bindIndexSheet('ansem-index');
        bindCopyCa();
        document.getElementById('btn-refresh').onclick = () => load().catch(e => alert(e.message));
        document.getElementById('btn-toggle-all').onclick = () => {
          indexOnly = !indexOnly;
          document.getElementById('btn-toggle-all').textContent = indexOnly ? 'All' : 'Idx';
          load().catch(e => alert(e.message));
        };
        load().catch(e => {
          const c = document.getElementById('ansem-index-count');
          if (c) c.textContent = e.message;
        });
        setInterval(() => load().catch(() => {}), 30000);
      </script>
    `,
  });
}
