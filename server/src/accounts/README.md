# Accounts

Owns receivable entries, customer cash receipts, payment allocations, and account balance projections.

## Implementation

- [accounts.model.ts](accounts.model.ts): Drizzle mappings for charges, receipts, receipt transfers, and allocations; the `ChargeBalance` value calculation.
- [accounts.repository.ts](accounts.repository.ts): Typed posting persistence, receipt attribution, and charge queries.
- [accounts.service.ts](accounts.service.ts): Receipt capture, payment re-attribution between customers (ACC-004), FIFO cash allocation, account summaries, ledgers, and account list rows.
- [accounts.controller.ts](accounts.controller.ts): Authenticated account list, customer summary, and ledger reads.

## Coordination

`ActionsService` invokes `receive` and `allocate`. Fulfillment and Returns call `allocateCash` when physical activity changes charge capacity. Rewards owns point balances and entitlement refresh; Credits owns credit funding and settlement. The account summary combines those sources without copying their balances into another table. Command writes join the action transaction; `accounts()` wraps its multi-customer read in a transaction.

## Related

- [Backend module index](../README.md)
