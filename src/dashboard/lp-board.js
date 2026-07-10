import { esc } from './layout.js';

const GREEN = '#34d399';

function fmtMoney(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0) return '$0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
  if (a >= 1) return sign + '$' + a.toFixed(2);
  return sign + '$' + a.toFixed(3);
}

function fmtPct(x) {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  return `${Number(x).toFixed(1)}%`;
}

/** Circular donut pie. opts: { centerLabel, titleColor, centerSub } */
function pieDonutSvg(slices, totalUsd, title, size = 140, opts = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const rO = size / 2 - 6;
  const rI = rO * 0.52;
  const list = slices || [];
  const total = list.reduce((s, x) => s + Math.max(0, Number(x.value) || 0), 0);
  const titleColor = opts.titleColor || '';
  const centerLabel = opts.centerLabel || null;
  const centerSub = opts.centerSub || (centerLabel ? '' : 'total');
  const fmt = (n) => {
    const v = Number(n) || 0;
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k';
    if (v >= 1) return '$' + v.toFixed(0);
    return '$' + v.toFixed(2);
  };
  const titleStyle = titleColor
    ? `font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;text-align:center;color:${esc(titleColor)};font-weight:600`
    : 'font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;text-align:center';
  if (!(total > 0)) {
    return `
      <div class="pie-wrap" style="text-align:center">
        <div class="${titleColor ? '' : 'muted'}" style="${titleStyle}">${esc(title)}</div>
        <div style="width:${size}px;height:${size}px;margin:0 auto;border-radius:50%;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;background:#000;color:var(--muted);font-size:11px">empty</div>
      </div>`;
  }
  function polar(r, angle) {
    const a = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  function ring(start, end) {
    const o0 = polar(rO, start);
    const o1 = polar(rO, end);
    const i1 = polar(rI, end);
    const i0 = polar(rI, start);
    const large = end - start > 180 ? 1 : 0;
    return `M ${o0.x} ${o0.y} A ${rO} ${rO} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${rI} ${rI} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
  }
  let angle = 0;
  const paths = list
    .map((s) => {
      const span = (Math.max(0, Number(s.value) || 0) / total) * 360;
      const start = angle;
      const end = angle + Math.max(span, 0.4);
      angle = end;
      const color = s.color || GREEN;
      return `<path d="${ring(start, end)}" fill="${esc(color)}" fill-opacity="0.85" stroke="rgba(0,0,0,0.55)" stroke-width="1"><title>${esc(s.label)} ${esc(String(s.pct ?? ''))}%</title></path>`;
    })
    .join('');
  const legend = list
    .slice(0, 6)
    .map(
      (s) =>
        `<div style="display:flex;align-items:center;gap:6px;font-size:10px;line-height:1.35;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:0;background:${esc(s.color || GREEN)};flex-shrink:0"></span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label)}</span>
          <span class="muted" style="font-variant-numeric:tabular-nums">${esc(String(s.pct ?? 0))}%</span>
        </div>`,
    )
    .join('');
  const centerMain = centerLabel != null ? centerLabel : fmt(totalUsd ?? total);
  return `
    <div class="pie-wrap">
      <div class="${titleColor ? '' : 'muted'}" style="${titleStyle}">${esc(title)}</div>
      <div style="display:flex;justify-content:center;margin-bottom:8px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(title)}">
          <circle cx="${cx}" cy="${cy}" r="${rO + 2}" fill="none" stroke="${titleColor ? esc(titleColor) : 'rgba(255,255,255,0.12)'}" stroke-width="1" stroke-opacity="0.55"/>
          ${paths}
          <circle cx="${cx}" cy="${cy}" r="${rI - 1}" fill="#000" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
          <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${titleColor ? esc(titleColor) : '#f0f0f0'}" style="font-size:12px;font-weight:600;font-family:ui-monospace,monospace">${esc(centerMain)}</text>
          ${centerSub ? `<text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#888" style="font-size:9px;font-family:ui-monospace,monospace">${esc(centerSub)}</text>` : ''}
        </svg>
      </div>
      <div>${legend}</div>
    </div>`;
}

/** Left: $HERD Controller · Creator · Center: This node · Right: Holder Pools · targets */
function dualSpreadHtml(book) {
  const you = book?.you || {};
  const ctrl = book?.ctrl || {};
  const goal = book?.goal || {};
  const poolsGreen = goal.accent || GREEN;
  return `
    <div id="lp-spread" style="margin-top:14px">
      <p class="muted" style="margin:0 0 10px;font-size:9px;letter-spacing:0.08em;text-transform:uppercase">$HERD Controller · Creator · This node · Holder Pools · targets</p>
      <div class="pie-trio" style="align-items:start">
        ${pieDonutSvg(ctrl.slices, ctrl.totalUsd, '$HERD Controller · Creator')}
        ${pieDonutSvg(you.slices, you.totalUsd, 'This node')}
        ${pieDonutSvg(goal.slices, null, goal.title || 'Holder Pools · targets', 140, {
          titleColor: poolsGreen,
          centerLabel: goal.centerLabel || 'targets',
          centerSub: 'calc',
        })}
      </div>
      <p class="muted" style="margin:10px 0 0;font-size:10px;line-height:1.4">
        <span style="color:${esc(poolsGreen)};font-weight:600">Green agent</span> =
        Start on Run. It covers mins, then deepens toward
        <span style="color:${esc(poolsGreen)};font-weight:600">Holder Pools · targets</span>
        (calc pie: <code>targetWeightPct</code> from pool prefs, else controller weight when follow-controller is on).
        Not a live wallet book — display may show controller fallback before sync writes prefs.
      </p>
    </div>`;
}

function sortByUsd(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0));
}

function laneOf(r) {
  if (r.lane) return r.lane;
  if (r.mode === 'off') return 'off';
  if (r.mode === 'hold' || r.holdExisting) return 'hold';
  return 'bot';
}

function bookRowsByLane(book) {
  const bot = (book?.bot || []).map((r) => ({ ...r, lane: 'bot' }));
  const hidden = book?.hidden || [];
  const hold = hidden.filter((r) => laneOf(r) === 'hold').map((r) => ({ ...r, lane: 'hold' }));
  const overflow = hidden
    .filter((r) => laneOf(r) === 'overflow')
    .map((r) => ({ ...r, lane: 'overflow' }));
  const off = hidden
    .filter((r) => laneOf(r) === 'off')
    .map((r) => ({ ...r, lane: 'off' }));
  return { bot, hold, overflow, off, all: [...bot, ...hold, ...overflow, ...off] };
}

/** Thin rectangular spreadsheet-style card rows (micro_trader language). */
function sheetCardRowsHtml(rows) {
  const list = sortByUsd(rows);
  if (!list.length) {
    return `<div class="pool-ranks" id="lp-sheet-body"><div class="muted" style="font-size:11px;padding:8px">No pools</div></div>`;
  }
  return `<div class="pool-ranks" id="lp-sheet-body">${list
    .map((r, i) => {
      const q = encodeURIComponent(r.pool || r.ticker);
      const under = r.gapPct != null && r.gapPct > 0.5;
      const over = r.gapPct != null && r.gapPct < -0.5;
      const cls = under ? 'need' : over ? 'ok' : '';
      const gapStr =
        r.gapPct == null
          ? 'no goal'
          : under
            ? `need +${r.gapPct}%`
            : over
              ? `over ${r.gapPct}%`
              : 'on goal';
      return `<div class="pool-rank-row ${cls}" data-tick="${esc(String(r.ticker || '').toLowerCase())}" data-lane="${esc(laneOf(r))}">
        <div class="pr-rank">${i + 1}</div>
        <div class="pr-main">
          <div class="pr-top">
            <strong class="pr-tick">${esc(r.ticker)}</strong>
            <span class="pr-usd">${esc(fmtMoney(r.valueUsd))}</span>
            <span class="pr-gap ${under ? 'bad' : over ? 'ok' : 'muted'}">${esc(gapStr)}</span>
          </div>
          <div class="pr-meta muted">
            you ${esc(fmtPct(r.youPct))} · goal ${esc(fmtPct(r.goalPct))} · ctrl ${esc(fmtPct(r.ctrlPct))} · fees ${esc(fmtMoney(r.unclaimedUsd))}
          </div>
        </div>
        <div class="pr-acts">
          <a href="/pool?pool=${q}&action=claim">Claim</a>
          <a href="/pool?pool=${q}&action=withdraw">Take %</a>
          <a class="pr-close" href="/pool?pool=${q}&action=close">Close</a>
          <a href="/pool?pool=${q}">→</a>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

function careSheetHtml(book, limit) {
  const lanes = bookRowsByLane(book);
  const botN = lanes.bot.length;
  return `
    <div id="lp-sheet" style="margin:0">
      <div class="row" style="justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap">
        <span class="muted" id="lp-sheet-count" style="font-size:10px">${esc(String(botN))}/${esc(String(limit))}</span>
        <input id="lp-sheet-filter" placeholder="filter…" style="max-width:120px;margin:0" />
      </div>
      <div style="max-height:70vh;overflow-y:auto">${sheetCardRowsHtml(lanes.bot)}</div>
    </div>`;
}

/**
 * Hub-style LP portfolio: $HERD Controller · This node · Holder Pools + card rows.
 */
export function lpPortfolioHtml(book, pol = {}) {
  const b = book || {};
  const limit = Math.max(10, Number(pol.nodeActiveLimit || b.activeLimit || 10) || 10);
  const bot = b.bot || [];
  const ctrlShort = (b.ctrlWallet || '').slice(0, 4);

  return `
    <section id="lp-portfolio" class="card" style="margin-bottom:12px;padding:14px;background:#000">
      <p class="muted" style="margin:0;font-size:9px;letter-spacing:0.1em;text-transform:uppercase">LP Portfolio</p>
      <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;margin-top:8px;flex-wrap:wrap">
        <div>
          <div style="font-size:28px;font-weight:600;letter-spacing:-0.03em;font-variant-numeric:tabular-nums" id="lp-total">${esc(fmtMoney(b.totalUsd))}</div>
          <div class="muted" style="font-size:10px;margin-top:2px">This node · all pools</div>
        </div>
        <div class="row" style="gap:16px;flex-wrap:wrap">
          <div><div class="muted" style="font-size:9px;text-transform:uppercase">$HERD Controller</div><div style="font-size:14px" id="lp-ctrl-total">${esc(fmtMoney(b.ctrl?.totalUsd))}</div><div class="muted" style="font-size:8px" id="lp-ctrl-w">${esc(ctrlShort ? ctrlShort + '…' : '—')}</div></div>
          <div><div class="muted" style="font-size:9px;text-transform:uppercase">Unclaimed</div><div style="font-size:14px;color:var(--accent)" id="lp-unclaimed">${esc(fmtMoney(b.unclaimedUsd))}</div></div>
          <div><div class="muted" style="font-size:9px;text-transform:uppercase">Fees earned</div><div style="font-size:14px;color:var(--accent)" id="lp-earned">${esc(fmtMoney(b.feesEarnedUsd))}</div></div>
          <div><div class="muted" style="font-size:9px;text-transform:uppercase">Bot set</div><div style="font-size:14px" id="lp-botn">${esc(String(bot.length))}/${esc(String(limit))}</div></div>
        </div>
      </div>
      ${dualSpreadHtml(b)}

      <div class="row" style="justify-content:space-between;align-items:baseline;margin:16px 0 8px;gap:8px">
        <div>
          <p class="muted" style="margin:0;font-size:9px;letter-spacing:0.08em;text-transform:uppercase">Care · you % vs green target</p>
          <p class="muted" style="margin:4px 0 0;font-size:10px;line-height:1.4">Underweight = need. Min 10 pools — Active limit + follow-controller on <a href="/config">Config</a>.</p>
        </div>
        <button type="button" class="secondary" id="btn-sync-ctrl" style="padding:4px 8px;font-size:10px">Sync ctrl weights</button>
      </div>
      ${careSheetHtml(b, limit)}
    </section>`;
}

/** Client-side updater (injected into Run). */
export function lpPortfolioClientJs() {
  return `
        function fmtMoneyClient(x) {
          const n = Number(x);
          if (!Number.isFinite(n) || n === 0) return '$0';
          const a = Math.abs(n);
          const sign = n < 0 ? '-' : '';
          if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
          if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
          if (a >= 1) return sign + '$' + a.toFixed(2);
          return sign + '$' + a.toFixed(3);
        }
        function fmtPctClient(x) {
          if (x == null || !Number.isFinite(Number(x))) return '—';
          return Number(x).toFixed(1) + '%';
        }
        var LP_GREEN = '#34d399';
        function pieClient(slices, totalUsd, title, opts) {
          opts = opts || {};
          const size = 140;
          const cx = size / 2, cy = size / 2, rO = size / 2 - 6, rI = rO * 0.52;
          const list = slices || [];
          const total = list.reduce((s, x) => s + Math.max(0, Number(x.value) || 0), 0);
          const titleColor = opts.titleColor || '';
          const centerLabel = opts.centerLabel || null;
          const centerSub = opts.centerSub != null ? opts.centerSub : (centerLabel ? '' : 'total');
          const fmt = (n) => { const v = Number(n) || 0; if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k'; if (v >= 1) return '$' + v.toFixed(0); return '$' + v.toFixed(2); };
          const titleStyle = titleColor
            ? 'font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;text-align:center;color:' + titleColor + ';font-weight:600'
            : 'font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;text-align:center';
          if (!(total > 0)) {
            return '<div class="pie-wrap" style="text-align:center"><div style="' + titleStyle + '">' + title + '</div><div style="width:' + size + 'px;height:' + size + 'px;margin:0 auto;border-radius:50%;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;background:#000;color:var(--muted);font-size:11px">empty</div></div>';
          }
          function polar(r, angle) { const a = ((angle - 90) * Math.PI) / 180; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; }
          function ring(start, end) {
            const o0 = polar(rO, start), o1 = polar(rO, end), i1 = polar(rI, end), i0 = polar(rI, start);
            const large = end - start > 180 ? 1 : 0;
            return 'M ' + o0.x + ' ' + o0.y + ' A ' + rO + ' ' + rO + ' 0 ' + large + ' 1 ' + o1.x + ' ' + o1.y + ' L ' + i1.x + ' ' + i1.y + ' A ' + rI + ' ' + rI + ' 0 ' + large + ' 0 ' + i0.x + ' ' + i0.y + ' Z';
          }
          let angle = 0;
          const paths = list.map((s) => {
            const span = (Math.max(0, Number(s.value) || 0) / total) * 360;
            const start = angle; const end = angle + Math.max(span, 0.4); angle = end;
            return '<path d="' + ring(start, end) + '" fill="' + (s.color || LP_GREEN) + '" fill-opacity="0.85" stroke="rgba(0,0,0,0.55)" stroke-width="1"></path>';
          }).join('');
          const legend = list.slice(0, 6).map((s) =>
            '<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:2px"><span style="width:8px;height:8px;background:' + (s.color || LP_GREEN) + '"></span><span style="flex:1">' + (s.label || '') + '</span><span class="muted">' + (s.pct ?? 0) + '%</span></div>'
          ).join('');
          const centerMain = centerLabel != null ? centerLabel : fmt(totalUsd ?? total);
          const ringStroke = titleColor || 'rgba(255,255,255,0.12)';
          const mainFill = titleColor || '#f0f0f0';
          return '<div class="pie-wrap"><div style="' + titleStyle + '">' + title + '</div><div style="display:flex;justify-content:center;margin-bottom:8px"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + (rO + 2) + '" fill="none" stroke="' + ringStroke + '" stroke-width="1" stroke-opacity="0.55"/>' + paths + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (rI - 1) + '" fill="#000" stroke="rgba(255,255,255,0.12)" stroke-width="1"/><text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" fill="' + mainFill + '" style="font-size:12px;font-weight:600">' + centerMain + '</text>' + (centerSub ? '<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" fill="#888" style="font-size:9px">' + centerSub + '</text>' : '') + '</svg></div><div>' + legend + '</div></div>';
        }
        function sortByUsdClient(rows) {
          return (rows || []).slice().sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0));
        }
        function laneOfClient(r) {
          if (r.lane) return r.lane;
          if (r.mode === 'off') return 'off';
          if (r.mode === 'hold' || r.holdExisting) return 'hold';
          return 'bot';
        }
        function bookLanesClient(book) {
          const bot = (book.bot || []).map((r) => Object.assign({}, r, { lane: 'bot' }));
          const hidden = book.hidden || [];
          const hold = hidden.filter((r) => laneOfClient(r) === 'hold').map((r) => Object.assign({}, r, { lane: 'hold' }));
          const overflow = hidden.filter((r) => laneOfClient(r) === 'overflow').map((r) => Object.assign({}, r, { lane: 'overflow' }));
          const off = hidden.filter((r) => laneOfClient(r) === 'off').map((r) => Object.assign({}, r, { lane: 'off' }));
          return { bot, hold, overflow, off, all: bot.concat(hold, overflow, off) };
        }
        function sheetCardsClient(rows) {
          const list = sortByUsdClient(rows);
          if (!list.length) return '<div class="pool-ranks" id="lp-sheet-body"><div class="muted" style="font-size:11px;padding:8px">No pools</div></div>';
          return '<div class="pool-ranks" id="lp-sheet-body">' + list.map((r, i) => {
            const q = encodeURIComponent(r.pool || r.ticker);
            const under = r.gapPct != null && r.gapPct > 0.5;
            const over = r.gapPct != null && r.gapPct < -0.5;
            const gapStr = r.gapPct == null ? 'no goal' : under ? ('need +' + r.gapPct + '%') : over ? ('over ' + r.gapPct + '%') : 'on goal';
            const lane = laneOfClient(r);
            return '<div class="pool-rank-row ' + (under ? 'need' : over ? 'ok' : '') + '" data-tick="' + String(r.ticker || '').toLowerCase() + '" data-lane="' + lane + '">'
              + '<div class="pr-rank">' + (i + 1) + '</div>'
              + '<div class="pr-main"><div class="pr-top"><strong class="pr-tick">' + (r.ticker || '') + '</strong>'
              + '<span class="pr-usd">' + fmtMoneyClient(r.valueUsd) + '</span>'
              + '<span class="pr-gap ' + (under ? 'bad' : over ? 'ok' : 'muted') + '">' + gapStr + '</span></div>'
              + '<div class="pr-meta muted">you ' + fmtPctClient(r.youPct) + ' · goal ' + fmtPctClient(r.goalPct) + ' · ctrl ' + fmtPctClient(r.ctrlPct) + ' · fees ' + fmtMoneyClient(r.unclaimedUsd) + '</div></div>'
              + '<div class="pr-acts"><a href="/pool?pool=' + q + '&action=claim">Claim</a><a href="/pool?pool=' + q + '&action=withdraw">Take %</a><a class="pr-close" href="/pool?pool=' + q + '&action=close">Close</a><a href="/pool?pool=' + q + '">→</a></div></div>';
          }).join('') + '</div>';
        }
        let lpSheetBook = null;
        function renderLpSheetTable() {
          if (!lpSheetBook) return;
          const limit = Math.max(10, lpSheetBook.activeLimit || 10);
          const lanes = bookLanesClient(lpSheetBook);
          const rows = lanes.bot || [];
          const wrap = document.querySelector('#lp-sheet > div:last-child');
          if (wrap) wrap.innerHTML = sheetCardsClient(rows);
          const count = document.getElementById('lp-sheet-count');
          if (count) count.textContent = rows.length + '/' + limit;
          applyLpSheetFilter();
        }
        function applyLpSheetFilter() {
          const inp = document.getElementById('lp-sheet-filter');
          const body = document.getElementById('lp-sheet-body');
          if (!body) return;
          const q = ((inp && inp.value) || '').toLowerCase().trim();
          let shown = 0;
          body.querySelectorAll('.pool-rank-row').forEach((row) => {
            const tick = row.getAttribute('data-tick') || '';
            const ok = !q || tick.includes(q);
            row.style.display = ok ? '' : 'none';
            if (ok) shown++;
          });
          const count = document.getElementById('lp-sheet-count');
          const limit = Math.max(10, (lpSheetBook && lpSheetBook.activeLimit) || 10);
          if (count) count.textContent = shown + '/' + limit;
        }
        function bindLpSheet() {
          const inp = document.getElementById('lp-sheet-filter');
          if (inp && !inp._lpBound) {
            inp._lpBound = true;
            inp.addEventListener('input', applyLpSheetFilter);
          }
        }
        function applyLpBook(book) {
          if (!book) return;
          const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
          const limit = Math.max(10, book.activeLimit || 10);
          lpSheetBook = book;
          set('lp-total', fmtMoneyClient(book.totalUsd));
          set('lp-ctrl-total', fmtMoneyClient(book.ctrl && book.ctrl.totalUsd));
          set('lp-unclaimed', fmtMoneyClient(book.unclaimedUsd));
          set('lp-earned', fmtMoneyClient(book.feesEarnedUsd));
          set('lp-botn', String((book.bot || []).length) + '/' + String(limit));
          if (book.ctrlWallet) {
            const w = document.getElementById('lp-ctrl-w');
            if (w) w.textContent = String(book.ctrlWallet).slice(0, 4) + '…';
          }
          const spread = document.getElementById('lp-spread');
          if (spread) {
            const g = book.goal || {};
            const poolsGreen = g.accent || LP_GREEN;
            spread.innerHTML = '<p class="muted" style="margin:0 0 10px;font-size:9px;letter-spacing:0.08em;text-transform:uppercase">$HERD Controller · Creator · This node · Holder Pools · targets</p>'
              + '<div class="pie-trio" style="align-items:start">'
              + pieClient(book.ctrl && book.ctrl.slices, book.ctrl && book.ctrl.totalUsd, '$HERD Controller · Creator')
              + pieClient(book.you && book.you.slices, book.you && book.you.totalUsd, 'This node')
              + pieClient(g.slices, null, g.title || 'Holder Pools · targets', { titleColor: poolsGreen, centerLabel: g.centerLabel || 'targets', centerSub: 'calc' })
              + '</div><p class="muted" style="margin:10px 0 0;font-size:10px;line-height:1.4"><span style="color:' + poolsGreen + ';font-weight:600">Green agent</span> = Start on Run · chases <span style="color:' + poolsGreen + ';font-weight:600">Holder Pools · targets</span> (calc: targetWeightPct, else controller when follow-controller is on).</p>';
          }
          if (document.getElementById('lp-sheet')) {
            bindLpSheet();
            renderLpSheetTable();
          }
        }
        function initLpSheet() {
          bindLpSheet();
          const syncBtn = document.getElementById('btn-sync-ctrl');
          if (syncBtn && !syncBtn._lpBound) {
            syncBtn._lpBound = true;
            syncBtn.addEventListener('click', async () => {
              syncBtn.disabled = true;
              syncBtn.textContent = 'Syncing…';
              try {
                const j = await (await fetch('/api/fund/sync-controller', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: '{}',
                })).json();
                syncBtn.textContent = j.ok ? 'Synced' : (j.error || 'Fail');
                await refreshLpBook();
              } catch (e) {
                syncBtn.textContent = String(e.message || e);
              } finally {
                setTimeout(() => { syncBtn.disabled = false; syncBtn.textContent = 'Sync ctrl weights'; }, 1500);
              }
            });
          }
        }
        async function refreshLpBook() {
          try {
            const j = await (await fetch('/api/portfolio-pies', { cache: 'no-store' })).json();
            applyLpBook(j.book || j);
          } catch (_) {}
        }
        initLpSheet();
`;
}
