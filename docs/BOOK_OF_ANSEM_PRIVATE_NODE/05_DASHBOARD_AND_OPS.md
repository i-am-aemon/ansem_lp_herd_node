# Chapter 5 — Dashboard & Ops

> Local bind: `127.0.0.1:8080` by default. Mutating APIs need `DASHBOARD_PASSWORD` from `.env`.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Setup — checklist, fee mix, wallets |
| `/#config` | Fee flywheel portions (same page as Setup) |
| `/ansem` | `@i_am_aemon` read-only old-book terminal |
| `/run` | **Operator desk** — seed queue, fund board, terminal, SQLite tx Activity |
| `/pool` | **Per-pool cockpit** — claim · withdraw · close · deposit (index-only) |
| `/whitepaper` | Flow + custody + security + capital policy |
| `/book` | Book index + optional PDF |
| `/health` | `{ ok, cellId, dry_run, last_tick }` |

Legacy redirects: `/fund` `/ops` `/seed` `/log` `/reports` → `/run` · `/config` `/manage` → `/#config`.

## Commands

| Command | What |
|---------|------|
| `npm run init [-- --keys]` | Scaffold cell / env / secrets |
| `npm run start` | Dashboard (skips boot keeper tick; ▶ Start on `/run`) |
| `npm run dry` | One dry tick, no dashboard |
| `npm run doctor` | Health checks + book gaps |
| `npm run alignment` | Prove public surface matches contract |
| `npm run cards` | Token-card PDF → `reports/` |
| `npm run book` | Build this book PDF |

## APIs

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/portfolio?wallet=` | Meteora + Dex enrichment |
| GET | `/api/fund` | Book snapshot · weights · fee pie |
| GET | `/api/fund-plan` | Unsigned take_out / close plans |
| GET | `/api/pool` | One index-pool snapshot |
| GET/POST | `/api/pool-plan` | Unsigned claim / withdraw / close / deposit |
| POST | `/api/fund-policy` | Save fundPolicy (auth) |
| GET/POST | `/api/pool-prefs` | Modes · targets · redirect |
| GET | `/api/seed-plan` | Ordered buy/deposit (respects gaps) |
| GET/POST | `/api/fee-split` · `/api/config` | Fee flywheel portions |
| GET | `/api/tx` | SQLite tx Activity feed |
| POST | `/api/tick` | Run one tick (auth) |

## Mental model

- `/` + `/#config` = **setup + fee portions**
- `/run` = **inbound seed + book + outbound control + Activity**
- `/pool` = **one-pool Phantom cockpit**
