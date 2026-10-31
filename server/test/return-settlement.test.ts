import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { ActionResult } from '@crm/shared/crm';
import { startDesk } from './support/app.js';
import type { HttpDesk } from './support/http-desk.js';

/**
 * Characterization tests for WF-003 return settlement.
 *
 * Each scenario records a return and pins every row the action writes, in
 * order, from the action result's `effects`. The expected lines were
 * recorded from the original hand-written settlement code and checked by
 * hand against WF-003, so the release refactor can be shown to keep
 * behaviour exactly.
 *
 * Ids become stable labels: names given by the scenario (R1 = first
 * receipt, C1 = first charge, ...) or `#n` in order of first appearance.
 * Timestamps and action ids are dropped. Engine rows (version bumps and the
 * audit event) are left out: they are not part of settlement.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const VOLATILE = new Set([
  'created_at',
  'updated_at',
  'occurred_at',
  'dispatched_at',
  'action_id',
]);
const ENGINE_ENTITIES = new Set(['customers', 'orders', 'business_events']);

function describeEffects(
  effects: ActionResult['effects'],
  names: Map<string, string>,
) {
  const label = (value: unknown) =>
    String(value).replace(UUID, (id) => {
      if (!names.has(id)) names.set(id, `#${names.size + 1}`);
      return names.get(id)!;
    });
  const fields = (row: unknown) =>
    Object.entries((row ?? {}) as Record<string, unknown>)
      .filter(([key]) => !VOLATILE.has(key))
      .map(([key, value]) => `${key}=${label(value)}`)
      .join(' ');
  return effects
    .filter((effect) => !ENGINE_ENTITIES.has(effect.entity))
    .map((effect) =>
      effect.operation === 'UPDATE'
        ? `UPDATE ${effect.entity} ${fields(effect.before)} -> ${fields(effect.after)}`
        : `${effect.operation} ${effect.entity} ${fields(effect.after)}`,
    );
}

describe('WF-003 return settlement effects (characterization)', () => {
  let app: INestApplication;
  let desk: HttpDesk;
  before(async () => {
    ({ app, desk } = await startDesk('return-settlement'));
  });
  after(async () => {
    await app?.close();
  });

  async function customer() {
    return (await desk.createCustomer()).id;
  }
  async function deliveryCharges(customerId: string) {
    const { ledger } = await desk.snapshot(customerId);
    return ledger.finance
      .filter((row) => row.kind === 'DELIVERY')
      .map((row) => String(row.id));
  }
  async function receive(customerId: string, amountPaise: number) {
    return (await desk.receive(customerId, amountPaise)).references.receiptId!;
  }
  async function settle(
    names: Map<string, string>,
    orderId: string,
    items: Array<{ shipmentLineId: string; qty: number }>,
    feePaise: number,
  ) {
    const result = await desk.apply(
      {
        type: 'RECORD_RETURN',
        payload: {
          orderId,
          items,
          feePaise,
          reason: 'Customer return accepted',
        },
      },
      'WAREHOUSE',
    );
    const lines = describeEffects(result.effects, names);
    // Set RECORD_EFFECTS=<file> to dump the lines when re-recording on purpose.
    if (process.env.RECORD_EFFECTS)
      appendFileSync(process.env.RECORD_EFFECTS, `${JSON.stringify(lines)}\n`);
    return lines;
  }
  function named(entries: Record<string, string>) {
    return new Map(Object.entries(entries).map(([name, id]) => [id, name]));
  }

  it('releases cash from the latest-allocated receipt first, pays the fee from released cash, and funds a credit note', async () => {
    const customerId = await customer();
    const orderId = await desk.order(customerId, [
      { skuId: 'sku-a', qty: 3, unitPricePaise: 10000 },
    ]);
    const shipment = await desk.ship(orderId);
    const [C1] = await deliveryCharges(customerId);
    const R1 = await receive(customerId, 20000);
    const R2 = await receive(customerId, 10000);
    const lines = await settle(
      named({
        customer: customerId,
        order: orderId,
        C1: C1!,
        R1,
        R2,
        line: shipment.lines[0]!.id,
      }),
      orderId,
      [{ shipmentLineId: shipment.lines[0]!.id, qty: 2 }],
      3000,
    );
    assert.deepEqual(lines, EXPECTED.cashTwoReceiptsWithFee);
  });

  it('returns released credit to its own note', async () => {
    const customerId = await customer();
    const R1 = await receive(customerId, 10000);
    const issued = await desk.apply(
      {
        type: 'ISSUE_CREDIT_NOTE',
        payload: { customerId, amountPaise: 10000, reason: 'Goodwill credit' },
      },
      'ACCOUNTS',
    );
    const K1 = issued.references.creditNoteId!;
    const orderId = await desk.order(customerId);
    const shipment = await desk.ship(orderId);
    const [C1] = await deliveryCharges(customerId);
    await desk.apply(
      {
        type: 'APPLY_CREDIT_NOTE',
        payload: {
          customerId,
          creditNoteId: K1,
          chargeId: C1!,
          amountPaise: 10000,
        },
      },
      'ACCOUNTS',
    );
    const lines = await settle(
      named({
        customer: customerId,
        order: orderId,
        C1: C1!,
        R1,
        K1,
        line: shipment.lines[0]!.id,
      }),
      orderId,
      [{ shipmentLineId: shipment.lines[0]!.id, qty: 1 }],
      0,
    );
    assert.deepEqual(lines, EXPECTED.creditOnly);
  });

  it('restores redeemed points', async () => {
    const customerId = await customer();
    const firstOrder = await desk.order(customerId);
    await desk.ship(firstOrder);
    const R1 = await receive(customerId, 10000);
    const orderId = await desk.order(customerId);
    const shipment = await desk.ship(orderId);
    const [C1, C2] = await deliveryCharges(customerId);
    await desk.apply(
      {
        type: 'REDEEM_POINTS',
        payload: { customerId, chargeId: C2!, points: 1000 },
      },
      'ACCOUNTS',
    );
    const lines = await settle(
      named({
        customer: customerId,
        order: orderId,
        C1: C1!,
        C2: C2!,
        R1,
        line: shipment.lines[0]!.id,
      }),
      orderId,
      [{ shipmentLineId: shipment.lines[0]!.id, qty: 1 }],
      0,
    );
    assert.deepEqual(lines, EXPECTED.pointsOnly);
  });

  it('releases cash, then credit, then points on a mixed-settled charge', async () => {
    const customerId = await customer();
    const firstOrder = await desk.order(customerId);
    await desk.ship(firstOrder);
    const R1 = await receive(customerId, 10000);
    const R2 = await receive(customerId, 4000);
    const issued = await desk.apply(
      {
        type: 'ISSUE_CREDIT_NOTE',
        payload: { customerId, amountPaise: 4000, reason: 'Goodwill credit' },
      },
      'ACCOUNTS',
    );
    const K1 = issued.references.creditNoteId!;
    const orderId = await desk.order(customerId, [
      { skuId: 'sku-a', qty: 2, unitPricePaise: 10000 },
    ]);
    const shipment = await desk.ship(orderId);
    const [C1, C2] = await deliveryCharges(customerId);
    await desk.apply(
      {
        type: 'REDEEM_POINTS',
        payload: { customerId, chargeId: C2!, points: 1000 },
      },
      'ACCOUNTS',
    );
    await desk.apply(
      {
        type: 'APPLY_CREDIT_NOTE',
        payload: {
          customerId,
          creditNoteId: K1,
          chargeId: C2!,
          amountPaise: 4000,
        },
      },
      'ACCOUNTS',
    );
    const R3 = await receive(customerId, 15000);
    const lines = await settle(
      named({
        customer: customerId,
        order: orderId,
        C1: C1!,
        C2: C2!,
        R1,
        R2,
        R3,
        K1,
        line: shipment.lines[0]!.id,
      }),
      orderId,
      [{ shipmentLineId: shipment.lines[0]!.id, qty: 2 }],
      1500,
    );
    assert.deepEqual(lines, EXPECTED.mixedWithFee);
  });

  it('visits returned lines in payload order, so the fee is paid from the first receipt released', async () => {
    const customerId = await customer();
    const orderId = await desk.order(customerId, [
      { skuId: 'sku-a', qty: 2, unitPricePaise: 10000 },
      { skuId: 'sku-b', qty: 2, unitPricePaise: 15000 },
    ]);
    const shipment = await desk.ship(orderId, undefined, [1, 0]);
    const lineA = shipment.lines.find((line) => line.sku_id === 'sku-a')!.id;
    const lineB = shipment.lines.find((line) => line.sku_id === 'sku-b')!.id;
    const confirm = (shipmentLineId: string, qty: number) =>
      desk.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId: shipment.id,
            items: [{ shipmentLineId, qty }],
          },
        },
        'WAREHOUSE',
      );
    const R1 = await receive(customerId, 10000);
    await confirm(lineB, 2);
    const R2 = await receive(customerId, 30000);
    await confirm(lineA, 1);
    const R3 = await receive(customerId, 10000);
    const [CA1, CB1, CA2] = await deliveryCharges(customerId);
    const lines = await settle(
      named({
        customer: customerId,
        order: orderId,
        CA1: CA1!,
        CB1: CB1!,
        CA2: CA2!,
        R1,
        R2,
        R3,
        lineA,
        lineB,
      }),
      orderId,
      [
        { shipmentLineId: lineB, qty: 1 },
        { shipmentLineId: lineA, qty: 2 },
      ],
      5000,
    );
    assert.deepEqual(lines, EXPECTED.payloadOrderAcrossLines);
  });
});

// Recorded from the original returns.service.ts (commit 8537fd9).
const EXPECTED: Record<string, string[]> = {
  cashTwoReceiptsWithFee: [
    'INSERT returns id=#7 customer_id=customer order_id=order gross_paise=20000 fee_paise=3000 reason=Customer return accepted',
    'INSERT return_lines id=#8 return_id=#7 shipment_line_id=line qty=2 amount_paise=20000',
    'APPEND receivable_entries id=#9 customer_id=customer order_id=order line_key=#10 shipment_line_id=line kind=RETURN amount_paise=-20000 adjusts_id=C1 source_id=#7',
    'APPEND payment_allocations id=#11 customer_id=customer receipt_id=R2 charge_id=C1 amount_paise=-10000',
    'APPEND payment_allocations id=#12 customer_id=customer receipt_id=R1 charge_id=C1 amount_paise=-10000',
    'APPEND receivable_entries id=#13 customer_id=customer order_id=order line_key=null shipment_line_id=null kind=RETURN_FEE amount_paise=3000 adjusts_id=null source_id=#7',
    'APPEND payment_allocations id=#14 customer_id=customer receipt_id=R2 charge_id=#13 amount_paise=3000',
    'INSERT credit_notes id=#15 customer_id=customer return_id=#7 amount_paise=17000 reason=Customer return accepted',
    'INSERT credit_funds id=#16 credit_note_id=#15 receipt_id=R2 amount_paise=7000',
    'INSERT credit_funds id=#17 credit_note_id=#15 receipt_id=R1 amount_paise=10000',
    'APPEND reward_ledger id=#18 customer_id=customer line_key=#10 bucket=AVAILABLE points_delta=-2000 source_id=#19',
  ],
  creditOnly: [
    'INSERT returns id=#7 customer_id=customer order_id=order gross_paise=10000 fee_paise=0 reason=Customer return accepted',
    'INSERT return_lines id=#8 return_id=#7 shipment_line_id=line qty=1 amount_paise=10000',
    'APPEND receivable_entries id=#9 customer_id=customer order_id=order line_key=#10 shipment_line_id=line kind=RETURN amount_paise=-10000 adjusts_id=C1 source_id=#7',
    'APPEND credit_applications id=#11 customer_id=customer credit_note_id=K1 charge_id=C1 amount_paise=-10000',
    'APPEND reward_ledger id=#12 customer_id=customer line_key=#10 bucket=LOCKED points_delta=-1000 source_id=#13',
  ],
  pointsOnly: [
    'INSERT returns id=#7 customer_id=customer order_id=order gross_paise=10000 fee_paise=0 reason=Customer return accepted',
    'INSERT return_lines id=#8 return_id=#7 shipment_line_id=line qty=1 amount_paise=10000',
    'APPEND receivable_entries id=#9 customer_id=customer order_id=order line_key=#10 shipment_line_id=line kind=RETURN amount_paise=-10000 adjusts_id=C2 source_id=#7',
    'APPEND reward_redemptions id=#11 customer_id=customer charge_id=C2 points=-1000',
    'APPEND reward_ledger id=#12 customer_id=customer line_key=null bucket=AVAILABLE points_delta=1000 source_id=#7',
    'APPEND reward_ledger id=#13 customer_id=customer line_key=null bucket=REDEEMED points_delta=-1000 source_id=#7',
    'APPEND reward_ledger id=#14 customer_id=customer line_key=#10 bucket=LOCKED points_delta=-1000 source_id=#15',
  ],
  mixedWithFee: [
    'INSERT returns id=#10 customer_id=customer order_id=order gross_paise=20000 fee_paise=1500 reason=Customer return accepted',
    'INSERT return_lines id=#11 return_id=#10 shipment_line_id=line qty=2 amount_paise=20000',
    'APPEND receivable_entries id=#12 customer_id=customer order_id=order line_key=#13 shipment_line_id=line kind=RETURN amount_paise=-20000 adjusts_id=C2 source_id=#10',
    'APPEND payment_allocations id=#14 customer_id=customer receipt_id=R3 charge_id=C2 amount_paise=-15000',
    'APPEND credit_applications id=#15 customer_id=customer credit_note_id=K1 charge_id=C2 amount_paise=-4000',
    'APPEND reward_redemptions id=#16 customer_id=customer charge_id=C2 points=-1000',
    'APPEND reward_ledger id=#17 customer_id=customer line_key=null bucket=AVAILABLE points_delta=1000 source_id=#10',
    'APPEND reward_ledger id=#18 customer_id=customer line_key=null bucket=REDEEMED points_delta=-1000 source_id=#10',
    'APPEND receivable_entries id=#19 customer_id=customer order_id=order line_key=null shipment_line_id=null kind=RETURN_FEE amount_paise=1500 adjusts_id=null source_id=#10',
    'APPEND payment_allocations id=#20 customer_id=customer receipt_id=R3 charge_id=#19 amount_paise=1500',
    'INSERT credit_notes id=#21 customer_id=customer return_id=#10 amount_paise=13500 reason=Customer return accepted',
    'INSERT credit_funds id=#22 credit_note_id=#21 receipt_id=R3 amount_paise=13500',
    'APPEND reward_ledger id=#23 customer_id=customer line_key=#13 bucket=AVAILABLE points_delta=-1500 source_id=#24',
    'APPEND reward_ledger id=#25 customer_id=customer line_key=#13 bucket=LOCKED points_delta=-500 source_id=#24',
  ],
  payloadOrderAcrossLines: [
    'INSERT returns id=#11 customer_id=customer order_id=order gross_paise=35000 fee_paise=5000 reason=Customer return accepted',
    'INSERT return_lines id=#12 return_id=#11 shipment_line_id=lineB qty=1 amount_paise=15000',
    'APPEND receivable_entries id=#13 customer_id=customer order_id=order line_key=#14 shipment_line_id=lineB kind=RETURN amount_paise=-15000 adjusts_id=CB1 source_id=#11',
    'APPEND payment_allocations id=#15 customer_id=customer receipt_id=R2 charge_id=CB1 amount_paise=-15000',
    'INSERT return_lines id=#16 return_id=#11 shipment_line_id=lineA qty=2 amount_paise=20000',
    'APPEND receivable_entries id=#17 customer_id=customer order_id=order line_key=#18 shipment_line_id=lineA kind=RETURN amount_paise=-10000 adjusts_id=CA1 source_id=#11',
    'APPEND payment_allocations id=#19 customer_id=customer receipt_id=R1 charge_id=CA1 amount_paise=-10000',
    'APPEND receivable_entries id=#20 customer_id=customer order_id=order line_key=#18 shipment_line_id=lineA kind=RETURN amount_paise=-10000 adjusts_id=CA2 source_id=#11',
    'APPEND payment_allocations id=#21 customer_id=customer receipt_id=R3 charge_id=CA2 amount_paise=-10000',
    'APPEND receivable_entries id=#22 customer_id=customer order_id=order line_key=null shipment_line_id=null kind=RETURN_FEE amount_paise=5000 adjusts_id=null source_id=#11',
    'APPEND payment_allocations id=#23 customer_id=customer receipt_id=R2 charge_id=#22 amount_paise=5000',
    'INSERT credit_notes id=#24 customer_id=customer return_id=#11 amount_paise=30000 reason=Customer return accepted',
    'INSERT credit_funds id=#25 credit_note_id=#24 receipt_id=R2 amount_paise=10000',
    'INSERT credit_funds id=#26 credit_note_id=#24 receipt_id=R1 amount_paise=10000',
    'INSERT credit_funds id=#27 credit_note_id=#24 receipt_id=R3 amount_paise=10000',
    'APPEND reward_ledger id=#28 customer_id=customer line_key=#18 bucket=AVAILABLE points_delta=-2000 source_id=#29',
    'APPEND reward_ledger id=#30 customer_id=customer line_key=#14 bucket=AVAILABLE points_delta=-1200 source_id=#29',
  ],
};
