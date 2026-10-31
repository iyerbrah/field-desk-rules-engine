# Returns

Owns physical return documents, their returned quantities and values, and coordination of the resulting financial adjustments.

## Implementation

- [returns.model.ts](returns.model.ts): Return and return-line tables, returnable-quantity validation, and explicit fee bounds.
- [returns.repository.ts](returns.repository.ts): Typed return persistence and per-line/customer return totals.
- [returns.service.ts](returns.service.ts): Validate a physical return, reduce source charges, release excess settlements through Settlement, pay the fee from released cash, fund credit, and refresh allocations and rewards.
- [returns.controller.ts](returns.controller.ts): Authenticated customer return history.

## Coordination

Warehouse or Admin submits `RECORD_RETURN` through Actions. The service reads delivered units from Fulfillment and writes compensating records through the owning Accounts, Credits, and Rewards repositories. The same transaction preserves original delivery and settlement evidence. A return does not reopen demand; commercial cancellation remains an Orders operation.

## Related

- [Backend module index](../README.md)
