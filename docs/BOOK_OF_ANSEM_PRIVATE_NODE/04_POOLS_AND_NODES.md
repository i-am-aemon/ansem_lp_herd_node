# Chapter 4 — Pools & Nodes

> **Node** here means a TOKEN–ANSEM Meteora DAMM v2 pool you seed, top up, take capital from, or close — not a Solana validator.

## Old book vs start list

| Set | Where | Role |
|-----|-------|------|
| **Old book** | Tracked wallet positions (~94) | Watch on `/ansem`; never signed by this node |
| **Start list** | `src/lib/ansem-index.js` `START_LIST` | Sandbox (~25 tickers); coverage then depth |

A node is a **slice**, not the full index. Pass 1 = 5 ANSEM min per pair; Pass 2 = deepen.

## Controls (`/run` + `/pool`)

| Control | Meaning |
|---------|---------|
| **Seed queue** | Ranked Next action on `/run` (APE + buy-the-dip) |
| **Target weight** | Share of LP book for *future* capital (sync from controller) |
| **Take % out / Close** | Per-pool cockpit at `/pool?pool=…` |
| **Fee mix** | Setup `/#config` — HERD / Reserve ANSEM / Reserve SOL / Pools |

## Adding liquidity

1. Put `LP_WALLET_PUBLIC_KEY` + `LP_PRIVATE_KEY` in `.env` (fresh wallet).
2. Fund the LP (keep ≥ 0.05 SOL operating).
3. Follow `/run` Next action or `GET /api/seed-plan`.
4. Deposit dual-sided on Meteora (≥ 5 ANSEM side in Pass 1).
5. Positions show on `/run` / doctor.

Dry/demo never auto-signs without your keys. Reinvest legs **propose** toward underweight targets.

## Why dual-sided

Each TOKEN–ANSEM LP needs both sides so the book stays tradeable. Fee flywheel (Ch.3) buys ANSEM and can later reinvest; fund control (Ch.10) steers and exits.
