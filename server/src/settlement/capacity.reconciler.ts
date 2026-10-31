import { Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccountsRepository,
  AccountsRepositoryModule,
} from '../accounts/accounts.repository.js';
import {
  CreditsRepository,
  CreditsRepositoryModule,
} from '../credits/credits.repository.js';
import {
  RewardsRepository,
  RewardsRepositoryModule,
} from '../rewards/rewards.repository.js';
import type { ActionContext as Context } from '../common/domain.js';
import { fail } from '../common/domain.js';

/**
 * WF-003 release order: when a charge is settled above its retained value,
 * give back cash first, then credit, then points.
 */
export const WF003_RELEASE_ORDER = ['cash', 'credit', 'points'] as const;

/** Cash released per receipt, in the order receipts were first released. */
export type ReleasedCash = Map<string, number>;

/**
 * Restores capacity that a command has shrunk after it was already used.
 *
 * A command records facts only (a return, a delivery correction, ...). If
 * those facts lower a charge's retained value below what already settles
 * it, ACC-001 breaks; this class releases the excess under the WF-003
 * policy. What happens to released cash afterwards is the caller's rule:
 * returns pay their fee and fund a credit note (WF-003), a delivery
 * correction leaves it free for WF-002 allocation.
 */
@Injectable()
export class CapacityReconciler {
  constructor(
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
  ) {}

  /**
   * ACC-001: release settlement above the charge's retained value
   * (face amount plus adjustments). `sourceId` links reward postings to
   * the document that caused the release.
   */
  releaseChargeOverSettlement(
    c: Context,
    chargeId: string,
    sourceId: string,
  ): ReleasedCash {
    const released: ReleasedCash = new Map();
    const charge = this.accountsRepository.findCustomerCharge(
      chargeId,
      c.customerId,
    );
    if (!charge)
      fail('CHARGE_MISMATCH', 'The charge to settle is not on this account');
    const retained =
      charge.amount_paise +
      this.accountsRepository.adjustmentsForCharge(chargeId);
    const redeemed = this.rewardsRepository.redeemedForCharge(chargeId);
    let overage = Math.max(
      0,
      this.accountsRepository.cashForCharge(chargeId) +
        this.creditsRepository.appliedToCharge(chargeId) +
        redeemed -
        retained,
    );
    for (const step of WF003_RELEASE_ORDER) {
      if (!overage) break;
      if (step === 'cash')
        overage = this.releaseCash(c, chargeId, overage, released);
      if (step === 'credit') overage = this.releaseCredit(c, chargeId, overage);
      if (step === 'points')
        overage = this.releasePoints(c, chargeId, overage, redeemed, sourceId);
    }
    return released;
  }

  /**
   * ACC-002: release cash allocations above a receipt's effective amount
   * (captured less transfers out), visiting charges in reverse order of
   * first allocation, as WF-003 does for receipts on a charge. Free cash
   * absorbs a shrink first because only the excess is released. Returns
   * the part allocations could not cover: that part funds credit, which
   * the caller must handle.
   */
  releaseReceiptOverAllocation(c: Context, receiptId: string): number {
    const receipt = this.accountsRepository.findCustomerReceipt(
      receiptId,
      c.customerId,
    );
    if (!receipt)
      fail('RECEIPT_MISMATCH', 'The receipt is not on this account');
    let excess = Math.max(
      0,
      this.accountsRepository.allocatedFromReceipt(receiptId) +
        this.creditsRepository.reservedFromReceipt(receiptId) -
        receipt.effective_paise,
    );
    for (const allocation of this.accountsRepository.cashByChargeForReceipt(
      receiptId,
    )) {
      const take = Math.min(excess, allocation.n);
      if (!take) continue;
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        receipt_id: receiptId,
        charge_id: allocation.charge_id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      excess -= take;
    }
    return excess;
  }

  /**
   * ACC-002 / ACC-004: withdraw `amount` of credit funding drawn from a
   * receipt that moved to another customer, latest funding first. Unused
   * credit is withdrawn first. Credit already applied to charges must be
   * reversed first (the caller decides whether that is allowed). Credit
   * already refunded cannot be withdrawn: that money left the business.
   *
   * With `write` false nothing is recorded; the result says what a write
   * would need, so the caller can ask before acting.
   */
  withdrawCreditFunding(
    c: Context,
    receiptId: string,
    amount: number,
    reason: string,
    write: boolean,
  ) {
    const outcome = { applied: 0, refunded: 0, charges: new Set<string>() };
    let left = amount;
    const byNote = new Map<string, Array<{ id: string; remaining: number }>>();
    for (const fund of this.creditsRepository.fundsFromReceipt(receiptId))
      byNote.set(fund.credit_note_id, [
        ...(byNote.get(fund.credit_note_id) ?? []),
        fund,
      ]);
    for (const [noteId, funds] of byNote) {
      if (!left) break;
      const funded = funds.reduce((sum, fund) => sum + fund.remaining, 0);
      const withdrawable =
        funded - this.creditsRepository.refundedFromReceipt(noteId, receiptId);
      const take = Math.min(left, Math.max(0, withdrawable));
      if (!take) continue;
      left -= take;
      const open =
        this.creditsRepository.fundedForCredit(noteId) -
        this.creditsRepository.appliedFromCredit(noteId) -
        this.creditsRepository.refundedFromCredit(noteId);
      const applied = take - Math.min(take, Math.max(0, open));
      outcome.applied += applied;
      if (applied)
        this.reverseApplications(
          c,
          noteId,
          applied,
          reason,
          write,
          outcome.charges,
        );
      if (!write) continue;
      let withdraw = take;
      for (const fund of funds) {
        const part = Math.min(withdraw, fund.remaining);
        if (!part) continue;
        this.creditsRepository.insertFunding(c, {
          id: randomUUID(),
          credit_note_id: noteId,
          receipt_id: receiptId,
          amount_paise: -part,
          reversal_of_id: fund.id,
          reason,
        });
        withdraw -= part;
      }
    }
    outcome.refunded = left;
    return outcome;
  }

  /** CRD-006: reverse applied credit latest first, with linked negative entries. */
  private reverseApplications(
    c: Context,
    noteId: string,
    amount: number,
    reason: string,
    write: boolean,
    charges: Set<string>,
  ) {
    let left = amount;
    const taken = new Map<string, number>();
    for (const application of this.creditsRepository.applicationsForCreditLatestFirst(
      noteId,
    )) {
      if (!left) break;
      const unreversed =
        application.amount_paise +
        this.creditsRepository.applicationReversals(application.id);
      const onCharge =
        this.creditsRepository.appliedBetween(noteId, application.charge_id) -
        (taken.get(application.charge_id) ?? 0);
      const take = Math.min(left, unreversed, onCharge);
      if (take <= 0) continue;
      left -= take;
      taken.set(
        application.charge_id,
        (taken.get(application.charge_id) ?? 0) + take,
      );
      charges.add(application.charge_id);
      if (write)
        this.creditsRepository.insertApplication(c, {
          id: randomUUID(),
          customer_id: c.customerId,
          credit_note_id: noteId,
          charge_id: application.charge_id,
          amount_paise: -take,
          reversal_of_id: application.id,
          reason,
          action_id: c.id,
          created_at: c.now,
        });
    }
    if (left)
      fail('FUNDING_MISMATCH', 'Applied credit could not be traced to charges');
  }

  /** WF-003: cash goes back to receipts in reverse order of first allocation. */
  private releaseCash(
    c: Context,
    chargeId: string,
    overage: number,
    released: ReleasedCash,
  ) {
    for (const allocation of this.accountsRepository.cashByReceiptForCharge(
      chargeId,
    )) {
      const take = Math.min(overage, allocation.n);
      if (!take) continue;
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        receipt_id: allocation.receipt_id,
        charge_id: chargeId,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      released.set(
        allocation.receipt_id,
        (released.get(allocation.receipt_id) ?? 0) + take,
      );
      overage -= take;
    }
    return overage;
  }

  /** WF-003: credit goes back to its notes in reverse order of first application. */
  private releaseCredit(c: Context, chargeId: string, overage: number) {
    for (const application of this.creditsRepository.creditByNoteForCharge(
      chargeId,
    )) {
      const take = Math.min(overage, application.n);
      if (!take) continue;
      // Known gap kept from the original code: this negative application
      // carries no reversal_of_id link.
      this.creditsRepository.insertApplication(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        credit_note_id: application.credit_note_id,
        charge_id: chargeId,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      overage -= take;
    }
    return overage;
  }

  /** WF-003 / REW-004: redeemed points go back to AVAILABLE. */
  private releasePoints(
    c: Context,
    chargeId: string,
    overage: number,
    redeemed: number,
    sourceId: string,
  ) {
    if (overage > redeemed)
      fail(
        'SETTLEMENT_MISMATCH',
        'The return cannot be settled against its source documents',
      );
    this.rewardsRepository.insertRedemption(c, {
      id: randomUUID(),
      customer_id: c.customerId,
      charge_id: chargeId,
      points: -overage,
      action_id: c.id,
      created_at: c.now,
    });
    for (const [bucket, points] of [
      ['AVAILABLE', overage],
      ['REDEEMED', -overage],
    ] as const)
      this.rewardsRepository.insertPosting(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket,
        points_delta: points,
        source_id: sourceId,
        action_id: c.id,
        created_at: c.now,
      });
    return 0;
  }
}

@Module({
  imports: [
    AccountsRepositoryModule,
    CreditsRepositoryModule,
    RewardsRepositoryModule,
  ],
  providers: [CapacityReconciler],
  exports: [CapacityReconciler],
})
export class CapacityReconcilerModule {}
