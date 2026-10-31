import { Injectable, Module } from '@nestjs/common';
import {
  and,
  count,
  eq,
  getTableColumns,
  isNotNull,
  ne,
  sum,
} from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { safe, recordInsert, recordUpdate, fail } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import { crmOrders } from '../orders/orders.model.js';
import {
  crmShipments,
  crmShipmentLines,
  crmDeliveries,
  crmCorrections,
} from '../fulfillment/fulfillment.model.js';

@Injectable()
export class FulfillmentRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  findLine(id: string) {
    return this.db
      .select()
      .from(crmShipmentLines)
      .where(eq(crmShipmentLines.id, id))
      .get();
  }
  dispatchedCount(orderId: string) {
    return (
      this.db
        .select({ value: count() })
        .from(crmShipments)
        .where(
          and(
            eq(crmShipments.order_id, orderId),
            isNotNull(crmShipments.dispatched_at),
          ),
        )
        .get()?.value ?? 0
    );
  }
  loadingForOrder(orderId: string) {
    return this.db
      .select()
      .from(crmShipments)
      .where(
        and(
          eq(crmShipments.order_id, orderId),
          eq(crmShipments.status, 'LOADING'),
        ),
      )
      .orderBy(insertionOrder(crmShipments))
      .all();
  }
  reservedForLine(lineKey: string, excludedShipmentId: string) {
    return safe(
      this.db
        .select({ value: sum(crmShipmentLines.loaded_qty).mapWith(Number) })
        .from(crmShipmentLines)
        .innerJoin(
          crmShipments,
          eq(crmShipments.id, crmShipmentLines.shipment_id),
        )
        .where(
          and(
            eq(crmShipmentLines.line_key, lineKey),
            ne(crmShipments.status, 'VOIDED'),
            ne(crmShipments.id, excludedShipmentId),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  findForOrder(id: string, orderId: string) {
    return this.db
      .select()
      .from(crmShipments)
      .where(and(eq(crmShipments.id, id), eq(crmShipments.order_id, orderId)))
      .get();
  }
  linesForShipment(shipmentId: string) {
    return this.db
      .select()
      .from(crmShipmentLines)
      .where(eq(crmShipmentLines.shipment_id, shipmentId))
      .orderBy(insertionOrder(crmShipmentLines))
      .all();
  }
  findInShipment(id: string, shipmentId: string) {
    return this.db
      .select()
      .from(crmShipmentLines)
      .where(
        and(
          eq(crmShipmentLines.id, id),
          eq(crmShipmentLines.shipment_id, shipmentId),
        ),
      )
      .get();
  }
  deliveredForShipmentLine(lineId: string) {
    return safe(
      this.db
        .select({ value: sum(crmDeliveries.qty).mapWith(Number) })
        .from(crmDeliveries)
        .where(eq(crmDeliveries.shipment_line_id, lineId))
        .get()?.value ?? 0,
    );
  }
  undeliveredForShipment(shipmentId: string) {
    return safe(
      this.linesForShipment(shipmentId).reduce(
        (total, line) =>
          total + line.dispatched_qty - this.deliveredForShipmentLine(line.id),
        0,
      ),
    );
  }
  dispatchedForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmShipmentLines.dispatched_qty).mapWith(Number) })
        .from(crmShipmentLines)
        .innerJoin(
          crmShipments,
          eq(crmShipments.id, crmShipmentLines.shipment_id),
        )
        .where(
          and(
            eq(crmShipmentLines.line_key, lineKey),
            ne(crmShipments.status, 'VOIDED'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  dispatchedForOrder(orderId: string) {
    return safe(
      this.db
        .select({ value: sum(crmShipmentLines.dispatched_qty).mapWith(Number) })
        .from(crmShipmentLines)
        .where(eq(crmShipmentLines.order_id, orderId))
        .get()?.value ?? 0,
    );
  }
  findInOrder(id: string, orderId: string) {
    return this.db
      .select()
      .from(crmShipmentLines)
      .where(
        and(
          eq(crmShipmentLines.id, id),
          eq(crmShipmentLines.order_id, orderId),
        ),
      )
      .get();
  }
  dispatchedForOrderDocuments(orderId: string) {
    return this.db
      .select()
      .from(crmShipments)
      .where(
        and(
          eq(crmShipments.order_id, orderId),
          isNotNull(crmShipments.dispatched_at),
        ),
      )
      .orderBy(insertionOrder(crmShipments))
      .all();
  }
  loadingForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmShipmentLines.loaded_qty).mapWith(Number) })
        .from(crmShipmentLines)
        .innerJoin(
          crmShipments,
          eq(crmShipments.id, crmShipmentLines.shipment_id),
        )
        .where(
          and(
            eq(crmShipmentLines.line_key, lineKey),
            eq(crmShipments.status, 'LOADING'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  deliveredForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmDeliveries.qty).mapWith(Number) })
        .from(crmDeliveries)
        .innerJoin(
          crmShipmentLines,
          eq(crmShipmentLines.id, crmDeliveries.shipment_line_id),
        )
        .where(eq(crmShipmentLines.line_key, lineKey))
        .get()?.value ?? 0,
    );
  }
  forOrder(orderId: string) {
    return this.db
      .select()
      .from(crmShipments)
      .where(eq(crmShipments.order_id, orderId))
      .orderBy(insertionOrder(crmShipments))
      .all();
  }
  pricedDeliveriesForCustomer(customerId: string) {
    return this.db
      .select({
        id: crmDeliveries.id,
        qty: crmDeliveries.qty,
        unit_price_paise: crmShipmentLines.unit_price_paise,
      })
      .from(crmDeliveries)
      .innerJoin(
        crmShipmentLines,
        eq(crmShipmentLines.id, crmDeliveries.shipment_line_id),
      )
      .innerJoin(crmOrders, eq(crmOrders.id, crmDeliveries.order_id))
      .where(eq(crmOrders.customer_id, customerId))
      .orderBy(insertionOrder(crmDeliveries))
      .all();
  }
  correctionsForCustomer(customerId: string) {
    return this.db
      .select(getTableColumns(crmCorrections))
      .from(crmCorrections)
      .innerJoin(crmOrders, eq(crmOrders.id, crmCorrections.order_id))
      .where(eq(crmOrders.customer_id, customerId))
      .orderBy(insertionOrder(crmCorrections))
      .all();
  }
  insertShipment(c: ActionContext, row: typeof crmShipments.$inferInsert) {
    this.db.insert(crmShipments).values(row).run();
    recordInsert(c, 'shipments', row, false);
  }
  updateShipment(
    c: ActionContext,
    id: string,
    patch: Partial<Omit<typeof crmShipments.$inferInsert, 'id'>>,
  ) {
    const before = this.db
      .select()
      .from(crmShipments)
      .where(eq(crmShipments.id, id))
      .get();
    if (!before) fail('NOT_FOUND', 'Record not found');
    this.db
      .update(crmShipments)
      .set(patch)
      .where(eq(crmShipments.id, id))
      .run();
    recordUpdate(c, 'shipments', before, { ...before, ...patch });
  }
  insertShipmentLine(
    c: ActionContext,
    row: typeof crmShipmentLines.$inferInsert,
  ) {
    this.db.insert(crmShipmentLines).values(row).run();
    recordInsert(c, 'shipment_lines', row, false);
  }
  updateShipmentLine(
    c: ActionContext,
    id: string,
    patch: Partial<Omit<typeof crmShipmentLines.$inferInsert, 'id'>>,
  ) {
    const before = this.db
      .select()
      .from(crmShipmentLines)
      .where(eq(crmShipmentLines.id, id))
      .get();
    if (!before) fail('NOT_FOUND', 'Record not found');
    this.db
      .update(crmShipmentLines)
      .set(patch)
      .where(eq(crmShipmentLines.id, id))
      .run();
    recordUpdate(c, 'shipment_lines', before, { ...before, ...patch });
  }
  /**
   * FUL-007: confirmations on a line that still have units after earlier
   * reversals, latest first, with the units each one still holds.
   */
  openConfirmationsLatestFirst(lineId: string) {
    const rows = this.db
      .select()
      .from(crmDeliveries)
      .where(eq(crmDeliveries.shipment_line_id, lineId))
      .orderBy(insertionOrder(crmDeliveries))
      .all();
    const reversed = new Map<string, number>();
    for (const row of rows)
      if (row.reversal_of_id)
        reversed.set(
          row.reversal_of_id,
          (reversed.get(row.reversal_of_id) ?? 0) - row.qty,
        );
    return rows
      .filter((row) => !row.reversal_of_id)
      .map((row) => ({
        ...row,
        remaining: row.qty - (reversed.get(row.id) ?? 0),
      }))
      .filter((row) => row.remaining > 0)
      .reverse();
  }
  insertDelivery(c: ActionContext, row: typeof crmDeliveries.$inferInsert) {
    this.db.insert(crmDeliveries).values(row).run();
    recordInsert(c, 'deliveries', row, false);
  }
  insertCorrection(c: ActionContext, row: typeof crmCorrections.$inferInsert) {
    this.db.insert(crmCorrections).values(row).run();
    recordInsert(c, 'corrections', row, false);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [FulfillmentRepository],
  exports: [FulfillmentRepository],
})
export class FulfillmentRepositoryModule {}
