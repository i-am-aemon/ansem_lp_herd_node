# Index sheet

Match [www.ansemlp.fun](https://www.ansemlp.fun) `HomeIndex`.

| | |
|--|--|
| Row | `TICKER–ANSEM` · Creator · Holder · amount · fees · 24h · links |
| Accent | black + green `#34d399` |
| `$HERD` | placeholder until `HERD_MINT` + `HERD_POOL` |

## Shares

| Column | Formula |
|--------|---------|
| **Creator** | `position ÷ book total` |
| **Holder** | `position ÷ pool TVL` |

## Surfaces

- `/` Setup — [`pages-home.js`](../src/dashboard/pages-home.js)
- `/ansem` — [`pages-ansem.js`](../src/dashboard/pages-ansem.js)
- Sheet — [`index-sheet.js`](../src/dashboard/index-sheet.js)
- TVL enrich — [`portfolio.js`](../src/lib/portfolio.js)
