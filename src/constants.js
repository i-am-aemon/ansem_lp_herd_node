/** $ANSEM — The Black Bull */
export const ANSEM_MINT = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';

/**
 * @i_am_aemon map / controller book (read-only).
 * Hardcoded — not an env knob. Nodes copycat this pubkey’s TOKEN–ANSEM LPs.
 * Never import its private key into this process.
 */
export const CONTROLLER_WALLET = 'HpJbzERP44V21mKGRDDUArb9JJaL9NdPSgXzZ9uyieVB';

/** Old book / /ansem eyes — same as controller map wallet. */
export const OLD_BOOK_WALLET = CONTROLLER_WALLET;

/**
 * Default donate destination for the creator fam (@i_am_aemon / map book).
 * Override with AEMON_DONATE_WALLET — never the signing key for this node.
 */
export const AEMON_DONATE_WALLET = CONTROLLER_WALLET;

export const INDEX_NAME = 'ANSEM Liquidity Pool Herd';
export const INDEX_TOKEN_SYMBOL = 'HERD';
/** $HERD mint when live — override with HERD_MINT / INDEX_TOKEN_MINT */
export const INDEX_TOKEN_MINT = '';

/**
 * HERD–ANSEM Meteora pool (the key market every node should join when live).
 * Set HERD_POOL / INDEX_POOL_ADDRESS. Placeholder until launch.
 */
export const HERD_POOL_PLACEHOLDER = 'XXXXXXXXXXXX';
export const INDEX_POOL_ADDRESS = '';

export function isHerdPoolLive(addr = process.env.HERD_POOL || process.env.INDEX_POOL_ADDRESS || INDEX_POOL_ADDRESS) {
  const a = String(addr || '').trim();
  return Boolean(a) && a !== HERD_POOL_PLACEHOLDER && !/^X+$/i.test(a) && a.length >= 32;
}

/** DAMM v2 Data API — https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview */
export const METEORA_DAMM_V2_BASE = 'https://damm-v2.datapi.meteora.ag';
export const DEXSCREENER_BASE = 'https://api.dexscreener.com';
export const NODE_MIN_USD = 1;

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Estimated SOL cost per claim + sweep + swap tick */
export const ESTIMATED_GAS_SOL = 0.003;

export const ROUTE_TYPES = {
  /** Jupiter SOL→ANSEM, then SPL transfer to ANSEM_DEST_WALLET */
  JUPITER_BUY_SEND: 'jupiter_buy_send',
  /** Jupiter SOL→token, hold on operator */
  JUPITER_BUY_HOLD: 'jupiter_buy_hold',
  /** Jupiter SOL→$ANSEMINDEX, then SPL burn */
  JUPITER_BURN: 'jupiter_burn',
  /** Native SOL transfer to aemon / creator-fam wallet */
  DONATE_SOL: 'donate_sol',
  /** Keep SOL on operator for gas / future reinvest */
  SOL_RESERVE: 'sol_reserve',
  /** Re-add liquidity to Meteora (manual / Phase C) */
  METEORA_REINVEST: 'meteora_reinvest',
};
