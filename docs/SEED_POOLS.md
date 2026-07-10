# How to seed pools (APE + top-10 dip)

~$10 smoke: use a **fresh LP wallet** in `.env`, keep an **operating SOL floor** (default **0.05 SOL**, gas floor **0.02**), buy **ANSEM** (capped so rent remains), cover **top 10** buy-the-dip names (+ **APE** if a TOKEN–ANSEM pair is &lt;15m). `CONTROLLER_WALLET` is RO reference. Never paste a private key in chat.

## Critical: do not dump all SOL into ANSEM

Meteora deposits need spare SOL for **ATA + position NFT rent** (~0.008 SOL per new pair). If you swap almost everything to ANSEM and leave ~0.005 SOL, the node **cannot** open LPs — and may not even be able to sell ANSEM→SOL for a top-up (Jupiter still needs rent/fees).

| Floor | Default | Meaning |
|-------|---------|---------|
| `SOL_RESERVE` (gas) | **0.02** | Never spend below this |
| `SOL_OPERATING_FLOOR` | **0.05** | Block new ATA/buys; prefer `topup_sol` |
| `SOL_TARGET_RESERVE` | **0.08** | After auto ANSEM→SOL recovery |
| `SOL_RENT_PER_PAIR` | **0.008** | Left behind by capped `buy_ansem` |

Automated seed (`npm run seed` / ▶ on `/run`) sizes `buy_ansem` with `sizeBuyAnsem` and, if SOL dips below the operating floor, emits **`topup_sol`** (sell a slice of ANSEM→SOL) before more buys/deposits. **If SOL is already critically low (~&lt;0.01) with no free rent, send ~0.05–0.1 SOL manually** — that is the predictable trap for node operators.

## What “5 ANSEM into the pool” means

You are **not** sending 5 ANSEM to a wallet. You are opening a **Meteora DAMM v2 LP position** on a TOKEN–ANSEM pool.

For each pool you deposit **both sides** (dual-sided):

| Side | What | Target (Pass 1) |
|------|------|-----------------|
| ANSEM | `$ANSEM` mint | **≥ 5 whole ANSEM** (`PAIR_MIN_ANSEM`) |
| TOKEN | BIF, LIFE, CASHCAT, … | Sized to current pool ratio |

Meteora sets the exact TOKEN:ANSEM ratio from the live price. USD in the UI is an estimate only.

**ANSEM mint:** `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`

## Capital rules

1. `effectiveReserve = max(SOL_RESERVE, balance × RESERVE_PCT)`; `deployable = max(0, balance − effectiveReserve)`.
2. Jupiter: swap **capped** deployable → ANSEM — leave `max(operating floor, rent × active pairs)`.
3. If `SOL < SOL_OPERATING_FLOOR` and free ANSEM remains → **`topup_sol`** (ANSEM→SOL) before more work.
4. **APE:** pair age &lt; 15m → jump queue (immediate Next).
5. **Pass 1:** buy-the-dip top `NODE_ACTIVE_LIMIT` (default 10) — 5 ANSEM min each.
6. **Pass 2+:** same order, deepen until capital is exhausted.
7. Full 25-name start list is the index gate; a node is a **slice**.

## Setup

1. Copy `.env.example` → `.env`. Set `LP_WALLET_PUBLIC_KEY` + `LP_PRIVATE_KEY` + `DASHBOARD_PASSWORD` (`chmod 600 .env`).
2. Fund that wallet with SOL you intend to deploy (keep operating floor).
3. Open `/run` — ranked queue + **Next action**. Or call `GET /api/seed-plan?wallet=<pubkey>`.
4. Dry first (`DRY_RUN=true`). Live only when proven.

Never paste keys in chat, forms, or Railway demo vars.

Single-wallet mode: LP = operator = same pubkey; sweep is a no-op.

## Join one pool (repeat per ranked row)

1. Open the pool: `https://app.meteora.ag/pools/<POOL_CA>` (or `/run` / `/pool` links).
2. **Deposit / Add liquidity** — dual-sided TOKEN + ANSEM.
3. Size so the ANSEM side is **≥ 5 whole ANSEM** (`PAIR_MIN_ANSEM`).
4. Confirm. Position is owned by that wallet.
5. Check: `npm run doctor` or dry tick.

## Join the start list (coverage pass)

Start list = 25 nodes in `src/lib/ansem-index.js` (also via whitepaper facade). You do **not** need every row on day one — stop when deployable capital cannot fund another minimum.

Practical order:

1. Fund · leave ≥0.05 SOL operating (gas floor 0.02).
2. Buy ANSEM with deployable SOL.
3. Follow `/run` ranked Pass 1: Jupiter-buy TOKEN if needed → Meteora deposit → next.
4. Pass 2 only after coverage stops.

## What the node software does vs you

| You | Software |
|-----|----------|
| Own LP key in `.env` | Ranking + seed plan |
| Approve / fund live runs | `/api/seed-plan` ordered actions |
| Pick when to stop | Pass 1/2 badges on `/run` |
| — | Optional keeper: claim fees, buy ANSEM, log to `logs/tx.sqlite` |

Auto-deposit without your intent is an **explicit non-goal** for demo / dry modes.

## Verify

```bash
npm run doctor    # LP positions count
npm run dry       # tick sees LP wallet (may be $0 fees at first)
npm run alignment # public surface contract
```

`/ansem` still shows the **old book**. Your new positions show on `/run` and doctor.
