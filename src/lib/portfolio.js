import { ANSEM_MINT, DEXSCREENER_BASE } from '../constants.js';
import { fetchOpenPositions, getPoolsTvlUsd } from './meteora-api.js';
import { filterToIndex, isIndexPosition } from './ansem-index.js';

export function positionValueUsd(p) {
  const d = p.current_position?.current_deposits;
  if (!d) return 0;
  return (d.amount_x_usd ?? 0) + (d.amount_y_usd ?? 0);
}

export function unclaimedFeesUsd(p) {
  const f = p.current_position?.unclaimed_fees;
  if (!f) return 0;
  return (f.amount_x_usd ?? 0) + (f.amount_y_usd ?? 0);
}

export async function getOpenPositions(wallet) {
  return fetchOpenPositions(wallet, { persist: true });
}

function chunks(xs, n) {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function pickConstituent(p, ansemMint) {
  if (p.token_y?.address === ansemMint) {
    return { constituent: p.token_x, ansem: p.token_y };
  }
  if (p.token_x?.address === ansemMint) {
    return { constituent: p.token_y, ansem: p.token_x };
  }
  return { constituent: p.token_x, ansem: p.token_y };
}

export async function fetchDexBatch(cas) {
  const map = new Map();
  if (cas.length === 0) return map;

  for (const batch of chunks(cas, 30)) {
    const url = `${DEXSCREENER_BASE}/tokens/v1/solana/${batch.join(',')}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ansem-private-node/1.0' },
      });
      if (!res.ok) continue;
      const payload = await res.json();
      const pairs = Array.isArray(payload) ? payload : payload?.pairs ?? [];
      for (const pair of pairs) {
        if (!pair || typeof pair !== 'object') continue;
        const liq = pair.liquidity?.usd ?? -1;
        for (const token of [pair.baseToken, pair.quoteToken]) {
          const ca = token?.address;
          if (!ca || !batch.includes(ca)) continue;
          const prev = map.get(ca);
          if (prev && (prev._liq ?? -1) >= liq) continue;
          const createdAt = pair.pairCreatedAt ? Number(pair.pairCreatedAt) : null;
          const ageMinutes =
            createdAt && createdAt > 0
              ? Math.max(0, (Date.now() - createdAt) / 60_000)
              : null;
          map.set(ca, {
            image_url: pair.info?.imageUrl,
            market_cap: pair.marketCap ?? pair.fdv,
            price_usd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
            volume_24h: pair.volume?.h24,
            price_change_5m: pair.priceChange?.m5,
            price_change_1h: pair.priceChange?.h1,
            price_change_6h: pair.priceChange?.h6,
            price_change_24h: pair.priceChange?.h24,
            pair_created_at: createdAt || undefined,
            age_minutes: ageMinutes != null ? ageMinutes : undefined,
            _liq: liq,
          });
        }
      }
    } catch {
      // best-effort
    }
  }

  const clean = new Map();
  for (const [k, v] of map) {
    const { _liq, ...rest } = v;
    clean.set(k, { ...rest, liquidity_usd: _liq >= 0 ? _liq : undefined });
  }
  return clean;
}

export async function enrichPositions(positions, ansemMint = ANSEM_MINT) {
  const cas = [
    ...new Set(
      positions.map((p) => pickConstituent(p, ansemMint).constituent?.address).filter(Boolean),
    ),
  ];
  const dex = await fetchDexBatch(cas);

  return positions.map((p) => {
    const { constituent, ansem } = pickConstituent(p, ansemMint);
    const e = dex.get(constituent?.address) ?? {};
    return {
      ...p,
      position_value_usd: positionValueUsd(p),
      unclaimed_fees_usd: unclaimedFeesUsd(p),
      constituent_token: constituent,
      ansem_token: ansem,
      ticker: constituent?.symbol || p.pool_name?.split('-')[0] || '?',
      ...e,
    };
  });
}

export async function buildPortfolio(wallet, ansemMint = ANSEM_MINT, opts = {}) {
  const indexOnly = opts.indexOnly !== false; // default: filter to ANSEM index
  const open = await getOpenPositions(wallet);
  let enriched = await enrichPositions(open.positions, ansemMint);
  const allCount = enriched.length;
  if (indexOnly) {
    enriched = filterToIndex(enriched).map((p) => ({ ...p, in_index: true }));
  } else {
    enriched = enriched.map((p) => ({ ...p, in_index: isIndexPosition(p) }));
  }

  // Holder share = this wallet's LP USD ÷ full pool TVL (≠ creator book %).
  const bookTotal = enriched.reduce(
    (s, p) => s + (Number(p.position_value_usd) || 0),
    0,
  );
  const tvlByPool = await getPoolsTvlUsd(
    enriched.map((p) => p.pool_address).filter(Boolean),
  );
  enriched = enriched.map((p) => {
    const value = Number(p.position_value_usd) || 0;
    const tvl = tvlByPool.get(p.pool_address) ?? null;
    const shareOfPool =
      tvl != null && tvl > 0 ? (value / tvl) * 100 : null;
    const sharePct = bookTotal > 0 ? (value / bookTotal) * 100 : 0;
    return {
      ...p,
      pool_tvl_usd: tvl,
      share_of_pool_pct: shareOfPool,
      share_pct: Math.round(sharePct * 10) / 10,
    };
  });

  enriched.sort(
    (a, b) =>
      (b.share_of_pool_pct ?? 0) - (a.share_of_pool_pct ?? 0) ||
      b.position_value_usd +
        b.unclaimed_fees_usd -
        (a.position_value_usd + a.unclaimed_fees_usd),
  );
  const poolSet = new Set(enriched.map((p) => p.pool_address));

  return {
    wallet,
    ansem_mint: ansemMint,
    fetched_at: new Date().toISOString(),
    index_only: indexOnly,
    total_positions_raw: open.total_positions ?? allCount,
    total_positions: enriched.length,
    total_pools: poolSet.size,
    filtered_out: indexOnly ? Math.max(0, allCount - enriched.length) : 0,
    sol_price: open.sol_price,
    totals: open.total,
    positions: enriched,
  };
}
