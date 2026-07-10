import { layout, esc } from './layout.js';
import { phantomSignScript, solanaWeb3CdnTag } from './phantom-sign.js';

function fmtMoney(x) {
  if (x == null || Number.isNaN(Number(x))) return '—';
  const n = Number(x);
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(3)}`;
  return '$0';
}

export function renderPool({ snapshot, focusAction, error }) {
  const s = snapshot || {};
  const pool = s.pool || {};
  const pos = s.position || {};
  const pref = s.pref || {};
  const metrics = s.metrics || {};
  const action = focusAction || 'claim';
  const defaultPct = pref.takeOutDefaultPct || s.policy?.fundPolicy?.takeOutDefaultPct || 90;

  return layout({
    title: pool.ticker ? pool.ticker : 'Pool',
    active: '/run',
    headExtra: solanaWeb3CdnTag(),
    body: `
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <h1 style="margin:0">${esc(pool.ticker || 'Pool')}</h1>
        <div class="row">
          <a class="btn secondary" href="/run">← Run</a>
        </div>
      </div>

      ${error ? `<p class="bad" style="margin:0 0 8px">${esc(error)}</p>` : ''}

      <div class="grid" style="margin-bottom:10px">
        <div class="metric"><div class="k">LP</div><div class="v">${fmtMoney(pos.valueUsd)}</div><div class="s">${esc(pos.count || 0)} pos</div></div>
        <div class="metric"><div class="k">Fees</div><div class="v">${fmtMoney(pos.feesUsd)}</div><div class="s">unclaimed</div></div>
        <div class="metric"><div class="k">TVL</div><div class="v">${fmtMoney(metrics.tvl)}</div><div class="s">vol ${fmtMoney(metrics.volume_24h)}</div></div>
      </div>

      <div class="card">
        <div class="row" style="gap:6px;margin-bottom:10px">
          <select id="pool-action" style="flex:1;min-width:100px">
            <option value="claim" ${action === 'claim' ? 'selected' : ''}>Claim</option>
            <option value="withdraw" ${action === 'withdraw' || action === 'take_out' ? 'selected' : ''}>Withdraw</option>
            <option value="close" ${action === 'close' ? 'selected' : ''}>Close</option>
            <option value="deposit" ${action === 'deposit' ? 'selected' : ''}>Deposit</option>
          </select>
          <input id="pool-pct" type="number" min="1" max="100" value="${esc(defaultPct)}" style="width:64px" title="%" />
          <input id="pool-ansem" type="number" min="0.1" step="0.1" value="${esc(s.policy?.pairMinAnsem ?? 1)}" style="width:72px" title="ANSEM" />
        </div>
        <div class="row" style="gap:6px">
          <button type="button" id="btn-build">Build</button>
          <button type="button" class="secondary" id="btn-apply-close" style="display:none">Off</button>
          <a class="btn secondary" href="${esc(s.links?.meteora || '#')}" target="_blank" rel="noreferrer">↗</a>
        </div>
        <div id="pool-plan-links" class="row" style="margin-top:8px;gap:6px"></div>
        <p class="muted" id="pool-toast" style="font-size:10px;margin:6px 0 0"></p>
        <pre id="pool-plan-out" style="display:none"></pre>
        <p class="muted" style="margin:8px 0 0;font-size:9px;word-break:break-all">
          <span id="pool-wallet-display">${esc((s.wallet || '').slice(0, 4))}${s.wallet ? '…' + esc(s.wallet.slice(-4)) : '—'}</span>
        </p>
      </div>

      <script>
        ${phantomSignScript()}
        const POOL = ${JSON.stringify(pool.pool || '')};
        const toast = (m) => { document.getElementById('pool-toast').textContent = m; };
        const headers = () => ({ 'Content-Type': 'application/json' });
        const out = document.getElementById('pool-plan-out');
        const links = document.getElementById('pool-plan-links');
        const applyCloseBtn = document.getElementById('btn-apply-close');

        async function walletForPlans() {
          try {
            const pk = await ensurePhantomConnected();
            document.getElementById('pool-wallet-display').textContent = pk ? pk.slice(0,4)+'…'+pk.slice(-4) : '—';
            return pk;
          } catch (e) {
            const remembered = rememberedPubkey();
            if (remembered) {
              document.getElementById('pool-wallet-display').textContent = remembered.slice(0,4)+'…'+remembered.slice(-4);
              return remembered;
            }
            throw e;
          }
        }

        function renderPlan(j) {
          out.style.display = 'block';
          out.textContent = JSON.stringify(j, null, 2);
          links.innerHTML = '';
          applyCloseBtn.style.display = j.action === 'close' && j.ok ? 'inline-block' : 'none';
          for (const a of j.actions || []) {
            if (a.serialized && a.status === 'READY') {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'btn';
              btn.textContent = 'Approve · ' + (a.type || 'tx');
              btn.onclick = async () => {
                try {
                  toast('Phantom…');
                  const rebuilt = await buildPlan(true);
                  const ready = (rebuilt.actions || []).find(x => x.serialized && x.status === 'READY' && x.type === a.type)
                    || (rebuilt.actions || []).find(x => x.serialized && x.status === 'READY');
                  if (!ready?.serialized) throw new Error('no tx');
                  const sig = await signBase64Tx(ready.serialized);
                  toast(sig.slice(0, 8) + '…');
                  const aEl = document.createElement('a');
                  aEl.href = 'https://solscan.io/tx/' + sig;
                  aEl.target = '_blank';
                  aEl.rel = 'noreferrer';
                  aEl.className = 'btn secondary';
                  aEl.textContent = 'tx';
                  links.appendChild(aEl);
                } catch (e) {
                  toast(String(e.message || e));
                }
              };
              links.appendChild(btn);
            }
            const L = a.links || {};
            if (L.meteora) {
              const el = document.createElement('a');
              el.className = 'btn secondary';
              el.href = L.meteora;
              el.target = '_blank';
              el.rel = 'noreferrer';
              el.textContent = '↗';
              links.appendChild(el);
            }
            if (L.jupiterAnsem) {
              const el = document.createElement('a');
              el.className = 'btn secondary';
              el.href = L.jupiterAnsem;
              el.target = '_blank';
              el.rel = 'noreferrer';
              el.textContent = 'ANSEM';
              links.appendChild(el);
            }
            if (L.jupiterToken) {
              const el = document.createElement('a');
              el.className = 'btn secondary';
              el.href = L.jupiterToken;
              el.target = '_blank';
              el.rel = 'noreferrer';
              el.textContent = 'TOKEN';
              links.appendChild(el);
            }
          }
        }

        async function buildPlan(silent) {
          const wallet = await walletForPlans();
          const action = document.getElementById('pool-action').value;
          const pct = document.getElementById('pool-pct').value;
          const ansemAmount = document.getElementById('pool-ansem').value;
          if (!silent) toast('…');
          const q = new URLSearchParams({ action, pool: POOL, wallet, pct, ansemAmount });
          const res = await fetch('/api/pool-plan?' + q.toString());
          const j = await res.json();
          renderPlan(j);
          if (!silent) toast(j.ok ? (j.status || 'ok') : (j.error || 'fail'));
          return j;
        }

        document.getElementById('btn-build').onclick = () => buildPlan(false).catch(e => toast(String(e.message || e)));
        document.getElementById('pool-action').onchange = () => {
          if (document.getElementById('pool-action').value === 'close') document.getElementById('pool-pct').value = 100;
        };

        applyCloseBtn.onclick = async () => {
          try {
            const wallet = await walletForPlans();
            const redirectTo = document.getElementById('pref-redirect').value.trim();
            toast('…');
            const q = new URLSearchParams({ action: 'close', apply: '1', pool: POOL, wallet });
            if (redirectTo) q.set('redirectTo', redirectTo);
            const res = await fetch('/api/pool-plan?' + q.toString(), {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({ action: 'close', pool: POOL, wallet, redirectTo, applyClosePrefs: true }),
            });
            const j = await res.json();
            renderPlan(j);
            toast(j.ok ? 'off' : (j.error || 'fail'));
          } catch (e) {
            toast(String(e.message || e));
          }
        };

        walletForPlans().catch(() => {});
      </script>
    `,
  });
}
