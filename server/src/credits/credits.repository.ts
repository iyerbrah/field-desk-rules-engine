import { Injectable, Module } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt, min, sum } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { safe, recordInsert } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import {
  crmCreditNotes,
  crmCreditFunds,
  crmCreditApplications,
  crmCreditRefunds,
} from '../credits/credits.model.js';

@Injectable()
export class CreditsRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  reservedFromReceipt(receiptId: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditFunds.amount_paise).mapWith(Number) })
        .from(crmCreditFunds)
        .where(eq(crmCreditFunds.receipt_id, receiptId))
        .get()?.value ?? 0,
    );
  }
  appliedToCharge(chargeId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmCreditApplications.amount_paise).mapWith(Number),
        })
        .from(crmCreditApplications)
        .where(eq(crmCreditApplications.charge_id, chargeId))
        .get()?.value ?? 0,
    );
  }
  creditByNoteForCharge(chargeId: string) {
    return this.db
      .select({
        credit_note_id: crmCreditApplications.credit_note_id,
        n: sum(crmCreditApplications.amount_paise).mapWith(Number),
      })
      .from(crmCreditApplications)
      .where(eq(crmCreditApplications.charge_id, chargeId))
      .groupBy(crmCreditApplications.credit_note_id)
      .having(gt(sum(crmCreditApplications.amount_paise), 0))
      .orderBy(desc(min(insertionOrder(crmCreditApplications))))
      .all()
      .map((row) => ({ ...row, n: safe(row.n ?? 0) }));
  }
  findCustomerCredit(id: string, customerId: string) {
    return this.db
      .select()
      .from(crmCreditNotes)
      .where(
        and(
          eq(crmCreditNotes.id, id),
          eq(crmCreditNotes.customer_id, customerId),
        ),
      )
      .get();
  }
  appliedFromCredit(creditId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmCreditApplications.amount_paise).mapWith(Number),
        })
        .from(crmCreditApplications)
        .where(eq(crmCreditApplications.credit_note_id, creditId))
        .get()?.value ?? 0,
    );
  }
  refundedFromCredit(creditId: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditRefunds.amount_paise).mapWith(Number) })
        .from(crmCreditRefunds)
        .where(eq(crmCreditRefunds.credit_note_id, creditId))
        .get()?.value ?? 0,
    );
  }
  fundsForCredit(creditId: string) {
    return this.db
      .select()
      .from(crmCreditFunds)
      .where(eq(crmCreditFunds.credit_note_id, creditId))
      .orderBy(insertionOrder(crmCreditFunds))
      .all();
  }
  refundedFromReceipt(creditId: string, receiptId: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditRefunds.amount_paise).mapWith(Number) })
        .from(crmCreditRefunds)
        .where(
          and(
            eq(crmCreditRefunds.credit_note_id, creditId),
            eq(crmCreditRefunds.receipt_id, receiptId),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  findCustomerApplication(id: string, customerId: string) {
    return this.db
      .select()
      .from(crmCreditApplications)
      .where(
        and(
          eq(crmCreditApplications.id, id),
          eq(crmCreditApplications.customer_id, customerId),
          gt(crmCreditApplications.amount_paise, 0),
        ),
      )
      .get();
  }
  applicationReversals(id: string) {
    return safe(
      this.db
        .select({
          value: sum(crmCreditApplications.amount_paise).mapWith(Number),
        })
        .from(crmCreditApplications)
        .where(eq(crmCreditApplications.reversal_of_id, id))
        .get()?.value ?? 0,
    );
  }
  appliedBetween(creditId: string, chargeId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmCreditApplications.amount_paise).mapWith(Number),
        })
        .from(crmCreditApplications)
        .where(
          and(
            eq(crmCreditApplications.credit_note_id, creditId),
            eq(crmCreditApplications.charge_id, chargeId),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  findCustomerRefund(id: string, customerId: string) {
    return this.db
      .select()
      .from(crmCreditRefunds)
      .where(
        and(
          eq(crmCreditRefunds.id, id),
          eq(crmCreditRefunds.customer_id, customerId),
          gt(crmCreditRefunds.amount_paise, 0),
        ),
      )
      .get();
  }
  refundReversals(id: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditRefunds.amount_paise).mapWith(Number) })
        .from(crmCreditRefunds)
        .where(eq(crmCreditRefunds.reversal_of_id, id))
        .get()?.value ?? 0,
    );
  }
  creditsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmCreditNotes)
      .where(eq(crmCreditNotes.customer_id, customerId))
      .orderBy(insertionOrder(crmCreditNotes))
      .all();
  }
  refundedForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditRefunds.amount_paise).mapWith(Number) })
        .from(crmCreditRefunds)
        .where(eq(crmCreditRefunds.customer_id, customerId))
        .get()?.value ?? 0,
    );
  }
  /** CRD-001: funding recorded when the credit was issued, before withdrawals. */
  originalFundingForCredit(creditId: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditFunds.amount_paise).mapWith(Number) })
        .from(crmCreditFunds)
        .where(
          and(
            eq(crmCreditFunds.credit_note_id, creditId),
            gt(crmCreditFunds.amount_paise, 0),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  /** CRD-004: net funding per receipt for a credit, in funding order. */
  fundingByReceiptForCredit(creditId: string) {
    return this.db
      .select({
        receipt_id: crmCreditFunds.receipt_id,
        n: sum(crmCreditFunds.amount_paise).mapWith(Number),
      })
      .from(crmCreditFunds)
      .where(eq(crmCreditFunds.credit_note_id, creditId))
      .groupBy(crmCreditFunds.receipt_id)
      .having(gt(sum(crmCreditFunds.amount_paise), 0))
      .orderBy(asc(min(insertionOrder(crmCreditFunds))))
      .all()
      .map((row) => ({ ...row, n: safe(row.n ?? 0) }));
  }
  /**
   * ACC-004: funding rows drawn from a receipt that still fund something,
   * latest first, with the amount each still funds after withdrawals.
   */
  fundsFromReceipt(receiptId: string) {
    const rows = this.db
      .select()
      .from(crmCreditFunds)
      .where(eq(crmCreditFunds.receipt_id, receiptId))
      .orderBy(insertionOrder(crmCreditFunds))
      .all();
    const withdrawn = new Map<string, number>();
    for (const row of rows)
      if (row.reversal_of_id)
        withdrawn.set(
          row.reversal_of_id,
          (withdrawn.get(row.reversal_of_id) ?? 0) + row.amount_paise,
        );
    return rows
      .filter((row) => !row.reversal_of_id)
      .map((row) => ({
        ...row,
        remaining: row.amount_paise + (withdrawn.get(row.id) ?? 0),
      }))
      .filter((row) => row.remaining > 0)
      .reverse();
  }
  /** Applications of a credit to charges, latest first. */
  applicationsForCreditLatestFirst(creditId: string) {
    return this.db
      .select()
      .from(crmCreditApplications)
      .where(
        and(
          eq(crmCreditApplications.credit_note_id, creditId),
          gt(crmCreditApplications.amount_paise, 0),
        ),
      )
      .orderBy(desc(insertionOrder(crmCreditApplications)))
      .all();
  }
  fundedForCredit(creditId: string) {
    return safe(
      this.db
        .select({ value: sum(crmCreditFunds.amount_paise).mapWith(Number) })
        .from(crmCreditFunds)
        .where(eq(crmCreditFunds.credit_note_id, creditId))
        .get()?.value ?? 0,
    );
  }
  invalidApplications(creditId: string) {
    return this.db
      .select({ chargeId: crmCreditApplications.charge_id })
      .from(crmCreditApplications)
      .where(eq(crmCreditApplications.credit_note_id, creditId))
      .groupBy(crmCreditApplications.charge_id)
      .having(lt(sum(crmCreditApplications.amount_paise), 0))
      .all().length;
  }
  invalidRefunds(creditId: string, fundingCreditId: string) {
    const totals = this.db
      .select({
        receiptId: crmCreditRefunds.receipt_id,
        amount: sum(crmCreditRefunds.amount_paise).mapWith(Number),
      })
      .from(crmCreditRefunds)
      .where(eq(crmCreditRefunds.credit_note_id, creditId))
      .groupBy(crmCreditRefunds.receipt_id)
      .all();
    return totals.filter((row) => {
      const amount = row.amount ?? 0;
      const funding =
        this.db
          .select({ amount: sum(crmCreditFunds.amount_paise).mapWith(Number) })
          .from(crmCreditFunds)
          .where(
            and(
              eq(crmCreditFunds.credit_note_id, fundingCreditId),
              eq(crmCreditFunds.receipt_id, row.receiptId),
            ),
          )
          .get()?.amount ?? 0;
      return amount < 0 || amount > funding;
    }).length;
  }
  applicationsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmCreditApplications)
      .where(eq(crmCreditApplications.customer_id, customerId))
      .orderBy(insertionOrder(crmCreditApplications))
      .all();
  }
  refundsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmCreditRefunds)
      .where(eq(crmCreditRefunds.customer_id, customerId))
      .orderBy(insertionOrder(crmCreditRefunds))
      .all();
  }
  insertCredit(c: ActionContext, row: typeof crmCreditNotes.$inferInsert) {
    this.db.insert(crmCreditNotes).values(row).run();
    recordInsert(c, 'credit_notes', row, false);
  }
  insertFunding(c: ActionContext, row: typeof crmCreditFunds.$inferInsert) {
    this.db.insert(crmCreditFunds).values(row).run();
    recordInsert(c, 'credit_funds', row, false);
  }
  insertApplication(
    c: ActionContext,
    row: typeof crmCreditApplications.$inferInsert,
  ) {
    this.db.insert(crmCreditApplications).values(row).run();
    recordInsert(c, 'credit_applications', row, true);
  }
  insertRefund(c: ActionContext, row: typeof crmCreditRefunds.$inferInsert) {
    this.db.insert(crmCreditRefunds).values(row).run();
    recordInsert(c, 'credit_refunds', row, true);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [CreditsRepository],
  exports: [CreditsRepository],
})
export class CreditsRepositoryModule {}
