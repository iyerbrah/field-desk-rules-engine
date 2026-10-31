# Verification

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` from the workspace root. Tests use temporary databases and remove them after execution. No existing customer database is reset by verification.

## Business acceptance

The HTTP workflow suite defines its own requests and expected outcomes. It uses the public action and read contracts and the local catalog seed, with no call to mutation providers while exercising business operations. User creation and database migration are setup operations only. Source: `server/test/customer-workflows.test.ts` and its HTTP transport helper.

| Case | Verified outcome                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| F-01 | A20/B15 with A10/B10 delivered recognizes 250000 paise, retaining A10/B5 demand.                                         |
| F-02 | Commercial edit invalidates old approval and loading; revision 2 needs approval.                                         |
| F-03 | Ordinary post-dispatch edit is rejected without business mutation.                                                       |
| F-04 | Two shipments recognize 425000 paise in incremental charges, preserving earlier charges.                                 |
| F-05 | Unshipped cancellation compensates locked points without charges.                                                        |
| F-06 | Partial fulfillment retains delivered units and cancels only unshipped demand.                                           |
| F-07 | Paid 10000-paise return with a 2000-paise deduction yields 8000-paise funded credit and reverses entitlement.            |
| F-08 | One customer receipt allocates across two orders in FIFO order and unlocks proportional points.                          |
| F-09 | Redemption reduces spendable points and charge due without earning points.                                               |
| F-10 | Returning spent entitlement creates debt; later cash accrual offsets that debt.                                          |
| F-11 | Accounts chooses a partial credit application; no new cash receipt appears.                                              |
| F-12 | Missing physical shipment facts produce a question; explicit authorized correction preserves original dispatch evidence. |
| F-13 | Exact receipt retry returns the stored outcome; changed input with the same key conflicts.                               |
| F-14 | Concurrent returns accept at most the available units; the other request conflicts.                                      |

Additional HTTP cases race credit applications and point redemptions. Two hundred deterministic sequences vary item quantities, prices, payment timing, partial confirmations, return timing and fees, selected cancellation, point settlement, refund/reversal, duplicate receipt submissions, and invalid excess quantities. Each sequence tracks expected quantities and the customer net position independently, checks point conservation, and verifies that previously recorded ledger entries remain unchanged.

The service integration suite uses test-only fixtures to check role boundaries and forged actors, exact paise and rounding, return reversals of credit/point settlement, partial settlement corrections, stale loading documents, and preserved dispatched evidence. HTTP assertions compare domain customer, catalog, shipment, return, credit, and reward reads with the composed customer and order views. They also compare bootstrap and snapshot endpoints with the query service and verify that non-admin bootstrap projects only the current staff identity. It also verifies that the removed development runner, seed, and reset endpoints return 404 even for an authenticated administrator. An altered-record test proves account checks detect inconsistent evidence and roll back the next activity.

Scenario suites added for the rules-engine work share a test bootstrap (`server/test/support/app.ts`) and the account balance check (`server/test/support/account.ts`):

- `return-settlement.test.ts` pins every ledger row that five returns write. It covers latest-allocated receipt first, the fee paid from released cash, credit returned to its note, points restored, cash then credit then points, and payload order across lines. These are characterization tests: they were recorded from the original code before the release logic moved into Settlement.
- `delivery-correction.test.ts` (FUL-007) has 11 cases: correct then confirm the rest, latest-first reversal, freed cash re-allocated, credit and points restored, clawback, the returned-units and non-reducing bounds, a supplement shipment, role, and stale version.
- `payment-reattribution.test.ts` (ACC-004) has 10 cases: unallocated advance, the fully allocated two-customer example with clawback, partial move, unused credit shrink, the applied-credit question then decline then confirm, refunded credit rejection, same customer, both version checks, and role.

`server/test/migrations.test.ts` migrates a populated database from the preceding schema. It verifies that existing credits, applications, refunds, and receipt funding survive the upgrade, that new reversal links are valid, and that reapplying migrations is safe. It also starts with legacy workflow metadata and verifies that its tables are removed while customer transactions remain intact. Authentication tests cover strict validation, session expiry/revocation, default-deny access, CSRF, credential throttling, and password handling.

The seed suite verifies all six commercial states and seven fulfillment states across the 24 seeded orders, checks customer balances and reward buckets, and verifies that legacy workflow tables are absent. It also verifies reruns by another administrator, preservation of manual changes, rollback after a missing staff role, rebuilding an empty test database, and production/access restrictions.

## Account reconciliation

This check is derived from the [canonical business rules](candidate-walkthrough/canonical_business_rules.md), not an additional policy. For one customer, let $G$ be confirmed delivery value, $V$ returned value, $\Phi$ return deductions, $M$ effective receipts (captured less amounts moved to other customers), $F$ net refunds, and $Z$ net redeemed points. With outstanding charges $b_j$, free cash $u_i$, and open credit $O_n$:

$$
G-V+\Phi-M+F-Z
=\sum_j b_j-\sum_i u_i-\sum_n O_n.
$$

Positive value means the customer owes money; negative value means value is owed to the customer.

![Account reconciliation dependencies](candidate-walkthrough/diagrams/account-dependencies.svg)

## Recorded evidence

`pnpm test` generates `reports/customer-workflows.json` with each independent workflow outcome, the operating-term version, the sequence seed convention, action response times, and a memory sample. `complete` requires every expected case to finish successfully. The test command's exit status also covers other suites and setup/teardown failures; the JSON file alone is not a substitute for that status.

Latencies measure `POST /crm/actions`, including HTTP, validation, database work, checks, and response serialization. Reads needed to compose envelopes, authentication setup, and initial migrations are outside that timing. Median and p95 use the nearest-rank method across the reported requests. The workload includes accepted, rejected, conflicting, and replayed actions; each request's type, outcome, and duration are retained. These local measurements are not production capacity estimates. Memory is a sample of the test process, not isolated per-action allocation.

`pnpm metrics` writes `reports/source-metrics.json`: current commit, per-file hashes, nonblank TypeScript source lines, and AST decision-node counts. Its counting definition is included in the file. Counts exclude generated code, dependencies, migrations, and Markdown; test files are listed explicitly. Decision-node counts are a branch proxy and do not claim to measure review effort or code quality.

Reports are generated locally and ignored by Git. Preserve their files together with command output if retaining a verification record. Rerun reports after source changes; commit IDs and hashes identify which code was measured.

## Historical checkpoints

These references identify recorded implementation snapshots, rather than the current checkout:

| Commit    | Snapshot                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `7f5c5d2` | Earlier business-terms and operational acceptance checkpoint, before the CRM navigation, CLI dataset, removal of runtime workflow tooling, and domain-module refactors.                                                                             |
| `c3c4abe` | Domain models, typed Drizzle repositories, services, and controllers; 251 tests passed, along with lint, type checking, production build, formatting, and repeat-safe local seed verification. Drizzle reported no schema change for this refactor. |

Both snapshots use operating conventions version `2026-10-26.1`. Use commit IDs to reproduce a snapshot; no release tag is assumed. For the current checkout, rerun the commands above and retain their output with freshly generated reports.

## Limits

The suite exercises finite, reproducible histories; it does not enumerate every possible real-world sequence. Two hundred sequences are a coverage measure, not an exact count of executable business states. Real bank transfers, statutory invoices, taxes, inventory valuation, and other currencies remain outside the application boundary.

The API's live checks inspect current persisted evidence. They support transaction verification and operational review; they do not replace the independent tests or certify externally edited databases as complete accounting records.

## Related

- [Canonical business rules](candidate-walkthrough/canonical_business_rules.md)
- [Documentation index](README.md)
- [Development setup](../CONTRIBUTING.md)
- [API reference](api.md)
- [Operations desk](operations.md)
- [Business terms](business-terms.md)
- [Architecture](architecture.md)
- [Backend module index](../server/src/README.md)
