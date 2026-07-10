# Chapter 3 — Fee Flywheel

> **Path:** claim (W1) → sweep SOL (W1→W2, no-op if single-wallet) → split into legs → execute.  
> Fee portions are flexible on Setup `/#config`. LP book steering is `/run` (and Ch.10).

## Loop (one tick)

```
probe     → SOL mark + W1 open positions / unclaimed fees
claim     → claimPositionFee on eligible W1 positions
sweep     → move excess SOL from W1 to W2 (leave LP_RESERVE_SOL); skip if W1=W2
route     → split spendable USD into legs
leg       → ansem_send · ansem_hold · reserve · reinvest
summary   → tick_end + portfolio snapshots
```

## Fee split (defaults — normalize to 100%)

| UI label | Leg | Default | Meaning |
|----------|-----|---------|---------|
| HERD | `ansem_send` | **5%** | Buy/send toward HERD path (`ANSEM_DEST_WALLET`) |
| Reserve ANSEM | `ansem_hold` | **5%** | Hold ANSEM on operator |
| Reserve SOL | `reserve` | **5%** | Gas / buffer on operator |
| Pools | `reinvest` | **85%** | Propose adds toward underweight targets |

Burn (`index_burn`) and donate (`aemon_donate`) default **0%**.

Configured via `FEE_SPLIT_*` env, `cell.json` `feeSplit`, or Setup sliders → `/api/config`.

## Dry vs live

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Dry** | `DRY_RUN=true` or `SIMULATION_MODE=true` (default) | Builds plans; no signatures; logs `dry_run` |
| **Live** | both false **and** not `DEMO_PUBLIC` | Signs claims, sweeps, swaps, transfers |

## Thresholds (env)

| Key | Default | Role |
|-----|---------|------|
| `MIN_CLAIM_USD` | 1 | Skip tiny fee claims |
| `MIN_ROUTE_USD` | 1 | Skip tiny route legs |
| `MIN_RESERVE_USD` | 5 | Keep operator buffer |
| `MAX_BUY_USD_PER_RUN` | 50 | Cap ANSEM buy per tick |
| `ANSEM_SEND_CAP_USD` | 0 | Optional hard cap (0 = use pct) |
| `TICK_MS` | 60000 | Interval when looping |

## ANSEM mint

```
9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump
```

## Fund control

Taking capital **out** of LPs (take %, close, redirect) is Ch.10 / `/run` — not the fee flywheel.  
Reinvest share can **follow target weights** when `reinvestFollowsWeights` is on.
