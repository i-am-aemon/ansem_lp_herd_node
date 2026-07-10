import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { INDEX_NAME } from '../constants.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Public fork target — never the private working cell. */
const GITHUB_REPO = 'https://github.com/i-am-aemon/ANSEM_LP_HERD_Node';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readNodeVersion() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
    if (raw) return raw;
  } catch (_) {}
  return 'HERDnodebeta 0.1.0 - greenvader';
}

const NODE_VERSION_LABEL = readNodeVersion();
const NODE_CHANNEL = 'BETA';

function isDemoPublic() {
  try {
    return ['1', 'true', 'yes', 'on'].includes(
      String(process.env.DEMO_PUBLIC || '').toLowerCase(),
    );
  } catch {
    return false;
  }
}

export function layout({ title, active, body, headExtra = '', demoPublic, unlocked } = {}) {
  const demo = demoPublic != null ? Boolean(demoPublic) : isDemoPublic();
  const isUnlocked = unlocked != null ? Boolean(unlocked) : active !== '/unlock';
  const nav = [
    { href: '/', label: 'Setup' },
    { href: '/ansem', label: 'Index' },
    { href: '/config', label: 'Config' },
    { href: '/run', label: 'Run' },
    { href: '/whitepaper', label: 'Whitepaper' },
    { href: GITHUB_REPO, label: 'GitHub', external: true },
  ];
  const lockControl = isUnlocked
    ? `<div class="hdr-lock" id="hdr-lock">
        <button type="button" class="hdr-lock-btn" id="hdr-btn-lock" title="Lock dashboard" aria-label="Lock">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        </button>
        <span class="muted" style="font-size:9px">open</span>
      </div>`
    : `<form class="hdr-lock" id="hdr-unlock-form" autocomplete="on">
        <input id="hdr-password" name="password" type="password" autocomplete="current-password" placeholder="password" aria-label="DASHBOARD_PASSWORD" />
        <button type="submit" class="hdr-lock-btn" id="hdr-btn-unlock" title="Unlock" aria-label="Unlock">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 7.5-1"/></svg>
        </button>
      </form>`;
  const demoBanner = demo
    ? `<div style="background:#1a1a12;border-bottom:1px solid #3a3a28;color:#c8c878;padding:6px 12px;font-size:10px;text-align:center">
        DEMO — no keys · seed &amp; fee bot blocked · <a href="${esc(GITHUB_REPO)}" target="_blank" rel="noreferrer">Fork</a> → local <code>.env</code> for live · <a href="/whitepaper">Whitepaper</a>
      </div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)} · ANSEM</title>
  ${headExtra || ''}
  <style>
    :root {
      --bg: #000000;
      --panel: #000000;
      --border: #222222;
      --text: #f0f0f0;
      --muted: #888888;
      --accent: #34d399;
      --good: #34d399;
      --bad: #a0a0a0;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--mono);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      font-size: 12px;
      line-height: 1.35;
      -webkit-text-size-adjust: 100%;
    }
    a { color: var(--text); text-decoration: underline; text-underline-offset: 2px; }
    a:hover { color: var(--good); }
    header {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.92); backdrop-filter: blur(8px);
      position: sticky; top: 0; z-index: 10;
    }
    .hdr-right { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
    .hdr-lock {
      display: flex; align-items: center; gap: 6px;
      border: 1px solid var(--border); padding: 3px 6px; background: #000;
    }
    .hdr-lock input {
      width: 110px; margin: 0; padding: 5px 6px; font-size: 11px;
      border: none; background: transparent; color: var(--text);
    }
    .hdr-lock input:focus { outline: none; }
    .hdr-lock-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0; margin: 0;
      background: transparent; border: 1px solid var(--border); color: var(--muted);
      cursor: pointer; border-radius: 0;
    }
    .hdr-lock-btn:hover { border-color: var(--accent); color: var(--accent); background: transparent; }
    .brand {
      font-weight: 700; letter-spacing: 0.04em; font-size: 11px; color: var(--text);
      line-height: 1.25; max-width: min(280px, 55vw); word-break: break-word;
    }
    .brand-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .brand-meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      font-size: 9px; letter-spacing: 0.04em; color: var(--muted);
    }
    .pill.beta {
      border-color: var(--accent); color: var(--accent);
      font-weight: 700; letter-spacing: 0.08em;
    }
    .ver-label { color: var(--muted); font-weight: 500; word-break: break-word; }
    nav { display: flex; gap: 4px; flex-wrap: wrap; }
    nav a {
      padding: 5px 8px; border: 1px solid var(--border); border-radius: 3px;
      color: var(--muted); text-decoration: none; font-size: 11px;
    }
    nav a.active, nav a:hover { color: var(--text); border-color: var(--text); text-decoration: none; }
    main { max-width: 960px; margin: 0 auto; padding: 12px 12px 48px; }
    h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; letter-spacing: -0.02em; }
    h2 { font-size: 11px; margin: 16px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
    p.lead { display: none; }
    .card {
      background: #000; border: 1px solid var(--border); border-radius: 0;
      padding: 12px; margin-bottom: 10px;
    }
    .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .metric { background: #000; border: 1px solid var(--border); border-radius: 0; padding: 10px; }
    .metric .k { color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
    .metric .v { font-size: 20px; margin-top: 2px; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .metric .s { color: var(--muted); font-size: 10px; margin-top: 2px; }
    label { display: block; color: var(--muted); font-size: 10px; margin-bottom: 3px; }
    input, select {
      width: 100%; background: #000; border: 1px solid var(--border); color: var(--text);
      padding: 7px 8px; border-radius: 0; font-family: inherit; font-size: 12px;
    }
    button, .btn {
      background: var(--accent); color: #000; border: none; border-radius: 0;
      padding: 7px 12px; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
      display: inline-block; text-decoration: none;
    }
    button:hover, .btn:hover { background: #6ee7b7; text-decoration: none; color: #000; }
    button.secondary, .btn.secondary {
      background: transparent; color: var(--text); border: 1px solid var(--border);
    }
    button.secondary:hover, .btn.secondary:hover { border-color: var(--accent); color: var(--accent); background: transparent; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .ok { color: var(--good); }
    .bad { color: var(--bad); }
    .muted { color: var(--muted); }
    .tx-feed {
      margin: 0; max-height: 55vh; min-height: 240px; overflow: auto;
      background: #000; padding: 8px 0;
    }
    .tx-row {
      display: grid;
      grid-template-columns: 52px 28px 72px minmax(0, 1fr) 72px 56px;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid #222;
      font-size: 11px;
    }
    .tx-row:hover { background: #000; border-bottom-color: var(--accent); }
    .tx-row.session {
      grid-template-columns: 52px 1fr;
      background: #000;
      border-bottom-color: #222;
      color: var(--muted);
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tx-chip {
      width: 22px; height: 22px; border-radius: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 12px; border: 1px solid var(--border);
    }
    .tx-chip.plus { color: var(--good); border-color: var(--accent); background: #000; }
    .tx-chip.minus { color: #a0a0a0; border-color: #444; background: #000; }
    .tx-chip.dot { color: var(--muted); }
    .tx-kind { font-weight: 600; text-transform: lowercase; }
    .tx-did { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tx-usd { text-align: right; font-variant-numeric: tabular-nums; }
    .tx-sig a { color: var(--good); font-size: 10px; text-decoration: none; }
    .tx-sig a:hover { text-decoration: underline; }
    .tx-empty { padding: 28px 12px; text-align: center; color: var(--muted); font-size: 11px; }
    @media (max-width: 640px) {
      .tx-row { grid-template-columns: 44px 24px 56px minmax(0, 1fr); }
      .tx-usd, .tx-sig { display: none; }
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    th { color: var(--muted); font-weight: 500; position: sticky; top: 44px; background: #000; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
    .pos { color: var(--good); }
    .neg { color: #a0a0a0; }
    .pill {
      display: inline-block; padding: 1px 6px; border-radius: 0; font-size: 9px;
      border: 1px solid var(--border); color: var(--muted); letter-spacing: 0.04em;
    }
    .pill.ok { border-color: var(--good); color: var(--good); }
    .pill.dry { border-color: var(--muted); color: var(--muted); }
    pre {
      background: #000; border: 1px solid var(--border); padding: 8px; border-radius: 0;
      overflow: auto; font-size: 10px; max-height: 200px; margin: 8px 0 0;
    }
    .field { margin-bottom: 8px; }
    .toast { margin-top: 6px; color: var(--muted); font-size: 10px; white-space: pre-wrap; }
    .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    details.card > summary { cursor: pointer; color: var(--muted); font-size: 11px; list-style: none; }
    details.card > summary::-webkit-details-marker { display: none; }
    .box-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    .box-ctrl {
      background: #000; border: 1px solid var(--border); border-radius: 0;
      padding: 10px 8px; text-align: center; cursor: pointer; user-select: none;
      min-height: 64px; display: flex; flex-direction: column; justify-content: center; gap: 4px;
    }
    .box-ctrl:hover { border-color: var(--accent); }
    .box-ctrl.on { border-color: var(--good); background: #000; }
    .box-ctrl .box-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .box-ctrl .box-val { font-size: 18px; font-variant-numeric: tabular-nums; font-weight: 600; }
    .box-ctrl input.box-pct {
      width: 100%; text-align: center; font-size: 18px; font-weight: 600; padding: 4px;
      background: transparent; border: none; color: var(--text); font-family: inherit;
    }
    .box-ctrl input.box-pct:disabled { color: var(--muted); }
    .pie-pair { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
    .pie-trio { display: grid; gap: 12px; grid-template-columns: 1fr 1fr 1fr; }
    @media (max-width: 900px) {
      .pie-trio { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .pie-pair { grid-template-columns: 1fr; }
    }
    .sol-boxes { display: grid; gap: 8px; grid-template-columns: repeat(5, 1fr); }
    @media (max-width: 720px) {
      .sol-boxes { grid-template-columns: repeat(2, 1fr); }
    }
    .sol-box {
      background: #000; border: 1px solid var(--border); border-radius: 0;
      padding: 8px; text-align: center; font-variant-numeric: tabular-nums;
    }
    .sol-box .k { color: var(--muted); font-size: 9px; text-transform: uppercase; }
    .sol-box .v { font-size: 13px; font-weight: 700; margin-top: 4px; }
    .sol-box .s { color: var(--muted); font-size: 9px; margin-top: 2px; }
    .pool-tile {
      background: #000; border: 1px solid var(--border); border-radius: 0; padding: 10px;
    }
    .pool-tile .mode-row, .pool-tile .bool-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .pool-tile .mode-btn, .pool-tile .bool-btn {
      flex: 1; min-width: 48px; padding: 6px 4px; font-size: 10px; text-align: center;
      border: 1px solid var(--border); background: transparent; color: var(--muted);
      border-radius: 0; cursor: pointer; font-family: inherit;
    }
    .pool-tile .mode-btn.on, .pool-tile .bool-btn.on {
      border-color: var(--good); color: var(--good); background: #000;
    }

    /* Thin rectangular spreadsheet-style care rows */
    .pool-ranks { display: flex; flex-direction: column; gap: 4px; }
    .pool-rank-row {
      display: flex; align-items: center; gap: 10px;
      background: #000; border: 1px solid var(--border);
      border-radius: 0; padding: 8px 10px;
    }
    .pool-rank-row.need { border-color: #555; }
    .pool-rank-row.ok { border-color: var(--accent); }
    .pool-rank-row:hover { border-color: var(--accent); }
    .pr-rank {
      width: 26px; height: 26px; border-radius: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; background: #000; border: 1px solid var(--border);
      flex-shrink: 0; font-variant-numeric: tabular-nums; color: var(--muted);
    }
    .pr-main { flex: 1; min-width: 0; }
    .pr-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
    .pr-tick { font-size: 13px; }
    .pr-usd { font-size: 13px; font-variant-numeric: tabular-nums; color: var(--accent); }
    .pr-gap { font-size: 10px; }
    .pr-meta { font-size: 10px; margin-top: 2px; line-height: 1.35; }
    .pr-acts { display: flex; flex-wrap: wrap; gap: 4px; flex-shrink: 0; }
    .pr-acts a {
      padding: 4px 8px; font-size: 10px; border: 1px solid var(--border);
      border-radius: 0; text-decoration: none; color: var(--muted);
    }
    .pr-acts a:hover { border-color: var(--accent); color: var(--accent); }
    .pr-acts a.pr-close { border-color: #444; color: var(--muted); }
    .pr-acts a.pr-close:hover { border-color: var(--text); color: var(--text); }

    .wallet-pop {
      display: none; background: #000; border: 1px solid var(--border);
      border-radius: 0; padding: 10px; margin-bottom: 10px;
    }
    .wallet-pop.open { display: block; }
    .wallet-pop .wp-row {
      display: flex; justify-content: space-between; gap: 8px;
      padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 11px;
    }
    .wallet-pop .wp-row:last-child { border-bottom: none; }
    .stair {
      font-size: 11px; color: var(--muted); margin: 0 0 10px; line-height: 1.45;
      padding: 8px 10px; border: 1px solid var(--border); border-radius: 0; background: #000;
    }
    .stair strong { color: var(--good); font-weight: 600; }
    .pie-wrap { min-width: 0; }

    /* ANSEM Index sheet — website HomeIndex language */
    .index-sheet { margin: 0; }
    .index-table { width: 100%; border-collapse: collapse; min-width: 640px; }
    .index-table th {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--muted); font-weight: 500; padding: 8px 8px 8px 0;
      border-bottom: 1px solid var(--border); background: #000; position: sticky; top: 0;
    }
    .index-table th.index-num, .index-table td.index-num { text-align: right; padding-left: 8px; }
    .index-sort {
      background: none; border: none; color: inherit; font: inherit;
      padding: 0; cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em;
    }
    .index-sort:hover { color: var(--accent); }
    .index-row { border-bottom: 1px solid #1a1a1a; }
    .index-row:hover { background: #000; border-bottom-color: var(--border); }
    .index-row.herd { background: rgba(52, 211, 153, 0.06); }
    .index-row.placeholder { opacity: 0.85; }
    .index-row td { padding: 10px 8px 10px 0; vertical-align: middle; }
    .index-pair {
      display: inline-flex; align-items: flex-start; gap: 8px;
      text-decoration: none; color: var(--text); min-width: 0;
    }
    .index-pair:hover .index-pair-name { text-decoration: underline; text-underline-offset: 2px; }
    .index-ico { margin-top: 2px; border-radius: 2px; flex-shrink: 0; }
    .index-pair-name { display: block; font-size: 13px; font-weight: 600; }
    .index-pair-ansem { color: var(--muted); font-weight: 500; }
    .index-pair-sub { display: block; font-size: 10px; margin-top: 2px; }
    .index-share { color: var(--accent); }
    .index-share-creator { color: var(--accent); }
    .index-share-holder { color: var(--text); opacity: 0.9; }
    .index-fees { color: var(--accent); opacity: 0.85; }
    .index-links { display: flex; gap: 4px; justify-content: flex-end; }
    .index-link-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: 1px solid var(--border); background: #000;
    }
    .index-link-btn:hover { border-color: var(--accent); }
    .herd-brand-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
      padding: 12px; background: #000;
    }
    .herd-ca {
      flex: 1; min-width: 0; word-break: break-all;
      font-size: 11px; color: var(--text); background: transparent;
    }

    .audit-table td, .audit-table th { font-size: 10px; white-space: nowrap; }

    .claim-bar {
      margin: 0 0 10px; padding: 10px 12px;
      border: 1px solid var(--border); background: #000;
    }
    .claim-bar.ready { border-color: var(--accent); }
    .claim-bar-head {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 8px; margin-bottom: 6px;
    }
    .claim-bar-label {
      font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
    }
    .claim-bar-amt {
      font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 600;
    }
    .claim-bar-track {
      height: 8px; background: #111; border: 1px solid var(--border);
      overflow: hidden;
    }
    .claim-bar-fill {
      height: 100%; width: 0%;
      background: var(--accent);
      transition: width 0.4s ease;
    }
    .claim-bar.ready .claim-bar-fill { background: var(--good); }
    .claim-bar-foot {
      margin: 6px 0 0; font-size: 10px; color: var(--muted); line-height: 1.4;
    }

    .bot-alive {
      display: flex; align-items: center; gap: 10px;
      margin: 0 0 10px; padding: 10px 12px;
      border: 1px solid var(--border); background: #000;
    }
    .bot-alive.on { border-color: var(--accent); }
    .bot-spinner {
      width: 14px; height: 14px; border: 2px solid var(--border);
      border-top-color: var(--accent); border-radius: 50%;
      flex-shrink: 0;
    }
    .bot-alive.on .bot-spinner { animation: bot-spin 0.8s linear infinite; }
    @keyframes bot-spin { to { transform: rotate(360deg); } }
    .bot-dots { display: inline-flex; gap: 3px; }
    .bot-dots span {
      width: 4px; height: 4px; background: var(--muted); border-radius: 0;
    }
    .bot-alive.on .bot-dots span {
      background: var(--accent);
      animation: bot-dot 1.2s ease-in-out infinite;
    }
    .bot-alive.on .bot-dots span:nth-child(2) { animation-delay: 0.15s; }
    .bot-alive.on .bot-dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes bot-dot {
      0%, 80%, 100% { opacity: 0.35; }
      40% { opacity: 1; }
    }

    @media (max-width: 640px) {
      main { padding: 10px 10px 40px; }
      .metric .v { font-size: 18px; }
      th, td { padding: 5px 3px; }
      nav a { padding: 4px 6px; }
    }
  </style>
</head>
<body>
  ${demoBanner}
  <header>
    <div class="brand-wrap">
      <div class="brand">${esc(INDEX_NAME)}</div>
      <div class="brand-meta">
        <span class="pill beta">${esc(NODE_CHANNEL)}</span>
        <span class="ver-label">${esc(NODE_VERSION_LABEL)}</span>
      </div>
    </div>
    <div class="hdr-right">
      <nav>
        ${nav
          .map((item) => {
            const { href, label, external } = item;
            const cls = !external && active === href ? 'active' : '';
            const extra = external
              ? ' target="_blank" rel="noreferrer"'
              : '';
            return `<a href="${esc(href)}" class="${cls}"${extra}>${esc(label)}</a>`;
          })
          .join('')}
      </nav>
      ${lockControl}
    </div>
  </header>
  <main>${body}</main>
  <script>
    (function () {
      var lockBtn = document.getElementById('hdr-btn-lock');
      if (lockBtn) {
        lockBtn.addEventListener('click', async function () {
          try {
            await fetch('/api/lock', { method: 'POST', credentials: 'same-origin' });
          } catch (_) {}
          location.href = '/unlock?next=' + encodeURIComponent(location.pathname + location.search);
        });
      }
      var form = document.getElementById('hdr-unlock-form');
      if (form) {
        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          var pw = (document.getElementById('hdr-password') || {}).value || '';
          var params = new URLSearchParams(location.search);
          var next = params.get('next') || '/';
          try {
            var j = await (await fetch('/api/unlock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ password: pw, next: next }),
            })).json();
            if (!j.ok) {
              alert(j.error || 'wrong password');
              return;
            }
            location.href = j.next || next || '/';
          } catch (err) {
            alert(String(err.message || err));
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}

export { esc, GITHUB_REPO, NODE_VERSION_LABEL, NODE_CHANNEL };
