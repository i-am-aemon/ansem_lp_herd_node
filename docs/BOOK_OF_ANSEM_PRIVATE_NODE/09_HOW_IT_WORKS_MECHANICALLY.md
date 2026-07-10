# Chapter — How It Works Mechanically

> Read this when you feel confused. This is the operator manual for this private ANSEM Herd cell.

## One sentence

You watch the old book on `/ansem`. You act with a **fresh Phantom wallet** that joins TOKEN–ANSEM pools as LP (coverage-first). The optional local keeper later **claims fees** from those LPs — it does not trade memecoins for you, and it never auto-signs Phantom deposits.

---

## The wallets (do not mix them up)

| Wallet | Who | What you do |
|--------|-----|-------------|
| **Old book** `HpJbzE…` | Existing ~94 positions | **Watch only** on `/ansem`. Never import its private key here. |
| **Node wallet (LP)** | Fresh account in `.env` | **Join pools**, hold LP, run seed/fee loops locally. Testground default: **one wallet** = LP + operator. |
| **ANSEM dest** (optional) | Same pubkey or cold receive-only | Receives bought ANSEM from the fee flywheel. |
| **Keeper keys** (optional) | `LP_PRIVATE_KEY` / `OPERATOR_PRIVATE_KEY` in `.env` | Unattended claim→buy→send only. Never on Railway demo. |

`@i_am_aemon` on `/ansem` = **manual eyes** on the old book.  
Node LP wallet = **hands** that deposit into pools.

---

## Capital policy (locked defaults)

| Rule | Value |
|------|-------|
| SOL gas / operating | **0.02 gas · 0.05 operating · 0.08 target** (`sol-reserve.js`). Never dump all SOL into ANSEM. |
| Universe / sort | **tracked_top10 · dip24** — lowest 24h first; min coverage all 10 before depth |
| Dust | Wallet TOKEN holdings → deposit into LPs (census); do not re-buy blindly |
| Pair minimum (Pass 1) | **5 whole ANSEM** per TOKEN–ANSEM pool (`PAIR_MIN_ANSEM`), plus dual `$1` floor via `resolvePairMinAnsem` |
| Order of work | Buy ANSEM → ranked coverage → depth passes |
| Node scope | A **slice** of the start list — not the full index |
| Per-pool control | **Seed** / **Hold** / **Off** · pin · priority · custom min · force · notes · bulk · sort |

USD in the UI is an estimate only. The accounting unit is whole ANSEM tokens.

---

## What “5 ANSEM into a pool” actually is

You are **not** sending 5 ANSEM to someone.

You open a **Meteora DAMM v2 liquidity position** on a **TOKEN–ANSEM** pool:

```
You give the pool:   TOKEN (ratio-sized)  +  ≥ 5 ANSEM
You receive:         an LP position owned by your Phantom wallet
```

That LP earns trading fees. The keeper’s job later is: **claim those fees → buy more ANSEM → send to dest** (or same wallet in single-wallet mode).

---

## Ranking + passes

1. **Rank** start-list names: prefer **good but down** (negative 6h/24h change) with enough liquidity/volume; skip dead books.
2. **Pass 1 (coverage):** walk the ranked queue; open dual-sided LP at the 5 ANSEM minimum on as many pools as capital allows. Skip pools already at minimum.
3. **Pass 2+ (depth):** same order; add another increment until deployable capital is gone.

`/run` shows **Next action**, Pass 1/2 badges, and IN/NOT IN. `GET /api/seed-plan` returns the ordered buy/deposit checklist — **no auto-sign**.

---

## Lifecycle of one pool (the checklist you will live in)

```
1. NOT IN          → wallet has no LP in this pool yet
2. FUND            → hold SOL (≥ operating 0.05 / target 0.08) + ANSEM + a little TOKEN
3. DEPOSIT         → Phantom approves Meteora add-liquidity (≥ 5 ANSEM dual-sided)
4. IN / MONITOR    → Watch value, fees; doctor / ticks see the position
5. TOP UP (Pass 2) → Optional: deepen along the same ranked line
6. EXIT (sell)     → Withdraw LP on Meteora (get TOKEN + ANSEM back)
                     THEN sell TOKEN and/or ANSEM on Jupiter if you want cash/SOL
```

**Important:** “Sell” is **two steps**. Closing the LP is not the same as selling the tokens.

---

## Why this feels heavy (100s of pools)

The old book has **~94** pools. You do **not** need this node in all of them.

| Set | Count | Role |
|-----|-------|------|
| Old book | ~94 | Watchlist (`/ansem`) |
| Start list | ~25 | Sandbox — ranked coverage first |
| Later | winners / depth | Pass 2+ top-ups; exit what dies |

A node is a **node**, not the full index. Auto-deposit of all 94 pools is an explicit non-goal.

---

## Day-to-day mechanical loop (pre-launch)

### A. Setup once

1. Create a **fresh** LP wallet (not your main savings).
2. Put `LP_WALLET_PUBLIC_KEY` + `LP_PRIVATE_KEY` + `DASHBOARD_PASSWORD` in `.env` (`chmod 600`).
3. Fund the wallet with SOL you intend to deploy (keep operating floor).
4. Optional: set ANSEM dest.
5. Keep dry-run on until claims look right.

### B. Seed (coverage-first)

1. Open `/run` — see ranked **Next action**.
2. Buy ANSEM with deployable SOL (leave operating floor / rent).
3. For each Pass 1 row: buy TOKEN if needed → Meteora deposit ≥ 5 ANSEM dual-sided.
4. When capital cannot fund another minimum, stop Pass 1; start Pass 2 if you still have deployable capital.

### C. Monitor

- `/ansem` — old book health (Creator = % of book · Holder = % of pool TVL).
- `/run` — your coverage vs start list + ranked queue.
- `npm run doctor` / dry tick — keeper can see the LP wallet.
- Logs — `logs/tx.sqlite` + `logs/tx.jsonl`.

### D. Exit / take out / close (fund control)

Use **`/run`** (Ch.10) — not ad-hoc links only:

1. **Take % out** — withdraw N% of an LP → optional sell → route proceeds.
2. **Close** — 100% exit + `mode=off` + optional redirect to another name.
3. **Point future** — set target weight so Pass 2 / reinvest prefer that pool.

Manual Meteora/Jupiter links still work; the run desk builds the ordered plan.

### E. Fees (after you have LPs)

Keeper (dry first) splits claimed fees on Setup `/#config` (Ch.3).  
LP book steering is separate — Ch.10 / `/run`.

Ranking is deterministic rules (APE + buy-the-dip) — not ML.

---

## Security (short)

- Never paste a seed phrase or private key into the browser seeder.
- Phantom holds keys; the site plans and deep-links; you approve every tx.
- Old book never signs on this node.
- Railway never gets private keys.

Full protocols: `/whitepaper` Part 2 + Security. Seed: [`docs/SEED_POOLS.md`](../SEED_POOLS.md). Fund: [Ch.10](10_FUND_CONTROL.md).

---

## Mental model (if you only remember four things)

1. **Old book = eyes. Phantom node = hands.**
2. **0.02 gas · 0.05 operating · 5 ANSEM min per pair · coverage then depth.**
3. **Fee flywheel ≠ LP book** — fees on Setup `/`, book on `/run`.
4. **A node is a slice — take % / close / point future; never auto-sign without Phantom.**
