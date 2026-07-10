import { layout, esc } from './layout.js';
import { lpPortfolioHtml, lpPortfolioClientJs } from './lp-board.js';

function nextHeadline(next) {
  if (!next) return 'No next step — fund LP or check Config';
  if (next.type === 'topup_sol') {
    const a = next.ansem != null ? ` (~${Number(next.ansem).toFixed(2)} ANSEM)` : '';
    return `Top up SOL${a}`;
  }
  if (next.type === 'buy_ansem') {
    const sol = next.sol != null ? ` (~${Number(next.sol).toFixed(3)} SOL)` : '';
    return `Buy ANSEM${sol}`;
  }
  if (next.type === 'buy_token') return `Buy ${next.ticker || 'TOKEN'} (pair side)`;
  if (next.type === 'deposit') {
    const you = next.youAnsem != null ? Number(next.youAnsem).toFixed(2) : null;
    const ctrl = next.controllerAnsem != null ? Number(next.controllerAnsem).toFixed(2) : null;
    const need = next.ansem != null ? Number(next.ansem).toFixed(2) : null;
    if (you != null && ctrl != null && need != null) {
      return `Cover ${next.ticker || 'pool'} · you ${you} / ctrl ${ctrl} · add ${need} ANSEM`;
    }
    return `Cover ${next.ticker || 'pool'}${need != null ? ` · add ${need} ANSEM` : ''}`;
  }
  if (next.type === 'stop') return next.title || 'Stop';
  return next.title || next.ticker || next.type || 'Next step';
}

function coverageBoardHtml(cov, pol = {}, pies = null) {
  const need = (cov?.needMin || []).join(', ') || '—';
  const have = (cov?.atMin || []).join(', ') || '—';
  const cls = !cov ? 'muted' : cov.complete ? 'ok' : cov.blocked ? 'bad' : 'muted';
  const pairRule =
    cov?.pairMinRule ||
    `≥${pol.pairMinAnsem ?? 5} ANSEM · ≥$${pol.pairMinUsd ?? 1}`;
  const board = Array.isArray(cov?.board) ? cov.board : [];
  const limit = Math.max(10, Number(pol.nodeActiveLimit) || Number(cov?.total) || 10);
  const lineRaw = cov?.line || `Coverage —`;
  const lineClean = String(lineRaw).replace(/^MODE\s+\w+\s*·\s*/i, '');

  return `
    <div id="coverage-board" style="margin:0 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:0;background:#000">
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <span class="muted" style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase">Pools</span>
        <a class="btn secondary" href="/config" style="padding:4px 8px;font-size:10px">Config</a>
      </div>
      <div class="row" style="justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600" class="${cls}" id="coverage-line">${esc(lineClean)}</span>
        <span class="muted" style="font-size:10px" id="coverage-pct">${esc(String(cov?.pct ?? 0))}%</span>
      </div>
      <p class="muted" style="margin:0 0 4px;font-size:10px;line-height:1.45" id="coverage-goal">${esc(
        cov?.goal || 'Min in controller top-N',
      )}</p>
      <p class="muted" style="margin:0 0 6px;font-size:10px;line-height:1.45" id="pair-min-line">Pair min ${esc(pairRule)} · <span id="bubble-count-line">${esc(String(board.length || limit))} · active ${esc(String(limit))} — raise on <a href="/config">Config</a></span></p>
      <p style="margin:0 0 2px;font-size:10px;line-height:1.45"><span class="ok">Have</span> <span id="coverage-have">${esc(have)}</span></p>
      <p style="margin:0 0 8px;font-size:10px;line-height:1.45"><span class="bad">Need</span> <span id="coverage-need">${esc(need)}</span></p>
      <p class="muted" style="margin:0 0 8px;font-size:9px;line-height:1.4" id="score-legend">${esc(
        cov?.scoreLegend ||
          'Cover mins on the bot set, then deepen toward Holder Pools targets (green).',
      )}</p>
      <p style="margin:8px 0 2px;font-size:11px;line-height:1.45;font-weight:500" id="coverage-hint">${esc(cov?.operatorHint || '')}</p>
    </div>`;
}

/**
 * /run — Start / Shut down · terminal + tx log · LP portfolio · CSV at bottom.
 */
export function renderRun({
  wallet,
  balances,
  nextAction,
  ranking,
  coverage,
  policy,
  dryRun,
  lastTick,
  ticking,
  seeding,
  error,
  setup,
  seedKeys,
  loading = false,
  pies = null,
  minClaimUsd = 1,
}) {
  const sol = balances?.sol ?? 0;
  const deployable = balances?.deployableSol ?? 0;
  const ansem = balances?.ansem ?? 0;
  const next = nextAction || ranking?.next || null;
  const pol = policy || {};
  const cov = coverage || null;
  const headline = nextHeadline(next);
  const sk = seedKeys || {};
  const canLive = Boolean(sk.canLiveSeed);
  const keyOk = Boolean(sk.lpMatches && sk.hasLpKey);
  const liveReady = Boolean(setup?.liveReady);
  const claimMin = Math.max(0.01, Number(minClaimUsd) || 1);
  const claimNow = Number(
    pies?.book?.unclaimedUsd ??
      pies?.unclaimedUsd ??
      lastTick?.claimable_fees_usd ??
      lastTick?.plan?.claimable_fees_usd ??
      0,
  );
  const claimPct = Math.min(100, Math.round((Math.max(0, claimNow) / claimMin) * 100));
  const claimReady = claimNow >= claimMin;
  const opMode = String(pol.operatorMode || 'cover').toLowerCase();

  return layout({
    title: 'Run',
    active: '/run',
    body: `
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <h1 style="margin:0">Run</h1>
        <div class="row">
          <span class="pill ${dryRun ? 'dry' : ''}">${dryRun ? 'DRY' : 'LIVE'}</span>
          <span class="pill ${keyOk ? 'ok' : ''}" id="key-pill">${keyOk ? 'KEY OK' : 'KEY MISMATCH'}</span>
          <span class="pill ${seeding || ticking ? 'running' : ''}" id="run-status">${seeding || ticking ? 'RUNNING' : 'IDLE'}</span>
        </div>
      </div>

      <div id="bot-alive" class="bot-alive ${seeding || ticking ? 'on' : ''}" aria-live="polite">
        <div class="bot-spinner" aria-hidden="true"></div>
        <div style="flex:1;min-width:0">
          <div class="row" style="justify-content:space-between;gap:8px">
            <span class="ok" style="font-size:12px;font-weight:600" id="bot-alive-label">${seeding || ticking ? 'RUNNING' : 'IDLE'}</span>
            <span class="bot-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          </div>
          <p class="muted" style="margin:2px 0 0;font-size:10px" id="bot-alive-detail">${seeding || ticking ? 'Start keeps the node running until Shut down — watch the terminal' : 'Press Start — runs until Shut down'}</p>
        </div>
      </div>

      <div id="claim-bar" class="claim-bar ${claimReady ? 'ready' : ''}" aria-live="polite">
        <div class="claim-bar-head">
          <span class="claim-bar-label">Fees → claim</span>
          <span class="claim-bar-amt" id="claim-bar-amt">$${esc(claimNow.toFixed(2))} / $${esc(claimMin.toFixed(2))}</span>
        </div>
        <div class="claim-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${claimPct}" id="claim-bar-track">
          <div class="claim-bar-fill" id="claim-bar-fill" style="width:${claimPct}%"></div>
        </div>
        <p class="claim-bar-foot" id="claim-bar-foot">${
          claimReady
            ? 'Ready to claim — next fee tick / seed pass will pick this up'
            : `Waiting for $${esc(claimMin.toFixed(2))} claimable · ${esc(String(claimPct))}%`
        }</p>
      </div>

      <div class="grid" style="margin-bottom:10px">
        <div class="metric"><div class="k">SOL</div><div class="v" id="m-sol">${esc(Number(sol).toFixed(3))}</div><div class="s">wallet</div></div>
        <div class="metric"><div class="k">Deploy</div><div class="v" id="m-dep">${esc(Number(deployable).toFixed(3))}</div><div class="s">− reserve</div></div>
        <div class="metric"><div class="k">ANSEM</div><div class="v" id="m-ansem">${esc(Number(ansem).toFixed(2))}</div><div class="s">bag</div></div>
        <div class="metric"><div class="k">Cover</div><div class="v" style="font-size:13px" id="m-cover">${esc(cov ? `${cov.done}/${cov.total}` : '—')}</div><div class="s" id="m-cover-s">${esc(cov?.complete ? 'done' : 'mins')}</div></div>
      </div>

      ${error ? `<p class="bad">${esc(error)}</p>` : ''}
      ${loading ? `<p class="muted" id="load-banner" style="margin:0 0 10px;font-size:10px">Loading mission from chain…</p>` : '<p class="muted" id="load-banner" style="display:none;margin:0 0 10px;font-size:10px"></p>'}

      <div class="card" id="control" style="border-color:var(--text)">
        <p class="muted" style="margin:0 0 4px;font-size:9px;letter-spacing:0.08em;text-transform:uppercase">Control</p>
        <p style="margin:0 0 8px;font-size:13px;font-weight:600" id="next-title">${esc(headline)}</p>
        <p class="muted" style="margin:0 0 12px;font-size:10px;line-height:1.45" id="next-detail">
          ${esc(next?.detail || 'Start resets the tx log, then runs continuous seed + fee bot until Shut down. Green agent deepens toward Holder Pools targets.')}
        </p>
        <div class="row" style="gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <label class="muted" style="font-size:10px;margin:0" for="op-mode">MODE</label>
          <select id="op-mode" style="max-width:9em;margin:0;font-size:12px">
            <option value="cover" ${opMode === 'cover' ? 'selected' : ''}>cover</option>
            <option value="mirror" ${opMode === 'mirror' ? 'selected' : ''}>mirror</option>
            <option value="ape" ${opMode === 'ape' ? 'selected' : ''}>ape</option>
            <option value="hold" ${opMode === 'hold' ? 'selected' : ''}>hold</option>
          </select>
          <span class="muted" style="font-size:9px" id="mode-hint">cover = mins · mirror = deepen gaps · ape = fresh · hold = idle</span>
        </div>
        <div class="row" style="gap:8px;align-items:center">
          <button type="button" class="btn" id="btn-run" style="font-size:15px;padding:12px 22px">Start</button>
          <button type="button" class="secondary" id="btn-stop">Shut down</button>
          <button type="button" class="secondary" id="btn-once">One step</button>
        </div>
        <p class="muted" style="margin:10px 0 0;font-size:10px" id="policy-line">
          ${esc(pol.seedUniverse || 'tracked_top10')} · ${esc(pol.seedSort || 'dip24')} · HODL add-only · pair ≥ ${esc(pol.effectivePairMinAnsem ?? pol.pairMinAnsem ?? 5)} ANSEM · top ${esc(Math.max(10, pol.nodeActiveLimit ?? 10))}
        </p>
        <p class="muted" style="margin:6px 0 0;font-size:10px;line-height:1.45" id="blockers-line">Loading gates…</p>
        <p class="muted" style="margin:6px 0 0;font-size:10px;line-height:1.45" id="dust-line"></p>
        <p class="muted" style="margin:6px 0 0;font-size:10px;line-height:1.45" id="pnl-line"></p>
        <p class="muted" style="margin:6px 0 0;font-size:10px;line-height:1.45" id="key-line">
          ${keyOk
            ? (dryRun
              ? 'Key matches LP — currently DRY (logs only). Set DRY_RUN=false SIMULATION_MODE=false to spend.'
              : 'Key matches LP · LIVE seed will sign swaps/deposits.')
            : esc(sk.errors?.[0] || sk.hint || 'Put matching LP_PRIVATE_KEY in .env (never paste in chat).')}
        </p>
        <p class="muted" style="margin:4px 0 0;font-size:9px;word-break:break-all">LP <code id="run-wallet">${esc(wallet || '—')}</code></p>
        <p class="toast" id="run-toast" style="margin-top:8px"></p>
      </div>

      <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
        <div class="row" style="justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border)">
          <span class="muted" style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase">Terminal · transaction log</span>
          <span class="muted" style="font-size:10px" id="term-meta">idle — press Start</span>
        </div>
        <div id="tx-feed" class="tx-feed" aria-live="polite">
          <div class="tx-empty">No activity yet — Start resets the SQLite log and begins tracking claims, liquidity ±, and routes.</div>
        </div>
      </div>

      ${lpPortfolioHtml(pies?.book || pies, pol)}
      ${coverageBoardHtml(cov, pol, pies)}

      <details class="card" id="fee-bot">
        <summary>Fee bot (keeper) — claim → buy ANSEM → send</summary>
        <p class="muted" style="margin:10px 0 8px;font-size:10px">Folded into Start when unlocked. Needs DASHBOARD_PASSWORD session + matching keys.</p>
        <div class="row" style="gap:8px;align-items:center;margin-bottom:8px">
          <input id="token" type="password" placeholder="DASHBOARD_PASSWORD" autocomplete="off" style="max-width:140px;margin:0" />
          <button type="button" class="secondary" id="btn-keeper-start" ${liveReady ? '' : 'disabled'}>Start fee bot</button>
          <button type="button" class="secondary" id="btn-keeper-pause">Pause</button>
          <button type="button" class="secondary" id="btn-tick">Tick once</button>
        </div>
        <pre id="last-tick">${esc(JSON.stringify(lastTick || { note: 'no keeper tick yet' }, null, 2))}</pre>
        <div class="toast" id="keeper-toast"></div>
      </details>

      <div class="card" id="tx-csv" style="margin-top:12px">
        <p class="muted" style="margin:0 0 8px;font-size:9px;letter-spacing:0.08em;text-transform:uppercase">Download</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <a class="btn" href="/api/tx/export?format=csv">Download CSV</a>
          <a class="btn secondary" href="/api/tx/export?format=jsonl">JSONL</a>
          <span class="muted" style="font-size:10px">SQLite <code>logs/tx.sqlite</code> · Start clears the log</span>
        </div>
      </div>

      <script>
        const feed = document.getElementById('tx-feed');
        const status = document.getElementById('run-status');
        const termMeta = document.getElementById('term-meta');
        let paused = false;
        let sessionActive = false;
        let sessionStartedAt = 0;
        let eventsTimer = null;
        let lastIds = new Set();
        let currentNext = ${JSON.stringify(next || null)};
        let botRunning = ${seeding || ticking ? 'true' : 'false'};
        let feeBotRunning = ${ticking ? 'true' : 'false'};
        let claimMinUsd = ${JSON.stringify(claimMin)};

        ${lpPortfolioClientJs()}

        const rtoast = (m) => { document.getElementById('run-toast').textContent = m || ''; };
        const ktoast = (m) => { document.getElementById('keeper-toast').textContent = typeof m === 'string' ? m : JSON.stringify(m, null, 2); };

        function applyClaimBar(nowUsd, minUsd) {
          const min = Math.max(0.01, Number(minUsd != null ? minUsd : claimMinUsd) || 1);
          if (minUsd != null && Number.isFinite(Number(minUsd))) claimMinUsd = min;
          const now = Math.max(0, Number(nowUsd) || 0);
          const pct = Math.min(100, Math.round((now / min) * 100));
          const ready = now + 1e-9 >= min;
          const bar = document.getElementById('claim-bar');
          const amt = document.getElementById('claim-bar-amt');
          const fill = document.getElementById('claim-bar-fill');
          const track = document.getElementById('claim-bar-track');
          const foot = document.getElementById('claim-bar-foot');
          if (bar) bar.classList.toggle('ready', ready);
          if (amt) amt.textContent = '$' + now.toFixed(2) + ' / $' + min.toFixed(2);
          if (fill) fill.style.width = pct + '%';
          if (track) track.setAttribute('aria-valuenow', String(pct));
          if (foot) {
            foot.textContent = ready
              ? 'Ready to claim — next fee tick / seed pass will pick this up'
              : ('Waiting for $' + min.toFixed(2) + ' claimable · ' + pct + '%');
          }
        }

        function setBotRunning(on, kind) {
          botRunning = Boolean(on);
          const strip = document.getElementById('bot-alive');
          const label = document.getElementById('bot-alive-label');
          const detail = document.getElementById('bot-alive-detail');
          if (strip) strip.classList.toggle('on', botRunning || feeBotRunning);
          if (status) {
            if (botRunning) {
              status.textContent = 'RUNNING';
              status.className = 'pill running';
            } else if (feeBotRunning) {
              status.textContent = 'RUNNING';
              status.className = 'pill running';
            } else {
              status.textContent = 'IDLE';
              status.className = 'pill';
            }
          }
          if (label) {
            label.textContent = (botRunning || feeBotRunning) ? 'RUNNING' : 'IDLE';
          }
          if (detail) {
            detail.textContent = botRunning
              ? (kind || 'seed + fee bot — watch terminal')
              : feeBotRunning
                ? 'fee bot ticking — watch terminal'
                : 'Press Start — runs until Shut down';
          }
          const btn = document.getElementById('btn-run');
          const stopBtn = document.getElementById('btn-stop');
          if (btn) {
            btn.textContent = botRunning ? '● Running…' : 'Start';
            btn.disabled = botRunning;
          }
          if (stopBtn) {
            stopBtn.disabled = !(botRunning || feeBotRunning);
          }
        }

        function money(n) {
          const v = Number(n);
          if (!Number.isFinite(v)) return '';
          const abs = Math.abs(v);
          const s = abs >= 100 ? abs.toFixed(0) : abs >= 1 ? abs.toFixed(2) : abs.toFixed(3);
          return (v < 0 ? '-' : '') + '$' + s;
        }

        function chipFor(tx) {
          if (tx.kind === 'deposit' || tx.delta > 0) return { cls: 'plus', mark: '+' };
          if (tx.kind === 'withdraw' || tx.delta < 0) return { cls: 'minus', mark: '−' };
          if (tx.kind === 'claim' && (tx.status === 'ok' || tx.status === 'dry_run')) return { cls: 'plus', mark: '+' };
          return { cls: 'dot', mark: '·' };
        }

        function usdClass(tx) {
          if (tx.delta > 0 || (tx.kind === 'claim' && tx.status === 'ok')) return 'pos';
          if (tx.delta < 0 || tx.kind === 'withdraw') return 'neg';
          return 'muted';
        }

        function renderTxRow(tx) {
          const t = (tx.ts || '').slice(11, 19) || '--:--:--';
          if (tx.kind === 'session_start' || tx.kind === 'session_end') {
            const label = tx.kind === 'session_start' ? 'Start' : 'End';
            return '<div class="tx-row session" data-id="' + String(tx.id || '') + '">' +
              '<span>' + t + '</span>' +
              '<span>' + label + (tx.did ? ' · ' + String(tx.did).slice(0, 80) : '') + '</span>' +
              '</div>';
          }
          const chip = chipFor(tx);
          const kind = String(tx.kind || 'skip');
          const ticker = tx.ticker ? (' · ' + tx.ticker) : '';
          let did = tx.did || '';
          if (tx.kind === 'skip' && tx.min_usd != null && tx.usd != null) {
            did = did || ('waiting · ' + money(tx.usd) + ' < $' + Number(tx.min_usd));
          }
          const usd = tx.usd != null
            ? ((tx.delta > 0 || (tx.kind === 'claim' && tx.status === 'ok') ? '+' : tx.delta < 0 ? '−' : '') + money(Math.abs(Number(tx.usd))))
            : '—';
          const sig = tx.sig
            ? '<a href="https://solscan.io/tx/' + encodeURIComponent(tx.sig) + '" target="_blank" rel="noreferrer">tx</a>'
            : '<span class="muted">—</span>';
          return '<div class="tx-row" data-id="' + String(tx.id || '') + '">' +
            '<span class="muted">' + t + '</span>' +
            '<span class="tx-chip ' + chip.cls + '">' + chip.mark + '</span>' +
            '<span class="tx-kind">' + kind + ticker + '</span>' +
            '<span class="tx-did" title="' + String(did).replace(/"/g, '&quot;') + '">' + String(did).slice(0, 120) + '</span>' +
            '<span class="tx-usd ' + usdClass(tx) + '">' + usd + '</span>' +
            '<span class="tx-sig">' + sig + '</span>' +
            '</div>';
        }

        function clearFeed() {
          if (!feed) return;
          feed.innerHTML = '<div class="tx-empty">Listening for activity…</div>';
        }

        function appendTxs(txs) {
          if (!feed) return;
          const list = txs || [];
          let added = 0;
          for (const tx of list) {
            const id = tx.id != null ? String(tx.id) : (tx.ts + tx.kind + tx.did + (tx.sig || ''));
            if (lastIds.has(id)) continue;
            if (sessionStartedAt && tx.ts) {
              const ts = Date.parse(tx.ts);
              if (Number.isFinite(ts) && ts < sessionStartedAt - 2000) continue;
            }
            lastIds.add(id);
            const empty = feed.querySelector('.tx-empty');
            if (empty) empty.remove();
            feed.insertAdjacentHTML('beforeend', renderTxRow(tx));
            added += 1;
            // Live claim progress from skip / claim rows
            if (
              tx.min_usd != null &&
              tx.usd != null &&
              (tx.kind === 'skip' || tx.kind === 'claim' || /claim|fees under/i.test(String(tx.did || '')))
            ) {
              applyClaimBar(tx.usd, tx.min_usd);
            }
          }
          if (!paused && added) feed.scrollTop = feed.scrollHeight;
          while (feed.children.length > 200) feed.removeChild(feed.firstChild);
        }

        async function loadTxFeed() {
          try {
            const j = await (await fetch('/api/tx?limit=80', { cache: 'no-store' })).json();
            appendTxs(j.txs || []);
            termMeta.textContent = 'activity · ' + new Date().toLocaleTimeString();
          } catch (e) {
            termMeta.textContent = String(e.message || e);
          }
        }

        function startPoll() {
          if (eventsTimer) return;
          eventsTimer = setInterval(() => {
            loadTxFeed();
            refreshSnapshot();
          }, 2500);
        }

        function stopPoll() {
          if (eventsTimer) {
            clearInterval(eventsTimer);
            eventsTimer = null;
          }
        }

        function nextHeadlineJs(n) {
          if (!n) return 'No next step';
          if (n.type === 'topup_sol') {
            const a = n.ansem != null ? (' (~' + Number(n.ansem).toFixed(2) + ' ANSEM)') : '';
            return 'Top up SOL' + a;
          }
          if (n.type === 'buy_ansem') {
            const sol = n.sol != null ? (' (~' + Number(n.sol).toFixed(3) + ' SOL)') : '';
            return 'Buy ANSEM' + sol;
          }
          if (n.type === 'buy_token') return 'Buy ' + (n.ticker || 'TOKEN') + ' (pair side)';
          if (n.type === 'deposit') {
            const you = n.youAnsem != null ? Number(n.youAnsem).toFixed(2) : null;
            const ctrl = n.controllerAnsem != null ? Number(n.controllerAnsem).toFixed(2) : null;
            const need = n.ansem != null ? Number(n.ansem).toFixed(2) : null;
            if (you != null && ctrl != null && need != null) {
              return 'Cover ' + (n.ticker || 'pool') + ' · you ' + you + ' / ctrl ' + ctrl + ' · add ' + need + ' ANSEM';
            }
            return 'Cover ' + (n.ticker || 'pool') + (need != null ? (' · add ' + need + ' ANSEM') : '');
          }
          if (n.type === 'stop') return n.title || 'Stop';
          return n.title || n.ticker || n.type || 'Next';
        }

        function applyNextUi(n) {
          currentNext = n || null;
          const h = nextHeadlineJs(n);
          const title = document.getElementById('next-title');
          const detail = document.getElementById('next-detail');
          if (title) title.textContent = h;
          if (detail) {
            detail.textContent =
              n?.detail || 'Start runs the seed plan. Shut down stops everything.';
          }
        }

        function applyPiesUi(pies) {
          if (!pies) return;
          if (pies.book) applyLpBook(pies.book);
          else applyLpBook(pies);
        }

        function applyCoverageUi(cov) {
          if (!cov) return;
          const line = document.getElementById('coverage-line');
          const pct = document.getElementById('coverage-pct');
          const goal = document.getElementById('coverage-goal');
          const have = document.getElementById('coverage-have');
          const need = document.getElementById('coverage-need');
          const hint = document.getElementById('coverage-hint');
          const legend = document.getElementById('score-legend');
          const mCover = document.getElementById('m-cover');
          const mCoverS = document.getElementById('m-cover-s');
          if (line) {
            line.textContent = String(cov.line || ('Coverage ' + (cov.done || 0) + '/' + (cov.total || 10))).replace(/^MODE\s+\w+\s*·\s*/i, '');
            line.className = cov.complete ? 'ok' : cov.blocked ? 'bad' : '';
            line.style.fontSize = '12px';
            line.style.fontWeight = '600';
          }
          if (pct) pct.textContent = String(cov.pct ?? 0) + '%';
          if (goal) goal.textContent = cov.goal || '';
          if (have) have.textContent = (cov.atMin || []).join(', ') || '—';
          if (need) need.textContent = (cov.needMin || []).join(', ') || '—';
          if (hint) hint.textContent = cov.operatorHint || '';
          if (legend && cov.scoreLegend) legend.textContent = cov.scoreLegend;
          const stairEl = document.getElementById('stair-text');
          if (stairEl) {
            if (cov.focusTicker) {
              stairEl.textContent = ' · Focus ' + cov.focusTicker + ' · HODL · add-only';
            } else if (cov.stair === 'waiting_claim') {
              stairEl.textContent = ' · Open · waiting for claimable fees';
            } else if (cov.stair === 'hodl_add' || cov.stair === 'covered') {
              stairEl.textContent = ' · HODL · ranking picks next add';
            } else if (cov.stair) {
              stairEl.textContent = ' · ' + String(cov.stair).replace(/_/g, ' ');
            }
          }
          if (mCover) mCover.textContent = (cov.done ?? '—') + '/' + (cov.total ?? '—');
          if (mCoverS) mCoverS.textContent = cov.complete ? 'done' : 'mins';
        }

        async function refreshGates() {
          try {
            // Light gates by default — full=1 hits RPC/census and can stall under 429.
            const g = await (await fetch('/api/gates_status', { cache: 'no-store' })).json();
            const bl = document.getElementById('blockers-line');
            const dust = document.getElementById('dust-line');
            if (bl) {
              const blockers = g.blockers || [];
              bl.textContent = blockers.length
                ? 'Blockers: ' + blockers.map((b) => (b.code || '') + ' ' + (b.reason || '')).join(' · ')
                : 'Gates: clear · policy ' + (g.policy?.version || '');
              bl.className = blockers.length ? 'bad' : 'muted';
              bl.style.fontSize = '10px';
              bl.style.lineHeight = '1.45';
              bl.style.margin = '6px 0 0';
            }
            if (dust && g.census) {
              const d = (g.census.indexDust || [])
                .map((h) => h.ticker + ':' + Number(h.ui || 0).toFixed(1))
                .join(', ');
              dust.textContent = d
                ? 'Index dust → LP: ' + d + ' · positions ' + (g.census.positions || 0)
                : 'Index dust: none · positions ' + (g.census.positions || 0);
            } else if (dust) {
              dust.textContent = '';
            }
            const pnl = document.getElementById('pnl-line');
            if (pnl && g.sessionPnl && g.sessionPnl.code === 'SESSION_OK') {
              const pct = g.sessionPnl.pct != null
                ? ' (' + (g.sessionPnl.pct * 100).toFixed(1) + '%)'
                : '';
              pnl.textContent = 'Session PnL: $' + Number(g.sessionPnl.pnl || 0).toFixed(2) + pct
                + ' · mark $' + Number(g.sessionPnl.current || 0).toFixed(2);
            } else if (pnl) {
              pnl.textContent = 'Session PnL: baseline after first W1 mark';
            }
            if (g.coverage) applyCoverageUi(g.coverage);
          } catch (_) {}
        }

        async function refreshSnapshot() {
          try {
            const j = await (await fetch('/api/run', { cache: 'no-store' })).json();
            const banner = document.getElementById('load-banner');
            if (banner) {
              if (j.error) {
                banner.style.display = '';
                banner.textContent = j.error + (j.hint ? ' — ' + j.hint : '');
                banner.className = 'bad';
                banner.style.fontSize = '10px';
                banner.style.margin = '0 0 10px';
              } else if (j.loading) {
                banner.style.display = '';
                banner.textContent = 'Loading mission…';
                banner.className = 'muted';
              } else {
                banner.style.display = 'none';
              }
            }
            if (j.balances) {
              document.getElementById('m-sol').textContent = Number(j.balances.sol || 0).toFixed(3);
              document.getElementById('m-dep').textContent = Number(j.balances.deployableSol || 0).toFixed(3);
              document.getElementById('m-ansem').textContent = Number(j.balances.ansem || 0).toFixed(2);
              const wpSol = document.getElementById('wp-sol');
              const wpAnsem = document.getElementById('wp-ansem');
              const wpDep = document.getElementById('wp-dep');
              if (wpSol) wpSol.textContent = Number(j.balances.sol || 0).toFixed(4);
              if (wpAnsem) wpAnsem.textContent = Number(j.balances.ansem || 0).toFixed(2);
              if (wpDep) wpDep.textContent = Number(j.balances.deployableSol || 0).toFixed(4);
            }
            applyNextUi(j.nextAction || j.ranking?.next);
            if (j.coverage) applyCoverageUi(j.coverage);
            if (j.pies) applyPiesUi(j.pies);
            const claimFromPies =
              j.pies?.book?.unclaimedUsd ??
              j.pies?.unclaimedUsd ??
              j.lastTick?.claimable_fees_usd ??
              j.lastTick?.plan?.claimable_fees_usd;
            if (claimFromPies != null) {
              applyClaimBar(claimFromPies, j.minClaimUsd != null ? j.minClaimUsd : claimMinUsd);
            } else if (j.minClaimUsd != null) {
              claimMinUsd = Math.max(0.01, Number(j.minClaimUsd) || 1);
            }
            if (j.balances) {
              const wpSol = document.getElementById('wp-sol');
              const wpAnsem = document.getElementById('wp-ansem');
              const wpDep = document.getElementById('wp-dep');
              if (wpSol) wpSol.textContent = Number(j.balances.sol || 0).toFixed(4);
              if (wpAnsem) wpAnsem.textContent = Number(j.balances.ansem || 0).toFixed(2);
              if (wpDep) wpDep.textContent = Number(j.balances.deployableSol || 0).toFixed(4);
            }
            if (j.wallet) document.getElementById('run-wallet').textContent = j.wallet;
            feeBotRunning = Boolean(j.ticking);
            if (j.seeding) {
              sessionActive = true;
              setBotRunning(true, 'seed pass active — watch terminal');
            } else if (sessionActive || botRunning) {
              sessionActive = false;
              setBotRunning(false);
            } else {
              setBotRunning(false);
            }
            if (j.seedKeys) {
              const sk = j.seedKeys;
              const pill = document.getElementById('key-pill');
              const ok = sk.lpMatches && sk.hasLpKey;
              pill.textContent = ok ? 'KEY OK' : 'KEY MISMATCH';
              pill.className = ok ? 'pill ok' : 'pill';
            }
            if (j.lastTick) {
              document.getElementById('last-tick').textContent = JSON.stringify(j.lastTick, null, 2);
            }
            await refreshGates();
            return j;
          } catch (_) {
            return null;
          }
        }

        const authHeaders = () => ({
          'Content-Type': 'application/json',
          'X-Controller-Token': (document.getElementById('token')?.value || '').trim(),
        });

        function scrollToControl() {
          if (location.hash !== '#control') return;
          const el = document.getElementById('control');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        document.getElementById('btn-run').onclick = async () => {
          const btn = document.getElementById('btn-run');
          btn.disabled = true;
          sessionActive = true;
          sessionStartedAt = Date.now();
          lastIds = new Set();
          clearFeed();
          setBotRunning(true, 'starting…');
          termMeta.textContent = 'resetting tx log…';
          rtoast('Starting…');
          startPoll();
          try {
            try {
              await fetch('/api/tx/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            } catch (_) {}
            lastIds = new Set();
            clearFeed();
            sessionStartedAt = Date.now();
            const j = await (await fetch('/api/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'seed', continuous: true }),
            })).json();
            if (j.ok) {
              setBotRunning(true, j.dry_run ? 'dry seed running' : 'live seed running');
              let feeNote = '';
              try {
                const k = await (await fetch('/api/run', {
                  method: 'POST',
                  headers: authHeaders(),
                  body: JSON.stringify({ action: 'start' }),
                })).json();
                if (k.ok) {
                  feeBotRunning = true;
                  setBotRunning(true, j.dry_run ? 'dry seed + fee bot' : 'live · fee bot on');
                } else {
                  feeNote = ' · fee bot: ' + (k.error || 'failed');
                  rtoast((j.dry_run ? 'Seed started (dry)' : 'Seed started') + feeNote);
                }
              } catch (fe) {
                feeNote = ' · fee bot: ' + String(fe.message || fe);
                rtoast((j.dry_run ? 'Seed started (dry)' : 'Seed started') + feeNote);
              }
              if (!feeNote) rtoast(j.dry_run ? 'Started (dry)' : 'Started');
            } else {
              status.textContent = 'blocked';
              status.className = 'pill bad';
              rtoast(j.error || 'blocked');
              sessionActive = false;
              setBotRunning(false);
              stopPoll();
            }
            await loadTxFeed();
            await refreshSnapshot();
          } catch (e) {
            status.textContent = 'error';
            status.className = 'pill bad';
            rtoast(String(e.message || e));
            sessionActive = false;
            setBotRunning(false);
            stopPoll();
          } finally {
            if (!botRunning) btn.disabled = false;
          }
        };

        document.getElementById('btn-once').onclick = async () => {
          sessionActive = true;
          if (!sessionStartedAt) sessionStartedAt = Date.now();
          startPoll();
          rtoast('One seed step…');
          try {
            const j = await (await fetch('/api/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'seed_once' }),
            })).json();
            if (j.blocked) {
              rtoast(j.error || 'blocked');
            } else {
              rtoast(j.ok ? 'step ok' : (j.error || j.result?.error || 'step'));
            }
            await loadTxFeed();
            await refreshSnapshot();
          } catch (e) {
            rtoast(String(e.message || e));
          }
        };

        document.getElementById('btn-stop').onclick = async () => {
          try {
            await fetch('/api/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'seed_stop' }),
            });
          } catch (_) {}
          try {
            await fetch('/api/run', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ action: 'pause' }),
            });
          } catch (_) {}
          feeBotRunning = false;
          sessionActive = false;
          setBotRunning(false);
          stopPoll();
          document.getElementById('btn-run').disabled = false;
          rtoast('Shut down');
          await refreshSnapshot();
        };

        const modeSel = document.getElementById('op-mode');
        if (modeSel) {
          modeSel.addEventListener('change', async () => {
            const mode = modeSel.value;
            rtoast('MODE ' + mode + '…');
            try {
              const j = await (await fetch('/api/operator-mode', {
                method: 'POST',
                headers: authHeaders(),
                credentials: 'same-origin',
                body: JSON.stringify({ operatorMode: mode }),
              })).json();
              if (j.ok) {
                rtoast('MODE ' + (j.operatorMode || mode));
                await refreshSnapshot();
              } else {
                rtoast(j.error || 'mode failed — unlock first?');
              }
            } catch (e) {
              rtoast(String(e.message || e));
            }
          });
        }

        document.getElementById('btn-keeper-start').onclick = async () => {
          ktoast('starting fee bot…');
          sessionActive = true;
          if (!sessionStartedAt) sessionStartedAt = Date.now();
          startPoll();
          try {
            const j = await (await fetch('/api/run', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ action: 'start' }),
            })).json();
            if (j.ok) {
              feeBotRunning = true;
              setBotRunning(botRunning, 'fee bot running');
              ktoast('fee bot running');
            } else {
              ktoast(j.error || 'fail');
            }
            if (j.preflight) document.getElementById('last-tick').textContent = JSON.stringify(j.preflight, null, 2);
            await loadTxFeed();
          } catch (e) {
            ktoast(String(e.message || e));
          }
        };

        document.getElementById('btn-keeper-pause').onclick = async () => {
          try {
            const j = await (await fetch('/api/run', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ action: 'pause' }),
            })).json();
            if (j.ok) {
              feeBotRunning = false;
              setBotRunning(botRunning);
              ktoast('paused');
            } else {
              ktoast(j.error || 'fail');
            }
            await loadTxFeed();
          } catch (e) {
            ktoast(String(e.message || e));
          }
        };

        document.getElementById('btn-tick').onclick = async () => {
          sessionActive = true;
          if (!sessionStartedAt) sessionStartedAt = Date.now();
          startPoll();
          try {
            const j = await (await fetch('/api/tick', {
              method: 'POST',
              headers: authHeaders(),
              body: '{}',
            })).json();
            document.getElementById('last-tick').textContent = JSON.stringify(j, null, 2);
            ktoast(j.ok === false ? (j.error || 'fail') : 'tick ok');
            await loadTxFeed();
          } catch (e) {
            ktoast(String(e.message || e));
          }
        };

        feed.addEventListener('mouseenter', () => { paused = true; });
        feed.addEventListener('mouseleave', () => { paused = false; });

        refreshLpBook();
        refreshSnapshot();
        loadTxFeed();
        scrollToControl();
        window.addEventListener('hashchange', scrollToControl);
        setTimeout(scrollToControl, 80);
        setInterval(() => { refreshSnapshot(); }, 30000);
        setInterval(() => { refreshLpBook(); }, 45000);
        setInterval(() => { loadTxFeed(); }, 8000);
      </script>
    `,
  });
}
