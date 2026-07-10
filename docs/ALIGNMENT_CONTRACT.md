# Alignment — transaction activity

Open-source follow-controller node. **No Postgres.** Money moves live in a SQLite tx log (with a jsonl mirror) and show on `/run`.

## Store

| Path | Role |
|------|------|
| `logs/tx.sqlite` | Canonical typed transaction feed for `/run` Activity |
| `logs/tx.jsonl` | Append-only mirror for grepping |
| `logs/events.jsonl` | Phase/debug lines (`probe`, `claim`, `sweep`, …) |
| `logs/ticks.jsonl` | Full cycle audit snapshots |

### `logs/tx.sqlite` / `logs/tx.jsonl` row shape

| Field | Description |
|-------|-------------|
| `ts` | ISO8601 UTC |
| `tick_id` | Shared cycle id when inside a tick/pass |
| `kind` | `session_start` · `session_end` · `claim` · `deposit` · `withdraw` · `route` · `buy` · `skip` |
| `status` | `ok` · `skip` · `fail` · `dry_run` |
| `usd` | Dollar amount when known |
| `min_usd` | Claim minimum when relevant |
| `ticker` | Pool/token label |
| `sig` | On-chain signature when live |
| `did` | Plain-English what happened |
| `delta` | `+1` add liq · `-1` remove liq · `0` otherwise |

## APIs

| Path | Returns |
|------|---------|
| `GET /api/tx?limit=` | Recent rows for the Activity feed |
| `GET /api/tx/export` | Full JSONL download |
| `GET /api/ledger` | Tx backend + recent txs (use `/api/tx` for the feed) |

## UI

`/run` → **Activity** — graphical rows with ± chips, claim-min skips, Solscan links.

Canonical operator path: **Setup `/` → Index `/ansem` → Config `/#config` → Run `/run` → Whitepaper `/whitepaper`**.

Legacy bookmarks (`/fund`, `/ops`, `/seed`, `/log`, `/manage`, `/reports`) redirect to `/run` or `/#config`.

## Grep

```bash
tail -n 40 logs/tx.jsonl
grep '"kind":"claim"' logs/tx.jsonl
grep '"kind":"deposit"' logs/tx.jsonl
```

Prove alignment: `npm run alignment`.
