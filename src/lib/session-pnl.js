/**
 * Session PnL baseline — micro_trader usd_ledger bone (level, not ML).
 */
let _baseline = null;

export function startSession(totalUsd, meta = {}) {
  _baseline = {
    at: new Date().toISOString(),
    totalUsd: Number(totalUsd) || 0,
    ...meta,
  };
  return _baseline;
}

export function getSessionBaseline() {
  return _baseline;
}

export function resetSession() {
  _baseline = null;
}

/**
 * @returns {{ code: string, pnl: number, pct: number|null, baseline: object|null, current: number }}
 */
export function sessionPnl(currentUsd) {
  const current = Number(currentUsd) || 0;
  if (!_baseline) {
    return { code: 'NO_BASELINE', pnl: 0, pct: null, baseline: null, current };
  }
  const base = _baseline.totalUsd || 0;
  const pnl = current - base;
  const pct = base > 0 ? pnl / base : null;
  return {
    code: 'SESSION_OK',
    pnl,
    pct,
    baseline: _baseline,
    current,
  };
}

export function printSessionPnl(currentUsd) {
  const s = sessionPnl(currentUsd);
  if (s.code === 'NO_BASELINE') {
    console.log('SESSION_PNL: no baseline yet');
    return s;
  }
  const pctStr =
    s.pct != null ? ` (${(s.pct * 100).toFixed(1)}%)` : '';
  console.log(
    `SESSION_PNL: $${s.pnl.toFixed(2)}${pctStr} · mark $${s.current.toFixed(2)} vs start $${s.baseline.totalUsd.toFixed(2)}`,
  );
  return s;
}
