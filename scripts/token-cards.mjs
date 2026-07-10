#!/usr/bin/env node
/**
 * ANSEM Index trading-card PDF — one page per pool.
 * Consumes / builds portfolio for TRACKED_WALLET (old book, read-only).
 *
 * Output under reports/:
 *   ANSEM_INDEX_TOKEN_CARDS_<ts>.pdf
 *   ANSEM_INDEX_TOKEN_CARDS_<ts>_card_data.csv
 *   ansem_index_token_history.csv
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { config } from '../src/config.js';
import { buildPortfolio } from '../src/lib/portfolio.js';
import { INDEX_NAME, ANSEM_MINT, OLD_BOOK_WALLET } from '../src/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');

function fmtMoney(x) {
  if (x == null || Number.isNaN(Number(x))) return '-';
  const n = Number(x);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(2)}K`;
  if (a >= 1) return `${sign}$${a.toFixed(2)}`;
  return `${sign}$${a.toFixed(4)}`;
}

function fmtPct(x) {
  if (x == null || Number.isNaN(Number(x))) return '-';
  return `${Number(x) >= 0 ? '+' : ''}${Number(x).toFixed(2)}%`;
}

function short(x, left = 6, right = 4) {
  if (!x) return '';
  if (x.length <= left + right + 1) return x;
  return `${x.slice(0, left)}…${x.slice(-right)}`;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  fs.mkdirSync(REPORTS, { recursive: true });
  const wallet = config.trackedWallet || OLD_BOOK_WALLET;
  console.log(`Building token cards for ${wallet}…`);

  const portfolio = await buildPortfolio(wallet, config.ansemMint || ANSEM_MINT);
  const positions = portfolio.positions || [];
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix = `ANSEM_INDEX_TOKEN_CARDS_${wallet.slice(0, 6)}_${ts}`;
  const pdfPath = path.join(REPORTS, `${prefix}.pdf`);
  const csvPath = path.join(REPORTS, `${prefix}_card_data.csv`);
  const histPath = path.join(REPORTS, 'ansem_index_token_history.csv');

  // History append
  const histRows = positions.map((p) => ({
    timestamp_utc: now.toISOString(),
    index: INDEX_NAME,
    wallet,
    ticker: p.ticker,
    ca: p.constituent_token?.address || '',
    pool: p.pool_address || '',
    price_usd: p.price_usd ?? '',
    position_value_usd: p.position_value_usd ?? '',
    pending_fees_usd: p.unclaimed_fees_usd ?? '',
  }));
  const histHeader =
    'timestamp_utc,index,wallet,ticker,ca,pool,price_usd,position_value_usd,pending_fees_usd\n';
  const histBody = histRows
    .map((r) =>
      [
        r.timestamp_utc,
        r.index,
        r.wallet,
        r.ticker,
        r.ca,
        r.pool,
        r.price_usd,
        r.position_value_usd,
        r.pending_fees_usd,
      ]
        .map(csvEscape)
        .join(','),
    )
    .join('\n');
  if (!fs.existsSync(histPath)) fs.writeFileSync(histPath, histHeader);
  fs.appendFileSync(histPath, histBody + '\n');

  // Card data CSV
  const cardHeader = [
    'TICKER',
    'CA',
    'POOL',
    'VALUE_USD',
    'FEES_USD',
    'CHG_24H',
    'VOL_24H',
    'MC',
    'FEE_PCT',
  ].join(',');
  const cardBody = positions
    .map((p) =>
      [
        p.ticker,
        p.constituent_token?.address,
        p.pool_address,
        p.position_value_usd,
        p.unclaimed_fees_usd,
        p.price_change_24h,
        p.volume_24h,
        p.market_cap,
        p.pool_config?.base_fee_pct,
      ]
        .map(csvEscape)
        .join(','),
    )
    .join('\n');
  fs.writeFileSync(csvPath, cardHeader + '\n' + cardBody + '\n');

  // PDF
  const doc = new PDFDocument({ size: 'A4', margin: 36, autoFirstPage: false });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const totals = portfolio.totals || {};
  const totalValue = positions.reduce((s, p) => s + (p.position_value_usd || 0), 0);
  const totalFees = positions.reduce((s, p) => s + (p.unclaimed_fees_usd || 0), 0);

  // Cover
  doc.addPage();
  doc.fontSize(22).fillColor('#111').text(INDEX_NAME, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555').text('Token Trading Card Audit Report', {
    align: 'center',
  });
  doc.moveDown(1);
  doc.fontSize(9).fillColor('#111');
  const cover = [
    ['Wallet (read-only)', wallet],
    ['Token cards', String(positions.length)],
    ['Estimated LP value', fmtMoney(totalValue || totals.balances)],
    ['Pending fees', fmtMoney(totalFees || totals.unclaimed_fees)],
    ['Total deposits', fmtMoney(totals.total_deposits)],
    ['PnL', `${fmtMoney(totals.pnl)} (${fmtPct(totals.pnl_pct_change)})`],
    ['Generated', now.toISOString()],
  ];
  for (const [k, v] of cover) {
    doc.text(`${k}: ${v}`);
  }
  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor('#555')
    .text(
      'Each following page is one TOKEN–ANSEM pool card. Links: Solscan, Meteora, DexScreener. Private node never signs with this wallet.',
    );

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    doc.addPage();
    const ca = p.constituent_token?.address || '';
    const pool = p.pool_address || '';

    doc.rect(30, 30, 535, 780).strokeColor('#333').lineWidth(1.2).stroke();

    doc.fontSize(18).fillColor('#111').text(p.ticker || '?', 48, 48);
    doc
      .fontSize(8)
      .fillColor('#666')
      .text(`Card ${i + 1} of ${positions.length} · ${p.pool_name || ''}`, 48, 72);

    doc.fontSize(9).fillColor('#111');
    let y = 100;
    const lines = [
      ['Token CA', short(ca, 8, 8)],
      ['Pool CA', short(pool, 8, 8)],
      ['Pair', 'ANSEM'],
      ['Position value', fmtMoney(p.position_value_usd)],
      ['Pending fees', fmtMoney(p.unclaimed_fees_usd)],
      ['Price', fmtMoney(p.price_usd)],
      ['5m', fmtPct(p.price_change_5m)],
      ['1h', fmtPct(p.price_change_1h)],
      ['6h', fmtPct(p.price_change_6h)],
      ['24h', fmtPct(p.price_change_24h)],
      ['Vol 24h', fmtMoney(p.volume_24h)],
      ['Market cap', fmtMoney(p.market_cap)],
      ['Fee %', p.pool_config?.base_fee_pct != null ? `${p.pool_config.base_fee_pct}%` : '-'],
    ];
    for (const [k, v] of lines) {
      doc.text(`${k}`, 48, y, { width: 140, continued: false });
      doc.text(String(v), 200, y);
      y += 16;
    }

    y += 12;
    doc.fontSize(8).fillColor('#1a4a9c');
    doc.text(`Solscan Token: https://solscan.io/token/${ca}`, 48, y);
    y += 12;
    doc.text(`Solscan Pool: https://solscan.io/account/${pool}`, 48, y);
    y += 12;
    doc.text(`Meteora: https://app.meteora.ag/pools/${pool}`, 48, y);
    y += 12;
    doc.text(`DexScreener: https://dexscreener.com/solana/${ca}`, 48, y);

    y += 24;
    doc.fontSize(7).fillColor('#666').text(`Full CA: ${ca}`, 48, y, { width: 500 });
    y += 12;
    doc.text(`Pool: ${pool}`, 48, y, { width: 500 });
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log('================ DONE ================');
  console.log('PDF: ', pdfPath);
  console.log('CSV: ', csvPath);
  console.log('History:', histPath);
  console.log(`Cards: ${positions.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
