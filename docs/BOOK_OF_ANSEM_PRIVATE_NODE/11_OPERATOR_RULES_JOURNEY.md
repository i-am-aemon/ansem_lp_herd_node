# Chapter — Operator Rules Journey

> Day-1 productization. Rules print clearly. Dust goes into pools. One terminal. One DB.

## One sentence

You keep the key. Capital seeds the **tracking wallet’s top 10** from the **lowest 24h** first. Leftover TOKEN in the wallet is **dust to accumulate into LPs** — never ignore it, never re-buy blindly.

## Hard caps (micro_trader lesson)

| Cap | Limit | Why |
|-----|------:|-----|
| Log files | **3** (`events.jsonl` + `ticks.jsonl` + `tx.jsonl` mirror) | micro_trader had ~62 patterns |
| Tx store | **1** (`logs/tx.sqlite` — no Postgres) | They had 4 backends / 17 Neon tables |
| Ops UI | **1** (`/run`) | They had 14 surfaces |

## Operator modes (holder-based)

`CONTROLLER_WALLET` is the reference. Flip **MODE** on `/run` (or `OPERATOR_MODE` / `POST /api/operator-mode`):

| Mode | What the bot does next |
|------|------------------------|
| **cover** | Min ≥5 ANSEM (and ≥~$1 dual) in all controller top-N |
| **mirror** | Reaccumulate toward controller weights; propose take-outs when overweight |
| **ape** | Enter fresh TOKEN–ANSEM pairs at the pair-min floor |
| **hold** | No seed / no trim proposals |

Fees stay on Setup `/#config` — not a seed mode.

**Pair min:** `max(PAIR_MIN_ANSEM, PAIR_MIN_USD / (2 × ANSEM price))` so new entries are never sub-dollar dust.

## Seed journey

1. Set MODE (cover → mirror when coverage done)  
2. `topup_sol` if below operating floor  
3. Capped `buy_ansem` (leave rent)  
4. **Wallet census** — deposit index dust you already hold  
5. `buy_token` only when no dust for that mint  
6. `deposit` — mins first in **cover**; deepen gaps in **mirror**  
7. Sort = **dip24**; universe = **tracked_top10**  
8. **Trim rule:** take ~90% / **leave ~10% in the LP** — close only when you mean wipe

## Capital floors

| Floor | Default | Meaning |
|-------|---------|---------|
| Gas `SOL_RESERVE` | 0.02 | Never spend |
| Operating | 0.05 | Block ATA/buys; prefer `topup_sol` |
| Target | 0.08 | After ANSEM→SOL recovery |
| Rent / pair | ~0.008 | Left by capped `buy_ansem` |
| Pair min USD | 1 | Dual-sided floor for new LPs |

**Predictable trap:** dump all SOL → ANSEM, leave ~0.005 → cannot open LPs (and may not even top up). Send ~0.05–0.1 SOL if critically low.

## Dust → LP

Bought TOKEN sitting in the wallet is fine — it must be **managed**:

- Census lists RIF / ANSUM / TOESCOIN / …  
- Planner prefers **deposit held TOKEN** over Jupiter re-buy  
- Existing LPs get **dust top-ups** (add liquidity) when ANSEM remains (mirror / after cover)

## Grep truth

```bash
# Why blocked?
jq 'select(.code!=null)' logs/events.jsonl | tail
# Seed steps
jq 'select(.phase=="seed")' logs/events.jsonl | tail
curl -s localhost:8080/api/gates_status | jq .
curl -s localhost:8080/api/operator-mode | jq .
```

## Scar → rule

| Scar | Rule |
|------|------|
| Gen keys ≠ Phantom | LP key must match `LP_WALLET` |
| All SOL → ANSEM | Operating floor + capped buy |
| Re-bought RIF 3× | Census skip buy if held |
| Deposit blockhash | Set blockhash before NFT partialSign |
| RPC 429 | Retry; don’t thrash |

## Copy from micro_trader / refuse

**Copy:** JSONL+tick_id, reason codes, gates_status, stdout one-liner, session PnL, census, go-live gate, policy banner.  
**Refuse:** Neon ML warehouse, Gist triple-write, 14 dashboards, Kronos, accumulator wheels.
