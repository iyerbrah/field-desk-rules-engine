# FieldDesk CRM

A local CRM for sales, warehouse operations, customer accounts, and finance, built with React, shadcn/ui, Zustand, NestJS, Drizzle, and SQLite in a pnpm workspace.

| Area           | Features                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Orders         | Commercial revisions, submission, approval, rejection, and cancellation                                        |
| Fulfillment    | Loading, multiple shipments, partial deliveries, returns, shipment and delivery corrections                    |
| Accounts       | Customer receipts, moving misattributed payments, cash allocation, credits, applications, and recorded refunds |
| Rewards        | Locked and available points, redemption history, and pending recoveries                                        |
| Activity       | Staff attribution, customer timelines, commercial revisions, and posting history                               |
| Administration | Email/password sign-in, user management, and Sales/KAM/Warehouse/Accounts/Admin roles                          |

Use customer and sales order tables to find records, open their detail pages, and manage orders through dedicated creation, editing, approval, cancellation, and fulfillment forms. Customer account pages group payments, credits, refunds, and rewards. Local development data includes customer and order histories across approval, fulfillment, and settlement states.

See [development setup](CONTRIBUTING.md) to run locally and the [documentation index](docs/README.md) for operating and API references.

## Related

- [Development setup](CONTRIBUTING.md)
- [Documentation](docs/README.md)
