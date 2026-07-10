# Book of ANSEM Private Node

Operator + agent guide for the private ANSEM Index node (`i_am_aemon`). This is the **shared mental model** — what the node is, what it is not, and how we prove dry ticks before live.

| Canon | Path | Purpose |
|-------|------|---------|
| **This book** | `docs/BOOK_OF_ANSEM_PRIVATE_NODE/` | Why / wallets / flywheel / ops / observability |
| **Alignment contract** | [`docs/ALIGNMENT_CONTRACT.md`](../ALIGNMENT_CONTRACT.md) | Tx activity schema (`logs/tx.sqlite` + jsonl mirror) |
| **Setup** | [`docs/SETUP.md`](../SETUP.md) | Wizard steps |
| **Hub links** | [`docs/HUB_LINKS.md`](../HUB_LINKS.md) | Paste into public Railway hub |
| **Public node** | [ANSEM_LP_HERD_Node](https://github.com/i-am-aemon/ANSEM_LP_HERD_Node) | Fork → Railway demo → local `.env` for live |
| **Micro Trader book** | `soltrader_global/.../BOOK_OF_MICRO_TRADER/` | Logging lineage |

## Chapters

| # | Title | File |
|---|-------|------|
| 0 | What this book is | [00_WHAT_THIS_BOOK_IS.md](00_WHAT_THIS_BOOK_IS.md) |
| 1 | Why this node | [01_WHY_THIS_NODE.md](01_WHY_THIS_NODE.md) |
| 2 | Wallets & custody | [02_WALLETS_AND_CUSTODY.md](02_WALLETS_AND_CUSTODY.md) |
| 3 | Fee flywheel | [03_FEE_FLYWHEEL.md](03_FEE_FLYWHEEL.md) |
| 4 | Pools & nodes | [04_POOLS_AND_NODES.md](04_POOLS_AND_NODES.md) |
| 5 | Dashboard & ops | [05_DASHBOARD_AND_OPS.md](05_DASHBOARD_AND_OPS.md) |
| 6 | Observability | [06_OBSERVABILITY.md](06_OBSERVABILITY.md) |
| 7 | Reports & whitepaper | [07_REPORTS_AND_WHITEPAPER.md](07_REPORTS_AND_WHITEPAPER.md) |
| 8 | Go-live charter | [08_GO_LIVE_CHARTER.md](08_GO_LIVE_CHARTER.md) |
| 9 | **How it works mechanically** | [09_HOW_IT_WORKS_MECHANICALLY.md](09_HOW_IT_WORKS_MECHANICALLY.md) |
| 10 | **Fund control** | [10_FUND_CONTROL.md](10_FUND_CONTROL.md) |
| 11 | **Operator rules journey** | [11_OPERATOR_RULES_JOURNEY.md](11_OPERATOR_RULES_JOURNEY.md) |
| A | Doc map | [APPENDIX_A_DOC_MAP.md](APPENDIX_A_DOC_MAP.md) |

## Build PDF

```bash
npm run book          # → reports/book_of_ansem_private_node.pdf
# or
bash scripts/build_book.sh
```

## Vision (what this bot is for)

**You keep the key. Capital seeds only the ANSEM index. Phantom approves.**

**Product canon:** [www.ansemlp.fun](https://www.ansemlp.fun) · [whitepaper v2](https://www.ansemlp.fun/whitepaper)

```
You hold SOL in Phantom
  → node builds a plan (never signs)
  → you approve in Phantom
  → buy ANSEM → seed TOKEN–ANSEM LPs on the start list (~25 names)
  → later: claim fees (Setup) · take % / close / point (/run) · harvest leave ~$1
```

Example: **~$10 SOL** = smoke-test coverage (a few mins), not the full book. Larger capital = more names, then Pass 2 depth. Never paste a private key into the site or chat.

**Fork path:** [ANSEM_LP_HERD_Node](https://github.com/i-am-aemon/ANSEM_LP_HERD_Node) → Railway demo → local `.env`. Site whitepaper = thesis; node `/whitepaper` = operator flow.

**Not:** a custodian · an auto-signer · a scrape of all Meteora pools.

## Central claim

**Old book = eyes. Phantom node = hands. LP in = deposit. LP out = take % / close on `/run`. Fee flywheel ≠ LP book. Universe = index start list only.**

Confused? Start at the root [README](../../README.md), then [Ch.9](09_HOW_IT_WORKS_MECHANICALLY.md). Running a fund? [Ch.10 Fund control](10_FUND_CONTROL.md).
