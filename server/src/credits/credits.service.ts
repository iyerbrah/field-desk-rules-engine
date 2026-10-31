import { CreditBalance } from './credits.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { authorize, useCustomer, fail, safe } from '../common/domain.js';

@Injectable()
export class CreditsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
  ) {}
  issueCredit(c: Context, p: Payload<'ISSUE_CREDIT_NOTE'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    let available = 0;
    const funds = this.accountsRepository
      .receiptsByInsertion(c.customerId)
      .map((receipt) => {
        const free =
          receipt.effective_paise -
          this.accountsRepository.allocatedFromReceipt(receipt.id) -
          this.creditsRepository.reservedFromReceipt(receipt.id);
        available = safe(available + free);
        return { id: receipt.id, free };
      });
    if (p.amountPaise > available)
      fail(
        'CASH_UNAVAILABLE',
        'The credit exceeds the customer’s unapplied cash',
      );
    const creditId = randomUUID();
    c.references.creditNoteId = creditId;
    this.creditsRepository.insertCredit(c, {
      id: creditId,
      customer_id: c.customerId,
      return_id: null,
      amount_paise: p.amountPaise,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });
    let left = p.amountPaise;
    for (const receipt of funds) {
      const take = Math.min(left, receipt.free);
      if (take)
        this.creditsRepository.insertFunding(c, {
          id: randomUUID(),
          credit_note_id: creditId,
          receipt_id: receipt.id,
          amount_paise: take,
        });
      left -= take;
    }
  }
  applyCredit(c: Context, p: Payload<'APPLY_CREDIT_NOTE'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const note = this.creditsRepository.findCustomerCredit(
      p.creditNoteId,
      c.customerId,
    );
    if (!note)
      fail('CREDIT_NOT_FOUND', 'Select a credit belonging to this customer');
    new CreditBalance(
      this.creditsRepository.fundedForCredit(note.id),
      this.creditsRepository.appliedFromCredit(note.id),
      this.creditsRepository.refundedFromCredit(note.id),
    ).assertAvailable(p.amountPaise, 'application');
    const charge = this.accountsRepository.findCustomerCharge(
      p.chargeId,
      c.customerId,
    );
    if (!charge)
      fail('CHARGE_NOT_FOUND', 'Select a charge belonging to this customer');
    const due =
      charge.amount_paise +
      this.accountsRepository.adjustmentsForCharge(charge.id) -
      this.accountsRepository.cashForCharge(charge.id) -
      this.creditsRepository.appliedToCharge(charge.id) -
      this.rewardsRepository.redeemedForCharge(charge.id);
    if (p.amountPaise > due)
      fail('AMOUNT_EXCEEDED', 'The application exceeds the outstanding charge');
    this.creditsRepository.insertApplication(c, {
      id: randomUUID(),
      customer_id: c.customerId,
      credit_note_id: note.id,
      charge_id: charge.id,
      amount_paise: p.amountPaise,
      action_id: c.id,
      created_at: c.now,
    });
  }
  refundCredit(c: Context, p: Payload<'REFUND_CREDIT_NOTE'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const note = this.creditsRepository.findCustomerCredit(
      p.creditNoteId,
      c.customerId,
    );
    if (!note)
      fail('CREDIT_NOT_FOUND', 'Select a credit belonging to this customer');
    new CreditBalance(
      this.creditsRepository.fundedForCredit(note.id),
      this.creditsRepository.appliedFromCredit(note.id),
      this.creditsRepository.refundedFromCredit(note.id),
    ).assertAvailable(p.amountPaise, 'refund');
    let remaining = p.amountPaise;
    // CRD-004: split across funding receipts in funding order, net of any
    // funding withdrawn under ACC-004.
    for (const fund of this.creditsRepository.fundingByReceiptForCredit(
      note.id,
    )) {
      const free =
        fund.n -
        this.creditsRepository.refundedFromReceipt(note.id, fund.receipt_id);
      const take = Math.min(free, remaining);
      if (!take) continue;
      this.creditsRepository.insertRefund(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        credit_note_id: note.id,
        receipt_id: fund.receipt_id,
        amount_paise: take,
        reference: p.reference,
        action_id: c.id,
        created_at: c.now,
      });
      remaining -= take;
    }
    if (remaining)
      fail('FUNDING_MISMATCH', 'The credit has insufficient receipt backing');
  }
  reverseCreditApplication(
    c: Context,
    p: Payload<'REVERSE_CREDIT_APPLICATION'>,
  ) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const original = this.creditsRepository.findCustomerApplication(
      p.applicationId,
      c.customerId,
    );
    if (!original)
      fail(
        'APPLICATION_NOT_FOUND',
        'Select a credit application belonging to this customer',
      );
    const unreversed =
      original.amount_paise +
      this.creditsRepository.applicationReversals(original.id);
    const applied = this.creditsRepository.appliedBetween(
      original.credit_note_id,
      original.charge_id,
    );
    if (p.amountPaise > Math.min(unreversed, applied))
      fail(
        'REVERSAL_EXCEEDED',
        'The reversal exceeds the remaining applied credit',
      );
    const reversalId = randomUUID();
    this.creditsRepository.insertApplication(c, {
      id: reversalId,
      customer_id: c.customerId,
      credit_note_id: original.credit_note_id,
      charge_id: original.charge_id,
      amount_paise: -p.amountPaise,
      reversal_of_id: original.id,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });
    c.references.applicationId = original.id;
    c.references.reversalId = reversalId;
    c.references.creditNoteId = original.credit_note_id;
  }
  reverseCreditRefund(c: Context, p: Payload<'REVERSE_CREDIT_REFUND'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const original = this.creditsRepository.findCustomerRefund(
      p.refundId,
      c.customerId,
    );
    if (!original)
      fail('REFUND_NOT_FOUND', 'Select a refund belonging to this customer');
    const remaining =
      original.amount_paise +
      this.creditsRepository.refundReversals(original.id);
    if (p.amountPaise > remaining)
      fail('REVERSAL_EXCEEDED', 'The reversal exceeds the unreversed refund');
    const reversalId = randomUUID();
    this.creditsRepository.insertRefund(c, {
      id: reversalId,
      customer_id: c.customerId,
      credit_note_id: original.credit_note_id,
      receipt_id: original.receipt_id,
      amount_paise: -p.amountPaise,
      reversal_of_id: original.id,
      reason: p.reason,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });
    c.references.refundId = original.id;
    c.references.reversalId = reversalId;
    c.references.creditNoteId = original.credit_note_id;
  }
  forCustomer(customerId: string) {
    if (!this.customersRepository.findById(customerId))
      throw new NotFoundException('Customer not found');
    return this.creditsRepository
      .creditsForCustomer(customerId)
      .map((note) => ({
        ...note,
        availablePaise: new CreditBalance(
          this.creditsRepository.fundedForCredit(note.id),
          this.creditsRepository.appliedFromCredit(note.id),
          this.creditsRepository.refundedFromCredit(note.id),
        ).availablePaise,
      }));
  }
}
