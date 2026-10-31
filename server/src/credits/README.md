# Credits

Owns receipt-backed customer credit, its funding links, applications to charges, recorded refunds, and settlement reversals.

## Implementation

- [credits.model.ts](credits.model.ts): Credit notes, receipt funding, application/refund tables, and the `CreditBalance` value object.
- [credits.repository.ts](credits.repository.ts): Typed credit persistence, funding attribution, settlement totals, and reversal limits.
- [credits.service.ts](credits.service.ts): Explicit credit reservation, application, refund, reversal operations, and available-credit reads.
- [credits.controller.ts](credits.controller.ts): Authenticated customer credit-note reads.

## Coordination

Accounts provides receipt and charge evidence; Rewards provides existing point settlement when calculating charge capacity. Returns can reserve released receipt allocations through the credit repository during a return. A credit's issued value is its net receipt funding: funding withdrawn because its receipt moved to another customer (ACC-004) is a linked negative `credit_funds` row. Explicit settlement commands enter through Actions and append entries rather than overwriting earlier settlements. Refund records describe bookkeeping; this module does not initiate bank transfers.

## Related

- [Backend module index](../README.md)
