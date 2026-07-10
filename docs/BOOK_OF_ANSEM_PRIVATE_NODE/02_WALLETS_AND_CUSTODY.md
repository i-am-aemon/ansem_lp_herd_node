# Chapter 2 — Wallets & Custody

> **Rule:** Old book never signs. New W1/W2 hold the node. Secrets stay in `.env` (chmod 600).

## Wallet map

| Role | Env | Signs? | Purpose |
|------|-----|--------|---------|
| **Tracked (old book)** | `TRACKED_WALLET` | Never | `/ansem` read-only terminal — 94 TOKEN–ANSEM positions |
| **W0 Main** | `MAIN_WALLET` | Never | Optional fund source label |
| **W1 LP** | `LP_WALLET_PUBLIC_KEY` + `LP_PRIVATE_KEY` | Yes | Owns Meteora positions; `claimPositionFee`; SOL sweep out |
| **W2 Operator** | `OPERATOR_WALLET` + `OPERATOR_PRIVATE_KEY` | Yes | Jupiter buy ANSEM; SPL send to dest |
| **ANSEM dest** | `ANSEM_DEST_WALLET` | No (receive only) | Receives bought ANSEM — replaces LIFE burn |

Default tracked wallet:

```
HpJbzERP44V21mKGRDDUArb9JJaL9NdPSgXzZ9uyieVB
```

## File model

```
PUBLIC  → cell.json + .env.example   (addresses, flags — safe to back up carefully)
PRIVATE → .env                       (keys + password — never commit)
BACKUP  → secrets/{main,lp,operator}.json  (optional keypair arrays, chmod 600)
LOGS    → logs/                      (events, ticks, tx.sqlite — no secrets)
```

## Generate vs import

- **Generate:** Setup `/` → “Generate new W1/W2” or `npm run init -- --force --keys`.
- **Import:** Phantom → Export private key → paste into `.env` after `LP_PRIVATE_KEY=` / `OPERATOR_PRIVATE_KEY=` (no quotes). Pubkeys must match `LP_WALLET_PUBLIC_KEY` / `OPERATOR_WALLET`.

HTTP APIs return **pubkeys only**. Key material is never sent in JSON responses.

## Railway / cloud

`railway:sync-env` **skips** `*PRIVATE_KEY*` and dashboard passwords. Cloud defaults force `DRY_RUN=true` and `DEMO_PUBLIC=true`. Live signing is **local-first**.

## Non-negotiables

1. Do not put the old book private key in this node.
2. Do not commit `.env` or `secrets/*.json`.
3. Do not enable live mode on a public Railway demo with keys uploaded.
