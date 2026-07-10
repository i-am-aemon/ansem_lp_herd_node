# Chapter 7 — Reports & Whitepaper

## Token trading cards

```bash
npm run cards
```

Outputs under `reports/` (download from `/files/reports/…` when the dashboard is up):

- `ANSEM_INDEX_TOKEN_CARDS_<wallet>_<ts>.pdf` — one page per pool
- `*_card_data.csv` — tabular export
- `ansem_index_token_history.csv` — append-only history

Source wallet: **tracked (old book)** — read-only. Cards are audit sheets, not signing tools.

No Postgres. Ops activity is tracked in `logs/tx.sqlite` (+ `logs/tx.jsonl` mirror) — see `/run` Activity feed (`GET /api/tx`).

## Web whitepaper (v1.0)

`/whitepaper` renders from `src/lib/whitepaper.js`:

- What it is
- Wallets / keys (`.env` local + Railway Variables)
- Capital rules (leave-in stub ~10% / ~$1)
- Fee split
- Run loop
- Short security list

Print / Save PDF from the browser.

## This book PDF

```bash
npm run book
# → reports/book_of_ansem_private_node.pdf
```

Served at `/files/reports/book_of_ansem_private_node.pdf` when the dashboard is up (`/reports` redirects to `/run`).
