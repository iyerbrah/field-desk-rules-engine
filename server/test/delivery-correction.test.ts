import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@crm/shared';
import type { CrmCommand, OrderDetail } from '@crm/shared/crm';
import { startDesk } from './support/app.js';
import { assertAccount } from './support/account.js';
import type { HttpDesk } from './support/http-desk.js';

/**
 * FDSK-170 / FUL-007: correct an overstated delivery confirmation.
 *
 * The removed units go back to "dispatched, in transit". Settlement above
 * the reduced charge is released (WF-003 order), released cash stays free
 * for WF-002 allocation (no credit note: nothing was returned), and
 * rewards are recomputed.
 */
describe(
  'FDSK-170 correct an overstated delivery (FUL-007)',
  {
    todo: 'CORRECT_DELIVERY lands in the next commit',
  },
  () => {
    let app: INestApplication;
    let desk: HttpDesk;
    before(async () => {
      ({ app, desk } = await startDesk('delivery-correction'));
    });
    after(async () => {
      await app?.close();
    });

    const reason = 'Driver confirmed the wrong count';
    const evidence = 'Signed proof of delivery shows fewer cartons';

    function correction(
      orderId: string,
      shipmentId: string,
      items: Array<{ shipmentLineId: string; deliveredQty: number }>,
    ): CrmCommand {
      // Typed loosely until the CORRECT_DELIVERY contract exists.
      return {
        type: 'CORRECT_DELIVERY',
        payload: { orderId, shipmentId, items, reason, evidence },
      } as unknown as CrmCommand;
    }
    async function delivered(
      units: number,
      sku = { skuId: 'sku-a', unitPricePaise: 10000 },
    ) {
      const customerId = (await desk.createCustomer()).id;
      const orderId = await desk.order(customerId, [{ ...sku, qty: units }]);
      const shipment = await desk.ship(orderId);
      return {
        customerId,
        orderId,
        shipmentId: shipment.id,
        lineId: shipment.lines[0]!.id,
      };
    }
    async function shipmentOf(orderId: string, shipmentId: string) {
      const detail = await desk.read<OrderDetail>(`orders/${orderId}`);
      return detail.shipments.find((row) => row.id === shipmentId)!;
    }
    async function chargesOf(customerId: string) {
      return (await desk.snapshot(customerId)).summary.charges;
    }
    async function correct(
      orderId: string,
      shipmentId: string,
      items: Array<{ shipmentLineId: string; deliveredQty: number }>,
      role: Role = 'KAM',
    ) {
      return desk.apply(correction(orderId, shipmentId, items), role);
    }

    it('corrects an unpaid 10 to 6, reopens the shipment, and lets the other 4 be confirmed later', async () => {
      const { customerId, orderId, shipmentId, lineId } = await delivered(10);
      await correct(orderId, shipmentId, [
        { shipmentLineId: lineId, deliveredQty: 6 },
      ]);
      let shipment = await shipmentOf(orderId, shipmentId);
      assert.equal(shipment.status, 'DISPATCHED');
      assert.equal(shipment.lines[0]!.delivered, 6);
      let state = await desk.snapshot(customerId);
      assertAccount(state, 60000);
      assert.equal(state.summary.outstandingPaise, 60000);
      assert.equal(state.orders[0]!.lines[0]!.delivered, 6);
      assert.equal(state.orders[0]!.lines[0]!.dispatched, 10);

      await desk.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId,
            items: [{ shipmentLineId: lineId, qty: 4 }],
          },
        },
        'WAREHOUSE',
      );
      shipment = await shipmentOf(orderId, shipmentId);
      assert.equal(shipment.status, 'DELIVERED');
      state = await desk.snapshot(customerId);
      assertAccount(state, 100000);
    });

    it('reverses confirmations latest first, linking each reversal to its confirmation', async () => {
      const customerId = (await desk.createCustomer()).id;
      const orderId = await desk.order(customerId, [
        { skuId: 'sku-a', qty: 10, unitPricePaise: 10000 },
      ]);
      const shipment = await desk.ship(orderId, undefined, [6]);
      const lineId = shipment.lines[0]!.id;
      await desk.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId: shipment.id,
            items: [{ shipmentLineId: lineId, qty: 4 }],
          },
        },
        'WAREHOUSE',
      );
      const [first, second] = (await chargesOf(customerId)).filter(
        (charge) => charge.kind === 'DELIVERY',
      );
      const result = await correct(orderId, shipment.id, [
        { shipmentLineId: lineId, deliveredQty: 5 },
      ]);
      const reversals = result.effects
        .filter((effect) => effect.entity === 'deliveries')
        .map(
          (effect) => effect.after as { qty: number; reversal_of_id: string },
        );
      assert.deepEqual(
        reversals.map((row) => row.qty),
        [-4, -1],
      );
      const adjustments = result.effects
        .filter((effect) => effect.entity === 'receivable_entries')
        .map(
          (effect) =>
            effect.after as {
              kind: string;
              amount_paise: number;
              adjusts_id: string;
            },
        );
      assert.deepEqual(
        adjustments.map((row) => [row.kind, row.amount_paise, row.adjusts_id]),
        [
          ['DELIVERY_CORRECTION', -40000, second!.id],
          ['DELIVERY_CORRECTION', -10000, first!.id],
        ],
      );
      assertAccount(await desk.snapshot(customerId), 50000);
    });

    it('frees cash from a paid charge; WF-002 settles another open charge and keeps the rest as unapplied cash', async () => {
      const { customerId, orderId, shipmentId, lineId } = await delivered(10);
      await desk.receive(customerId, 100000);
      const otherOrder = await desk.order(customerId);
      await desk.ship(otherOrder);
      assert.equal(
        (await desk.snapshot(customerId)).summary.outstandingPaise,
        10000,
      );
      await correct(orderId, shipmentId, [
        { shipmentLineId: lineId, deliveredQty: 6 },
      ]);
      const state = await desk.snapshot(customerId);
      assertAccount(state, -30000);
      assert.equal(state.summary.outstandingPaise, 0);
      assert.equal(state.summary.unappliedCashPaise, 30000);
      assert.equal(state.summary.creditsOpenPaise, 0);
      assert.equal(state.ledger.credits.length, 0);
    });

    it('gives released credit back to its note', async () => {
      const customerId = (await desk.createCustomer()).id;
      await desk.receive(customerId, 20000);
      const issued = await desk.apply(
        {
          type: 'ISSUE_CREDIT_NOTE',
          payload: {
            customerId,
            amountPaise: 20000,
            reason: 'Goodwill credit',
          },
        },
        'ACCOUNTS',
      );
      const creditNoteId = issued.references.creditNoteId!;
      const orderId = await desk.order(customerId, [
        { skuId: 'sku-a', qty: 2, unitPricePaise: 10000 },
      ]);
      const shipment = await desk.ship(orderId);
      const [charge] = await chargesOf(customerId);
      await desk.apply(
        {
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId,
            creditNoteId,
            chargeId: charge!.id,
            amountPaise: 20000,
          },
        },
        'ACCOUNTS',
      );
      await correct(orderId, shipment.id, [
        { shipmentLineId: shipment.lines[0]!.id, deliveredQty: 1 },
      ]);
      const state = await desk.snapshot(customerId);
      assertAccount(state, -10000);
      assert.equal(state.summary.outstandingPaise, 0);
      assert.equal(state.summary.creditsOpenPaise, 10000);
      const note = state.summary.credits.find(
        (row) => row.id === creditNoteId,
      )!;
      assert.equal(note.availablePaise, 10000);
    });

    it('restores points that paid a charge which no longer exists', async () => {
      const customerId = (await desk.createCustomer()).id;
      const earning = await desk.order(customerId);
      await desk.ship(earning);
      await desk.receive(customerId, 10000);
      assert.equal(
        (await desk.snapshot(customerId)).summary.points.available,
        1000,
      );
      const orderId = await desk.order(customerId);
      const shipment = await desk.ship(orderId);
      const charge = (await chargesOf(customerId)).find(
        (row) => row.order_id === orderId,
      )!;
      await desk.apply(
        {
          type: 'REDEEM_POINTS',
          payload: { customerId, chargeId: charge.id, points: 1000 },
        },
        'ACCOUNTS',
      );
      await correct(orderId, shipment.id, [
        { shipmentLineId: shipment.lines[0]!.id, deliveredQty: 0 },
      ]);
      const state = await desk.snapshot(customerId);
      assertAccount(state, 0);
      assert.equal(state.summary.points.available, 1000);
      assert.equal(state.summary.points.redeemed, 0);
    });

    it('claws back points that were earned on the corrected charge and already spent', async () => {
      const customerId = (await desk.createCustomer()).id;
      const earning = await desk.order(customerId);
      const earningShipment = await desk.ship(earning);
      await desk.receive(customerId, 10000);
      const spending = await desk.order(customerId);
      await desk.ship(spending);
      const charge = (await chargesOf(customerId)).find(
        (row) => row.order_id === spending,
      )!;
      await desk.apply(
        {
          type: 'REDEEM_POINTS',
          payload: { customerId, chargeId: charge.id, points: 1000 },
        },
        'ACCOUNTS',
      );
      await correct(earning, earningShipment.id, [
        { shipmentLineId: earningShipment.lines[0]!.id, deliveredQty: 0 },
      ]);
      const state = await desk.snapshot(customerId);
      assertAccount(state, -1000);
      // The freed 10000 now pays the other charge's 9000 (earning 900 points),
      // so 100 of the 1000 points already spent are no longer backed by cash.
      assert.equal(state.summary.points.available, 0);
      assert.equal(state.summary.points.clawbackPending, 100);
    });

    it('rejects a correction below the units already returned', async () => {
      const { customerId, orderId, shipmentId, lineId } = await delivered(10);
      await desk.apply(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: [{ shipmentLineId: lineId, qty: 3 }],
            feePaise: 0,
            reason: 'Damaged cartons',
          },
        },
        'WAREHOUSE',
      );
      const result = await desk.assertUnchanged(
        await desk.envelope(
          correction(orderId, shipmentId, [
            { shipmentLineId: lineId, deliveredQty: 2 },
          ]),
          'KAM',
        ),
        customerId,
        'REJECTED',
      );
      assert.equal(result.errors[0]!.code, 'CORRECTION_BELOW_RETURNED');
    });

    it('rejects a correction that does not reduce the delivered count', async () => {
      const { customerId, orderId, shipmentId, lineId } = await delivered(4);
      const result = await desk.assertUnchanged(
        await desk.envelope(
          correction(orderId, shipmentId, [
            { shipmentLineId: lineId, deliveredQty: 4 },
          ]),
          'KAM',
        ),
        customerId,
        'REJECTED',
      );
      assert.equal(result.errors[0]!.code, 'DELIVERY_NOT_REDUCED');
    });

    it('corrects a WF-004 supplement shipment', async () => {
      const { customerId, orderId, shipmentId } = await delivered(1);
      await desk.apply(
        {
          type: 'CORRECT_DISPATCHED_ORDER',
          payload: {
            orderId,
            items: [
              {
                skuId: 'sku-c',
                qty: 2,
                unitPricePaise: 25000,
                deliveredQty: 2,
              },
            ],
            reason: 'Unrecorded reserve blend shipped',
            evidence: 'Signed dispatch supplement confirmed by warehouse',
            authorizationReference: 'KAM-CORRECTION-01',
            location: 'EXISTING_SHIPMENT',
            shipmentId,
          },
        },
        'KAM',
      );
      const detail = await desk.read<OrderDetail>(`orders/${orderId}`);
      const supplement = detail.shipments.find(
        (row) => row.original_shipment_id === shipmentId,
      )!;
      assert.equal(supplement.status, 'DELIVERED');
      await correct(orderId, supplement.id, [
        { shipmentLineId: supplement.lines[0]!.id, deliveredQty: 1 },
      ]);
      const shipment = await shipmentOf(orderId, supplement.id);
      assert.equal(shipment.status, 'DISPATCHED');
      assert.equal(shipment.lines[0]!.delivered, 1);
      assertAccount(await desk.snapshot(customerId), 35000);
    });

    it('rejects the warehouse role without changes', async () => {
      const { customerId, orderId, shipmentId, lineId } = await delivered(2);
      const result = await desk.assertUnchanged(
        await desk.envelope(
          correction(orderId, shipmentId, [
            { shipmentLineId: lineId, deliveredQty: 1 },
          ]),
          'WAREHOUSE',
        ),
        customerId,
        'REJECTED',
      );
      assert.equal(result.errors[0]!.code, 'FORBIDDEN');
    });

    it('returns a conflict on a stale order version', async () => {
      const { customerId, orderId, shipmentId, lineId } = await delivered(2);
      const envelope = await desk.envelope(
        correction(orderId, shipmentId, [
          { shipmentLineId: lineId, deliveredQty: 1 },
        ]),
        'KAM',
      );
      envelope.expectedVersion = envelope.expectedVersion! - 1;
      const result = await desk.assertUnchanged(
        envelope,
        customerId,
        'CONFLICT',
      );
      assert.equal(result.errors[0]!.code, 'VERSION_CONFLICT');
    });
  },
);
