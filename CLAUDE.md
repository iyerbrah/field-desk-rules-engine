# CLAUDE.md: working agreement and plan for this repository

This repository is my submission for the Tejas take-home **"Business Rules Engine"**. It is a private copy (not a fork) of `AviKKi/field-desk` with the original history kept. The deadline is **31 Oct 2026**. The evaluators read the code, the docs, **the git history and our chat history**. Work accordingly.

## 1. The assignment in one paragraph

The canonical business rules live in `docs/candidate-walkthrough/canonical_business_rules.md`. Today they are implemented as hand-written service code, and every new rule or command has to be wired into several places by hand. The task is to reduce that combinatorial explosion with a framework, a set of patterns, or a mix of both. Two features go on top of it:

- **FDSK-169**: move a payment recorded against the wrong customer.
- **FDSK-170**: correct an overstated delivery confirmation.

Evaluation criteria: clarity of design over coverage, honesty, generality with understood limits, elegance of the two features, rules expressed concisely and readable by non-engineers, and a commit history that tells the story.

## 2. How we work (non-negotiable)

1. **Plan before code.** For each phase below, propose a short plan (files, approach, tests). Wait for my OK before editing.
2. **Small commits.** One logical change per commit: one refactor, one rule, or one feature slice. Each message says *what changed and why*, and cites rule IDs (for example `WF-003`) where relevant.
3. **Never** squash, amend a pushed commit, rebase published history, or force-push. History stays as it happened.
4. **Run `pnpm test` before every commit.** The suite has 251 tests and takes about 80 s on the original code. Run `pnpm check` (lint, typecheck, tests, build) at the end of each phase. Never commit with failing tests. Never weaken or delete an existing test to make something pass: stop and tell me.
5. **Cite rules in code.** Put rule IDs in comments where a rule is enforced (`// ACC-001 charge capacity`). New rules get new IDs in the canonical rules doc in the same commit as the code.
6. **Don't write my architecture drafts.** `docs/solution/01-*` and `02-*` are mine. You may critique them and contribute to stage 3 and 4 when I ask.
7. **Be honest about limits.** If something is unsupported or approximate, say so in code comments, docs and `Evaluator_notes.md`. Never paper over it.
8. When unsure about business intent, **ask me**. Don't guess silently. Record each decision in `docs/solution/decisions.md` (one line each: decision, reason, date).

## 3. Codebase facts (verified)

- Stack: pnpm workspace with `client/` (React, shadcn, Zustand), `server/` (NestJS, Drizzle, better-sqlite3) and `shared/` (Zod contracts, `shared/src/crm.ts`).
- Commands: `pnpm install`, `pnpm test`, `pnpm check`, `pnpm db:generate` (Drizzle migration from the schema; migrations live in `server/drizzle/`, currently 0000 to 0005).
- **Command path**: `POST /actions` goes to `server/src/actions/actions.service.ts`. It opens an immediate transaction, checks idempotency, then opens a nested savepoint. Inside the savepoint it:
  1. resolves one aggregate (order or customer) and checks `expectedVersion`;
  2. dispatches through a **20-case switch**;
  3. bumps versions for **one** customer and its orders;
  4. runs `AuditService.review(customerId)` and fails with `ACCOUNT_INCONSISTENT` if any check fails.

  `DomainFailure` rolls back to REJECTED or CONFLICT. `DomainDecision` rolls back to `NEEDS_DECISION`.
- **Reactions are hand-wired**: `allocateCash(c)` then `rewardsService.refresh(c)` is pasted into `fulfillment.service.ts` (`deliver`, `correct`), `returns.service.ts` (`returnItems`) and `accounts.service.ts` (`receive`, `allocate`). There is one more `refresh` in `orders.service.ts`. WF-002 is the rule these encode.
- **Rewards** (`rewards.service.ts#refresh`) already uses reconcile-to-target: it recomputes from facts and posts the delta.
- **Return settlement** (`returns.service.ts`, about lines 64 to 234) hand-codes the WF-003 release: reduce the charge, then release cash, then credit, then points, and turn the remaining released cash into a new credit note.
- **Ledgers are append-only and signed**, linked by `adjusts_id` / `reversal_of_id`. Check constraints to know about:
  - `payment_receipts.amount_paise > 0`;
  - `credit_funds.amount_paise > 0`;
  - `credit_notes.amount_paise > 0`;
  - `deliveries.qty > 0`;
  - `credit_refunds` already uses the signed-with-reversal pattern; copy it.
- **Single-customer assumption** shows up in `ActionContext.customerId`, the version bump, `review()`, and `AccountsRepository.receivedForCustomer` (which sums raw receipts). The test helper `assertAccount` in `server/test/customer-workflows.test.ts` also sums raw receipts.
- **Formulas are duplicated**: reward earning lives in `RewardsService` and again in `AuditService` (BigInt). Charge outstanding is computed inline in at least 4 places. `ChargeBalance` and `CreditBalance` live in the models.
- **Client**: decisions are only joined into an error string (`client/src/features/crm/context.tsx:128`). There is no way to answer them.
- **Tests**: `node:test` with Nest testing and supertest. Use `server/test/support/http-desk.ts` (`HttpDesk`) and `crm-fixtures.ts`. Look at `customer-workflows.test.ts` for the scenario style.

## 4. Target architecture (see `docs/solution/03-architecture-post-research.md`)

**Key insight:** returns, FDSK-169 and FDSK-170 all *shrink a capacity that has already been consumed*. A charge's retained value can fall below its settlement (ACC-001), or a receipt's effective amount can fall below its allocations and funding (ACC-002). We build **one capacity-restoring reconciler** with a declared release-order policy (WF-003). Each feature then only records facts.

Pipeline: **Command spec → apply (append facts) → reactions to fixpoint → verify invariants for every touched account → commit, or a preview/decision result.**

Reactions come in two kinds:
- **Data-triggered**: capacity restore and reward refresh. They watch the tables written, which `c.effects[].entity` already records.
- **Policy-triggered**: cash allocation runs only on the WF-002 occasion list. WF-002 says other operations must *not* allocate, so cash allocation must not become purely reactive.

## 5. Resolved decisions

1. **FDSK-169 and credit funded by the moved receipt.**
   - Unused open credit: shrink the funding through a signed adjustment.
   - Credit already applied: raise a **question**, and reverse the application when confirmed.
   - Credit already refunded: **reject** with a clear message (recovery happens outside the system).
2. **FDSK-170 meaning.** The removed units revert to *dispatched, in transit*. No "never left the warehouse?" question; that would be a separate dispatch-correction command (future work).
3. **FDSK-170 released cash** becomes **free cash** and is re-allocated by WF-002. It does *not* become a credit note, because nothing was returned. This deliberately differs from WF-003.
4. **Solution B**: a demonstration slice on branch `solution-b` only, if time allows.

## 6. Phases (priority order; cut from the bottom)

Each phase ends green on `pnpm check`. The commits listed are guides; split them further if useful.

### Phase 1: Safety net
- `test: pin return-settlement effects before refactoring`. Characterization tests that snapshot the ledger rows produced by returns covering cash, credit, points and fee, so the refactor can be proven behaviour-preserving.

### Phase 2: Capacity reconciler (core of solution A)
- `refactor: extract WF-003 release policy into a capacity reconciler`. Release order: cash, then credit, then points; within cash or credit, source groups in reverse order of first allocation or application. Return settlement keeps its own rule that remaining released cash funds a credit note.
- `refactor: compute balances through the model value objects only` (`ChargeBalance`, a new `ReceiptBalance`, `CreditBalance`).

### Phase 3: Engine capabilities
- `feat(engine): track touched accounts; version-check, bump and review each`. The envelope accepts `expectedVersions?: Record<id, number>`; the single `expectedVersion` stays valid.
- `feat(engine): batch decision questions and accept answers`. `c.ask(key, prompt, options)`; `envelope.answers`; all open questions are returned in one `NEEDS_DECISION`.
- `feat(engine): dry-run preview`. `dryRun: true` runs everything in the savepoint, returns `PREVIEW` with effects and review, then rolls back. It must not consume the idempotency key as a real application.

### Phase 4: FDSK-170, `CORRECT_DELIVERY` (rule FUL-007; KAM and Admin)
- Payload: `{ orderId, shipmentId, items: [{ shipmentLineId, deliveredQty /* corrected total */ }], reason, evidence }`.
- Schema: `deliveries` gets `reversal_of_id`, `reason` and `evidence`. The check becomes "positive with no reversal link, or negative with one". Write a migration.
- Behaviour:
  - Require $r_h \le d'_h < d_h$.
  - Reverse confirmations latest first.
  - Add one `DELIVERY_CORRECTION` adjustment per affected charge (`adjusts_id`).
  - Move the shipment from `DELIVERED` back to `DISPATCHED`.
  - The reconciler releases settlement, WF-002 re-allocates, and rewards refresh.
- **Write the tests first:**
  - Unpaid 10 corrected to 6, then confirm the remaining 4.
  - Cash-paid, where freed cash settles an older charge.
  - Credit-paid, where credit goes back to its note.
  - Points-paid, where points are restored.
  - Points earned and already redeemed, leading to clawback pending.
  - Returned 3, correct to 2: rejected.
  - Correction on a WF-004 supplement shipment.
  - Wrong role: rejected.
  - Stale version: conflict.

### Phase 5: FDSK-169, `REATTRIBUTE_PAYMENT` (rule ACC-004; Accounts and Admin)
- Payload: `{ customerId, receiptId, targetCustomerId, amountPaise?, reason, bankReference, expectedVersions }`. If `amountPaise` is omitted, the full remaining amount moves.
- Schema:
  - new `receipt_transfers` table (from, to, amount, reason, bank reference, new receipt id, action id);
  - `payment_receipts.transferred_from_receipt_id`;
  - signed credit-funding adjustment.
- Effective receipt amount = amount minus transfers out. Update ACC-002, `receivedForCustomer`, the summaries, the audit checks and the test helper.
- Both accounts: the reconciler releases on the source, WF-002 allocates on both, rewards refresh on both, and each timeline gets an audit event.
- **Write the tests first:**
  - Unallocated advance.
  - Fully allocated (the brief's ₹10,000 Greenfield/Northside example), including Northside clawback.
  - Partial move.
  - Funded open credit.
  - Applied credit: question, then answered success.
  - Refunded credit: rejected.
  - Same customer: rejected.
  - Stale version on either side: conflict.
  - Wrong role: rejected.

### Phase 6: Rules docs
- Add FUL-007 and ACC-004. Update FUL-006 (add DELIVERED back to DISPATCHED), ACC-002 (effective amount) and WF-002 (new occasions). Update `docs/api.md` and the business terms.

### Phase 7: Declarative layer (rest of solution A)
- `refactor: declare WF-002 occasions and reactions once`. This removes the pasted tails.
- `refactor: declare commands in a registry` (rule ID, title, roles, targets, handler). This replaces the switch.

### Phase 8: UI (optional)
- A generic decision dialog that renders options and resubmits with answers.
- A "Review changes" preview before Apply.
- Forms for the two new actions.

### Phase 9: Solution B slice (optional, branch `solution-b`)
- ORD-005 and the shipment lifecycle as literal transition tables.
- Invariants named by rule ID.
- A generated, plain-English rule book (`docs/solution/rule-book.md`) built from the specs.

### Phase 10: Wrap-up
- `docs/solution/when-to-build-a-rules-framework.md` (deliverable 3).
- `docs/solution/04-architecture-final.md`, which describes what was really built and differs from stage 3 where it does.
- `Evaluator_notes.md`, `docs/agent-chats/`.

## 7. Out of scope

Bank transfers, dispatch-quantity corrections, editing arbitrary history, multi-instance concurrency.
