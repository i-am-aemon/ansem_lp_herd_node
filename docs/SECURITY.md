# Security notes (operator)

- Real keys only in `.env` or Railway Variables (chmod 600 locally). Never commit. Never paste in chat/UI.
- `.env.example` is placeholders only — no live pubkeys or secrets.
- Controller / old book (`HpJbzE…`) is **read-only**. Never import its private key.
- Public OK to publish: `$ANSEM` mint, controller pubkey, pool addresses, public fork URL.
- **Demo** (`DEMO_PUBLIC=true`): Start blocked — no private keys on that deploy.
- **Live internet deploy:** always set `DASHBOARD_PASSWORD` (seed / prefs / fee bot require unlock). Never put keys on a public demo.
- **Live Railway:** keys in Variables only; `DEMO_PUBLIC=false`. Prefer `RAILWAY_LIVE=yes` sync so demo locks are not re-forced.
- Single-wallet live: set `OPERATOR_PRIVATE_KEY` = `LP_PRIVATE_KEY`.
- If a key ever hit git or chat: move funds → new wallet → rotate → treat old key as burned.
