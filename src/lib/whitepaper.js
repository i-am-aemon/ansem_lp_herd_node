import {
  START_LIST,
  INDEX_CONSTITUENT_COUNT,
  INDEX_VISION,
  startListFloorUsd,
  NODE_ACTIVE_LIMIT_DEFAULT,
} from './ansem-index.js';

export {
  START_LIST,
  INDEX_CONSTITUENT_COUNT,
  INDEX_VISION,
  startListFloorUsd,
  isIndexPool,
  isIndexPosition,
  filterToIndex,
  findConstituent,
  effectiveStartList,
  herdPoolRow,
  resolveHerdPool,
  resolveHerdMint,
} from './ansem-index.js';

/** One-form ANSEM Index — matches Setup: HERD LP · one .env · cover then deepen. */
export const WHITEOBER_VERSION = 'v1.1-oneform';
export const WHITEOBER_TITLE = 'ANSEM Index';

/** Public fork target (ansemlp_index_node redirects here). Never the private working cell. */
export const PUBLIC_GITHUB =
  'https://github.com/i-am-aemon/ANSEM_LP_HERD_Node';

/** Public site + whitepaper — prefer www. */
export const PUBLIC_SITE = 'https://www.ansemlp.fun';
export const PUBLIC_WHITEPAPER = `${PUBLIC_SITE}/whitepaper`;

/** Whole ANSEM tokens required per TOKEN–ANSEM pair (Pass 1 / HODL ticket). */
export const PAIR_MIN_ANSEM = 5;

/** Gas floor — never spend below this. */
export const SOL_RESERVE = 0.02;

/** Block new ATA / buys below this; trigger ANSEM→SOL top-up. */
export const SOL_OPERATING_FLOOR = 0.05;

/** Target after topup_sol recovery. */
export const SOL_TARGET_RESERVE = 0.08;

/** Estimated SOL rent per new pair (ATA + position NFT). */
export const SOL_RENT_PER_PAIR = 0.008;

/** effectiveReserve = max(SOL_RESERVE, wallet × RESERVE_PCT). */
export const RESERVE_PCT = 0.05;

/** Default leave-in on take-out (~10%). Close = 100%. */
export const LEAVE_IN_POOL_PCT = 10;

/** Dollar floor stub left in a pool when trimming. */
export const LEAVE_IN_POOL_MIN_USD = 1;

/**
 * One-form steps — same spine as Setup.
 * Keys → reserve → buy ANSEM → cover → deepen → fees.
 */
export const PART1_FLOW = [
  {
    id: 'what',
    n: 0,
    title: 'ANSEM Liquidity Pool · HERD LP',
    body: `You do not need a bot. Manual LP on Meteora is enough. This node is advanced optional tooling — fork it, guide a community cell, or run alone. You keep the key. Capital seeds only the ${INDEX_CONSTITUENT_COUNT}-name ANSEM index (TOKEN–ANSEM pools) — not all of Meteora. When HERD is live, every node joins HERD_POOL. On Run, the green agent deepens toward Holder Pools targets (targetWeightPct). Not a custodian.`,
  },
  {
    id: 'keys',
    n: 1,
    title: 'One .env (or Railway Variables)',
    body: 'Fresh LP wallet. Set LP_WALLET_PUBLIC_KEY + LP_PRIVATE_KEY + DASHBOARD_PASSWORD. Never paste a seed or private key into the browser. Controller / old book (HpJbzE…) is read-only — never import its key.',
  },
  {
    id: 'capital',
    n: 2,
    title: 'Reserve SOL · buy ANSEM (capped)',
    body: `Keep ≥${SOL_OPERATING_FLOOR} SOL operating (gas floor ${SOL_RESERVE}). Buy ANSEM with the rest, leaving rent (~${SOL_RENT_PER_PAIR}/pair). If SOL dips below the floor, top up via ANSEM→SOL.`,
  },
  {
    id: 'cover',
    n: 3,
    title: 'Cover mins · then deepen (HODL)',
    body: `Pass 1: hit ≥${PAIR_MIN_ANSEM} ANSEM per pair on the top NODE_ACTIVE_LIMIT (default ${NODE_ACTIVE_LIMIT_DEFAULT}) ranked names (+ APE <15m). Pass 2+: same order, only add — never shrink. Full ${INDEX_CONSTITUENT_COUNT}-list is the index gate; a node is a slice.`,
  },
  {
    id: 'fees',
    n: 4,
    title: 'Claim · split on Config',
    body: 'Fee mix on Setup/Config: HERD Token %, Reserve ANSEM %, Reserve SOL %, Pools %. Normalizes to 100%. Optional burn / donate when those legs are on.',
  },
  {
    id: 'run',
    n: 5,
    title: 'Run',
    body: '▶ Run: Start keeps the node running until Shut down. Terminal + SQLite tx log on the same page; CSV download at the bottom. Dry-run until proven, then DRY_RUN=false SIMULATION_MODE=false. Kill switch: move funds out of the node wallet.',
  },
];

/** Short custody — kept for server import compatibility. */
export const PART2_CUSTODY = [
  {
    id: 'who-runs',
    title: 'Who runs',
    body: 'LP wallet + LP private key. That pubkey owns Meteora positions. Controller and tracked wallets are eyes only.',
  },
  {
    id: 'env-path',
    title: 'Secrets stay in env',
    body: 'Keys live in .env or Railway Variables. DASHBOARD_PASSWORD unlocks Config. chmod 600. Never commit.',
  },
];

/** Non-negotiables only. */
export const SECURITY_PROTOCOLS = [
  {
    id: 'verify-url',
    title: 'Verify the URL',
    body: 'Only on localhost or your own deploy. This app never asks for a seed phrase.',
  },
  {
    id: 'no-paste',
    title: 'Never paste keys in the browser',
    body: 'Private keys go in .env / Railway Variables only.',
  },
  {
    id: 'fresh-wallet',
    title: 'Fresh wallet',
    body: `Fund only what you intend to deploy. Keep ≥${SOL_OPERATING_FLOOR} SOL after deploys.`,
  },
  {
    id: 'kill-switch',
    title: 'Kill switch',
    body: 'Move funds out of the node wallet. Revoke site permissions if the URL changes.',
  },
];

export const CAPITAL_POLICY = [
  {
    id: 'smoke',
    title: 'Smoke capital',
    body: INDEX_VISION.smokeTest,
  },
  {
    id: 'index-only',
    title: 'Index-only universe',
    body: `Deploy and sync only the ANSEM index start list (${INDEX_CONSTITUENT_COUNT} TOKEN–ANSEM pools). We do not scrape all Meteora pools.`,
  },
  {
    id: 'passes',
    title: 'Coverage then depth',
    body: `Pass 1: mins on active ranked pools. Pass 2+: same order, add until capital is gone. HODL — only add.`,
  },
];

export const PARTS = [
  {
    id: 'part-1',
    label: 'Flow',
    blurb: `One .env → ≥${SOL_OPERATING_FLOOR} SOL → buy ANSEM → cover → deepen → fees.`,
  },
  {
    id: 'part-2',
    label: 'Custody',
    blurb: 'LP key in .env. Old book RO. Controller RO.',
  },
];
