# Actions

Owns the command execution boundary and persisted idempotency outcomes for CRM activities.

## Implementation

- [actions.model.ts](actions.model.ts): The `action_requests` table, including requester-scoped keys and stored results.
- [actions.repository.ts](actions.repository.ts): Request lookup, action lookup, and result persistence.
- [actions.service.ts](actions.service.ts): Actor verification, request fingerprints, version checks, dispatch to domain services, aggregate versions, and commit coordination.
- [actions.controller.ts](actions.controller.ts): Validation and authenticated handling of `POST /api/crm/actions`.

## Coordination

Execution uses an immediate SQLite transaction with a nested savepoint. A rejected operation rolls back business writes while its request outcome can still be stored. Applied activities advance every touched customer and all of their order versions, append an event on each timeline, and pass Audit checks for each account before commit. Domain services add a second account with `forCustomer()`, and the envelope then needs `expectedVersions` for it. Decision questions are answered through the envelope's `answers`. Domain services own the actual order, fulfillment, finance, and reward operations. Browser clients, CLI seeding, and integration fixtures submit commands through this boundary.

## Related

- [Backend module index](../README.md)
