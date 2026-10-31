# Evaluator notes

A short guide to this submission: what to read, what was built, and what wasn't.

## Read in this order

1. `docs/solution/03-architecture-post-research.md`: the stage-3 design, written after reading the code with Claude.
2. `docs/solution/04-architecture-final.md`: what was actually built, and every place it differs from stage 3.
3. `docs/solution/decisions.md`: each business and implementation decision, with its reason.
4. `docs/solution/when-to-build-a-rules-framework.md`: deliverable 3.
5. The commit history from `8537fd9` onwards (`git log --reverse 63fbc8f..`). Each commit is one step and explains why.

## What was built

- **One capacity reconciler** (`server/src/settlement/capacity.reconciler.ts`) that restores ACC-001 (charge capacity) and ACC-002 (receipt capacity) under the WF-003 release order. Return settlement was moved onto it first, with characterization tests proving identical ledger effects. Both features then reuse it.
- **FDSK-170 `CORRECT_DELIVERY`** (new rule FUL-007). The handler records a reversal and an adjustment; the reconciler, WF-002 and rewards do the rest. 11 scenarios in `server/test/delivery-correction.test.ts`.
- **FDSK-169 `REATTRIBUTE_PAYMENT`** (new rule ACC-004). The handler records a transfer and a receipt; the reconciler releases the source receipt's excess, and both accounts re-allocate and refresh rewards. 8 scenarios in `server/test/payment-reattribution.test.ts`.
- **A multi-account engine.** Every customer account a command touches is version-checked, bumped, audited and reviewed.
- **Rules docs updated in the same commits as the code:** FUL-007 and ACC-004 added; FUL-006, ACC-002, WF-002 and WF-005 updated; the API and role docs too.

Test suite: 251 tests originally, 275 now, all green. `pnpm check` passes.

## Known limits

- **FDSK-169 does not move money that funds customer credit.** It rejects with `RECEIPT_FUNDS_CREDIT` and a clear message. The planned open-credit shrink and applied-credit question were deferred for time (decision 5).
- **Released credit applications have no `reversal_of_id` link.** This was true of returns before this work, and is kept for behavioural identity. It is commented in the reconciler.
- **`BUSINESS_TERMS_VERSION` is still `2026-10-26.1`,** although rules were added.
- **Not built:**
  - command registry;
  - declared reactions (handlers still call WF-002 allocation explicitly, with comments naming the occasion);
  - batched questions with answers;
  - dry-run preview;
  - value objects as the single formula source;
  - UI forms and dialogs;
  - the Solution B slice.

  See `04-architecture-final.md` §2 and §4.
- **Multi-account version checks cover customer accounts,** not individual orders on the second account.
- **The FDSK-169 and FDSK-170 scenarios use the HTTP API only.** There is no UI for them.

## Process notes

- The work was done with Claude (Opus 5.5) in Claude Code, on deadline day, under the working agreement in `CLAUDE.md`: plan first, small commits, tests green before every commit, no history rewriting.
- The stage-1 and stage-2 architecture drafts are the candidate's own work and are not written by Claude. If they are missing from `docs/solution/`, they were not finished in time.
- Tests were written before each feature. FDSK-170's scenarios were committed first as `todo` items, so the history shows them, without ever committing a failing suite.
- drizzle-kit generated a broken copy statement in migration `0006`, selecting new columns from the old table. It was fixed by hand, following `0003`, and the commit message says so.
