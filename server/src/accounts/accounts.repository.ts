import { Injectable, Module } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, min, sum } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { safe, recordInsert } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import {
  crmReceivableEntries,
  crmPaymentReceipts,
  crmPaymentAllocations,
} from '../accounts/accounts.model.js';

@Injectable()
export class AccountsRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  findCharge(id: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(eq(crmReceivableEntries.id, id))
      .get();
  }
  cashForLine(lineKey: string) {
    return safe(
      this.db
        .select({
          value: sum(crmPaymentAllocations.amount_paise).mapWith(Number),
        })
        .from(crmPaymentAllocations)
        .innerJoin(
          crmReceivableEntries,
          eq(crmReceivableEntries.id, crmPaymentAllocations.charge_id),
        )
        .where(eq(crmReceivableEntries.line_key, lineKey))
        .get()?.value ?? 0,
    );
  }
  receiptsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmPaymentReceipts)
      .where(eq(crmPaymentReceipts.customer_id, customerId))
      .orderBy(
        asc(crmPaymentReceipts.created_at),
        insertionOrder(crmPaymentReceipts),
      )
      .all();
  }
  allocatedFromReceipt(receiptId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmPaymentAllocations.amount_paise).mapWith(Number),
        })
        .from(crmPaymentAllocations)
        .where(eq(crmPaymentAllocations.receipt_id, receiptId))
        .get()?.value ?? 0,
    );
  }
  chargesInDueOrder(customerId: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(
        and(
          eq(crmReceivableEntries.customer_id, customerId),
          gt(crmReceivableEntries.amount_paise, 0),
        ),
      )
      .orderBy(
        asc(crmReceivableEntries.created_at),
        insertionOrder(crmReceivableEntries),
      )
      .all();
  }
  adjustmentsForCharge(chargeId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmReceivableEntries.amount_paise).mapWith(Number),
        })
        .from(crmReceivableEntries)
        .where(eq(crmReceivableEntries.adjusts_id, chargeId))
        .get()?.value ?? 0,
    );
  }
  cashForCharge(chargeId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmPaymentAllocations.amount_paise).mapWith(Number),
        })
        .from(crmPaymentAllocations)
        .where(eq(crmPaymentAllocations.charge_id, chargeId))
        .get()?.value ?? 0,
    );
  }
  chargesForLine(lineKey: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(
        and(
          eq(crmReceivableEntries.line_key, lineKey),
          gt(crmReceivableEntries.amount_paise, 0),
        ),
      )
      .orderBy(insertionOrder(crmReceivableEntries))
      .all();
  }
  chargesForShipmentLine(lineId: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(
        and(
          eq(crmReceivableEntries.shipment_line_id, lineId),
          gt(crmReceivableEntries.amount_paise, 0),
        ),
      )
      .orderBy(insertionOrder(crmReceivableEntries))
      .all();
  }
  cashByReceiptForCharge(chargeId: string) {
    return this.db
      .select({
        receipt_id: crmPaymentAllocations.receipt_id,
        n: sum(crmPaymentAllocations.amount_paise).mapWith(Number),
      })
      .from(crmPaymentAllocations)
      .where(eq(crmPaymentAllocations.charge_id, chargeId))
      .groupBy(crmPaymentAllocations.receipt_id)
      .having(gt(sum(crmPaymentAllocations.amount_paise), 0))
      .orderBy(desc(min(insertionOrder(crmPaymentAllocations))))
      .all()
      .map((row) => ({ ...row, n: safe(row.n ?? 0) }));
  }
  findCustomerCharge(id: string, customerId: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(
        and(
          eq(crmReceivableEntries.id, id),
          eq(crmReceivableEntries.customer_id, customerId),
          gt(crmReceivableEntries.amount_paise, 0),
        ),
      )
      .get();
  }
  receiptsByInsertion(customerId: string) {
    return this.db
      .select()
      .from(crmPaymentReceipts)
      .where(eq(crmPaymentReceipts.customer_id, customerId))
      .orderBy(insertionOrder(crmPaymentReceipts))
      .all();
  }
  chargesForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(
        and(
          eq(crmReceivableEntries.customer_id, customerId),
          gt(crmReceivableEntries.amount_paise, 0),
        ),
      )
      .orderBy(insertionOrder(crmReceivableEntries))
      .all();
  }
  receivedForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmPaymentReceipts.amount_paise).mapWith(Number) })
        .from(crmPaymentReceipts)
        .where(eq(crmPaymentReceipts.customer_id, customerId))
        .get()?.value ?? 0,
    );
  }
  postedForCustomer(customerId: string) {
    return safe(
      this.db
        .select({
          value: sum(crmReceivableEntries.amount_paise).mapWith(Number),
        })
        .from(crmReceivableEntries)
        .where(eq(crmReceivableEntries.customer_id, customerId))
        .get()?.value ?? 0,
    );
  }
  chargesForDelivery(deliveryId: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(
        and(
          eq(crmReceivableEntries.source_id, deliveryId),
          // WF-005 / FUL-007: a delivery reversal carries one linked
          // DELIVERY_CORRECTION adjustment instead of a goods charge.
          inArray(crmReceivableEntries.kind, [
            'DELIVERY',
            'CORRECTION',
            'DELIVERY_CORRECTION',
          ]),
        ),
      )
      .orderBy(insertionOrder(crmReceivableEntries))
      .all();
  }
  invalidReceiptAllocations(receiptId: string) {
    return this.db
      .select({ chargeId: crmPaymentAllocations.charge_id })
      .from(crmPaymentAllocations)
      .where(eq(crmPaymentAllocations.receipt_id, receiptId))
      .groupBy(crmPaymentAllocations.charge_id)
      .having(lt(sum(crmPaymentAllocations.amount_paise), 0))
      .all().length;
  }
  entriesForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmReceivableEntries)
      .where(eq(crmReceivableEntries.customer_id, customerId))
      .orderBy(insertionOrder(crmReceivableEntries))
      .all();
  }
  allocationsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmPaymentAllocations)
      .where(eq(crmPaymentAllocations.customer_id, customerId))
      .orderBy(insertionOrder(crmPaymentAllocations))
      .all();
  }
  insertCharge(
    c: ActionContext,
    row: typeof crmReceivableEntries.$inferInsert,
  ) {
    this.db.insert(crmReceivableEntries).values(row).run();
    recordInsert(c, 'receivable_entries', row, true);
  }
  insertReceipt(c: ActionContext, row: typeof crmPaymentReceipts.$inferInsert) {
    this.db.insert(crmPaymentReceipts).values(row).run();
    recordInsert(c, 'payment_receipts', row, false);
  }
  insertAllocation(
    c: ActionContext,
    row: typeof crmPaymentAllocations.$inferInsert,
  ) {
    this.db.insert(crmPaymentAllocations).values(row).run();
    recordInsert(c, 'payment_allocations', row, true);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [AccountsRepository],
  exports: [AccountsRepository],
})
export class AccountsRepositoryModule {}
