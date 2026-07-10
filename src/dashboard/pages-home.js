import { layout, esc } from './layout.js';
import {
  ANSEM_MINT,
  CONTROLLER_WALLET,
  HERD_POOL_PLACEHOLDER,
  INDEX_NAME,
  INDEX_TOKEN_SYMBOL,
} from '../constants.js';
import {
  herdBrandStripHtml,
  indexSheetHtml,
  indexSheetClientJs,
  normalizeIndexRows,
} from './index-sheet.js';
import { resolveHerdMint, resolveHerdPool } from '../lib/ansem-index.js';
import {
  PUBLIC_GITHUB,
  PUBLIC_SITE,
  PUBLIC_WHITEPAPER,
} from '../lib/whitepaper.js';

function pct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 10;
}

function shortPk(pk) {
  const s = String(pk || '');
  if (s.length < 10) return s || '—';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function solscanAccount(pk) {
  return `https://solscan.io/account/${encodeURIComponent(pk)}`;
}

function sliderRow(id, label, hint, value) {
  const v = pct(value);
  return `
    <div class="field" style="margin:0 0 14px">
      <div class="row" style="justify-content:space-between;margin-bottom:2px">
        <label style="margin:0;color:var(--text);font-size:11px">${esc(label)}</label>
        <span class="muted" style="font-size:11px"><span id="${id}-val">${esc(v)}</span>%</span>
      </div>
      ${hint ? `<p class="muted" style="margin:0 0 6px;font-size:10px;line-height:1.4">${hint}</p>` : ''}
      <input id="${id}" type="range" min="0" max="100" step="1" value="${esc(v)}"
        style="width:100%;accent-color:var(--accent)" />
    </div>`;
}

function originRow(label, valueHtml, note = '') {
  return `
    <div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div class="row" style="justify-content:space-between;gap:8px;align-items:baseline">
        <span class="muted" style="font-size:10px;letter-spacing:0.06em;text-transform:uppercase">${esc(label)}</span>
        ${note ? `<span class="muted" style="font-size:10px">${esc(note)}</span>` : ''}
      </div>
      <div style="margin-top:4px;font-size:12px;line-height:1.45;word-break:break-all">${valueHtml}</div>
    </div>`;
}

function walletRow(label, pk, note) {
  if (!pk) {
    return `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <span>${esc(label)}</span>
        <span class="muted">not set</span>
      </div>`;
  }
  return `
    <div class="row" style="justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:11px;font-weight:600">${esc(label)}</div>
        ${note ? `<div class="muted" style="font-size:10px;margin-top:2px">${esc(note)}</div>` : ''}
      </div>
      <a href="${esc(solscanAccount(pk))}" target="_blank" rel="noreferrer" style="font-variant-numeric:tabular-nums">
        ${esc(shortPk(pk))} ↗
      </a>
    </div>`;
}

/**
 * Setup = ANSEM LP HERD · one .env · fee mix · Index sheet · Run.
 */
export function renderHome({
  checklist,
  feeSplit,
  ledger,
  solReserve = 0.02,
  pairMinAnsem = 5,
  nodeActiveLimit = 10,
  pools = [],
  poolPrefs = {},
  ansemMint = ANSEM_MINT,
  lpWallet = '',
  controllerWallet = CONTROLLER_WALLET,
  herdLive = false,
  herdPool = '',
  herdMint = '',
}) {
  const c = checklist || {};
  const keys = c.keys || {};
  const fs = feeSplit || {};
  const lpKeyOk = Boolean(keys.lp?.present && keys.lp?.matches);
  const keysDone = Boolean(c.wallets?.lp && lpKeyOk);
  const backend = ledger?.backend || 'none';
  const gas = Number(solReserve);
  const gasLabel = Number.isFinite(gas) ? gas : 0.02;
  const limit = Math.max(10, Math.min(25, Math.floor(Number(nodeActiveLimit) || 10)));
  const minAnsem = Number.isFinite(Number(pairMinAnsem)) ? Number(pairMinAnsem) : 5;
  const herd = fs.ansemSend ?? 0.05;
  const hold = fs.ansemHold ?? 0.05;
  const resFee = fs.reserve ?? 0.05;
  const poolsPct = fs.reinvest ?? 0.85;
  const mint = ansemMint || ANSEM_MINT;
  const lp = lpWallet || c.wallets?.lp || '';
  const ctrl = controllerWallet || CONTROLLER_WALLET;
  const hPool = herdPool || resolveHerdPool();
  const hMint = herdMint || resolveHerdMint();
  const herdMintDisp =
    hMint && hMint.length >= 32 ? hMint : HERD_POOL_PLACEHOLDER;
  const herdPoolDisp = herdLive && hPool ? hPool : HERD_POOL_PLACEHOLDER;
  const githubLabel = PUBLIC_GITHUB.replace('https://github.com/', '');

  const indexSeedRows = normalizeIndexRows(
    (pools || []).map((p) => ({
      ticker: p.ticker,
      pool: p.pool,
      mint: p.mint,
      valueUsd: 0,
      feesUsd: 0,
      herd: Boolean(p.herd),
    })),
    { herdLive, totalUsd: 0 },
  );

  return layout({
    title: 'ANSEM LP HERD',
    active: '/',
    body: `
      <img class="hero-art" src="/ticker/source.png" alt="ANSEM LP HERD" />
      <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
        <div>
          <h1 style="margin:0">ANSEM LP HERD</h1>
          <p class="muted" style="margin:4px 0 0;font-size:11px">${esc(INDEX_NAME)} · HERD LP</p>
        </div>
        <span class="pill ${c.dryRun ? 'dry' : 'ok'}">${c.dryRun ? 'DRY' : 'LIVE'}</span>
      </div>

      ${herdBrandStripHtml({
        ansemMint: mint,
        herdMint: hMint,
        herdPool: hPool,
        herdLive,
      })}

      <p style="margin:0 0 12px;font-size:12px;line-height:1.5;max-width:42em">
        You do not need a bot. Add TOKEN–ANSEM liquidity on Meteora by hand if you want —
        this node is the advanced path for operators who want automation, a clean Setup,
        and community forks that can guide their own cells.
      </p>
      <p class="muted" style="margin:0 0 14px;font-size:11px;line-height:1.45;max-width:42em">
        Stay minimal: hit pair floors first, then deepen by rank toward Holder Pools targets (green on Run).
        When $HERD is live, every node joins <code>HERD_POOL</code>.
        Read the
        <a href="${esc(PUBLIC_WHITEPAPER)}" target="_blank" rel="noreferrer">whitepaper</a>
        or the in-node <a href="/whitepaper">/whitepaper</a>.
      </p>

      <h2>Origins</h2>
      <div class="card" style="padding-top:4px;padding-bottom:4px">
        ${originRow(
          'Site',
          `<a href="${esc(PUBLIC_SITE)}" target="_blank" rel="noreferrer">${esc(PUBLIC_SITE.replace('https://', ''))}</a>
           · <a href="${esc(PUBLIC_WHITEPAPER)}" target="_blank" rel="noreferrer">whitepaper</a>`,
          'canonical',
        )}
        ${originRow(
          'GitHub · fork',
          `<a href="${esc(PUBLIC_GITHUB)}" target="_blank" rel="noreferrer">${esc(githubLabel)}</a>`,
          'public node',
        )}
        ${originRow(
          '$ANSEM mint',
          `<code>${esc(mint)}</code>
           · <a href="https://solscan.io/token/${encodeURIComponent(mint)}" target="_blank" rel="noreferrer">Solscan</a>
           · <a href="https://dexscreener.com/solana/${encodeURIComponent(mint)}" target="_blank" rel="noreferrer">Dex</a>`,
          'The Black Bull',
        )}
        ${originRow(
          'Controller',
          `<code>${esc(ctrl)}</code>
           · <a href="${esc(solscanAccount(ctrl))}" target="_blank" rel="noreferrer">Solscan</a>`,
          'map book · read-only',
        )}
        ${originRow(
          '$HERD mint / pool',
          herdLive
            ? `<code>${esc(herdMintDisp)}</code><br/><code>${esc(herdPoolDisp)}</code>`
            : `<code>${esc(HERD_POOL_PLACEHOLDER)}</code> — paste <code>HERD_MINT</code> + <code>HERD_POOL</code> at launch`,
          herdLive ? 'live' : 'pre-launch',
        )}
        ${originRow(
          'Meteora pools',
          `Start list = TOKEN–ANSEM DAMM v2 only (e.g. IMG
           <a href="https://app.meteora.ag/pools/CPFU1K2Wv6dJ3La7fzn9xHJXyxheneFGM2qoo9jDFSrX" target="_blank" rel="noreferrer">CPFU…DFSrX</a>).
           Full sheet below · live book on <a href="/ansem">Index</a>.`,
          'audited vs site',
        )}
        <p class="muted" style="margin:10px 0 6px;font-size:10px;line-height:1.4">
          No bot required to join the index. Fork the node when you want a guided cell —
          or LP manually and skip the dashboard.
        </p>
      </div>

      <h2>Top LP Wallets</h2>
      <div class="card">
        ${walletRow('LP wallet public key', lp, 'LP_WALLET_PUBLIC_KEY')}
        ${walletRow('Controller', ctrl, 'Map book · read-only')}
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Step 1</div>
            <div style="font-size:14px;font-weight:600">
              Put keys in one <code>.env</code>
            </div>
          </div>
          <span class="pill ${keysDone ? 'ok' : ''}" style="font-size:12px;padding:6px 10px">
            ${keysDone ? 'YES · DONE' : 'NO · NOT YET'}
          </span>
        </div>
        <p style="margin:12px 0 0;font-size:11px;line-height:1.5;max-width:42em;border:1px solid var(--border);padding:10px">
          <strong>Use a new clean wallet.</strong> Fund a separate LP wallet so this node does not touch your other positions.
          On start / config it may <strong>sell SOL down toward the gas floor (~${esc(gasLabel)})</strong> to buy $ANSEM and seed pools.
        </p>
        <p class="muted" style="margin:10px 0 0;font-size:10px;line-height:1.5;max-width:42em">
          Treat <code>.env</code> like cash: never commit, never paste in chat, never screenshot.
          If leaked — move funds out, delete the file, rotate the key.
        </p>
        <div style="margin:12px 0 0;font-size:11px;line-height:1.55;max-width:42em">
          <p style="margin:0 0 8px"><strong>Local</strong></p>
          <ol style="margin:0 0 12px;padding-left:1.2em">
            <li><code>cp .env.example .env</code></li>
            <li>Set <code>LP_WALLET_PUBLIC_KEY</code>, <code>LP_PRIVATE_KEY</code>, <code>DASHBOARD_PASSWORD</code></li>
            <li>At $HERD launch: paste <code>HERD_MINT</code> + <code>HERD_POOL</code> below (Config) or in <code>.env</code> — same as hub <code>NEXT_PUBLIC_HERD_*</code></li>
            <li><code>chmod 600 .env</code> · refresh</li>
          </ol>
          <p style="margin:0 0 8px"><strong>Railway</strong></p>
          <ol style="margin:0;padding-left:1.2em">
            <li>No <code>.env</code> file — use Variables with the same names</li>
            <li>Demo: skip private key. Live: add <code>LP_PRIVATE_KEY</code> + password</li>
          </ol>
        </div>
        ${
          keysDone
            ? `<p class="muted" style="margin:12px 0 0;font-size:11px">HERD LP key matches wallet.</p>`
            : `<p class="muted" style="margin:12px 0 0;font-size:11px">
                ${!c.wallets?.lp ? 'LP_WALLET_PUBLIC_KEY missing. ' : ''}
                ${!keys.lp?.present ? 'LP_PRIVATE_KEY missing. ' : ''}
                ${keys.lp?.present && !keys.lp?.matches ? 'LP_PRIVATE_KEY does not match LP wallet public key. ' : ''}
              </p>`
        }
      </div>

      <h2 id="index">ANSEM Index</h2>
      <div class="card">
        ${indexSheetHtml({
          id: 'setup-index',
          rows: indexSeedRows,
          title: 'Start list · controller book fills live',
          herdLive,
          showFilter: true,
        })}
        <p class="muted" style="margin:10px 0 0;font-size:10px;line-height:1.4">
          Same table language as
          <a href="${esc(PUBLIC_SITE)}" target="_blank" rel="noreferrer">www.ansemlp.fun</a>.
          Full RO book on <a href="/ansem">Index</a>.
        </p>
      </div>

      <h2 id="config">Config</h2>
      <div class="card">
        ${sliderRow(
          'fs-herd',
          'Buy $ANSEM %',
          'Claimed fees → buy $ANSEM on HERD LP. Default 5%. (Not the $HERD mint — that ships at launch.)',
          herd,
        )}
        ${sliderRow(
          'fs-reserveAnsem',
          'Reserve ANSEM %',
          'Buy $ANSEM and hold on the node. Default 5%.',
          hold,
        )}
        ${sliderRow(
          'fs-reserveSol',
          'Reserve SOL %',
          'SOL of claimed — keep on the operator. Default 5%.',
          resFee,
        )}
        ${sliderRow(
          'fs-pools',
          'Pools %',
          'Rest of claimed back into LPs. Default 85%.',
          poolsPct,
        )}
        <p class="muted" style="margin:0 0 12px;font-size:10px">
          Sum: <span id="fs-sum">${esc(
            pct(herd) + pct(hold) + pct(resFee) + pct(poolsPct),
          )}</span>% · normalizes on save
        </p>

        <div class="field" style="margin:0 0 12px">
          <div class="row" style="justify-content:space-between;margin-bottom:4px">
            <label style="margin:0;color:var(--text);font-size:11px">Number of pools</label>
            <select id="node-limit" style="width:auto;min-width:4.5em;margin:0">
              ${[10, 12, 15, 20, 25]
                .map(
                  (n) =>
                    `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`,
                )
                .join('')}
            </select>
          </div>
          <p class="muted" style="margin:4px 0 0;font-size:10px">Bot covers this many ranked pools (min 10). No per-pool active/hold toggles.</p>
        </div>

        <div class="field" style="margin:0 0 14px">
          <label style="color:var(--text);font-size:11px">Min ANSEM / pool</label>
          <input id="pair-min-ansem" type="number" min="0" step="0.1" value="${esc(minAnsem)}" style="max-width:8em" />
          <p class="muted" style="margin:4px 0 0;font-size:10px">Default 5 — hit mins first, then deepen by rank.</p>
        </div>

        <div class="field" style="margin:0 0 10px">
          <label style="color:var(--text);font-size:11px">$HERD mint · HERD_MINT</label>
          <input id="herd-mint" type="text" spellcheck="false" autocomplete="off"
            placeholder="${esc(HERD_POOL_PLACEHOLDER)}"
            value="${esc(hMint && hMint.length >= 32 ? hMint : '')}" />
        </div>
        <div class="field" style="margin:0 0 14px">
          <label style="color:var(--text);font-size:11px">HERD–ANSEM pool · HERD_POOL</label>
          <input id="herd-pool" type="text" spellcheck="false" autocomplete="off"
            placeholder="${esc(HERD_POOL_PLACEHOLDER)}"
            value="${esc(herdLive && hPool ? hPool : '')}" />
          <p class="muted" style="margin:4px 0 0;font-size:10px">
            Same CAs as hub <code>NEXT_PUBLIC_HERD_*</code>. Paste at launch · Save writes <code>.env</code>.
            Node indexes + pins this pool; Pools % reinvest proposes it first when live.
          </p>
        </div>

        <p class="muted" style="margin:0 0 12px;font-size:10px">
          Gas floor: <strong style="color:var(--text)">${esc(gasLabel)} SOL</strong> (fixed · not a fee %).
        </p>

        <div class="row">
          <button type="button" id="btn-save" class="secondary">Save</button>
          <button type="button" id="btn-lock" class="secondary">Lock</button>
          <span class="muted" id="toast" style="font-size:10px"></span>
        </div>
        <p class="muted" style="margin:8px 0 0;font-size:10px">
          Unlocked with <code>DASHBOARD_PASSWORD</code> · Lock hides everything again.
        </p>
      </div>

      <p class="muted" style="margin:0 0 12px;font-size:10px">
        Activity: SQLite <code>logs/tx.sqlite</code> on <a href="/run">/run</a> (Start resets · CSV at bottom)${backend && backend !== 'none' ? ` · backend ${esc(backend)}` : ''}.
      </p>

      <div class="card" style="text-align:center;padding:20px">
        <p class="muted" style="margin:0 0 12px;font-size:11px">
          ${keysDone ? 'Next: Config fees · then Run.' : 'Finish Step 1 before a live run.'}
        </p>
        <div class="row" style="justify-content:center;gap:8px">
          <a class="btn secondary" href="/#config" style="font-size:14px;padding:12px 20px;display:inline-block">Config</a>
          <a class="btn" href="/run" style="font-size:16px;padding:14px 28px;display:inline-block">▶ Run</a>
        </div>
      </div>

      <script>
        ${indexSheetClientJs()}
        const herdLive = ${JSON.stringify(!!herdLive)};
        const herdPool = ${JSON.stringify(hPool || '')};
        const herdTicker = ${JSON.stringify(INDEX_TOKEN_SYMBOL || 'HERD')};
        const ctrlWallet = ${JSON.stringify(ctrl || '')};

        bindIndexSheet('setup-index');
        bindCopyCa();

        async function refreshSetupIndex() {
          if (!ctrlWallet) return;
          try {
            const p = await (await fetch('/api/portfolio?wallet=' + encodeURIComponent(ctrlWallet), { cache: 'no-store' })).json();
            if (p.error) return;
            const rows = portfolioToIndexRows(p.positions || [], {
              herdLive: herdLive,
              herdPool: herdPool,
              herdTicker: herdTicker,
            });
            renderIndexSheet('setup-index', rows);
          } catch (_) {}
        }
        refreshSetupIndex();
        setInterval(refreshSetupIndex, 45000);

        const ids = ['fs-herd','fs-reserveAnsem','fs-reserveSol','fs-pools'];
        function syncSum() {
          let s = 0;
          for (const id of ids) {
            const el = document.getElementById(id);
            const lab = document.getElementById(id + '-val');
            const v = Number(el.value) || 0;
            if (lab) lab.textContent = String(v);
            s += v;
          }
          const sum = document.getElementById('fs-sum');
          if (sum) sum.textContent = String(s);
        }
        ids.forEach((id) => document.getElementById(id).addEventListener('input', syncSum));

        document.getElementById('node-limit').addEventListener('change', () => {});

        document.getElementById('btn-lock').onclick = async () => {
          await fetch('/api/lock', { method: 'POST', credentials: 'same-origin' });
          location.href = '/unlock';
        };

        document.getElementById('btn-save').onclick = async () => {
          const toast = document.getElementById('toast');
          toast.textContent = '…';
          const body = {
            feeSplit: {
              ansemSend: Number(document.getElementById('fs-herd').value) || 0,
              ansemHold: Number(document.getElementById('fs-reserveAnsem').value) || 0,
              reserve: Number(document.getElementById('fs-reserveSol').value) || 0,
              reinvest: Number(document.getElementById('fs-pools').value) || 0,
              indexBurn: 0,
              aemonDonate: 0,
            },
            knobs: {
              pairMinAnsem: Number(document.getElementById('pair-min-ansem').value) || 5,
              nodeActiveLimit: Math.max(10, Number(document.getElementById('node-limit').value) || 10),
              reservePct: (Number(document.getElementById('fs-reserveSol').value) || 0) / 100,
            },
            herdMint: (document.getElementById('herd-mint')?.value || '').trim(),
            herdPool: (document.getElementById('herd-pool')?.value || '').trim(),
            clearRoutes: true,
          };
          try {
            const j = await (await fetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify(body),
            })).json();
            toast.textContent = j.ok ? 'saved' : (j.error || 'fail');
            if (!j.ok && (j.unlock || String(j.error || '').includes('locked'))) {
              setTimeout(() => { location.href = j.unlock || '/unlock'; }, 600);
            }
          } catch (e) {
            toast.textContent = String(e.message || e);
          }
        };
      </script>
    `,
  });
}
