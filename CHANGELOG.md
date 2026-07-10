# Changelog

## Unreleased

### Dead-code scrub (publication / production)
- Removed orphan dashboard pages (`pages-fund` / `manage` / `config` / `seed` / `log`) and unused `run-status.js`
- Removed stub `src/db.js` + `pg` dependency; money log is `logs/tx.sqlite` (+ jsonl mirror) only
- Removed AI advisor placeholder and Imperial SOL long (perp adapter + fee leg)
- Legacy routes (`/fund`, `/ops`, `/seed`, `/log`, …) redirect to `/run` or `/#config`
- Secrets story is `.env`-first; deleted `cell_secrets.env.example`
- Docs + `npm run alignment` match live Setup → Config → Run surface
- Public polish: fixed Dockerfile COPY, `/fund` deep links → `/pool`, Railway demo docs (no keys), scrubbed private-repo leakage from book appendix

### Controller track fix
- **CASHCAT** start-list → new controller pool `5gyd9HHp…` / mint `3grmULX…` (was old `F4ZAM5z…`)
- Tracked top-N now uses controller book USD (raw positions had no `position_value_usd` → empty top → dip24 stuck on **RIF**)
- Cover focus follows controller weight (BIF → CASHCAT → …); dust names dropped from Need

### Run desk
- **Reports removed** from nav — `/reports` redirects to `/run`
- **Fund page removed** from nav — `/fund` redirects to `/run` (APIs kept)
- Run = Control · **terminal + SQLite tx log** · LP portfolio · **Download CSV** at bottom
- Start **resets** `logs/tx.sqlite` (Node built-in SQLite)
- Green agent copy: Holder Pools · targets (calc pie); Sync ctrl weights on Run

### Origins audit
- Canonical fork URL → [ANSEM_LP_HERD_Node](https://github.com/i-am-aemon/ANSEM_LP_HERD_Node) (`ansemlp_index_node` redirects)
- Setup **Origins** card: site, whitepaper, $ANSEM mint, controller, HERD placeholder, Meteora pool sample
- Copy: no bot required — node is advanced / community forks; link [www.ansemlp.fun](https://www.ansemlp.fun)

## 1.0.0 — 2026-07-09

### Public story
- Whitepaper **v1.0** — harvest (leave ~10% / ~$1), Fork → Railway → `.env`, operator modes
- Dual-repo docs: fork **[ANSEM_LP_HERD_Node](https://github.com/i-am-aemon/ANSEM_LP_HERD_Node)**; private working cell is not a fork target
- Nav GitHub → public repo; `DEMO_PUBLIC` banner on demo deploys

### Operator
- Always-on `/run` node terminal (all event phases)
- `LEAVE_IN_POOL_MIN_USD=1` caps take-out so tiny books keep a dollar stub
- Fee flywheel + fund control + cover/mirror/ape/hold modes (existing)

### Ops
- Secrets in `.env`; Railway sync skips keys
- Activity: `logs/tx.sqlite` (+ `logs/tx.jsonl` mirror)
