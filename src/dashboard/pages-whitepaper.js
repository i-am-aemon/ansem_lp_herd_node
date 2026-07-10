import { layout, esc } from './layout.js';

/**
 * One-form whitepaper — same spine as Setup (HERD LP · ANSEM Liquidity Pool).
 */
export function renderWhitepaper({
  title,
  version,
  parts,
  flow,
  custody,
  security = [],
  capital = [],
  startList,
  floor,
  nodeMin,
  pairMinAnsem,
  solReserve,
  bottom = null,
}) {
  const b = bottom || {};

  return layout({
    title: 'Whitepaper',
    active: '/whitepaper',
    body: `
      <img class="hero-art" src="/ticker/source.png" alt="HERD" />
      <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
        <div>
          <h1 style="margin:0">HERD LP</h1>
          <p class="muted" style="margin:4px 0 0;font-size:11px">${esc(title)} · ${esc(version)}</p>
        </div>
        <span class="pill">INDEX</span>
      </div>

      <p class="muted" style="margin:0 0 12px;font-size:11px;line-height:1.45;max-width:42em">
        You do not need a bot — manual TOKEN–ANSEM LP on Meteora is enough.
        This node is the advanced path: one <code>.env</code>, your LP wallet, community forks.
        Cover mins first, then deepen by rank. When HERD is live, every node joins <code>HERD_POOL</code>.
        Site: <a href="https://www.ansemlp.fun" target="_blank" rel="noreferrer">www.ansemlp.fun</a>.
      </p>

      <div class="grid" style="margin-bottom:10px">
        <div class="metric"><div class="k">Reserve</div><div class="v">${esc(solReserve)}</div><div class="s">SOL gas floor</div></div>
        <div class="metric"><div class="k">Pair min</div><div class="v">${esc(pairMinAnsem)}</div><div class="s">ANSEM</div></div>
        <div class="metric"><div class="k">Index</div><div class="v">${esc(startList.length)}</div><div class="s">pools · floor $${esc(floor)}</div></div>
      </div>

      <h2>Flow</h2>
      <div class="card">
        ${flow
          .map(
            (s, i) => `
          <div style="padding:${i === 0 ? '0' : '10px'} 0 ${i === flow.length - 1 ? '0' : '10px'};${i < flow.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
            <div class="row" style="gap:8px;align-items:baseline">
              <span class="pill">${esc(s.n)}</span>
              <strong style="font-size:12px">${esc(s.title)}</strong>
            </div>
            <p class="muted" style="margin:6px 0 0;font-size:11px;line-height:1.5">${esc(s.body)}</p>
          </div>`,
          )
          .join('')}
      </div>

      <h2>Custody · security</h2>
      <div class="card">
        ${[...custody, ...security]
          .map(
            (s, i, arr) => `
          <div style="padding:${i === 0 ? '0' : '10px'} 0 ${i === arr.length - 1 ? '0' : '10px'};${i < arr.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
            <strong style="font-size:12px">${esc(s.title)}</strong>
            <p class="muted" style="margin:4px 0 0;font-size:11px;line-height:1.5">${esc(s.body)}</p>
          </div>`,
          )
          .join('')}
      </div>

      <h2>Capital</h2>
      <div class="card">
        ${capital
          .map(
            (s, i, arr) => `
          <div style="padding:${i === 0 ? '0' : '10px'} 0 ${i === arr.length - 1 ? '0' : '10px'};${i < arr.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
            <strong style="font-size:12px">${esc(s.title)}</strong>
            <p class="muted" style="margin:4px 0 0;font-size:11px;line-height:1.5">${esc(s.body)}</p>
          </div>`,
          )
          .join('')}
      </div>

      <h2>Index list · ${esc(startList.length)} · floor $${esc(floor)}</h2>
      <div class="card scroll-x" style="max-height:40vh;overflow:auto;padding:0">
        <table>
          <thead><tr><th>#</th><th>Ticker</th><th>Pool</th></tr></thead>
          <tbody>
            ${startList
              .map(
                (n, i) =>
                  `<tr><td class="muted">${i + 1}</td><td>${esc(n.ticker)}</td><td class="muted" style="font-size:9px">${esc((n.pool || '').slice(0, 8))}…</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <section id="bottom" style="margin-top:16px">
        <h2>${esc(b.title || 'Join the HERD')}</h2>
        <p class="muted" style="margin:0 0 12px;font-size:11px;line-height:1.5;max-width:42em">
          ${esc(b.intro || '')}
        </p>
        ${
          b.whySafe
            ? `
        <div class="card" style="border-color:var(--good)">
          <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;color:var(--good)">${esc(b.whySafe.title)}</div>
          <p style="margin:0 0 12px;font-size:12px;line-height:1.5">${esc(b.whySafe.lead || '')}</p>
          ${(b.whySafe.points || [])
            .map(
              (s, i, arr) => `
            <div style="padding:${i === 0 ? '0' : '10px'} 0 ${i === arr.length - 1 ? '0' : '10px'};${i < arr.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
              <strong style="font-size:12px">${esc(s.title)}</strong>
              <p class="muted" style="margin:4px 0 0;font-size:11px;line-height:1.5">${esc(s.body)}</p>
            </div>`,
            )
            .join('')}
        </div>`
            : ''
        }
        <div class="card" style="margin-top:10px;border-color:var(--good);padding:16px;text-align:center">
          <p style="margin:0 0 8px;font-size:14px;font-weight:600;line-height:1.45">
            ${esc(b.closing || 'You read the whitepaper. Congrats — now join the HERD.')}
          </p>
          <p class="muted" style="margin:0;font-size:10px;letter-spacing:0.06em;text-transform:uppercase">
            HERDnodebeta · greenvader
          </p>
        </div>
        <p class="muted" style="margin:12px 0 0;font-size:10px;text-align:center">
          <a href="/">← Setup</a>
          ${parts?.length ? ` · ${parts.map((p) => esc(p.label)).join(' · ')}` : ''}
          ${nodeMin != null ? ` · node min $${esc(nodeMin)}` : ''}
        </p>
      </section>
    `,
  });
}
