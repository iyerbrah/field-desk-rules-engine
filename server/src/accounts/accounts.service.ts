import { ChargeBalance } from './accounts.model.js';
import { CreditBalance } from '../credits/credits.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CustomerSummary,
  LedgerView,
  CustomerAccountRow,
} from '@crm/shared/crm';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { DatabaseService } from '../database/database.service.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import {
  authorize,
  useCustomer,
  fail,
  safe,
  forCustomer,
} from '../common/domain.js';
import { CapacityReconciler } from '../settlement/capacity.reconciler.js';

@Injectable()
export class AccountsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly rewardsService: RewardsService,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
    private readonly returnsRepository: ReturnsRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly database: DatabaseService,
    private readonly capacityReconciler: CapacityReconciler,
  ) {}
  receive(c: Context, p: Payload<'RECEIVE_CUSTOMER_PAYMENT'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const receiptId = randomUUID();
    c.references.receiptId = receiptId;
    this.accountsRepository.insertReceipt(c, {
      id: receiptId,
      customer_id: c.customerId,
      amount_paise: p.amountPaise,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });

    this.allocateCash(c);

    this.rewardsService.refresh(c);
  }
  allocate(c: Context, p: Payload<'ALLOCATE_PAYMENT'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));

    this.allocateCash(c);

    this.rewardsService.refresh(c);
  }
  /**
   * ACC-004 (FDSK-169): move a payment recorded against the wrong
   * customer. Records the transfer and the receiving receipt; the capacity
   * reconciler releases what the source receipt can no longer cover, and
   * WF-002 re-allocates cash on both accounts.
   */
  reattribute(c: Context, p: Payload<'REATTRIBUTE_PAYMENT'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    if (p.targetCustomerId === c.customerId)
      fail(
        'SAME_CUSTOMER',
        'Choose a different customer to receive the payment',
      );
    if (!this.customersRepository.findById(p.targetCustomerId))
      fail('NOT_FOUND', 'The receiving customer does not exist');
    const receipt = this.accountsRepository.findCustomerReceipt(
      p.receiptId,
      c.customerId,
    );
    if (!receipt)
      fail('RECEIPT_NOT_FOUND', 'Select a receipt recorded on this customer');
    const amount = p.amountPaise ?? receipt.effective_paise;
    if (amount <= 0 || amount > receipt.effective_paise)
      fail(
        'AMOUNT_EXCEEDED',
        `Only ${receipt.effective_paise} paise of this receipt remain on the account`,
      );
    // CUS-001: the receiving account is checked like the source.
    const target = forCustomer(c, p.targetCustomerId);
    const receiptId = randomUUID();
    const transferId = randomUUID();
    c.references.receiptId = receiptId;
    c.references.transferId = transferId;
    this.accountsRepository.insertReceipt(target, {
      id: receiptId,
      customer_id: target.customerId,
      amount_paise: amount,
      reference: receipt.reference,
      action_id: c.id,
      created_at: c.now,
    });
    this.accountsRepository.insertTransfer(c, {
      id: transferId,
      customer_id: c.customerId,
      receipt_id: receipt.id,
      to_customer_id: target.customerId,
      to_receipt_id: receiptId,
      amount_paise: amount,
      reason: p.reason,
      bank_reference: p.bankReference,
      action_id: c.id,
      created_at: c.now,
    });
    // ACC-002: free cash absorbs the move first, then allocations are
    // released latest first.
    const fundsCredit = this.capacityReconciler.releaseReceiptOverAllocation(
      c,
      receipt.id,
    );
    // Known limit (v1): moving money that funds customer credit is refused.
    if (fundsCredit)
      fail(
        'RECEIPT_FUNDS_CREDIT',
        `${fundsCredit} paise of this receipt fund customer credit. Moving them is not supported yet: reverse the credit's use first, or move a smaller amount.`,
      );
    // WF-002: payment re-attribution is a cash-allocation occasion on both
    // accounts, and rewards follow the cash (REW-002, REW-003).
    for (const account of [c, target]) {
      this.allocateCash(account);
      this.rewardsService.refresh(account);
    }
  }
  allocateCash(c: Context) {
    for (const receipt of this.accountsRepository.receiptsForCustomer(
      c.customerId,
    )) {
      let available =
        receipt.effective_paise -
        this.accountsRepository.allocatedFromReceipt(receipt.id) -
        this.creditsRepository.reservedFromReceipt(receipt.id);
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.accountsRepository.chargesInDueOrder(
        c.customerId,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const cash = this.accountsRepository.cashForCharge(charge.id);
        const credit = this.creditsRepository.appliedToCharge(charge.id);
        const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.accountsRepository.insertAllocation(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }
  }
  summary(customerId: string): CustomerSummary {
    const customer = this.customersRepository.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const charges = this.accountsRepository
      .chargesForCustomer(customerId)
      .map((charge) => {
        const remainingPaise =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const cashPaidPaise = this.accountsRepository.cashForCharge(charge.id);
        const credit = this.creditsRepository.appliedToCharge(charge.id);
        const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
        return {
          ...charge,
          remainingPaise,
          cashPaidPaise,
          outstandingPaise: new ChargeBalance(
            remainingPaise,
            cashPaidPaise,
            credit,
            redeemed,
          ).outstandingPaise,
        };
      });
    const credits = this.creditsRepository
      .creditsForCustomer(customerId)
      .map((note) => {
        const appliedPaise = this.creditsRepository.appliedFromCredit(note.id);
        const refundedPaise = this.creditsRepository.refundedFromCredit(
          note.id,
        );
        return {
          ...note,
          appliedPaise,
          refundedPaise,
          availablePaise: new CreditBalance(
            note.amount_paise,
            appliedPaise,
            refundedPaise,
          ).availablePaise,
        };
      });
    const receipts = this.accountsRepository.receiptsByInsertion(customerId);
    const unappliedCashPaise = safe(
      receipts.reduce(
        (sum, receipt) =>
          sum +
          receipt.effective_paise -
          this.accountsRepository.allocatedFromReceipt(receipt.id) -
          this.creditsRepository.reservedFromReceipt(receipt.id),
        0,
      ),
    );
    const receivedPaise =
      this.accountsRepository.receivedForCustomer(customerId);
    const refundsPaise = this.creditsRepository.refundedForCustomer(customerId);
    const redemption = this.rewardsRepository.redeemedForCustomer(customerId);
    const netBalancePaise = safe(
      this.accountsRepository.postedForCustomer(customerId) -
        receivedPaise +
        refundsPaise -
        redemption,
    );
    return {
      customer,
      charges,
      credits,
      netBalancePaise,
      unappliedCashPaise,
      receivedPaise,
      refundsPaise,
      outstandingPaise: safe(
        charges.reduce((sum, row) => sum + row.outstandingPaise, 0),
      ),
      creditsOpenPaise: safe(
        credits.reduce((sum, row) => sum + row.availablePaise, 0),
      ),
      points: this.rewardsService.balances(customerId),
    };
  }
  ledger(customerId: string): LedgerView {
    this.summary(customerId);
    return {
      finance: this.accountsRepository.entriesForCustomer(customerId),
      receipts: this.accountsRepository.receiptsByInsertion(customerId),
      transfers: this.accountsRepository.transfersForCustomer(customerId),
      allocations: this.accountsRepository.allocationsForCustomer(customerId),
      creditApplications:
        this.creditsRepository.applicationsForCustomer(customerId),
      credits: this.creditsRepository.creditsForCustomer(customerId),
      refunds: this.creditsRepository.refundsForCustomer(customerId),
      redemptions: this.rewardsRepository.redemptionsForCustomer(customerId),
      rewards: this.rewardsRepository.entriesForCustomer(customerId),
      returns: this.returnsRepository.forCustomer(customerId),
      corrections:
        this.fulfillmentRepository.correctionsForCustomer(customerId),
    };
  }
  accounts(): CustomerAccountRow[] {
    return this.database.db.transaction(() =>
      this.customersRepository.list().map((customer) => {
        const summary = this.summary(customer.id);
        return {
          customer,
          netBalancePaise: summary.netBalancePaise,
          outstandingPaise: summary.outstandingPaise,
          unappliedCashPaise: summary.unappliedCashPaise,
          creditsOpenPaise: summary.creditsOpenPaise,
        };
      }),
    );
  }
}
