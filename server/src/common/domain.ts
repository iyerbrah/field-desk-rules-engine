import type {
  ActionResult,
  CrmCommand,
  OrderListRow,
  Customer,
} from '@crm/shared/crm';
import type { User, Role } from '@crm/shared';
export type Payload<T extends CrmCommand['type']> = Extract<
  CrmCommand,
  { type: T }
>['payload'];
export interface ActionContext {
  id: string;
  actor: User;
  requester: User;
  now: string;
  /** Primary customer account: the command's target. */
  customerId: string;
  /**
   * Every customer account the command acts on, primary included. The
   * engine version-checks, bumps, audits and reviews each one. Shared by
   * contexts derived with forCustomer().
   */
  touched: Set<string>;
  orderId?: string;
  effects: ActionResult['effects'];
  references: Record<string, string>;
  command?: CrmCommand;
}
/**
 * Act on another customer account inside the same command. The derived
 * context shares the effects, references and touched set, so the engine
 * checks the second account exactly like the first.
 */
export function forCustomer(c: ActionContext, customerId: string) {
  c.touched.add(customerId);
  return { ...c, customerId, orderId: undefined } satisfies ActionContext;
}
export class DomainFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class DomainDecision extends Error {
  constructor(readonly decisions: ActionResult['decisions']) {
    super('Additional shipment information is required');
  }
}
export function fail(code: string, message: string): never {
  throw new DomainFailure(code, message);
}
export function safe(value: number) {
  if (!Number.isSafeInteger(value))
    fail('AMOUNT_RANGE', 'The amount exceeds the supported range');
  return value;
}
export function distinct(ids: string[]) {
  if (new Set(ids).size !== ids.length)
    fail('DUPLICATE_ITEM', 'Submit each line only once');
}
export function authorize(c: ActionContext, ...roles: Role[]) {
  if (!roles.includes(c.actor.role))
    fail('FORBIDDEN', 'This operation requires a different role');
}
export function useOrder(c: ActionContext, order: OrderListRow | undefined) {
  if (!order) fail('NOT_FOUND', 'Order not found');
  c.customerId = order.customer_id;
  c.orderId = order.id;
  return order;
}
export function useCustomer(c: ActionContext, customer: Customer | undefined) {
  if (!customer) fail('NOT_FOUND', 'Customer not found');
  c.customerId = customer.id;
  return customer;
}
export function recordInsert(
  c: ActionContext,
  entity: string,
  row: unknown,
  append = false,
) {
  c.effects.push({
    entity,
    operation: append ? 'APPEND' : 'INSERT',
    after: row,
  });
}
export function recordUpdate(
  c: ActionContext,
  entity: string,
  before: unknown,
  after: unknown,
) {
  c.effects.push({ entity, operation: 'UPDATE', before, after });
}
