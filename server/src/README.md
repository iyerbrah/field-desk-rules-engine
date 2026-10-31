# Backend modules

`AppModule` imports feature modules directly. Each directory owns a specific business capability or supporting concern; its README describes the relevant files, collaborators, and execution boundary.

| Directory                                     | Responsibility                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Accounts](accounts/README.md)                | Owns receivable entries, customer cash receipts, receipt transfers between customers, payment allocations, and account balance projections.                    |
| [Actions](actions/README.md)                  | Owns the command execution boundary and persisted idempotency outcomes for CRM activities.                                                                     |
| [Audit](audit/README.md)                      | Owns business activity history, posting provenance, action traces, and account consistency review.                                                             |
| [Authentication](auth/README.md)              | Owns sign-in, registration, JWT verification, persisted sessions, and request authentication and role guards.                                                  |
| [Catalog](catalog/README.md)                  | Owns product reference records: SKU identity, catalog price, and points per unit.                                                                              |
| [Common helpers](common/README.md)            | Contains small shared execution types, domain errors, effect recording, and HTTP validation utilities.                                                         |
| [Configuration](config/README.md)             | Owns runtime environment validation and the typed configuration contract.                                                                                      |
| [Credits](credits/README.md)                  | Owns receipt-backed customer credit, its funding links, applications to charges, recorded refunds, and settlement reversals.                                   |
| [CRM queries](crm-queries/README.md)          | Composes the two cross-domain responses used to initialize the CRM and display a complete customer record.                                                     |
| [Customers](customers/README.md)              | Owns customer identity, unique account codes, and customer record versions.                                                                                    |
| [Database infrastructure](database/README.md) | Owns the shared SQLite connection, Drizzle initialization, migration execution, and schema discovery for tooling.                                              |
| [Fulfillment](fulfillment/README.md)          | Owns physical shipments, loading quantities, dispatch evidence, incremental delivery confirmations, delivery corrections, and authorized dispatch supplements. |
| [Health](health/README.md)                    | Exposes a public database readiness check.                                                                                                                     |
| [Orders](orders/README.md)                    | Owns commercial orders, immutable line revisions, revision approvals and rejections, and canceled demand.                                                      |
| [Returns](returns/README.md)                  | Owns physical return documents, their returned quantities and values, and coordination of the resulting financial adjustments.                                 |
| [Rewards](rewards/README.md)                  | Owns reward entitlement, point ledger buckets, redemption records, and recovery of entitlement that has already been spent.                                    |
| [Settlement](settlement/README.md)            | Restores charge and receipt capacity after a command shrinks it, under the declared WF-003 release order.                                                      |
| [CLI scripts](scripts/README.md)              | Owns local administrator bootstrapping and repeat-safe development data creation.                                                                              |
| [Users](users/README.md)                      | Owns staff accounts, password storage, account creation, searchable staff lists, and administrator-controlled role and status changes.                         |
| [Workspace metadata](workspace/README.md)     | Exposes role-specific titles and descriptions for the Sales and KAM workspaces.                                                                                |

## Organization

Business modules keep models, typed repositories, services, controllers, and Nest wiring together. Repository provider modules expose data access where another domain needs it without introducing circular service dependencies. Services coordinate changes; models hold state and value invariants; repositories persist typed records.

Use only the layers a capability needs. Catalog serves repository reads directly. Workspace serves static metadata without a repository or service. Health has one infrastructure query. CRM Queries combines existing reads without inventing a model, repository, or command facade.

Domain commands enter through Actions, which owns transaction/savepoint boundaries, idempotency, version advancement, and pre-commit review for every customer account the command touched. Commands that shrink a capacity already in use (returns, delivery corrections, payment re-attribution) record facts and let Settlement release what no longer fits. Bootstrap and customer snapshot reads are composed by CRM Queries inside read transactions. Shared request and response contracts are imported from `@crm/shared`; database tooling discovers domain tables through `database/schema.ts`.

## Related

- [Canonical business rules](../../docs/candidate-walkthrough/canonical_business_rules.md)
- [Architecture and deployment](../../docs/architecture.md)
- [API reference](../../docs/api.md)
- [Verification](../../docs/verification.md)
- [Development workflow](../../CONTRIBUTING.md)
- [Documentation index](../../docs/README.md)
