# Chapter 1 — Why This Node

> **Anchor:** Empty private workspace → LIFE-style private node forked from `ansemindex/keeper` + LifeNode UX.

## Two repos, two jobs

| Repo | Role | Keys |
|------|------|------|
| **`ansemindex`** | Public / read hub — terminal, manage preview, whitepaper page | Pubkeys only |
| **This private cell** | Operator node — claim, buy, send, local secrets | `.env` on disk |

Same relationship as:

- public hub vs private operator cell
- micro_trader arena (strategy) vs a holder’s LifeNode (keys + loop)

## What we are testing

1. **Read-only book** — watch `HpJbzERP44V21mKGRDDUArb9JJaL9NdPSgXzZ9uyieVB` without ever signing from it.
2. **New node wallets** — Phantom-compatible W1 (LP) + W2 (operator); keys never in the browser response body.
3. **Node deposits** — add TOKEN–ANSEM liquidity from W1 on start-list pools (~$1 floor).
4. **Keeper dry → live** — prove claim → sweep → Jupiter buy ANSEM → SPL send before flipping `DRY_RUN=false`.
5. **Reports** — trading-card PDF + whitepaper.
6. **Railway your way** — demo sync skips private keys; live signing stays local-first.

## Lineage

```
micro_trader (events.jsonl + tick_id)
    ↓ mirrored by
LifeNode (JSONL + SQLite + wizard)
    ↓ fee path adapted
ANSEM keeper (claim → buy ANSEM → send, not burn)
    ↓ + private UX
ansem herd private cell (this book)
```

## What this is not

- Not a memecoin sniper (that was micro_trader v2).
- Not the public ANSEM Index marketing site.
- Not a place to paste private keys into a web form.
- Not automatic dual-sided pool seeding yet (Phase C / manual Meteora deposits).
