import { fail, safe } from '../common/domain.js';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { crmCustomers } from '../customers/customers.model.js';
import {
  crmReceivableEntries,
  crmPaymentReceipts,
} from '../accounts/accounts.model.js';

export const crmCreditNotes = sqliteTable(
  'credit_notes',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    return_id: text('return_id'),
    amount_paise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('credit_notes_customer_id_idx').on(t.customer_id),
    check(
      'credit_notes_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export const crmCreditFunds = sqliteTable(
  'credit_funds',
  {
    id: text('id').primaryKey(),
    credit_note_id: text('credit_note_id')
      .notNull()
      .references(() => crmCreditNotes.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    // ACC-004: funding withdrawn because its receipt moved to another
    // customer is a negative row linked to the funding it reduces.
    reversal_of_id: text('reversal_of_id').references(
      (): AnySQLiteColumn => crmCreditFunds.id,
    ),
    reason: text('reason').notNull().default(''),
  },
  (t) => [
    index('credit_funds_credit_note_id_idx').on(t.credit_note_id),
    index('credit_funds_receipt_id_idx').on(t.receipt_id),
    index('credit_funds_reversal_idx').on(t.reversal_of_id),
    check(
      'credit_funds_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ((${t.amount_paise} > 0 and ${t.reversal_of_id} is null) or (${t.amount_paise} < 0 and ${t.reversal_of_id} is not null))`,
    ),
  ],
);

export const crmCreditApplications = sqliteTable(
  'credit_applications',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    credit_note_id: text('credit_note_id')
      .notNull()
      .references(() => crmCreditNotes.id, { onDelete: 'cascade' }),
    charge_id: text('charge_id')
      .notNull()
      .references(() => crmReceivableEntries.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reversal_of_id: text('reversal_of_id').references(
      (): AnySQLiteColumn => crmCreditApplications.id,
    ),
    reason: text('reason').notNull().default(''),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('credit_applications_customer_id_idx').on(t.customer_id),
    index('credit_applications_credit_note_id_idx').on(t.credit_note_id),
    index('credit_applications_charge_id_idx').on(t.charge_id),
    index('credit_applications_reversal_idx').on(t.reversal_of_id),
    check(
      'credit_applications_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export const crmCreditRefunds = sqliteTable(
  'credit_refunds',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    credit_note_id: text('credit_note_id')
      .notNull()
      .references(() => crmCreditNotes.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reversal_of_id: text('reversal_of_id').references(
      (): AnySQLiteColumn => crmCreditRefunds.id,
    ),
    reason: text('reason').notNull().default(''),
    reference: text('reference').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('credit_refunds_customer_id_idx').on(t.customer_id),
    index('credit_refunds_credit_note_id_idx').on(t.credit_note_id),
    index('credit_refunds_receipt_id_idx').on(t.receipt_id),
    index('credit_refunds_reversal_idx').on(t.reversal_of_id),
    check(
      'credit_refunds_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ((${t.amount_paise} > 0 and ${t.reversal_of_id} is null) or (${t.amount_paise} < 0 and ${t.reversal_of_id} is not null))`,
    ),
  ],
);

export type CreditNote = typeof crmCreditNotes.$inferSelect;
export class CreditBalance {
  constructor(
    readonly issuedPaise: number,
    readonly appliedPaise: number,
    readonly refundedPaise: number,
  ) {}
  get availablePaise() {
    return safe(this.issuedPaise - this.appliedPaise - this.refundedPaise);
  }
  assertAvailable(amountPaise: number, operation: 'application' | 'refund') {
    if (amountPaise > this.availablePaise)
      fail('CREDIT_EXCEEDED', `The ${operation} exceeds the open credit`);
  }
}
