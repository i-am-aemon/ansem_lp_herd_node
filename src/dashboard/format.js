/**
 * Shared money / pct formatters — black/green Index + LP board language.
 */
export function fmtMoney(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0) return '$0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
  if (a >= 1) return sign + '$' + a.toFixed(2);
  return sign + '$' + a.toFixed(3);
}

export function fmtPct(x, { signed = false } = {}) {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  const n = Number(x);
  const body = n.toFixed(1) + '%';
  if (!signed) return body;
  return (n > 0 ? '+' : '') + body;
}

export function fmtPctChange(x) {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  const n = Number(x);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

export function pctToneClass(x) {
  if (x == null || !Number.isFinite(Number(x)) || Number(x) === 0) return 'muted';
  return Number(x) > 0 ? 'pos' : 'neg';
}

/** Client-side copies (string for injection into <script>). */
export function formatClientJs() {
  return `
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
          return Number(x).toFixed(1) + '%';
        }
        function fmtPctChange(x) {
          if (x == null || !Number.isFinite(Number(x))) return '—';
          const n = Number(x);
          return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
        }
        function pctToneClass(x) {
          if (x == null || !Number.isFinite(Number(x)) || Number(x) === 0) return 'muted';
          return Number(x) > 0 ? 'pos' : 'neg';
        }
`;
}
