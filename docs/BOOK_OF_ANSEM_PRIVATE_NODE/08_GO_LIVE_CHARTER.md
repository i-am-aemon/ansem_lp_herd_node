# Chapter 8 — Go-Live Charter

> Flip live only when dry ticks are boringly correct.

## Checklist

1. [ ] `npm run doctor` — tracked wallet OK; routes sum to 1; keys match pubkeys
2. [ ] `ANSEM_DEST_WALLET` set
3. [ ] Several `npm run dry` ticks — events show probe → claim/sweep/route → tick_end
4. [ ] Grep: no unexpected `level=error` on happy path
5. [ ] W1 funded (~0.05 SOL+) and has LP if you expect claims
6. [ ] W2 funded enough for Jupiter + rent
7. [ ] Old book key **not** in `.env`
8. [ ] Local only: set `DRY_RUN=false` and `SIMULATION_MODE=false` in `.env`
9. [ ] `DEMO_PUBLIC` remains false for live
10. [ ] Start from `/run` or `npm run start`; watch `/api/tx`

## Non-goals (still)

- Do not sign with `HpJbzE…`
- Do not upload private keys to Railway for go-live
- Do not burn ANSEM
- Do not treat Railway hub health as proof this private node is live

## Rollback

Set `DRY_RUN=true` `SIMULATION_MODE=true` again. Pause interval on `/run`. Keys stay on disk; nothing to “revoke” on-chain except stop signing.

## Strip-down reminder

One fee path. One observability contract. One old book (RO). Everything else waits.
