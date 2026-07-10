/**
 * Structured logging
 * - logs/events.jsonl  — phase/debug lines (grep)
 * - logs/tx.sqlite     — typed transaction feed for /run (resettable)
 * - logs/tx.jsonl      — mirror append for grepping (optional)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EVENTS_PATH = path.join(ROOT, 'logs', 'events.jsonl');
const TX_PATH = path.join(ROOT, 'logs', 'tx.jsonl');
const TX_DB_PATH = path.join(ROOT, 'logs', 'tx.sqlite');

const RING_MAX = 500;
const _txRing = [];
let _tickSeq = 0;
let _currentTickId = null;
let _txSeq = 0;
let _db = null;

export function newTickId() {
  _currentTickId = `t${Date.now().toString(36)}${(_tickSeq++ % 1000).toString(36).padStart(2, '0')}`;
  return _currentTickId;
}

export function currentTickId() {
  return _currentTickId;
}

function ensureLogsDir() {
  const dir = path.join(ROOT, 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTxDb() {
  if (_db) return _db;
  ensureLogsDir();
  _db = new DatabaseSync(TX_DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS txs (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      tick_id TEXT,
      cell_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      usd REAL,
      min_usd REAL,
      ticker TEXT,
      sig TEXT,
      did TEXT,
      delta REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_txs_ts ON txs(ts);
  `);
  return _db;
}

function appendJsonl(filePath, row) {
  ensureLogsDir();
  fs.appendFileSync(filePath, JSON.stringify(row) + '\n');
}

function emit(level, message, fields = {}) {
  const row = {
    ts: new Date().toISOString(),
    level,
    message,
    tick_id: fields.tick_id ?? _currentTickId ?? null,
    cell_id: fields.cell_id ?? null,
    ...fields,
  };
  row.level = level;
  try {
    appendJsonl(EVENTS_PATH, row);
  } catch {
    /* never break the loop on log write */
  }

  const prefix = `[${fields.component || 'node'}]`;
  const detail = fields.phase ? ` ${fields.phase}/${fields.action || ''}` : '';
  const codeBit = fields.code ? ` ${fields.code}` : '';
  const human = `${prefix}${detail}${codeBit} ${message}`;
  if (level === 'error') console.error(human, fields.sig || fields.detail || '');
  else if (level === 'warn') console.warn(human, fields.detail || '');
  else console.log(human, fields.usd != null ? `$${Number(fields.usd).toFixed(2)}` : '');

  return row;
}

export function logInfo(message, fields = {}) {
  return emit('info', message, fields);
}

export function logWarn(message, fields = {}) {
  return emit('warn', message, fields);
}

export function logError(message, fields = {}) {
  return emit('error', message, fields);
}

/** Phase transition within a tick (probe, claim, sweep, route, leg, summary, seed, fund). */
export function logPhase(phase, action, fields = {}) {
  const level = fields.level || 'info';
  return emit(level, `${phase} ${action}`, {
    event: 'phase',
    component: fields.component || 'keeper',
    phase,
    action,
    ...fields,
    level,
  });
}

/** End-of-tick aggregate — filter key event:"tick_summary". */
export function tickSummary(tickId, fields = {}) {
  return logInfo('tick summary', {
    event: 'tick_summary',
    component: 'keeper',
    tick_id: tickId,
    ...fields,
  });
}

function insertTxRow(row) {
  try {
    getTxDb()
      .prepare(
        `INSERT OR REPLACE INTO txs
         (id, ts, tick_id, cell_id, kind, status, usd, min_usd, ticker, sig, did, delta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.ts,
        row.tick_id,
        row.cell_id,
        row.kind,
        row.status,
        row.usd,
        row.min_usd,
        row.ticker,
        row.sig,
        row.did,
        row.delta,
      );
  } catch (e) {
    console.warn('[tx] sqlite write failed', e?.message || e);
  }
}

/**
 * Typed transaction row for the graphical /run feed.
 */
export function logTx(fields = {}) {
  const id = `tx${Date.now().toString(36)}${(_txSeq++ % 1000).toString(36).padStart(2, '0')}`;
  const row = {
    id,
    ts: new Date().toISOString(),
    tick_id: fields.tick_id ?? _currentTickId ?? null,
    cell_id: fields.cell_id ?? null,
    kind: String(fields.kind || 'skip'),
    status: fields.status != null ? String(fields.status) : 'ok',
    usd: fields.usd != null && Number.isFinite(Number(fields.usd)) ? Number(fields.usd) : null,
    min_usd:
      fields.min_usd != null && Number.isFinite(Number(fields.min_usd))
        ? Number(fields.min_usd)
        : null,
    ticker: fields.ticker != null ? String(fields.ticker) : null,
    sig: fields.sig != null ? String(fields.sig) : null,
    did: fields.did != null ? String(fields.did) : '',
    delta: Number.isFinite(Number(fields.delta)) ? Number(fields.delta) : 0,
  };

  _txRing.push(row);
  while (_txRing.length > RING_MAX) _txRing.shift();

  insertTxRow(row);
  try {
    appendJsonl(TX_PATH, row);
  } catch {
    /* mirror is best-effort */
  }

  const sign =
    row.delta > 0 ? '+' : row.delta < 0 ? '-' : row.kind === 'claim' && row.status === 'ok' ? '+' : '·';
  const usdBit = row.usd != null ? ` $${Number(row.usd).toFixed(2)}` : '';
  console.log(`[tx] ${sign}${row.kind} ${row.status}${usdBit} ${row.did || ''}`.trim());

  return row;
}

function mapDbRow(r) {
  return {
    id: r.id,
    ts: r.ts,
    tick_id: r.tick_id,
    cell_id: r.cell_id,
    kind: r.kind,
    status: r.status,
    usd: r.usd,
    min_usd: r.min_usd,
    ticker: r.ticker,
    sig: r.sig,
    did: r.did || '',
    delta: Number(r.delta) || 0,
  };
}

function queryTxFromDb({ since = 0, limit = 80, kind, tickId } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 80), 50_000);
  const clauses = [];
  const params = [];
  if (since) {
    clauses.push('ts >= ?');
    params.push(new Date(Number(since)).toISOString());
  }
  if (kind) {
    clauses.push('kind = ?');
    params.push(kind);
  }
  if (tickId) {
    clauses.push('tick_id = ?');
    params.push(tickId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(lim);
  try {
    const rows = getTxDb()
      .prepare(
        `SELECT * FROM (
           SELECT * FROM txs ${where} ORDER BY ts DESC LIMIT ?
         ) ORDER BY ts ASC`,
      )
      .all(...params);
    return rows.map(mapDbRow);
  } catch {
    return [];
  }
}

/**
 * Recent tx rows (newest last). SQLite is source of truth; ring is hot cache.
 */
export function queryTx({ since = 0, limit = 80, kind, tickId } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 80), RING_MAX);
  if (!since && !kind && !tickId && _txRing.length) {
    return _txRing.slice(-lim);
  }
  const fromDb = queryTxFromDb({ since, limit: lim, kind, tickId });
  if (fromDb.length) {
    if (!_txRing.length) {
      for (const r of fromDb.slice(-RING_MAX)) _txRing.push(r);
    }
    return fromDb;
  }
  return _txRing.filter((r) => {
    if (since && r.ts) {
      const t = Date.parse(r.ts);
      if (Number.isFinite(t) && t < since) return false;
    }
    if (kind && r.kind !== kind) return false;
    if (tickId && r.tick_id !== tickId) return false;
    return true;
  }).slice(-lim);
}

export function exportTxJsonl(limit = 5000) {
  return queryTxFromDb({ limit: Math.min(Math.max(1, Number(limit) || 5000), 50_000) });
}

export function exportTxCsv(limit = 5000) {
  const rows = exportTxJsonl(limit);
  const header = [
    'id',
    'ts',
    'kind',
    'status',
    'ticker',
    'usd',
    'delta',
    'did',
    'sig',
    'tick_id',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.ts,
        r.kind,
        r.status,
        r.ticker,
        r.usd,
        r.delta,
        r.did,
        r.sig,
        r.tick_id,
      ]
        .map((v) => {
          const s = v == null ? '' : String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** Clear SQLite + ring (+ archive jsonl). Called on Start so the terminal resets. */
export function resetTxLog() {
  _txRing.length = 0;
  try {
    getTxDb().exec('DELETE FROM txs');
  } catch (e) {
    console.warn('[tx] sqlite reset failed', e?.message || e);
  }
  try {
    ensureLogsDir();
    if (fs.existsSync(TX_PATH)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(TX_PATH, path.join(ROOT, 'logs', `tx.${stamp}.jsonl.bak`));
    }
  } catch {
    try {
      fs.writeFileSync(TX_PATH, '');
    } catch {
      /* ignore */
    }
  }
  return { ok: true, backend: 'sqlite', path: TX_DB_PATH };
}

export function getTxBackend() {
  return { backend: 'sqlite', path: TX_DB_PATH, mirror: TX_PATH };
}

export { EVENTS_PATH, TX_PATH, TX_DB_PATH };
