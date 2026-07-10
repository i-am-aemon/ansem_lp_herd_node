# Chapter 6 — Observability

> Structured JSONL + `tick_id` from micro_trader lineage. Money moves live in SQLite `logs/tx.sqlite` (jsonl mirror). **No Postgres.**

## How this node does it

| Store | Path |
|-------|------|
| Events JSONL | `logs/events.jsonl` — phase/debug (`probe`, `claim`, `sweep`, …) |
| Ticks JSONL | `logs/ticks.jsonl` — full cycle audit snapshots |
| Tx SQLite | `logs/tx.sqlite` — typed Activity feed for `/run` |
| Tx JSONL mirror | `logs/tx.jsonl` — same rows for grepping |

Implementation: [`src/logger.js`](../../src/logger.js). Contract: [`docs/ALIGNMENT_CONTRACT.md`](../ALIGNMENT_CONTRACT.md).

Phases: `probe` → `claim` → `sweep` → `route` → `leg` → `summary`.

`tick_id` format: `t{millis}{seq}` — all events in a cycle share it. Grep one id to reconstruct a tick.

## Prove a dry tick

```bash
npm run dry
grep tick_end logs/events.jsonl | tail -1
grep tracked_ro logs/events.jsonl | tail -1   # old book snapshot
tail -n 20 logs/tx.jsonl
```

Or open `/run` → Activity (loads `GET /api/tx`).

## What “worked” means

| Weak signal | Strong signal |
|-------------|---------------|
| Dashboard HTML loaded | `tick_end` with shared `tick_id` in JSONL |
| Console one-liner | `/run` Activity row with `kind` + `status` + `sig` |
| “I think it claimed” | `phase=claim` / `kind=claim` rows with `usd` and status |

Refuse to confuse **ran** with **worked**.
