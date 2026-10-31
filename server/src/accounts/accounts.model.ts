import { safe } from '../common/domain.js';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { crmCustomers } from '../customers/customers.model.js';
import { crmOrders } from '../orders/orders.model.js';

export const crmReceivableEntries = sqliteTable(
  'receivable_entries',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key'),
    shipment_line_id: text('shipment_line_id'),
    kind: text('kind').notNull(),
    amount_paise: integer('amount_paise').notNull(),
    adjusts_id: text('adjusts_id'),
    source_id: text('source_id').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('receivable_entries_customer_id_idx').on(t.customer_id),
    index('receivable_entries_order_id_idx').on(t.order_id),
    check(
      'receivable_entries_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export const crmPaymentReceipts = sqliteTable(
  'payment_receipts',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reference: text('reference').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('payment_receipts_customer_id_idx').on(t.customer_id),
    check(
      'payment_receipts_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

/**
 * ACC-004 (FDSK-169): part or all of a receipt moved to another customer
 * because it was recorded against the wrong account. Receipts stay
 * immutable (WF-001); the transfer lowers the source receipt's effective
 * amount and names the receipt it created on the receiving account.
 */
export const crmReceiptTransfers = sqliteTable(
  'receipt_transfers',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    to_customer_id: text('to_customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    to_receipt_id: text('to_receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    bank_reference: text('bank_reference').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('receipt_transfers_customer_id_idx').on(t.customer_id),
    index('receipt_transfers_receipt_id_idx').on(t.receipt_id),
    index('receipt_transfers_to_customer_id_idx').on(t.to_customer_id),
    check(
      'receipt_transfers_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
    check(
      'receipt_transfers_accounts_check',
      sql`${t.customer_id} <> ${t.to_customer_id}`,
    ),
  ],
);

export const crmPaymentAllocations = sqliteTable(
  'payment_allocations',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    charge_id: text('charge_id')
      .notNull()
      .references(() => crmReceivableEntries.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('payment_allocations_customer_id_idx').on(t.customer_id),
    index('payment_allocations_receipt_id_idx').on(t.receipt_id),
    index('payment_allocations_charge_id_idx').on(t.charge_id),
    check(
      'payment_allocations_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export type Receipt = typeof crmPaymentReceipts.$inferSelect;
export type ReceivableEntry = typeof crmReceivableEntries.$inferSelect;
export class ChargeBalance {
  constructor(
    readonly retainedPaise: number,
    readonly cashPaise: number,
    readonly creditPaise: number,
    readonly points: number,
  ) {}
  get outstandingPaise() {
    return safe(
      this.retainedPaise - this.cashPaise - this.creditPaise - this.points,
    );
  }
}
