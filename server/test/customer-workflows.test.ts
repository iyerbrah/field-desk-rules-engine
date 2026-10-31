import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type {
  CrmBootstrap,
  CustomerSnapshot,
  OrderDetail,
} from '@crm/shared/crm';
import { DatabaseService } from '../src/database/database.service.js';
import { UsersService } from '../src/users/users.service.js';
import { configureApp } from '../src/configure-app.js';
import { seedReferenceData } from '../src/scripts/seed-reference-data.js';
import { HttpDesk } from './support/http-desk.js';
import { assertAccount } from './support/account.js';

const directory = mkdtempSync(join(tmpdir(), 'customer-workflows-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'workflow.db');
process.env.JWT_SECRET = 'workflow-test-secret-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
const items = [
  { skuId: 'sku-a', qty: 20, unitPricePaise: 10000 },
  { skuId: 'sku-b', qty: 15, unitPricePaise: 15000 },
];

describe('Customer workflows through HTTP', { concurrency: false }, () => {
  let app: INestApplication;
  let desk: HttpDesk;
  const outcomes: Array<{ name: string; passed: boolean; error?: string }> = [];
  function workflow(name: string, run: () => Promise<void>) {
    it(name, async () => {
      try {
        await run();
        outcomes.push({ name, passed: true });
      } catch (error) {
        outcomes.push({
          name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }
  before(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useValue([{ ttl: 60000, limit: 100000 }])
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    migrate(app.get(DatabaseService).db, {
      migrationsFolder: resolve('drizzle'),
    });
    const password = 'workflow-admin-password';
    const admin = await app.get(UsersService).create({
      name: 'Workflow operator',
      email: 'workflow@example.test',
      password,
      role: 'ADMIN',
    });
    seedReferenceData(app.get(DatabaseService), admin);
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password })
      .expect(200);
    const headers = login.headers['set-cookie'] as unknown as string[];
    desk = new HttpDesk(app, headers[0]!.split(';')[0]!);
    const catalog = await desk.read<CrmBootstrap>('bootstrap');
    assert.deepEqual(
      catalog.skus.map((sku) => [sku.id, sku.price_paise, sku.points_per_unit]),
      [
        ['sku-a', 10000, 1000],
        ['sku-b', 15000, 1200],
        ['sku-c', 25000, 2000],
      ],
    );
  });
  after(async () => {
    const times = (desk?.timings ?? [])
      .map((item) => item.durationMs)
      .sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      times[Math.max(0, Math.ceil(times.length * fraction) - 1)] ?? 0;
    mkdirSync(resolve('../reports'), { recursive: true });
    writeFileSync(
      resolve('../reports/customer-workflows.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          termsVersion: '2026-10-26.1',
          workload: {
            canonicalCases: 14,
            mixedSequences: 200,
            additionalCases: 2,
            seeds: '0x4b1d + sequence * 7919',
            rateLimit:
              '100000 requests per minute in this test application only',
            transport: 'NestJS HTTP, Supertest, temporary SQLite',
            latencyScope:
              'POST /crm/actions including HTTP and database commit; excludes envelope lookups and reads',
          },
          complete:
            outcomes.length === 216 && outcomes.every((item) => item.passed),
          outcomes,
          actions: {
            count: times.length,
            medianMs: percentile(0.5),
            p95Ms: percentile(0.95),
            requests: desk?.timings ?? [],
          },
          memory: process.memoryUsage(),
        },
        null,
        2,
      ) + '\n',
    );
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  workflow(
    'F-01 bills only confirmed A10/B10 and retains A10/B5 open',
    async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id, items);
      await desk.ship(orderId, [10, 10]);
      const state = await desk.snapshot(customer.id);
      assertAccount(state, 250000);
      assert.deepEqual(
        state.orders[0]!.lines.map((line) => [
          line.delivered,
          line.open,
          line.dispatched - line.delivered,
        ]),
        [
          [10, 10, 0],
          [10, 5, 0],
        ],
      );
      assert.equal(state.summary.points.available, 0);
      assert.equal(state.summary.points.locked, 38000);
    },
  );

  workflow(
    'F-02 invalidates loading and requires approval for an edited revision',
    async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id);
      const detail = await desk.read<OrderDetail>(`orders/${orderId}`);
      const loading = await desk.apply(
        {
          type: 'START_LOADING',
          payload: {
            orderId,
            items: [{ lineKey: detail.lines[0]!.lineKey, qty: 1 }],
          },
        },
        'WAREHOUSE',
      );
      await desk.apply(
        {
          type: 'EDIT_ORDER',
          payload: {
            orderId,
            items: [{ skuId: 'sku-a', qty: 2, unitPricePaise: 12000 }],
            reason: 'Revise the commercial commitment',
          },
        },
        'SALES',
      );
      await desk.assertUnchanged(
        await desk.envelope(
          {
            type: 'DISPATCH_SHIPMENT',
            payload: { orderId, shipmentId: loading.references.shipmentId! },
          },
          'WAREHOUSE',
        ),
        customer.id,
        'REJECTED',
      );
      const state = await desk.snapshot(customer.id);
      assert.equal(state.orders[0]!.order.current_revision, 2);
      assert.equal(state.orders[0]!.shipments[0]!.status, 'VOIDED');
      assert.equal(state.orders[0]!.lines[0]!.approved, 0);
      await desk.apply(
        { type: 'APPROVE_ORDER', payload: { orderId, revision: 2 } },
        'KAM',
      );
      assert.equal(
        (await desk.snapshot(customer.id)).summary.points.locked,
        2000,
      );
    },
  );

  workflow(
    'F-03 rejects ordinary edits after dispatch without changing evidence',
    async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id);
      await desk.ship(orderId, [1], [0]);
      await desk.assertUnchanged(
        await desk.envelope(
          {
            type: 'EDIT_ORDER',
            payload: {
              orderId,
              items: [{ skuId: 'sku-a', qty: 2, unitPricePaise: 10000 }],
              reason: 'Attempt a post-dispatch edit',
            },
          },
          'SALES',
        ),
        customer.id,
        'REJECTED',
      );
    },
  );

  workflow(
    'F-04 charges a second shipment incrementally without duplicating earlier charges',
    async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id, items);
      await desk.ship(orderId, [10, 10]);
      const before = await desk.snapshot(customer.id);
      await desk.ship(orderId, [10, 5]);
      const state = await desk.snapshot(customer.id);
      assertAccount(state, 425000);
      assert.equal(state.orders[0]!.shipments.length, 2);
      assert.equal(state.ledger.finance.length, 4);
      for (const row of before.ledger.finance)
        assert.deepEqual(
          state.ledger.finance.find((entry) => entry.id === row.id),
          row,
        );
    },
  );

  workflow(
    'F-05 cancels an unshipped approved order with compensating point postings',
    async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id);
      await desk.apply(
        {
          type: 'CANCEL_REMAINDER',
          payload: { orderId, reason: 'Customer cancels the order' },
        },
        'SALES',
      );
      const state = await desk.snapshot(customer.id);
      assertAccount(state, 0);
      assert.equal(state.summary.points.locked, 0);
      assert.deepEqual(
        state.ledger.rewards.map((row) => row.points_delta),
        [1000, -1000],
      );
    },
  );

  workflow(
    'F-06 cancels only unshipped demand after a partial fulfillment',
    async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id, items);
      await desk.ship(orderId, [10, 10]);
      await desk.apply(
        {
          type: 'CANCEL_REMAINDER',
          payload: { orderId, reason: 'Cancel remaining demand' },
        },
        'SALES',
      );
      const state = await desk.snapshot(customer.id);
      assertAccount(state, 250000);
      assert.deepEqual(
        state.orders[0]!.lines.map((line) => [line.canceled, line.delivered]),
        [
          [10, 10],
          [5, 10],
        ],
      );
      assert.equal(state.summary.points.locked, 22000);
    },
  );

  async function paidItem() {
    const customer = await desk.createCustomer();
    const orderId = await desk.order(customer.id);
    const shipment = await desk.ship(orderId);
    await desk.receive(customer.id, 10000);
    return { customer, orderId, lineId: shipment.lines[0]!.id };
  }
  async function returnedItem(feePaise = 2000) {
    const item = await paidItem();
    await desk.apply(
      {
        type: 'RECORD_RETURN',
        payload: {
          orderId: item.orderId,
          items: [{ shipmentLineId: item.lineId, qty: 1 }],
          feePaise,
          reason: 'Customer return accepted',
        },
      },
      'WAREHOUSE',
    );
    return item;
  }

  workflow(
    'F-07 gives an 8000-paise funded credit after a 10000-paise paid return and 2000-paise fee',
    async () => {
      const { customer } = await returnedItem();
      const state = await desk.snapshot(customer.id);
      assertAccount(state, -8000);
      assert.equal(state.summary.creditsOpenPaise, 8000);
      assert.equal(state.summary.points.available, 0);
      assert.equal(state.ledger.receipts.length, 1);
      assert.equal(state.ledger.returns.length, 1);
    },
  );

  workflow(
    'F-08 captures customer cash once and attributes it across two orders in FIFO order',
    async () => {
      const customer = await desk.createCustomer();
      await desk.ship(await desk.order(customer.id));
      await desk.ship(await desk.order(customer.id));
      await desk.receive(customer.id, 15000);
      const state = await desk.snapshot(customer.id);
      assertAccount(state, 5000);
      assert.equal(state.ledger.receipts.length, 1);
      assert.ok(!('order_id' in state.ledger.receipts[0]!));
      assert.deepEqual(
        state.summary.charges.map((charge) => charge.cashPaidPaise),
        [10000, 5000],
      );
      assert.equal(state.summary.points.available, 1500);
    },
  );

  workflow(
    'F-09 spends unlocked points against a later charge without earning new points',
    async () => {
      const { customer } = await paidItem();
      await desk.ship(await desk.order(customer.id));
      let state = await desk.snapshot(customer.id);
      const charge = state.summary.charges.find(
        (row) => row.outstandingPaise > 0,
      )!;
      await desk.apply(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: customer.id,
            chargeId: charge.id,
            points: 1000,
          },
        },
        'SALES',
      );
      state = await desk.snapshot(customer.id);
      assertAccount(state, 9000);
      assert.equal(state.summary.points.available, 0);
      assert.equal(state.summary.points.redeemed, 1000);
      assert.equal(state.summary.points.locked, 1000);
    },
  );

  workflow(
    'F-10 records spent-return entitlement as debt and offsets it with later earnings',
    async () => {
      const { customer, orderId, lineId } = await paidItem();
      await desk.ship(await desk.order(customer.id));
      let state = await desk.snapshot(customer.id);
      const charge = state.summary.charges.find(
        (row) => row.outstandingPaise > 0,
      )!;
      await desk.apply(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: customer.id,
            chargeId: charge.id,
            points: 1000,
          },
        },
        'SALES',
      );
      await desk.apply(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: [{ shipmentLineId: lineId, qty: 1 }],
            feePaise: 0,
            reason: 'Return after spending points',
          },
        },
        'WAREHOUSE',
      );
      state = await desk.snapshot(customer.id);
      assertAccount(state, -1000);
      assert.equal(state.summary.points.clawbackPending, 1000);
      await desk.receive(customer.id, 9000);
      state = await desk.snapshot(customer.id);
      assert.equal(state.summary.points.clawbackPending, 100);
      assert.equal(state.summary.points.available, 0);
    },
  );

  workflow(
    'F-11 applies only the Accounts-selected amount of credit without a new receipt',
    async () => {
      const { customer } = await returnedItem();
      await desk.ship(await desk.order(customer.id));
      let state = await desk.snapshot(customer.id);
      assert.equal(state.summary.outstandingPaise, 10000);
      await desk.apply(
        {
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId: customer.id,
            creditNoteId: state.summary.credits[0]!.id,
            chargeId: state.summary.charges.find(
              (row) => row.outstandingPaise > 0,
            )!.id,
            amountPaise: 3000,
          },
        },
        'ACCOUNTS',
      );
      state = await desk.snapshot(customer.id);
      assertAccount(state, 2000);
      assert.equal(state.summary.creditsOpenPaise, 5000);
      assert.equal(state.summary.outstandingPaise, 7000);
      assert.equal(state.ledger.receipts.length, 1);
      assert.equal(state.summary.points.available, 0);
    },
  );

  workflow(
    'F-12 asks for physical facts before appending an authorized dispatch correction',
    async () => {
      const { customer, orderId } = await paidItem();
      const before = await desk.snapshot(customer.id);
      const payload = {
        orderId,
        items: [
          { skuId: 'sku-c', qty: 1, unitPricePaise: 25000, deliveredQty: 1 },
        ],
        reason: 'Unrecorded reserve blend shipped',
        evidence: 'Signed dispatch supplement confirmed by warehouse',
        authorizationReference: 'KAM-CORRECTION-01',
      };
      await desk.assertUnchanged(
        await desk.envelope(
          { type: 'CORRECT_DISPATCHED_ORDER', payload },
          'KAM',
        ),
        customer.id,
        'NEEDS_DECISION',
      );
      await desk.apply(
        {
          type: 'CORRECT_DISPATCHED_ORDER',
          payload: {
            ...payload,
            location: 'EXISTING_SHIPMENT',
            shipmentId: before.orders[0]!.shipments[0]!.id,
          },
        },
        'KAM',
      );
      const state = await desk.snapshot(customer.id);
      assertAccount(state, 25000);
      assert.deepEqual(
        state.orders[0]!.shipments[0],
        before.orders[0]!.shipments[0],
      );
      assert.equal(state.orders[0]!.revisions.length, 2);
      assert.equal(
        state.orders[0]!.shipments[1]!.original_shipment_id,
        before.orders[0]!.shipments[0]!.id,
      );
      assert.equal(state.ledger.corrections.length, 1);
    },
  );

  workflow(
    'F-13 returns the original receipt result on retry and rejects changed key input',
    async () => {
      const customer = await desk.createCustomer();
      const envelope = await desk.envelope(
        {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: {
            customerId: customer.id,
            amountPaise: 10000,
            reference: 'BANK-EXACT-RETRY',
          },
        },
        'ACCOUNTS',
      );
      const result = await desk.submit(envelope);
      assert.equal(result.status, 'APPLIED');
      assert.deepEqual(await desk.submit(envelope), result);
      const conflict = await desk.submit({ ...envelope, expectedVersion: 1 });
      assert.equal(conflict.errors[0]!.code, 'IDEMPOTENCY_CONFLICT');
      const state = await desk.snapshot(customer.id);
      assertAccount(state, -10000);
      assert.equal(state.ledger.receipts.length, 1);
      assert.equal(state.timeline.length, 1);
    },
  );

  workflow(
    'F-14 permits only one of two concurrent returns on the same units',
    async () => {
      const { customer, orderId, lineId } = await paidItem();
      const envelope = await desk.envelope(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: [{ shipmentLineId: lineId, qty: 1 }],
            feePaise: 0,
            reason: 'Concurrent returned goods',
          },
        },
        'WAREHOUSE',
      );
      const results = await Promise.all([
        desk.submit(envelope),
        desk.submit({ ...envelope, idempotencyKey: randomUUID() }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [
        'APPLIED',
        'CONFLICT',
      ]);
      const state = await desk.snapshot(customer.id);
      assert.equal(state.ledger.returns.length, 1);
      assertAccount(state, -10000);
    },
  );

  workflow(
    'serializes concurrent credit applications without spending credit twice',
    async () => {
      const { customer } = await returnedItem();
      await desk.ship(await desk.order(customer.id));
      const before = await desk.snapshot(customer.id);
      const envelope = await desk.envelope(
        {
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId: customer.id,
            creditNoteId: before.summary.credits[0]!.id,
            chargeId: before.summary.charges.find(
              (row) => row.outstandingPaise > 0,
            )!.id,
            amountPaise: 8000,
          },
        },
        'ACCOUNTS',
      );
      const results = await Promise.all([
        desk.submit(envelope),
        desk.submit({ ...envelope, idempotencyKey: randomUUID() }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [
        'APPLIED',
        'CONFLICT',
      ]);
      const after = await desk.snapshot(customer.id);
      assertAccount(after, 2000);
      assert.equal(after.summary.creditsOpenPaise, 0);
      assert.equal(after.ledger.creditApplications.length, 1);
      await desk.assertUnchanged(
        await desk.envelope(envelope.command, 'SALES'),
        customer.id,
        'REJECTED',
      );
    },
  );

  workflow(
    'serializes concurrent point redemptions without spending points twice',
    async () => {
      const { customer } = await paidItem();
      await desk.ship(await desk.order(customer.id));
      const before = await desk.snapshot(customer.id);
      const envelope = await desk.envelope(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: customer.id,
            chargeId: before.summary.charges.find(
              (row) => row.outstandingPaise > 0,
            )!.id,
            points: 1000,
          },
        },
        'SALES',
      );
      const results = await Promise.all([
        desk.submit(envelope),
        desk.submit({ ...envelope, idempotencyKey: randomUUID() }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [
        'APPLIED',
        'CONFLICT',
      ]);
      const after = await desk.snapshot(customer.id);
      assertAccount(after, 9000);
      assert.equal(after.summary.points.available, 0);
      assert.equal(after.ledger.redemptions.length, 1);
    },
  );

  for (let sequence = 0; sequence < 200; sequence++) {
    workflow(
      `maintains quantities, account position, and immutable evidence in sequence ${sequence + 1}`,
      async () => {
        let seed = 0x4b1d + sequence * 7919;
        const pick = (max: number) => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed % max;
        };
        const customer = await desk.createCustomer();
        const qty = 3 + pick(5),
          price = 10001 + pick(20000),
          dispatched = qty - 1;
        const firstDelivery = 1 + pick(dispatched);
        let delivered = 0,
          returned = 0,
          canceled = 0,
          fees = 0,
          cash = 0,
          refunds = 0,
          spent = 0;
        let previous: CustomerSnapshot | undefined;
        const verify = async () => {
          const state = await desk.snapshot(customer.id);
          assertAccount(
            state,
            (delivered - returned) * price + fees - cash + refunds - spent,
          );
          if (state.orders.length) {
            const line = state.orders[0]!.lines[0]!;
            assert.deepEqual(
              [
                line.qty,
                line.dispatched,
                line.delivered,
                line.returned,
                line.canceled,
              ],
              [qty, dispatched, delivered, returned, canceled],
            );
            const p = state.summary.points;
            assert.equal(
              p.locked + p.available + p.redeemed - p.clawbackPending,
              (qty - returned - canceled) * 1000,
            );
            assert.equal(p.redeemed, spent);
            for (const value of Object.values(p)) assert.ok(value >= 0);
          }
          if (previous) {
            for (const kind of Object.keys(previous.ledger) as Array<
              keyof CustomerSnapshot['ledger']
            >) {
              for (const row of previous.ledger[kind])
                assert.deepEqual(
                  state.ledger[kind].find((next) => next.id === row.id),
                  row,
                  `Changed historical ${kind} entry`,
                );
            }
          }
          previous = state;
          return state;
        };
        const orderId = await desk.order(customer.id, [
          { skuId: 'sku-a', qty, unitPricePaise: price },
        ]);
        const receipt = 1 + pick(dispatched * price + 1000);
        if (sequence % 2 === 0) {
          await desk.receive(customer.id, receipt);
          cash += receipt;
        }
        const shipment = await desk.ship(
          orderId,
          [dispatched],
          [firstDelivery],
        );
        delivered = firstDelivery;
        await verify();
        const invalid = await desk.envelope(
          {
            type: 'CONFIRM_DELIVERY',
            payload: {
              orderId,
              shipmentId: shipment.id,
              items: [{ shipmentLineId: shipment.lines[0]!.id, qty: qty + 1 }],
            },
          },
          'WAREHOUSE',
        );
        await desk.assertUnchanged(invalid, customer.id, 'REJECTED');
        const returnGoods = async () => {
          const count = 1 + pick(firstDelivery);
          const fee = pick(Math.floor(price / 5));
          await desk.apply(
            {
              type: 'RECORD_RETURN',
              payload: {
                orderId,
                items: [{ shipmentLineId: shipment.lines[0]!.id, qty: count }],
                feePaise: fee,
                reason: 'Physical goods returned',
              },
            },
            'WAREHOUSE',
          );
          returned += count;
          fees += fee;
          await verify();
        };
        if (sequence % 3 === 0) await returnGoods();
        if (delivered < dispatched) {
          await desk.apply(
            {
              type: 'CONFIRM_DELIVERY',
              payload: {
                orderId,
                shipmentId: shipment.id,
                items: [
                  {
                    shipmentLineId: shipment.lines[0]!.id,
                    qty: dispatched - delivered,
                  },
                ],
              },
            },
            'WAREHOUSE',
          );
          delivered = dispatched;
          await verify();
        }
        if (sequence % 3 !== 0) await returnGoods();
        await desk.apply(
          {
            type: 'CANCEL_REMAINDER',
            payload: {
              orderId,
              reason: 'Cancel unshipped units',
              items: [
                {
                  lineKey: (await desk.read<OrderDetail>(`orders/${orderId}`))
                    .lines[0]!.lineKey,
                  qty: 1,
                },
              ],
            },
          },
          'SALES',
        );
        canceled = 1;
        await verify();
        if (sequence % 2 !== 0) {
          await desk.receive(customer.id, receipt);
          cash += receipt;
          await verify();
        }
        let state = await desk.snapshot(customer.id);
        const charge = state.summary.charges.find(
          (row) => row.outstandingPaise > 0,
        );
        if (
          charge &&
          state.summary.points.available > 0 &&
          sequence % 4 === 0
        ) {
          const points = Math.min(
            charge.outstandingPaise,
            state.summary.points.available,
            127,
          );
          const envelope = await desk.envelope(
            {
              type: 'REDEEM_POINTS',
              payload: { customerId: customer.id, chargeId: charge.id, points },
            },
            'ACCOUNTS',
          );
          assert.equal((await desk.submit(envelope)).status, 'APPLIED');
          spent += points;
          await verify();
          assert.equal((await desk.submit(envelope)).status, 'APPLIED');
          await verify();
        }
        state = await desk.snapshot(customer.id);
        const credit = state.summary.credits.find(
          (row) => row.availablePaise > 0,
        );
        if (credit && sequence % 2 === 0) {
          const amount = 1 + pick(credit.availablePaise);
          const refunded = await desk.apply(
            {
              type: 'REFUND_CREDIT_NOTE',
              payload: {
                customerId: customer.id,
                creditNoteId: credit.id,
                amountPaise: amount,
                reference: 'BANK-REFUND',
              },
            },
            'ACCOUNTS',
          );
          refunds += amount;
          const withRefund = await verify();
          if (sequence % 4 === 0) {
            const row = withRefund.ledger.refunds.find(
              (entry) => entry.action_id === refunded.actionId,
            )!;
            const amount = Math.max(
              1,
              Math.floor(Number(row.amount_paise) / 2),
            );
            await desk.apply(
              {
                type: 'REVERSE_CREDIT_REFUND',
                payload: {
                  customerId: customer.id,
                  refundId: String(row.id),
                  amountPaise: amount,
                  reason: 'Bank returned part of transfer',
                  reference: 'BANK-REVERSAL',
                },
              },
              'ACCOUNTS',
            );
            refunds -= amount;
            await verify();
          }
        }
        const beforeReceipt = await desk.snapshot(customer.id);
        const retry = await desk.envelope(
          {
            type: 'RECEIVE_CUSTOMER_PAYMENT',
            payload: {
              customerId: customer.id,
              amountPaise: 17,
              reference: 'Exact duplicate transfer',
            },
          },
          'ACCOUNTS',
        );
        const outcomes = await Promise.all([
          desk.submit(retry),
          desk.submit(retry),
        ]);
        assert.deepEqual(outcomes[0], outcomes[1]);
        cash += 17;
        const final = await verify();
        assert.equal(
          final.ledger.receipts.length,
          beforeReceipt.ledger.receipts.length + 1,
        );
        await desk.assertUnchanged(
          await desk.envelope(
            {
              type: 'RECORD_RETURN',
              payload: {
                orderId,
                items: [{ shipmentLineId: shipment.lines[0]!.id, qty: qty }],
                feePaise: 0,
                reason: 'Excess units rejected',
              },
            },
            'WAREHOUSE',
          ),
          customer.id,
          'REJECTED',
        );
      },
    );
  }
});
