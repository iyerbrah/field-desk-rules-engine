# Settlement

Restores capacity that a command has shrunk after it was already used: a charge whose retained value fell below its settlement (ACC-001), or a receipt whose effective amount fell below its allocations and credit funding (ACC-002).

## Implementation

- [capacity.reconciler.ts](capacity.reconciler.ts): `WF003_RELEASE_ORDER` (cash, then credit, then points) and `CapacityReconciler`:
  - `releaseChargeOverSettlement`: releases settlement above a charge's retained value in WF-003 order and returns the released cash per receipt.
  - `releaseReceiptOverAllocation`: releases a receipt's allocations above its effective amount, latest first allocation first.
  - `withdrawCreditFunding`: withdraws credit funded by a moved receipt. Unused credit goes first; applied credit is reversed only when the caller allows it; refunded credit is reported back. It has a plan mode that writes nothing, so the caller can ask the user first.

## Coordination

Returns, Fulfillment (`CORRECT_DELIVERY`) and Accounts (`REATTRIBUTE_PAYMENT`) call the reconciler after recording their facts. What happens to released cash stays the caller's rule: returns pay the fee and fund a credit note (WF-003), and the other commands leave it free for WF-002 allocation. The reconciler depends only on the Accounts, Credits and Rewards repositories, so it adds no module cycles. Writes join the Actions transaction.

## Related

- [Backend module index](../README.md)
