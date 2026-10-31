import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@crm/shared';
import type { ActionEnvelope, CrmCommand } from '@crm/shared/crm';
import { startDesk } from './support/app.js';
import { assertAccount } from './support/account.js';
import type { HttpDesk } from './support/http-desk.js';

/**
 * FDSK-169 / ACC-004: move a payment recorded against the wrong customer.
 *
 * The command touches two accounts. Each is version-checked, bumped,
 * audited and reviewed. On the source, the capacity reconciler releases
 * allocations the moved money no longer covers (free cash goes first);
 * WF-002 then allocates cash on both accounts and rewards follow the cash.
 */
describe('FDSK-169 move a payment to the right customer (ACC-004)', () => {
  let app: INestApplication;
  let desk: HttpDesk;
  before(async () => {
    ({ app, desk } = await startDesk('payment-reattribution'));
  });
  after(async () => {
    await app?.close();
  });

  const reason = 'Bank transfer was from Greenfield, not Northside';
  const bankReference = 'HDFC-UTR-2026-10-31-0001';

  function move(
    customerId: string,
    receiptId: string,
    targetCustomerId: string,
    amountPaise?: number,
  ): CrmCommand {
    return {
      type: 'REATTRIBUTE_PAYMENT',
      payload: {
        customerId,
        receiptId,
        targetCustomerId,
        ...(amountPaise ? { amountPaise } : {}),
        reason,
        bankReference,
      },
    };
  }
  async function envelope(
    command: CrmCommand,
    targetCustomerId: string,
    role: Role = 'ACCOUNTS',
  ): Promise<ActionEnvelope> {
    const base = await desk.envelope(command, role);
    const target = await desk.snapshot(targetCustomerId);
    return {
      ...base,
      expectedVersions: { [targetCustomerId]: target.summary.customer.version },
    };
  }
  async function apply(command: CrmCommand, targetCustomerId: string) {
    const result = await desk.submit(await envelope(command, targetCustomerId));
    assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
    for (const review of Object.values(result.reviews ?? {}))
      assert.ok(review.checks.every((check) => check.passed));
    return result;
  }
  async function customer() {
    return (await desk.createCustomer()).id;
  }
  async function receive(customerId: string, amountPaise: number) {
    return (await desk.receive(customerId, amountPaise)).references.receiptId!;
  }
  async function deliveredOrder(customerId: string) {
    const orderId = await desk.order(customerId);
    await desk.ship(orderId);
    return orderId;
  }

  it('moves an unallocated advance and settles the right customer', async () => {
    const northside = await customer();
    const greenfield = await customer();
    await deliveredOrder(greenfield);
    const receiptId = await receive(northside, 10000);
    const result = await apply(
      move(northside, receiptId, greenfield),
      greenfield,
    );

    assert.deepEqual(
      Object.keys(result.reviews!).sort(),
      [northside, greenfield].sort(),
    );
    const source = await desk.snapshot(northside);
    const target = await desk.snapshot(greenfield);
    assertAccount(source, 0);
    assertAccount(target, 0);
    assert.equal(source.summary.receivedPaise, 0);
    assert.equal(target.summary.receivedPaise, 10000);
    assert.equal(target.summary.outstandingPaise, 0);
    assert.equal(source.ledger.transfers.length, 1);
    assert.equal(target.ledger.transfers.length, 1);
    for (const state of [source, target])
      assert.ok(
        state.timeline.some((event) => event.type === 'REATTRIBUTE_PAYMENT'),
      );
  });

  it('moves a fully allocated ₹100 payment: Northside reopens and loses spent points, Greenfield is settled', async () => {
    const northside = await customer();
    const greenfield = await customer();
    await deliveredOrder(greenfield);
    await deliveredOrder(northside);
    const receiptId = await receive(northside, 10000);
    const spending = await deliveredOrder(northside);
    const charge = (await desk.snapshot(northside)).summary.charges.find(
      (row) => row.order_id === spending,
    )!;
    await desk.apply(
      {
        type: 'REDEEM_POINTS',
        payload: { customerId: northside, chargeId: charge.id, points: 1000 },
      },
      'ACCOUNTS',
    );

    await apply(move(northside, receiptId, greenfield), greenfield);

    const source = await desk.snapshot(northside);
    assertAccount(source, 19000);
    assert.equal(source.summary.outstandingPaise, 19000);
    assert.equal(source.summary.points.available, 0);
    assert.equal(source.summary.points.clawbackPending, 1000);
    const target = await desk.snapshot(greenfield);
    assertAccount(target, 0);
    assert.equal(target.summary.outstandingPaise, 0);
    assert.equal(target.summary.points.available, 1000);
  });

  it('moves part of a receipt, taking free cash before reopening charges', async () => {
    const northside = await customer();
    const greenfield = await customer();
    await deliveredOrder(northside);
    const receiptId = await receive(northside, 15000);
    await apply(move(northside, receiptId, greenfield, 8000), greenfield);

    const source = await desk.snapshot(northside);
    assertAccount(source, 3000);
    assert.equal(source.summary.outstandingPaise, 3000);
    assert.equal(source.summary.unappliedCashPaise, 0);
    const target = await desk.snapshot(greenfield);
    assertAccount(target, -8000);
    assert.equal(target.summary.unappliedCashPaise, 8000);
  });

  it('refuses to move money that funds customer credit (v1 limit)', async () => {
    const northside = await customer();
    const greenfield = await customer();
    const receiptId = await receive(northside, 10000);
    await desk.apply(
      {
        type: 'ISSUE_CREDIT_NOTE',
        payload: {
          customerId: northside,
          amountPaise: 10000,
          reason: 'Goodwill credit',
        },
      },
      'ACCOUNTS',
    );
    const result = await desk.assertUnchanged(
      await envelope(move(northside, receiptId, greenfield), greenfield),
      northside,
      'REJECTED',
    );
    assert.equal(result.errors[0]!.code, 'RECEIPT_FUNDS_CREDIT');
  });

  it('rejects moving a payment to the same customer', async () => {
    const northside = await customer();
    const receiptId = await receive(northside, 10000);
    const result = await desk.assertUnchanged(
      await desk.envelope(move(northside, receiptId, northside), 'ACCOUNTS'),
      northside,
      'REJECTED',
    );
    assert.equal(result.errors[0]!.code, 'SAME_CUSTOMER');
  });

  it('requires and checks the receiving customer version', async () => {
    const northside = await customer();
    const greenfield = await customer();
    const receiptId = await receive(northside, 10000);
    const command = move(northside, receiptId, greenfield);

    const missing = await desk.assertUnchanged(
      await desk.envelope(command, 'ACCOUNTS'),
      northside,
      'REJECTED',
    );
    assert.equal(missing.errors[0]!.code, 'VERSION_REQUIRED');

    const stale = await envelope(command, greenfield);
    await receive(greenfield, 500); // the target changes after it was read
    const conflict = await desk.assertUnchanged(stale, greenfield, 'CONFLICT');
    assert.equal(conflict.errors[0]!.code, 'VERSION_CONFLICT');
  });

  it('returns a conflict on a stale source version', async () => {
    const northside = await customer();
    const greenfield = await customer();
    const receiptId = await receive(northside, 10000);
    const stale = await envelope(
      move(northside, receiptId, greenfield),
      greenfield,
    );
    stale.expectedVersion! -= 1;
    const result = await desk.assertUnchanged(stale, northside, 'CONFLICT');
    assert.equal(result.errors[0]!.code, 'VERSION_CONFLICT');
  });

  it('rejects the warehouse role without changes', async () => {
    const northside = await customer();
    const greenfield = await customer();
    const receiptId = await receive(northside, 10000);
    const result = await desk.assertUnchanged(
      await envelope(
        move(northside, receiptId, greenfield),
        greenfield,
        'WAREHOUSE',
      ),
      northside,
      'REJECTED',
    );
    assert.equal(result.errors[0]!.code, 'FORBIDDEN');
  });
});
