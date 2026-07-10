/**
 * Patient RPC — micro_trader-style pacing.
 * - Serial gate (one in-flight RPC at a time)
 * - Min delay between calls (default 400ms) so public endpoints don't 429
 * - Global cooldown after 429
 * - Exponential backoff on retry: 1s, 2s, 4s… cap 30s (quote ladder optional)
 */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isRateLimit(err) {
  const s = String(err?.message || err || '');
  return /429|Too Many Requests|rate limit|compute units|throttl/i.test(s);
}

export function isTransientRpc(err) {
  const s = String(err?.message || err || '');
  return (
    isRateLimit(err) ||
    /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|503|502|504|blockhash not found/i.test(
      s,
    )
  );
}

function envNum(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Min gap between RPC calls (ms). micro_trader ~100–500ms. */
export function rpcMinDelayMs() {
  return envNum('RPC_MIN_DELAY_MS', 400);
}

/** Extra pause after a 429 before anything else runs (ms). */
export function rpcCooldownMs() {
  return envNum('RPC_COOLDOWN_MS', 2000);
}

/**
 * Seconds to wait before retry attempt index (0-based after failure).
 * patient=true → micro_trader quote-ish: 3, 6, 12, 24… (seed loop)
 * patient=false → holdings-style: 1, 2, 4… (UI / balance reads)
 */
export function backoffSeconds(attempt, { patient = false } = {}) {
  const max = envNum('RPC_MAX_BACKOFF_SEC', 30);
  if (patient) {
    // micro_trader quote: (2**attempt)*3
    return Math.min(max, (2 ** attempt) * 3);
  }
  // micro_trader post_json_rpc / holdings: 0.5*(2**n) → use 1*(2**n) floor 1s
  return Math.min(max, Math.max(1, 2 ** attempt));
}

let _chain = Promise.resolve();
let _lastStart = 0;
let _cooldownUntil = 0;

/** Force a global quiet period (e.g. after 429). */
export function noteRpcCooldown(ms) {
  const wait = Math.max(0, Number(ms) || rpcCooldownMs());
  _cooldownUntil = Math.max(_cooldownUntil, Date.now() + wait);
}

/**
 * Serialize RPC work + enforce min spacing (prevents public-RPC stampedes).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ label?: string }} [opts]
 * @returns {Promise<T>}
 */
export function rpcGate(fn, opts = {}) {
  const label = opts.label || 'rpc';
  const run = _chain.then(async () => {
    const now = Date.now();
    const gap = rpcMinDelayMs();
    const waitGap = Math.max(0, _lastStart + gap - now);
    const waitCd = Math.max(0, _cooldownUntil - Date.now());
    const wait = Math.max(waitGap, waitCd);
    if (wait > 0) await sleep(wait);
    _lastStart = Date.now();
    try {
      return await fn();
    } catch (e) {
      if (isRateLimit(e)) {
        const cool = Math.max(rpcCooldownMs(), backoffSeconds(0) * 1000);
        noteRpcCooldown(cool);
        if (process.env.RPC_DEBUG === '1') {
          console.warn(`[rpc] 429 cooldown ${cool}ms · ${label}`);
        }
      }
      throw e;
    }
  });
  // Keep chain alive even if this call fails
  _chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, label?: string, patient?: boolean, onRetry?: (info: object) => void }} [opts]
 * @returns {Promise<T>}
 */
export async function withRpcRetry(fn, opts = {}) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || envNum('RPC_MAX_ATTEMPTS', 6));
  const label = opts.label || 'rpc';
  const patient = opts.patient === true;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await rpcGate(() => fn(), { label });
    } catch (e) {
      lastErr = e;
      const transient = isTransientRpc(e);
      if (!transient || attempt >= maxAttempts - 1) throw e;
      const waitSec = backoffSeconds(attempt, { patient });
      if (isRateLimit(e)) noteRpcCooldown(waitSec * 1000);
      if (typeof opts.onRetry === 'function') {
        opts.onRetry({
          attempt: attempt + 1,
          maxAttempts,
          waitSec,
          label,
          rate: isRateLimit(e),
          error: String(e?.message || e).slice(0, 160),
        });
      } else if (process.env.RPC_DEBUG === '1') {
        console.warn(`[rpc] retry ${label} in ${waitSec}s (try ${attempt + 1}/${maxAttempts})`);
      }
      await sleep(waitSec * 1000);
    }
  }
  throw lastErr;
}
