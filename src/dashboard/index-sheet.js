/**
 * ANSEM Index sheet — website HomeIndex table language for the node.
 * Rectangular rows: TICKER–ANSEM · Creator · Holder · amount · fees · 24h · Meteora/Dex.
 *
 * Share columns (different % — do not conflate):
 *   Creator = % of this wallet's book (position ÷ book total)
 *   Holder  = % of that pool's TVL (position ÷ pool TVL)
 */
import { esc } from './layout.js';
import { fmtMoney, fmtPct, fmtPctChange, pctToneClass, formatClientJs } from './format.js';
import {
  INDEX_TOKEN_SYMBOL,
  HERD_POOL_PLACEHOLDER,
  isHerdPoolLive,
} from '../constants.js';
import { resolveHerdMint, resolveHerdPool, herdPoolRow } from '../lib/ansem-index.js';

const METEORA_ICON = 'https://app.meteora.ag/apple/apple-icon-57x57.png';
const DEX_ICON = 'https://dexscreener.com/favicon.png';

function shortCa(addr) {
  const s = String(addr || '');
  if (s.length < 12) return s || '—';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function meteoraUrl(pool) {
  if (!pool || pool === HERD_POOL_PLACEHOLDER || /^X+$/i.test(pool)) return '#';
  return `https://app.meteora.ag/pools/${encodeURIComponent(pool)}`;
}

function dexUrl(mint) {
  if (!mint || mint.length < 32) return 'https://dexscreener.com/solana';
  return `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;
}

function round1(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 10) / 10;
}

/**
 * Normalize portfolio / start-list rows into Index sheet rows.
 * @param {object[]} rows
 * @param {{ totalUsd?: number, herdLive?: boolean }} opts
 */
export function normalizeIndexRows(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const total =
    opts.totalUsd != null
      ? Number(opts.totalUsd)
      : list.reduce(
          (s, r) =>
            s +
            (Number(r.valueUsd ?? r.position_value_usd ?? r.amount) || 0),
          0,
        );
  const herd = herdPoolRow();
  const herdLive = opts.herdLive != null ? opts.herdLive : Boolean(herd);

  const mapped = list.map((r) => {
    const pool = r.pool || r.pool_address || '';
    const ticker = r.ticker || r.token_symbol || r.constituent_token?.symbol || '?';
    const valueUsd = Number(r.valueUsd ?? r.position_value_usd ?? 0) || 0;
    // Creator = book weight
    const creatorSharePct =
      r.sharePct != null
        ? Number(r.sharePct)
        : r.share_pct != null
          ? Number(r.share_pct)
          : total > 0
            ? (valueUsd / total) * 100
            : 0;
    // Holder = of-pool TVL (may be absent until portfolio enrich)
    const holderSharePct =
      r.holderSharePct != null
        ? Number(r.holderSharePct)
        : r.share_of_pool_pct != null
          ? Number(r.share_of_pool_pct)
          : null;
    const isHerd =
      Boolean(r.herd) ||
      (herd && (pool === herd.pool || ticker === herd.ticker));
    return {
      ticker,
      pool,
      mint: r.mint || r.constituent_token?.address || '',
      sharePct: round1(creatorSharePct) ?? 0,
      holderSharePct: round1(holderSharePct),
      poolTvlUsd: r.poolTvlUsd ?? r.pool_tvl_usd ?? null,
      mcapUsd: r.mcapUsd ?? r.market_cap_usd ?? null,
      valueUsd: Math.round(valueUsd * 100) / 100,
      feesUsd: Number(r.feesUsd ?? r.unclaimed_fees_usd ?? r.fees_generated_usd ?? 0) || 0,
      chg24: r.chg24 ?? r.price_change_24h ?? null,
      herd: isHerd,
      placeholder: false,
    };
  });

  // Pin live HERD first
  mapped.sort((a, b) => {
    if (a.herd !== b.herd) return a.herd ? -1 : 1;
    return (b.valueUsd || 0) - (a.valueUsd || 0);
  });

  const showPlaceholder = !herdLive || !mapped.some((r) => r.herd);
  if (showPlaceholder) {
    const mint = resolveHerdMint() || HERD_POOL_PLACEHOLDER;
    const pool = resolveHerdPool() || HERD_POOL_PLACEHOLDER;
    mapped.unshift({
      ticker: INDEX_TOKEN_SYMBOL || 'HERD',
      pool: isHerdPoolLive(pool) ? pool : HERD_POOL_PLACEHOLDER,
      mint: mint.length >= 32 ? mint : HERD_POOL_PLACEHOLDER,
      sharePct: null,
      holderSharePct: null,
      poolTvlUsd: null,
      mcapUsd: null,
      valueUsd: null,
      feesUsd: null,
      chg24: null,
      herd: true,
      placeholder: true,
    });
  }

  return mapped;
}

function pairCell(r) {
  const sub = r.placeholder
    ? 'not live · paste HERD_POOL at launch'
    : shortCa(r.pool);
  const href = meteoraUrl(r.pool);
  const pair = `${esc(r.ticker)}<span class="index-pair-ansem">–ANSEM</span>`;
  return `
    <a class="index-pair" href="${esc(href)}" target="_blank" rel="noreferrer" ${r.placeholder ? 'onclick="return false"' : ''}>
      <img src="${METEORA_ICON}" alt="" width="18" height="18" class="index-ico" />
      <span class="index-pair-text">
        <span class="index-pair-name">${pair}</span>
        <span class="index-pair-sub muted">${esc(sub)}</span>
      </span>
    </a>`;
}

function linksCell(r) {
  const m = meteoraUrl(r.pool);
  const d = dexUrl(r.mint);
  return `
    <div class="index-links">
      <a class="index-link-btn" href="${esc(m)}" target="_blank" rel="noreferrer" title="Meteora" ${r.placeholder ? 'onclick="return false"' : ''}>
        <img src="${METEORA_ICON}" alt="M" width="14" height="14" />
      </a>
      <a class="index-link-btn" href="${esc(d)}" target="_blank" rel="noreferrer" title="DexScreener" ${r.placeholder && !(r.mint && r.mint.length >= 32) ? 'onclick="return false"' : ''}>
        <img src="${DEX_ICON}" alt="D" width="14" height="14" />
      </a>
    </div>`;
}

function shareCell(value, cls) {
  if (value == null) return `<td class="index-num ${cls}">—</td>`;
  return `<td class="index-num ${cls}">${esc(fmtPct(value))}</td>`;
}

function rowHtml(r) {
  const cls = [
    'index-row',
    r.herd ? 'herd' : '',
    r.placeholder ? 'placeholder' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const creator =
    r.sharePct == null || r.placeholder ? null : r.sharePct;
  const holder =
    r.holderSharePct == null || r.placeholder ? null : r.holderSharePct;
  const amount = r.placeholder || r.valueUsd == null ? '—' : fmtMoney(r.valueUsd);
  const fees = r.placeholder || r.feesUsd == null ? '—' : fmtMoney(r.feesUsd);
  const chg = r.placeholder || r.chg24 == null ? '—' : fmtPctChange(r.chg24);
  const chgCls = r.placeholder ? 'muted' : pctToneClass(r.chg24);
  return `
    <tr class="${cls}" data-tick="${esc(String(r.ticker || '').toLowerCase())}" data-herd="${r.herd ? '1' : '0'}">
      <td class="index-col-pool">${pairCell(r)}</td>
      ${shareCell(creator, 'index-share index-share-creator')}
      ${shareCell(holder, 'index-share index-share-holder')}
      <td class="index-num">${esc(amount)}</td>
      <td class="index-num index-fees">${esc(fees)}</td>
      <td class="index-num ${chgCls}">${esc(chg)}</td>
      <td class="index-col-links">${linksCell(r)}</td>
    </tr>`;
}

/**
 * Server-rendered Index sheet shell.
 * opts: { id, rows, title, showFilter, totalUsd, herdLive }
 */
export function indexSheetHtml(opts = {}) {
  const id = opts.id || 'index-sheet';
  const rows = normalizeIndexRows(opts.rows || [], {
    totalUsd: opts.totalUsd,
    herdLive: opts.herdLive,
  });
  const title = opts.title || 'ANSEM Index';
  const filter = opts.showFilter !== false;

  return `
    <div class="index-sheet" id="${esc(id)}" data-sheet="${esc(id)}">
      <div class="row" style="justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap">
        <div>
          <p class="muted" style="margin:0;font-size:9px;letter-spacing:0.1em;text-transform:uppercase">${esc(title)}</p>
          <p class="muted" style="margin:4px 0 0;font-size:10px;line-height:1.35">
            <span class="index-share-creator">Creator</span> = % book ·
            <span class="index-share-holder">Holder</span> = % pool
          </p>
        </div>
        <div class="row" style="gap:8px;align-items:center">
          <span class="muted" id="${esc(id)}-count" style="font-size:10px">${esc(String(rows.filter((r) => !r.placeholder).length))} pools</span>
          ${
            filter
              ? `<input id="${esc(id)}-filter" class="index-sheet-filter" placeholder="filter…" style="max-width:120px;margin:0" data-sheet="${esc(id)}" />`
              : ''
          }
        </div>
      </div>
      <div class="scroll-x" style="max-height:70vh;overflow-y:auto">
        <table class="index-table">
          <thead>
            <tr>
              <th class="index-col-pool">Pool</th>
              <th class="index-num" data-sort="share" title="% of creator/controller book">
                <button type="button" class="index-sort" data-sheet="${esc(id)}" data-key="share">Creator</button>
              </th>
              <th class="index-num" data-sort="holder" title="% of this pool's TVL held by wallet">
                <button type="button" class="index-sort" data-sheet="${esc(id)}" data-key="holder">Holder</button>
              </th>
              <th class="index-num" data-sort="amount"><button type="button" class="index-sort" data-sheet="${esc(id)}" data-key="amount">Amount</button></th>
              <th class="index-num" data-sort="fees"><button type="button" class="index-sort" data-sheet="${esc(id)}" data-key="fees">Fees</button></th>
              <th class="index-num" data-sort="chg24"><button type="button" class="index-sort" data-sheet="${esc(id)}" data-key="chg24">24h</button></th>
              <th class="index-col-links"></th>
            </tr>
          </thead>
          <tbody id="${esc(id)}-body">${rows.map(rowHtml).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Brand strip: $ANSEM (live) + $HERD (placeholder until mint set).
 */
export function herdBrandStripHtml({
  ansemMint,
  herdMint = '',
  herdPool = '',
  herdLive = false,
} = {}) {
  const herdCa =
    herdMint && herdMint.length >= 32 ? herdMint : HERD_POOL_PLACEHOLDER;
  const herdPoolDisp =
    herdLive && herdPool ? herdPool : HERD_POOL_PLACEHOLDER;
  const herdLivePill = herdLive
    ? '<span class="pill ok">LIVE</span>'
    : '<span class="pill dry">PRE-LAUNCH</span>';

  return `
    <div class="card herd-brand" style="margin-bottom:10px;padding:0;overflow:hidden">
      <div class="herd-brand-row">
        <div>
          <div class="muted" style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Pair mint</div>
          <div style="font-size:14px;font-weight:600">$ANSEM</div>
        </div>
        <code class="herd-ca" id="ansem-ca">${esc(ansemMint || '')}</code>
        <button type="button" class="secondary copy-ca" data-ca="${esc(ansemMint || '')}" style="padding:4px 8px;font-size:10px">Copy</button>
        <a href="https://solscan.io/token/${encodeURIComponent(ansemMint || '')}" target="_blank" rel="noreferrer" style="font-size:11px">Solscan ↗</a>
      </div>
      <div class="herd-brand-row" style="border-top:1px solid var(--border)">
        <div>
          <div class="muted" style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Index token</div>
          <div style="font-size:14px;font-weight:600;color:var(--accent)">$HERD</div>
        </div>
        <code class="herd-ca" id="herd-ca">${esc(herdCa)}</code>
        <button type="button" class="secondary copy-ca" data-ca="${esc(herdCa)}" style="padding:4px 8px;font-size:10px">Copy</button>
        ${herdLivePill}
      </div>
      <p class="muted" style="margin:0;padding:8px 12px;font-size:10px;line-height:1.4;border-top:1px solid var(--border)">
        ${
          herdLive
            ? `HERD–ANSEM pool live · <code>${esc(shortCa(herdPoolDisp))}</code> — every node joins.`
            : 'No $HERD CA yet — paste <code>HERD_MINT</code> + <code>HERD_POOL</code> at launch. Node runs TOKEN–ANSEM only until then.'
        }
      </p>
    </div>`;
}

/** Client JS: sort / filter / re-render Index sheet from row arrays. */
export function indexSheetClientJs() {
  return `
        ${formatClientJs()}
        var INDEX_METEORA_ICO = ${JSON.stringify(METEORA_ICON)};
        var INDEX_DEX_ICO = ${JSON.stringify(DEX_ICON)};
        var INDEX_HERD_PLACEHOLDER = ${JSON.stringify(HERD_POOL_PLACEHOLDER)};
        var _indexSheets = {};

        function shortCaClient(addr) {
          var s = String(addr || '');
          if (s.length < 12) return s || '—';
          return s.slice(0, 4) + '…' + s.slice(-4);
        }
        function meteoraUrlClient(pool) {
          if (!pool || pool === INDEX_HERD_PLACEHOLDER || /^X+$/i.test(pool)) return '#';
          return 'https://app.meteora.ag/pools/' + encodeURIComponent(pool);
        }
        function dexUrlClient(mint) {
          if (!mint || mint.length < 32) return 'https://dexscreener.com/solana';
          return 'https://dexscreener.com/solana/' + encodeURIComponent(mint);
        }
        function escClient(s) {
          return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        function fmtShareCell(v) {
          return (v == null) ? '—' : fmtPct(v);
        }
        function indexRowHtml(r) {
          var cls = 'index-row' + (r.herd ? ' herd' : '') + (r.placeholder ? ' placeholder' : '');
          var creator = (r.sharePct == null || r.placeholder) ? null : r.sharePct;
          var holder = (r.holderSharePct == null || r.placeholder) ? null : r.holderSharePct;
          var amount = (r.placeholder || r.valueUsd == null) ? '—' : fmtMoney(r.valueUsd);
          var fees = (r.placeholder || r.feesUsd == null) ? '—' : fmtMoney(r.feesUsd);
          var chg = (r.placeholder || r.chg24 == null) ? '—' : fmtPctChange(r.chg24);
          var chgCls = r.placeholder ? 'muted' : pctToneClass(r.chg24);
          var sub = r.placeholder ? 'not live · paste HERD_POOL at launch' : shortCaClient(r.pool);
          var href = meteoraUrlClient(r.pool);
          var pair = escClient(r.ticker) + '<span class="index-pair-ansem">–ANSEM</span>';
          var dead = r.placeholder ? ' onclick="return false"' : '';
          var dexDead = (r.placeholder && !(r.mint && r.mint.length >= 32)) ? ' onclick="return false"' : '';
          return '<tr class="' + cls + '" data-tick="' + escClient(String(r.ticker || '').toLowerCase()) + '" data-herd="' + (r.herd ? '1' : '0') + '">'
            + '<td class="index-col-pool"><a class="index-pair" href="' + escClient(href) + '" target="_blank" rel="noreferrer"' + dead + '>'
            + '<img src="' + INDEX_METEORA_ICO + '" alt="" width="18" height="18" class="index-ico" />'
            + '<span class="index-pair-text"><span class="index-pair-name">' + pair + '</span>'
            + '<span class="index-pair-sub muted">' + escClient(sub) + '</span></span></a></td>'
            + '<td class="index-num index-share index-share-creator">' + escClient(fmtShareCell(creator)) + '</td>'
            + '<td class="index-num index-share index-share-holder">' + escClient(fmtShareCell(holder)) + '</td>'
            + '<td class="index-num">' + escClient(amount) + '</td>'
            + '<td class="index-num index-fees">' + escClient(fees) + '</td>'
            + '<td class="index-num ' + chgCls + '">' + escClient(chg) + '</td>'
            + '<td class="index-col-links"><div class="index-links">'
            + '<a class="index-link-btn" href="' + escClient(href) + '" target="_blank" rel="noreferrer" title="Meteora"' + dead + '><img src="' + INDEX_METEORA_ICO + '" alt="M" width="14" height="14" /></a>'
            + '<a class="index-link-btn" href="' + escClient(dexUrlClient(r.mint)) + '" target="_blank" rel="noreferrer" title="DexScreener"' + dexDead + '><img src="' + INDEX_DEX_ICO + '" alt="D" width="14" height="14" /></a>'
            + '</div></td></tr>';
        }
        function sortIndexRows(rows, key, dir) {
          var d = dir === 'asc' ? 1 : -1;
          return (rows || []).slice().sort(function (a, b) {
            if (a.placeholder !== b.placeholder) return a.placeholder ? -1 : 1;
            var av, bv;
            if (key === 'share') { av = a.sharePct; bv = b.sharePct; }
            else if (key === 'holder') { av = a.holderSharePct; bv = b.holderSharePct; }
            else if (key === 'fees') { av = a.feesUsd; bv = b.feesUsd; }
            else if (key === 'chg24') { av = a.chg24; bv = b.chg24; }
            else { av = a.valueUsd; bv = b.valueUsd; }
            var aM = av == null || Number.isNaN(Number(av));
            var bM = bv == null || Number.isNaN(Number(bv));
            if (aM && bM) return 0;
            if (aM) return 1;
            if (bM) return -1;
            return d * (Number(av) - Number(bv));
          });
        }
        function renderIndexSheet(id, rows, opts) {
          opts = opts || {};
          _indexSheets[id] = { rows: rows || [], sortKey: opts.sortKey || 'amount', sortDir: opts.sortDir || 'desc' };
          var st = _indexSheets[id];
          var sorted = sortIndexRows(st.rows, st.sortKey, st.sortDir);
          var body = document.getElementById(id + '-body');
          if (body) body.innerHTML = sorted.map(indexRowHtml).join('');
          var count = document.getElementById(id + '-count');
          if (count) {
            var n = sorted.filter(function (r) { return !r.placeholder; }).length;
            count.textContent = n + ' pools';
          }
          applyIndexFilter(id);
        }
        function applyIndexFilter(id) {
          var inp = document.getElementById(id + '-filter');
          var body = document.getElementById(id + '-body');
          if (!body) return;
          var q = ((inp && inp.value) || '').toLowerCase().trim();
          body.querySelectorAll('tr.index-row').forEach(function (tr) {
            var tick = tr.getAttribute('data-tick') || '';
            var ok = !q || tick.includes(q) || (tr.getAttribute('data-herd') === '1' && 'herd'.includes(q));
            tr.style.display = ok ? '' : 'none';
          });
          var count = document.getElementById(id + '-count');
          if (count && q) {
            var n = 0;
            body.querySelectorAll('tr.index-row').forEach(function (tr) {
              if (tr.style.display !== 'none' && !tr.classList.contains('placeholder')) n++;
            });
            count.textContent = n + ' pools';
          }
        }
        function bindIndexSheet(id) {
          document.querySelectorAll('.index-sort[data-sheet="' + id + '"]').forEach(function (btn) {
            if (btn._idxBound) return;
            btn._idxBound = true;
            btn.addEventListener('click', function () {
              var st = _indexSheets[id] || { rows: [], sortKey: 'amount', sortDir: 'desc' };
              var key = btn.getAttribute('data-key') || 'amount';
              if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
              else { st.sortKey = key; st.sortDir = 'desc'; }
              renderIndexSheet(id, st.rows, st);
            });
          });
          var inp = document.getElementById(id + '-filter');
          if (inp && !inp._idxBound) {
            inp._idxBound = true;
            inp.addEventListener('input', function () { applyIndexFilter(id); });
          }
        }
        function bindCopyCa() {
          document.querySelectorAll('.copy-ca').forEach(function (btn) {
            if (btn._copyBound) return;
            btn._copyBound = true;
            btn.addEventListener('click', function () {
              var v = btn.getAttribute('data-ca') || '';
              if (!v) return;
              navigator.clipboard.writeText(v).then(function () {
                var t = btn.textContent;
                btn.textContent = 'Copied';
                setTimeout(function () { btn.textContent = t; }, 1200);
              }).catch(function () {});
            });
          });
        }
        function portfolioToIndexRows(positions, opts) {
          opts = opts || {};
          var list = positions || [];
          var total = list.reduce(function (s, p) { return s + (Number(p.position_value_usd) || 0); }, 0);
          var herdLive = !!opts.herdLive;
          var herdTicker = opts.herdTicker || 'HERD';
          var herdPool = opts.herdPool || '';
          var rows = list.map(function (p) {
            var valueUsd = Number(p.position_value_usd) || 0;
            var ticker = p.ticker || (p.constituent_token && p.constituent_token.symbol) || '?';
            var pool = p.pool_address || '';
            var isHerd = !!(opts.herdPool && pool === opts.herdPool) || ticker === herdTicker;
            var creator = (p.share_pct != null)
              ? Math.round(Number(p.share_pct) * 10) / 10
              : (total > 0 ? Math.round((valueUsd / total) * 1000) / 10 : 0);
            var holder = (p.share_of_pool_pct != null && Number.isFinite(Number(p.share_of_pool_pct)))
              ? Math.round(Number(p.share_of_pool_pct) * 10) / 10
              : null;
            return {
              ticker: ticker,
              pool: pool,
              mint: (p.constituent_token && p.constituent_token.address) || p.mint || '',
              sharePct: creator,
              holderSharePct: holder,
              poolTvlUsd: p.pool_tvl_usd != null ? Number(p.pool_tvl_usd) : null,
              valueUsd: Math.round(valueUsd * 100) / 100,
              feesUsd: Number(p.unclaimed_fees_usd) || 0,
              chg24: p.price_change_24h,
              herd: isHerd,
              placeholder: false
            };
          });
          rows.sort(function (a, b) {
            if (a.herd !== b.herd) return a.herd ? -1 : 1;
            return (b.valueUsd || 0) - (a.valueUsd || 0);
          });
          var hasHerd = rows.some(function (r) { return r.herd; });
          if (!herdLive || !hasHerd) {
            rows.unshift({
              ticker: herdTicker,
              pool: INDEX_HERD_PLACEHOLDER,
              mint: INDEX_HERD_PLACEHOLDER,
              sharePct: null, holderSharePct: null, poolTvlUsd: null,
              valueUsd: null, feesUsd: null, chg24: null,
              herd: true, placeholder: true
            });
          }
          return rows;
        }
`;
}
