# Rampa — Engineering take-home: Payments reconciliation

## Context
We move money across borders. A partner prefunds us in **USDT**. Our local payment provider converts it to **Bolivianos (Bs)** and holds a Bs balance for us, which we use to pay Bolivian **QR codes**. Every movement must be accounted for, and anything that doesn't match must be surfaced.

**Time box:** 2–3 hours. We value clear reasoning over completeness. If you run out of time, write down what you would do next.
**Stack:** Node.js, TypeScript, Nest.js. Any storage (in-memory or SQLite is fine).
**AI tools:** allowed. In the follow-up session you will explain and modify the code yourself.

## How the provider works
- USDT sent to the provider's wallet is converted to Bs. The provider sends a funding webhook, normally within 10 minutes of the on-chain transfer.
- The provider converts at the market reference rate in effect when it sends the funding webhook, less a spread of up to 0.5%.
- A pay-out goes PREVIEW → CONFIRM → COMPLETED or FAILED, normally within 15 minutes of CONFIRM. A COMPLETED pay-out can later be REVERSED (funds returned to the balance).
- The Bs balance is debited when a pay-out is COMPLETED. The provider does **not** reserve balance at PREVIEW or CONFIRM.
- A PREVIEW that is never confirmed simply expires. It has no financial effect.
- Like most webhook APIs, events can be delivered more than once and are not guaranteed to arrive in order.

## Input files (`data/`)
All data covers one day, 5 October 2026 (Bolivia time, UTC−4). Report state as of 20:00.

| File | Fields |
|---|---|
| `usdt_deposits.csv` | `tx_hash, amount_usdt, timestamp` — on-chain transfers to the provider's wallet |
| `funding_webhooks.json` | `event_id, deposit_tx_hash, amount_usdt, rate, amount_bs, timestamp` — provider confirms a deposit was converted |
| `payout_events.json` | `event_id, payout_id, type, amount_bs, timestamp` — pay-out lifecycle events |
| `reference_rates.csv` | `timestamp, usdt_bs` — hourly market reference rate; use the latest rate at or before an event |

## Task
Build a small service that:
1. **Ingests** all four files. Ingesting the same files again must not change any balance or report.
2. Records every movement in a **double-entry ledger** covering USDT and Bs.
3. Produces:
   - current balances: USDT sent but not yet converted, Bs available at the provider, Bs paid out, Bs in pay-outs not yet final
   - a **breaks report**: every event, record or moment that doesn't reconcile or needs human review, with the reason

## Deliverables
- A Git repository link (GitHub or GitLab) with the code and tests
- `README.md` covering: how to run it; your ledger model (accounts and entries); how you handle duplicates and out-of-order events; what you would change for production
- The output of a run against the provided files

## Next step
A 60-minute session with our engineering lead: you walk us through your solution, then we extend it together live. Be ready to explain every design choice.
