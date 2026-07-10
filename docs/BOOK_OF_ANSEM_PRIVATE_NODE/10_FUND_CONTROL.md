# Chapter 10 — Fund Control

> You are not only seeding pools. You are **running a fund**: manage LP book portions, take capital out, close names, and point future money where you want it.

Confused about deposits? Read [Ch.9](09_HOW_IT_WORKS_MECHANICALLY.md). This chapter is the **outbound + steering** plane. The UI lives on **`/run`** (legacy `/fund` redirects there).

---

## Two capital planes

| Plane | Question | Where you set it |
|-------|----------|------------------|
| **Fee flywheel** | Where do *claimed fees* go? | Setup `/#config` — ANSEM / burn / donate aemon / reserve / reinvest |
| **LP book** | Where does *deployed capital* sit, and where should *future* capital go? | `/run` — weights, take %, close, redirect |

```
Inbound:  claimed fees ──► fee flywheel portions
          fresh SOL    ──► LP book (seed / Pass 2)

Outbound: LP book ──► take % out ──► proceeds (reserve / ANSEM / aemon / redeploy)
          LP book ──► close pool ──► mode=off (+ optional redirect)

Steering: target weights + pin ──► seed-plan / Pass 2 / reinvest proposals
```

---

## Definitions (memorize these)

| Term | Meaning |
|------|---------|
| **Book value** | Sum of node-wallet LP USD across start-list pools |
| **Weight** | `pool_value / book_value` (current share) |
| **Target weight** | Your intent for *future* capital (0–100% of book; null = ranker discretion) |
| **Gap** | `target − current` — positive = underweight (needs capital); negative = overweight (candidate to take out) |
| **Redirect** | When a pool is closed/off, future capital that would have hit it goes to another key |

Target weights on active names should sum to ≤ 100%. Remainder = unassigned / ranker discretion.

---

## Meteora is the book (API + local cache)

Fund control is **Meteora DAMM v2 pool management**. Live data comes from their Data API; we keep a local copy so `/run` stays fast and works offline briefly.

| Source | What |
|--------|------|
| `GET https://damm-v2.datapi.meteora.ag/wallets/{w}/open_positions` | Your LP positions (book value) |
| `GET https://damm-v2.datapi.meteora.ag/pools/{address}` | Pool TVL, volume, fees, blacklist |
| `@meteora-ag/cp-amm-sdk` `getWithdrawQuote` / `removeLiquidity` | Take-% quotes + unsigned withdraw txs |
| Disk | `data/meteora/` — refreshed by `npm run meteora:sync` or **Sync pools** on `/run` |

Docs: [DAMM v2 Data API](https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview) · rate limit **10 RPS**.

---

## Operator verbs

### 1. Take % out

**Default: take ~90% / leave ~10% in the pool** (`LEAVE_IN_POOL_PCT=10`). Follow the controller book — trim losers, don’t wipe the LP unless you **Close**.

Shrink one LP by N% (e.g. 90% of RIF):

1. Meteora **withdraw** ~N% of the position.
2. Optional: Jupiter **sell** TOKEN (and ANSEM if you want cash) → SOL.
3. Route proceeds per fund policy: reserve · buy ANSEM · donate aemon · **redeploy** to a chosen pool.

Default proceeds: **operator reserve (SOL)**.

**Follow controller (mirror):** if they hold ~15% BIF, our `targetWeightPct` for BIF = 15. Seed adds toward underweight; when they trim / we overweight, `/run` proposes take-out (leave ~10% stub). Sync: **Sync ctrl weights** or seed pass auto-sync.

### 2. Close pool

Full exit = take out 100%, then:

- Set `mode=off` (no new deposits).
- If `redirectTo` is set, future capital that would have hit this name goes there.
- Row stays visible for history / re-seed later.

### 3. Point future funds here

Set **target weight** + optional **pin** on a name. Pass 2 / seed-plan / reinvest proposals prefer **positive gap** (underweight) pools, then ranker score.

Hold = keep existing LP, no new. Off = skip. Point here = actively pull future capital.

---

## Worked examples

**Take 25% out of LIFE**

- Book has LIFE at $40 of $200 (20% weight).
- Take 25% → withdraw ~$10 LP → sell → ~$10 SOL to reserve.
- LIFE weight falls; gap vs target updates on `/run`.

**Close SCAM, point future to manlet**

- Close SCAM → withdraw 100% → `mode=off` → `redirectTo=manlet`.
- Next Pass 2 / reinvest proposals skip SCAM and boost manlet.

**Fee 10% reinvest follows weights**

- `FEE_SPLIT_REINVEST=0.10` and `reinvestFollowsWeights=true`.
- Dry tick **proposes** dual-sided adds toward underweight targets (no auto-deposit this pass).

---

## Lifecycle

```
NOT IN ──deposit──► IN
  IN ──take % out──► IN (smaller)
  IN ──close──────► CLOSED (off)
  CLOSED ──optional re-seed──► NOT IN / IN
  IN ──point future──► IN (same LP; steering only)
```

---

## Security

- `/run`, `/pool`, and plan APIs never auto-sign without your keys in `.env`.
- Index-only: non–start-list pools are refused.
- Owner match: wallet must equal the node LP pubkey before txs are built.
- Old book stays read-only.
- Railway demo never gets private keys.

Full protocols: `/whitepaper` → Security.

---

## Pool cockpit (node-level Meteora)

Per index pool: **view · claim · withdraw % · close · prefs · deposit** at `/pool?pool=…`.

- Run desk **Manage** / seed **Deposit** → `/pool` (Meteora link secondary).
- SDK builds unsigned txs when possible; otherwise clear Meteora deep-link fallback.
- Close = 100% withdraw plan + Off prefs (apply via POST).

---

## Dashboard map

| Path | Job |
|------|-----|
| `/run` | Book value, fee pie, weight bars, take/close/point, seed queue, Activity |
| `/pool` | Per-pool cockpit (claim / withdraw / close / deposit) |
| `/#config` | Fee flywheel portions + keeper knobs |
| `/api/fund` | Snapshot JSON |
| `/api/fund-plan` | Unsigned take_out / close plans |
| `/api/pool` · `/api/pool-plan` | Pool snapshot + unsigned claim/withdraw/close/deposit |

Canon for agents: this chapter + [`src/lib/fund-plan.js`](../../src/lib/fund-plan.js) + [`src/lib/pool-cockpit.js`](../../src/lib/pool-cockpit.js).
