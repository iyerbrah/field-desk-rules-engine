import { z } from 'zod';
import type { User } from './types.js';

const id = z.string().min(1).max(100);
const quantity = z.number().int().min(1).max(10000);
const amount = z.number().int().min(1).max(1000000000);
const reason = z.string().trim().min(3).max(1000);
const item = z
  .object({ skuId: id, qty: quantity, unitPricePaise: amount })
  .strict();
const lines = z
  .array(item)
  .min(1)
  .max(100)
  .refine(
    (value) => new Set(value.map((line) => line.skuId)).size === value.length,
    'Each SKU can appear only once',
  );
const action = <T extends string, S extends z.ZodRawShape>(
  type: T,
  payload: S,
) => z.object({ type: z.literal(type), payload: z.object(payload).strict() });

export const crmActionSchema = z.discriminatedUnion('type', [
  action('UPDATE_CUSTOMER', {
    customerId: id,
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().min(2).max(40),
  }),
  action('PUNCH_ORDER', {
    customerId: id,
    items: lines,
    reason: reason.optional(),
  }),
  action('EDIT_ORDER', { orderId: id, items: lines, reason }),
  action('SUBMIT_ORDER', { orderId: id }),
  action('APPROVE_ORDER', {
    orderId: id,
    revision: z.number().int().positive(),
  }),
  action('REJECT_ORDER', {
    orderId: id,
    revision: z.number().int().positive(),
    reason,
  }),
  action('START_LOADING', {
    orderId: id,
    items: z
      .array(z.object({ lineKey: id, qty: quantity }).strict())
      .min(1)
      .max(100),
  }),
  action('DISPATCH_SHIPMENT', { orderId: id, shipmentId: id }),
  action('CONFIRM_DELIVERY', {
    orderId: id,
    shipmentId: id,
    items: z
      .array(z.object({ shipmentLineId: id, qty: quantity }).strict())
      .min(1)
      .max(100),
  }),
  action('CANCEL_REMAINDER', {
    orderId: id,
    reason,
    items: z
      .array(z.object({ lineKey: id, qty: quantity }).strict())
      .min(1)
      .max(100)
      .optional(),
  }),
  action('RECORD_RETURN', {
    orderId: id,
    items: z
      .array(z.object({ shipmentLineId: id, qty: quantity }).strict())
      .min(1)
      .max(100),
    feePaise: z.number().int().min(0).max(1000000000),
    reason,
  }),
  action('RECEIVE_CUSTOMER_PAYMENT', {
    customerId: id,
    amountPaise: amount,
    reference: z.string().trim().min(1).max(200),
  }),
  action('ALLOCATE_PAYMENT', { customerId: id }),
  // ACC-004 (FDSK-169): move a payment recorded against the wrong customer.
  // amountPaise defaults to everything still on the source receipt.
  action('REATTRIBUTE_PAYMENT', {
    customerId: id,
    receiptId: id,
    targetCustomerId: id,
    amountPaise: amount.optional(),
    reason,
    bankReference: z.string().trim().min(1).max(200),
  }),
  action('REDEEM_POINTS', { customerId: id, chargeId: id, points: amount }),
  action('ISSUE_CREDIT_NOTE', { customerId: id, amountPaise: amount, reason }),
  action('APPLY_CREDIT_NOTE', {
    customerId: id,
    creditNoteId: id,
    chargeId: id,
    amountPaise: amount,
  }),
  action('REFUND_CREDIT_NOTE', {
    customerId: id,
    creditNoteId: id,
    amountPaise: amount,
    reference: reason,
  }),
  action('REVERSE_CREDIT_APPLICATION', {
    customerId: id,
    applicationId: id,
    amountPaise: amount,
    reason,
  }),
  action('REVERSE_CREDIT_REFUND', {
    customerId: id,
    refundId: id,
    amountPaise: amount,
    reason,
    reference: reason,
  }),
  // FUL-007 (FDSK-170): lower an overstated delivery confirmation.
  // deliveredQty is the corrected total for the line, not a delta.
  action('CORRECT_DELIVERY', {
    orderId: id,
    shipmentId: id,
    items: z
      .array(
        z
          .object({
            shipmentLineId: id,
            deliveredQty: z.number().int().min(0).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    reason,
    evidence: z.string().trim().min(8).max(2000),
  }),
  action('CORRECT_DISPATCHED_ORDER', {
    orderId: id,
    items: z
      .array(item.extend({ deliveredQty: z.number().int().min(0).max(10000) }))
      .min(1)
      .max(100),
    reason,
    evidence: z.string().trim().min(8).max(2000),
    authorizationReference: reason,
    location: z.enum(['EXISTING_SHIPMENT', 'NEW_SHIPMENT']).optional(),
    shipmentId: id.optional(),
    dispatchedAt: z.iso.datetime().optional(),
  }),
]);

export const actionEnvelopeSchema = z
  .object({
    command: crmActionSchema,
    actorId: id.optional(),
    idempotencyKey: z.string().min(8).max(120),
    expectedVersion: z.number().int().min(0).optional(),
    // Versions of other accounts a command touches, by customer id.
    expectedVersions: z.record(id, z.number().int().min(0)).optional(),
    // Answers to decision questions from an earlier NEEDS_DECISION, by key.
    answers: z.record(id, id).optional(),
  })
  .strict();
export type CrmCommand = z.infer<typeof crmActionSchema>;
export type ActionEnvelope = z.infer<typeof actionEnvelopeSchema>;
export type CommandType = CrmCommand['type'];
export const BUSINESS_TERMS_VERSION = '2026-10-26.1';
export interface AccountCheck {
  id: string;
  label: string;
  passed: boolean;
  details: string;
  references: string[];
}
export interface AccountReview {
  customerId: string;
  customerVersion: number;
  termsVersion: string;
  checkedAt: string;
  checks: AccountCheck[];
}
export interface CustomerSnapshot {
  summary: CustomerSummary;
  orders: OrderDetail[];
  ledger: LedgerView;
  timeline: EventRow[];
  review: AccountReview;
}
export interface ActionResult {
  status: 'APPLIED' | 'REJECTED' | 'NEEDS_DECISION' | 'CONFLICT';
  actionId: string;
  errors: Array<{ code: string; message: string }>;
  decisions: Array<{
    key: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
  }>;
  effects: Array<{
    entity: string;
    operation: 'INSERT' | 'UPDATE' | 'APPEND';
    before?: unknown;
    after?: unknown;
    reason?: string;
    sourceReference?: string;
    provenance?: {
      actionId: string;
      actorId: string;
      requestedBy: string;
      orderId?: string;
      revision?: number;
      shipmentId?: string;
      lineKey?: string;
    };
  }>;
  trace: Array<{ stage: string; explanation: string }>;
  aggregateVersions: Record<string, number>;
  references: Record<string, string>;
  termsVersion?: string;
  review?: AccountReview;
  /** One review per touched customer account, keyed by customer id. */
  reviews?: Record<string, AccountReview>;
}
export interface Customer {
  id: string;
  code: string;
  name: string;
  version: number;
}
export interface CustomerAccountRow {
  customer: Customer;
  netBalancePaise: number;
  outstandingPaise: number;
  unappliedCashPaise: number;
  creditsOpenPaise: number;
}
export interface Sku {
  id: string;
  code: string;
  name: string;
  price_paise: number;
  points_per_unit: number;
}
export interface OrderListRow {
  id: string;
  number: string;
  customer_id: string;
  status: string;
  current_revision: number;
  version: number;
  created_at: string;
  totalPaise?: number;
  fulfillmentStatus?:
    | 'UNFULFILLED'
    | 'LOADING'
    | 'PARTIALLY_DISPATCHED'
    | 'DISPATCHED'
    | 'PARTIALLY_DELIVERED'
    | 'DELIVERED'
    | 'CANCELLED';
}
export interface OrderLine {
  lineKey: string;
  skuId: string;
  code: string;
  name: string;
  qty: number;
  approved: number;
  unitPricePaise: number;
  canceled: number;
  loaded: number;
  dispatched: number;
  delivered: number;
  returned: number;
  open: number;
}
export interface ShipmentLine {
  id: string;
  line_key: string;
  sku_id: string;
  loaded_qty: number;
  dispatched_qty: number;
  unit_price_paise: number;
  delivered: number;
  returned: number;
}
export interface Shipment {
  id: string;
  status: string;
  revision: number;
  dispatched_at: string | null;
  original_shipment_id: string | null;
  lines: ShipmentLine[];
}
export interface EventRow {
  id: string;
  action_id: string;
  customer_id: string;
  order_id: string | null;
  actor_id: string;
  actor_name: string;
  requested_by: string;
  type: string;
  payload: string;
  occurred_at: string;
}
export interface OrderDetail {
  order: OrderListRow;
  lines: OrderLine[];
  shipments: Shipment[];
  revisions: Array<{
    id: string;
    revision: number;
    reason: string;
    actor_id: string;
    created_at: string;
    lines: Array<{ sku_id: string; qty: number; unit_price_paise: number }>;
  }>;
  approvals: Array<{
    id: string;
    revision: number;
    decision: string;
    actor_id: string;
    reason: string;
  }>;
  timeline: EventRow[];
}
export interface Charge {
  id: string;
  order_id: string;
  line_key: string | null;
  amount_paise: number;
  remainingPaise: number;
  outstandingPaise: number;
  cashPaidPaise: number;
  kind: string;
  created_at: string;
}
export interface CreditNote {
  id: string;
  amount_paise: number;
  availablePaise: number;
  appliedPaise: number;
  refundedPaise: number;
  reason: string;
}
export interface CustomerSummary {
  customer: Customer;
  netBalancePaise: number;
  outstandingPaise: number;
  unappliedCashPaise: number;
  receivedPaise: number;
  creditsOpenPaise: number;
  refundsPaise: number;
  points: {
    locked: number;
    available: number;
    redeemed: number;
    clawbackPending: number;
  };
  charges: Charge[];
  credits: CreditNote[];
}
export interface LedgerView {
  finance: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  /** ACC-004 receipt transfers out of or into this account. */
  transfers: Array<Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  creditApplications: Array<Record<string, unknown>>;
  credits: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  redemptions: Array<Record<string, unknown>>;
  rewards: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  corrections: Array<Record<string, unknown>>;
}
export interface CrmBootstrap {
  customers: Customer[];
  skus: Sku[];
  orders: OrderListRow[];
  actors: User[];
}
