# Decisions

One line each: decision, reason, date. Business-intent decisions were made by the candidate. Implementation decisions were proposed by Claude and accepted in the plan.

| # | Decision | Reason | Date |
| --- | --- | --- | --- |
| 1 | FDSK-170 means the removed units go back to *dispatched, in transit*. The command asks no "never left the warehouse?" question. | The story says in transit. "Never left" changes dispatched quantity and open demand, so it would be a separate dispatch-correction command (future work). | 2026-10-31 |
| 2 | FDSK-170 released cash becomes **free cash** that WF-002 re-allocates. It does not become a credit note. | Nothing came back to the warehouse: a record was wrong. This deliberately differs from WF-003 returns. | 2026-10-31 |
| 3 | FDSK-170 `deliveredQty` is the corrected **total** for the line, not a delta. | It matches how a KAM describes the mistake ("ten should have been six"). | 2026-10-31 |
| 4 | FDSK-170 reverses confirmations **latest first**. | Returns consume charges earliest first, so latest-first reversal can't push a partly returned charge below zero while returned ≤ corrected total holds. | 2026-10-31 |
| 5 | FDSK-169 v1 **rejects** a move that would touch credit funded by the receipt (`RECEIPT_FUNDS_CREDIT`). | With less than 5 hours left, the open-credit shrink and the applied-credit question (resolved decision 1 in CLAUDE.md) were deferred. They need a signed `credit_funds` migration, audit changes and an answer mechanism. Documented as a known limit. | 2026-10-31 |
| 6 | FDSK-169 partial move order: **free cash first**, then allocations in reverse order of first allocation, then credit (refused in v1). | Fewest charges reopen, and the release order mirrors WF-003. | 2026-10-31 |
| 7 | FDSK-169 records a `receipt_transfers` row. It does **not** add `payment_receipts.transferred_from_receipt_id`. | The transfer already links both receipts (`receipt_id` and `to_receipt_id`). A second link would be redundant and would rebuild `payment_receipts`. | 2026-10-31 |
| 8 | A receipt's capacity uses its **effective amount**, captured minus transfers out, exposed as `effective_paise`. | Receipts stay immutable (WF-001). Every capacity site (allocation, credit issue, summary, audit) reads one figure. | 2026-10-31 |
| 9 | Accounts touched by a command are version-checked after the handler runs. Secondary accounts need `expectedVersions`. | The handler discovers the second account. Checking at the end keeps one generic rule for every multi-account command. | 2026-10-31 |
| 10 | Cut for time: batched questions with answers, dry-run preview, value objects everywhere, command registry and declared reactions, UI forms, and the Solution B slice. | Less than 5 hours on deadline day. The core reconciler and both features came first. The cuts are described in `04-architecture-final.md` and `Evaluator_notes.md`. | 2026-10-31 |
