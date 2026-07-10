# Chapter 0 — What This Book Is

> **Book of ANSEM Private Node:** A shared guide for the operator (`i_am_aemon`) and the coding agent — what this repo does, how custody works, and how we know a dry tick actually ran.

## What this document is

This is **not** a product brochure. It is the **written record** of the private ANSEM Index node:

1. **Why it exists** — separate from the public hub (`ansemindex`).
2. **How money and keys move** — old book vs new W1/W2.
3. **How we observe** — same logging contract as micro_trader / LifeNode.
4. **When we go live** — checklist, not vibes.

If the PDF and git disagree, **trust git** and rebuild the book.

## Relationship to other books

| Book | Question it answers |
|------|---------------------|
| **Book of ANSEM Private Node** (this) | *What is this node? How do we run it safely?* |
| **Book of Micro Trader** | *How did SolTrader / arena logging evolve?* |
| **Book of Aemon** | *Is USD / arena math correct?* |
| **ANSEM Index whitepaper** (web `/whitepaper`) | *What is the fee → pool flywheel thesis?* |

## Central claim

Sustainable index automation needs **one production path**, **honest dry vs live**, and **refusing to confuse “dashboard loaded” with “tick proved.”** This node exists so the operator can hold keys locally and prove the claim → buy ANSEM → send loop before Railway or live signing.

## Study status (honest)

At the edition stamped in git:

- Private node runs locally on `:8080` with dry-run defaults.
- Old book `HpJbzE…` is tracked read-only (94 pools).
- New W1/W2 keypairs can be generated; ANSEM dest must be set before meaningful buy+send.
- Observability: `logs/events.jsonl`, `logs/ticks.jsonl`, `logs/tx.sqlite` (+ `tx.jsonl` mirror).
- Public hub on Railway is a **different** project (`ansemindex`); this repo is not that deploy unless you link it.
