# Business terms

Version **2026-10-26.1**. These terms name the current application's records and operations. Amounts use INR paise. Quantities and points use integers. A customer account is not a staff login.

## Entities

| Entity                    | Meaning                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Staff member; session     | An active/inactive login with one role; a revocable authenticated session.                                                              |
| Customer                  | Account identity, unique code, and record version. Owns orders, receipts, credit, and rewards.                                          |
| SKU                       | Product identity, catalog price, and points-per-unit rate.                                                                              |
| Order                     | Commercial commitment with one current revision, approval status, and version.                                                          |
| Revision; commercial line | Immutable agreed quantities and prices. A line key identifies the same SKU across retained revisions. Each line stores its reward rate. |
| Approval                  | Approval or rejection of one exact order revision.                                                                                      |
| Cancellation              | Recorded removal of unshipped demand.                                                                                                   |
| Shipment; shipment line   | One physical batch and its loaded/dispatched units, price, reward rate, and commercial references.                                      |
| Delivery                  | Incremental confirmation of dispatched units received by the customer.                                                                  |
| Correction                | Authorized addition of physically dispatched units; retains evidence and the original documents.                                        |
| Return; return line       | Previously delivered units received back, their gross value, and an explicit deduction.                                                 |
| Charge; adjustment        | A delivery obligation or return fee; a signed adjustment retains its source charge.                                                     |
| Receipt; cash allocation  | Customer money received; attribution of that money to a charge. An advance is unallocated receipt value.                                |
| Credit note; funding      | Customer value reserved from identified receipts. It is not a new cash receipt.                                                         |
| Credit application        | Credit used to settle a selected charge.                                                                                                |
| Credit refund             | A recorded payout from funded credit, with a bank reference.                                                                            |
| Point redemption          | Available customer points used to settle a selected charge.                                                                             |
| Reward posting            | Signed movement in `LOCKED`, `AVAILABLE`, `REDEEMED`, or `CLAWBACK_PENDING`.                                                            |
| Activity; request result  | Applied business history with actor/requester attribution; the saved outcome used for request retries.                                  |

Order approval status is `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `REAPPROVAL_REQUIRED`, or `CANCELLED`. Shipment status is `LOADING`, `DISPATCHED`, `DELIVERED`, or `VOIDED`.

Order fulfillment is a separate quantity-derived view: `UNFULFILLED`, `LOADING`, `PARTIALLY_DISPATCHED`, `DISPATCHED`, `PARTIALLY_DELIVERED`, `DELIVERED`, or `CANCELLED`. Payment, credit, and reward balances can coexist; they are not exclusive order states.

## Roles and actions

Admin can perform every listed action. The role column lists the other permitted roles. Every active signed-in role can read CRM customer, order, and account records. Action traces are restricted to the requester, acting staff member, or Admin.

| Action                       | Role            | Intent                                                      |
| ---------------------------- | --------------- | ----------------------------------------------------------- |
| Create customer              | Sales, Accounts | Add a customer identity.                                    |
| `UPDATE_CUSTOMER`            | Sales, Accounts | Change customer name/code.                                  |
| `PUNCH_ORDER`                | Sales           | Create a draft commercial revision.                         |
| `EDIT_ORDER`                 | Sales           | Replace the current commercial terms with a new revision.   |
| `SUBMIT_ORDER`               | Sales           | Submit a revision for commercial review.                    |
| `APPROVE_ORDER`              | KAM             | Approve the exact current revision.                         |
| `REJECT_ORDER`               | KAM             | Reject the exact current revision with a reason.            |
| `CANCEL_REMAINDER`           | Sales           | Cancel selected or all eligible unshipped demand.           |
| `START_LOADING`              | Warehouse       | Reserve units in a loading batch.                           |
| `DISPATCH_SHIPMENT`          | Warehouse       | Confirm that the loaded batch left the warehouse.           |
| `CONFIRM_DELIVERY`           | Warehouse       | Confirm some or all remaining dispatched units.             |
| `RECORD_RETURN`              | Warehouse       | Receive delivered units back; record an explicit deduction. |
| `CORRECT_DISPATCHED_ORDER`   | KAM             | Record authorized additional dispatched goods.              |
| `CORRECT_DELIVERY`           | KAM             | Lower an overstated delivery count (FUL-007).               |
| `RECEIVE_CUSTOMER_PAYMENT`   | Accounts        | Capture customer cash and allocate eligible value.          |
| `ALLOCATE_PAYMENT`           | Accounts        | Allocate existing free cash.                                |
| `REATTRIBUTE_PAYMENT`        | Accounts        | Move a payment to the customer who made it (ACC-004).       |
| `ISSUE_CREDIT_NOTE`          | Accounts        | Reserve free receipt value as explicit credit.              |
| `APPLY_CREDIT_NOTE`          | Accounts        | Settle a selected charge with credit.                       |
| `REFUND_CREDIT_NOTE`         | Accounts        | Record a payout from available credit.                      |
| `REVERSE_CREDIT_APPLICATION` | Accounts        | Undo an eligible amount of a recorded application.          |
| `REVERSE_CREDIT_REFUND`      | Accounts        | Undo an eligible amount of a recorded payout.               |
| `REDEEM_POINTS`              | Sales, Accounts | Settle a charge with available points.                      |

Sales means `SALES`; KAM means Key Account Manager (`KAM`); Warehouse means `WAREHOUSE`; Accounts means `ACCOUNTS`; Admin means `ADMIN`.

Only Admin manages staff roles/status or chooses another active acting staff member. Both actor and signed-in requester are recorded. Customer creation and staff administration use the signed-in user. Public registration creates Sales accounts. An administrator cannot change their own role/status or remove the last active administrator; role/status changes revoke the target's sessions.

## Operation boundary

The listed CRM commands use the action endpoint. Customer creation is a separate endpoint. There is no Sales return-request stage, general receipt-edit action, or arbitrary historical shipment editor. Refund reversal and authorized extra-goods correction have the specific meanings above. Refunds record bookkeeping; they do not initiate bank transfers.

## Related

- [Walkthrough](README.md)
- [Canonical business rules](canonical_business_rules.md)
- [Business reference](../business-terms.md)
- [API reference](../api.md)
