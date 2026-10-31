import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '@crm/shared';
import type { ActionResult, EventRow, AccountReview } from '@crm/shared/crm';
import { BUSINESS_TERMS_VERSION } from '@crm/shared/crm';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { OrdersRepository } from '../orders/orders.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { AuditRepository } from '../audit/audit.repository.js';
import { ActionsRepository } from '../actions/actions.repository.js';
import type { ActionContext as Context } from '../common/domain.js';
import { safe } from '../common/domain.js';
interface AuditRecord {
  [key: string]: unknown;
  id?: string;
  charge_id?: string;
  order_id?: string;
  line_key?: string;
  revision_id?: string;
  shipment_line_id?: string;
  shipment_id?: string;
  source_id?: string;
  return_id?: string;
  receipt_id?: string;
  adjusts_id?: string;
  reversal_of_id?: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly accountsRepository: AccountsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly accountsService: AccountsService,
    private readonly ordersService: OrdersService,
    private readonly rewardsRepository: RewardsRepository,
    private readonly returnsRepository: ReturnsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly auditRepository: AuditRepository,
    private readonly actionsRepository: ActionsRepository,
  ) {}
  evidence(c: Context, table: string, row: AuditRecord) {
    const charge = row.charge_id
      ? this.accountsRepository.findCharge(row.charge_id)
      : undefined;
    const line = row.line_key
      ? this.ordersRepository.latestLine(row.line_key)
      : undefined;
    const revision = row.revision_id
      ? this.ordersRepository.findRevision(row.revision_id)
      : undefined;
    const orderId = String(
      row.order_id ?? charge?.order_id ?? line?.order_id ?? c.orderId ?? '',
    );
    const order = orderId ? this.ordersRepository.findById(orderId) : undefined;
    const shipmentLine = row.shipment_line_id
      ? this.fulfillmentRepository.findLine(row.shipment_line_id)
      : undefined;
    let reason = `${c.command?.type ?? 'REFERENCE_DATA'} records ${table.replaceAll('_', ' ')}.`;
    if (table === 'receivable_entries') {
      reason =
        row.kind === 'RETURN'
          ? `Returned goods reduce charge ${row.adjusts_id} by ${-Number(row.amount_paise)} paise; the original charge remains recorded.`
          : row.kind === 'DELIVERY_CORRECTION'
            ? `Delivery correction ${row.source_id} reduces charge ${row.adjusts_id} by ${-Number(row.amount_paise)} paise; the original charge remains recorded.`
            : row.kind === 'RETURN_FEE'
              ? `Return ${row.source_id} incurs the recorded deduction of ${row.amount_paise} paise.`
              : `Confirmed delivery ${row.source_id} recognizes ${row.amount_paise} paise for shipment line ${row.shipment_line_id}; unconfirmed units create no charge.`;
    } else if (table === 'payment_allocations') {
      reason =
        Number(row.amount_paise) > 0
          ? `${row.amount_paise} paise of receipt ${row.receipt_id} settles charge ${row.charge_id} in oldest-charge order. Only cash attribution qualifies for rewards.`
          : `${-Number(row.amount_paise)} paise of receipt ${row.receipt_id} is released from reduced charge ${row.charge_id}.`;
    } else if (table === 'reward_ledger') {
      if (row.line_key) {
        const line = this.ordersRepository.latestLine(row.line_key);
        const cash = this.accountsRepository.cashForLine(row.line_key);
        reason = `${row.points_delta} points adjust ${row.bucket} for line ${row.line_key}. Qualifying allocated cash is ${cash} paise; each charge earns floor(cash × ${line?.points_per_unit ?? 0} / ${line?.unit_price_paise ?? 1}), bounded by retained approved units. Credits and redeemed points do not earn points.`;
      } else {
        reason = `${row.points_delta} points adjust ${row.bucket} after ${c.command?.type ?? 'REFERENCE_DATA'}. Spent entitlement is retained as clawback pending when returned; later accrual offsets that debt.`;
      }
    } else if (table === 'credit_applications') {
      reason = `${Number(row.amount_paise) < 0 ? 'Reverse' : 'Apply'} ${Math.abs(Number(row.amount_paise))} paise of credit ${row.credit_note_id} against charge ${row.charge_id}. This transfers credit without recording cash or earning points.`;
    } else if (table === 'credit_refunds') {
      reason = `${Number(row.amount_paise) < 0 ? 'Reverse recorded refund' : 'Record refund'} of ${Math.abs(Number(row.amount_paise))} paise from credit ${row.credit_note_id}, backed by receipt ${row.receipt_id}; bank reference ${row.reference}.`;
    } else if (table === 'credit_notes') {
      reason = `Reserve ${row.amount_paise} paise owed to the customer as explicit credit. Receipt funding is retained; application or refund requires Accounts action.`;
    } else if (table === 'credit_funds') {
      reason =
        Number(row.amount_paise) < 0
          ? `Withdraw ${-Number(row.amount_paise)} paise of credit ${row.credit_note_id} funded by receipt ${row.receipt_id}, which moved to another customer.`
          : `Reserve ${row.amount_paise} paise of receipt ${row.receipt_id} for credit ${row.credit_note_id}, preventing reuse as unapplied cash.`;
    } else if (table === 'payment_receipts') {
      reason = `Receive ${row.amount_paise} paise against customer ${row.customer_id}, reference ${row.reference}. No order is selected at capture.`;
    } else if (table === 'cancellations') {
      reason = `Cancel ${row.qty} unshipped units of line ${row.line_key}; dispatched and delivered quantities remain historical facts.`;
    } else if (table === 'deliveries') {
      reason = `Confirm ${row.qty} delivered units on shipment line ${row.shipment_line_id}; each confirmation creates one incremental goods charge.`;
    } else if (table === 'approvals') {
      reason = `${row.decision} applies specifically to commercial revision ${row.revision}.`;
    } else if (table === 'shipments') {
      reason =
        row.status === 'VOIDED'
          ? 'Void the pending loading document after a commercial change or cancellation; dispatched history is retained.'
          : `Record ${row.status} for revision ${row.revision}${row.original_shipment_id ? ` as a supplement to dispatch ${row.original_shipment_id}` : ''}.`;
    } else if (table === 'corrections') {
      reason = `Append the authorized physical correction from revision ${row.original_revision} to ${row.new_revision}; evidence: ${row.evidence}; authorization: ${row.authorization_reference}.`;
    }
    const suppliedReason =
      c.command && 'reason' in c.command.payload
        ? c.command.payload.reason
        : undefined;
    if (suppliedReason) reason += ` Reason: ${suppliedReason}`;
    return {
      reason,
      sourceReference: String(
        row.reversal_of_id ??
          row.adjusts_id ??
          row.source_id ??
          row.return_id ??
          row.receipt_id ??
          row.shipment_line_id ??
          row.revision_id ??
          c.id,
      ),
      provenance: {
        actionId: c.id,
        actorId: c.actor.id,
        requestedBy: c.requester.id,
        ...(order
          ? {
              orderId: order.id,
              revision: Number(
                row.revision ?? revision?.revision ?? order.current_revision,
              ),
            }
          : {}),
        ...(row.shipment_id || shipmentLine || table === 'shipments'
          ? {
              shipmentId: String(
                row.shipment_id ?? shipmentLine?.shipment_id ?? row.id,
              ),
            }
          : {}),
        ...(row.line_key ? { lineKey: String(row.line_key) } : {}),
      },
    };
  }
  enrich(c: Context) {
    for (const effect of c.effects)
      Object.assign(
        effect,
        this.evidence(c, effect.entity, effect.after as AuditRecord),
      );
  }
  review(customerId: string): AccountReview {
    const summary = this.accountsService.summary(customerId);
    const checks: AccountReview['checks'] = [];
    const check = (
      id: string,
      label: string,
      passed: boolean,
      details: string,
      references: string[] = [],
    ) => checks.push({ id, label, passed, details, references });
    let entitlement = 0;
    for (const order of this.ordersRepository.forCustomer(customerId)) {
      const detail = this.ordersService.detail(order.id);
      const approved = detail.approvals.some(
        (approval) =>
          approval.revision === order.current_revision &&
          approval.decision === 'APPROVED',
      );
      check(
        `approval:${order.id}`,
        'Commercial approval matches the active revision',
        order.status !== 'APPROVED' || approved,
        `Order ${order.number}, revision ${order.current_revision}, status ${order.status}.`,
        [order.id],
      );
      for (const line of detail.lines) {
        check(
          `quantities:${line.lineKey}`,
          `${line.code} quantities remain within the commercial commitment`,
          [
            line.qty,
            line.canceled,
            line.dispatched,
            line.delivered,
            line.returned,
            line.loaded,
            line.open,
          ].every((qty) => Number.isSafeInteger(qty) && qty >= 0) &&
            line.qty === line.canceled + line.dispatched + line.open &&
            line.returned <= line.delivered &&
            line.delivered <= line.dispatched &&
            line.loaded <= line.open,
          `Ordered ${line.qty}; canceled ${line.canceled}; dispatched ${line.dispatched}; delivered ${line.delivered}; returned ${line.returned}; loading ${line.loaded}; open ${line.open}.`,
          [order.id, line.lineKey],
        );
        if (order.status === 'APPROVED') {
          const commercial = this.ordersRepository
            .currentLines(order.id, order.current_revision)
            .find((row) => row.line_key === line.lineKey)!;
          entitlement = safe(
            entitlement +
              (line.qty - line.canceled - line.returned) *
                commercial.points_per_unit,
          );
          let earned = 0;
          for (const charge of this.accountsRepository.chargesForLine(
            line.lineKey,
          )) {
            const cash = this.accountsRepository.cashForCharge(charge.id);
            earned = safe(
              earned +
                Number(
                  (BigInt(cash) * BigInt(commercial.points_per_unit)) /
                    BigInt(commercial.unit_price_paise),
                ),
            );
          }
          const retained = safe(
            (line.qty - line.canceled - line.returned) *
              commercial.points_per_unit,
          );
          earned = Math.min(retained, earned);
          const recordedEarned = this.rewardsRepository.earnedForLine(
            line.lineKey,
          );
          const recordedLocked = this.rewardsRepository.lockedForLine(
            line.lineKey,
          );
          check(
            `reward-accrual:${line.lineKey}`,
            `${line.code} awards follow qualifying cash and retained units`,
            recordedEarned === earned && recordedLocked === retained - earned,
            `Cash-earned ${earned}; recorded line accrual ${recordedEarned}; locked ${recordedLocked}; retained entitlement ${retained} points.`,
            [order.id, line.lineKey],
          );
        }
      }
      for (const shipment of detail.shipments) {
        if (shipment.status === 'VOIDED') continue;
        const approval = detail.approvals.some(
          (row) =>
            row.revision === shipment.revision && row.decision === 'APPROVED',
        );
        check(
          `shipment:${shipment.id}`,
          'Shipment uses an approved commercial revision',
          approval &&
            (shipment.status !== 'LOADING' ||
              shipment.revision === order.current_revision),
          `Shipment ${shipment.id}, revision ${shipment.revision}, status ${shipment.status}.`,
          [order.id, shipment.id],
        );
        for (const line of shipment.lines) {
          check(
            `shipment-quantities:${line.id}`,
            'Shipment delivery and returns stay within dispatched units',
            line.returned >= 0 &&
              line.returned <= line.delivered &&
              line.delivered <= line.dispatched_qty &&
              line.dispatched_qty <= line.loaded_qty,
            `Loaded ${line.loaded_qty}; dispatched ${line.dispatched_qty}; delivered ${line.delivered}; returned ${line.returned}.`,
            [shipment.id, line.id],
          );
        }
      }
    }
    const deliveries =
      this.fulfillmentRepository.pricedDeliveriesForCustomer(customerId);
    for (const delivery of deliveries) {
      const charges = this.accountsRepository.chargesForDelivery(delivery.id);
      check(
        `delivery-charge:${delivery.id}`,
        'Confirmed delivery has exactly one matching goods charge',
        charges.length === 1 &&
          charges[0]!.amount_paise ===
            safe(delivery.qty * delivery.unit_price_paise),
        `${delivery.qty} × ${delivery.unit_price_paise} paise; ${charges.length} charge(s).`,
        [delivery.id],
      );
    }
    const deliveredValue = safe(
      deliveries.reduce((sum, row) => sum + row.qty * row.unit_price_paise, 0),
    );
    const returnedValue = this.returnsRepository.grossForCustomer(customerId);
    const fees = this.returnsRepository.feesForCustomer(customerId);
    const posted = this.accountsRepository.postedForCustomer(customerId);
    check(
      'recognized-value',
      'Charges equal confirmed goods less returns plus fees',
      posted === safe(deliveredValue - returnedValue + fees),
      `Posted ${posted}; delivered ${deliveredValue}; returned ${returnedValue}; fees ${fees} paise.`,
    );
    for (const charge of summary.charges) {
      const credit = this.creditsRepository.appliedToCharge(charge.id);
      const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
      check(
        `settlement:${charge.id}`,
        'Charge settlements are nonnegative and within retained value',
        [
          charge.remainingPaise,
          charge.cashPaidPaise,
          credit,
          redeemed,
          charge.outstandingPaise,
        ].every((amount) => Number.isSafeInteger(amount) && amount >= 0),
        `Retained ${charge.remainingPaise}; cash ${charge.cashPaidPaise}; credit ${credit}; redeemed ${redeemed}; due ${charge.outstandingPaise} paise.`,
        [charge.id],
      );
    }
    for (const receipt of this.accountsRepository.receiptsByInsertion(
      customerId,
    )) {
      const allocated = this.accountsRepository.allocatedFromReceipt(
        receipt.id,
      );
      const reserved = this.creditsRepository.reservedFromReceipt(receipt.id);
      const invalidPairs = this.accountsRepository.invalidReceiptAllocations(
        receipt.id,
      );
      check(
        `cash:${receipt.id}`,
        'Receipt cash is allocated or reserved at most once',
        allocated >= 0 &&
          reserved >= 0 &&
          allocated + reserved <= receipt.effective_paise &&
          invalidPairs === 0,
        `Received ${receipt.effective_paise} (captured ${receipt.amount_paise}, less transfers); allocated ${allocated}; reserved ${reserved} paise.`,
        [receipt.id],
      );
    }
    for (const credit of summary.credits) {
      const funding = this.creditsRepository.fundedForCredit(credit.id);
      const invalidApplications = this.creditsRepository.invalidApplications(
        credit.id,
      );
      const invalidRefunds = this.creditsRepository.invalidRefunds(
        credit.id,
        credit.id,
      );
      check(
        `credit:${credit.id}`,
        'Credit remains funded and within application and refund limits',
        // CRD-001: fully funded when issued; ACC-004 withdrawals only
        // lower the net funding, never below what is applied or refunded.
        this.creditsRepository.originalFundingForCredit(credit.id) ===
          credit.amount_paise &&
          funding >= 0 &&
          credit.availablePaise >= 0 &&
          credit.appliedPaise >= 0 &&
          credit.refundedPaise >= 0 &&
          invalidApplications === 0 &&
          invalidRefunds === 0,
        `Issued ${credit.amount_paise}; net funding ${funding}; applied ${credit.appliedPaise}; refunded ${credit.refundedPaise}; open ${credit.availablePaise} paise.`,
        [credit.id],
      );
    }
    const points = summary.points;
    const actualEntitlement = safe(
      points.locked +
        points.available +
        points.redeemed -
        points.clawbackPending,
    );
    check(
      'reward-conservation',
      'Reward buckets conserve retained approved entitlement',
      Object.values(points).every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) &&
        actualEntitlement === entitlement &&
        !(points.available > 0 && points.clawbackPending > 0),
      `Entitlement ${entitlement}; locked + available + redeemed − clawback pending = ${actualEntitlement} points.`,
    );
    const redeemed = this.rewardsRepository.redeemedForCustomer(customerId);
    check(
      'redemption-evidence',
      'Redeemed bucket matches settlement evidence',
      redeemed === points.redeemed,
      `Recorded settlements ${redeemed}; redeemed bucket ${points.redeemed} points.`,
    );
    check(
      'account-position',
      'Account position matches open charges, cash, and credits',
      summary.netBalancePaise ===
        safe(
          summary.outstandingPaise -
            summary.unappliedCashPaise -
            summary.creditsOpenPaise,
        ),
      `Net ${summary.netBalancePaise} = due ${summary.outstandingPaise} − unapplied cash ${summary.unappliedCashPaise} − open credit ${summary.creditsOpenPaise} paise.`,
    );
    const duplicateEvents = this.auditRepository.duplicateEvents(customerId);
    check(
      'activity-uniqueness',
      'Applied activities have one audit event',
      duplicateEvents === 0,
      `${duplicateEvents} duplicate activity event(s).`,
    );
    return {
      customerId,
      customerVersion: summary.customer.version,
      termsVersion: BUSINESS_TERMS_VERSION,
      checkedAt: new Date().toISOString(),
      checks,
    };
  }
  customerTimeline(customerId: string): EventRow[] {
    this.accountsService.summary(customerId);
    return this.auditRepository.eventsForCustomer(customerId);
  }
  trace(id: string, user: User): ActionResult {
    const row = this.actionsRepository.findAction(id);
    if (!row) throw new NotFoundException('Activity not found');
    if (
      user.role !== 'ADMIN' &&
      row.requester_id !== user.id &&
      row.actor_id !== user.id
    )
      throw new ForbiddenException(
        'This activity belongs to another staff member',
      );
    return JSON.parse(row.result) as ActionResult;
  }
  orderTimeline(orderId: string) {
    if (!this.ordersRepository.findById(orderId))
      throw new NotFoundException('Order not found');
    return this.auditRepository.eventsForOrder(orderId);
  }
}
