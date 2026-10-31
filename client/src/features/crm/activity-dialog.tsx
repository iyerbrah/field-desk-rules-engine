import { useState } from 'react';
import type { FormEvent } from 'react';
import { crmActionSchema } from '@crm/shared/crm';
import type {
  CommandType,
  CustomerSnapshot,
  OrderDetail,
} from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ErrorNotice } from '@/components/feedback';
import { useCommand, useCrm } from './context';
import { decimal, Field, money, paise, Table } from './ui';

const titles: Partial<Record<CommandType, string>> = {
  SUBMIT_ORDER: 'Submit order for approval',
  APPROVE_ORDER: 'Approve order',
  REJECT_ORDER: 'Reject order',
  START_LOADING: 'Prepare shipment',
  DISPATCH_SHIPMENT: 'Dispatch shipment',
  CONFIRM_DELIVERY: 'Confirm delivery',
  CANCEL_REMAINDER: 'Cancel unshipped items',
  RECORD_RETURN: 'Record a return',
  CORRECT_DISPATCHED_ORDER: 'Record shipment correction',
  CORRECT_DELIVERY: 'Correct delivered count',
  RECEIVE_CUSTOMER_PAYMENT: 'Record payment',
  ALLOCATE_PAYMENT: 'Allocate available cash',
  REDEEM_POINTS: 'Redeem reward points',
  ISSUE_CREDIT_NOTE: 'Reserve customer credit',
  APPLY_CREDIT_NOTE: 'Apply credit',
  REFUND_CREDIT_NOTE: 'Record refund',
  REVERSE_CREDIT_APPLICATION: 'Reverse credit application',
  REVERSE_CREDIT_REFUND: 'Reverse refund',
};
export function ActivityDialog({
  type,
  snapshot,
  detail,
  shipmentId,
  entryId,
  onClose,
}: {
  type: CommandType;
  snapshot: CustomerSnapshot;
  detail?: OrderDetail;
  shipmentId?: string;
  entryId?: string;
  onClose: () => void;
}) {
  const { data, refresh } = useCrm();
  const command = useCommand();
  const [error, setError] = useState('');
  const [physical, setPhysical] = useState('');
  const summary = snapshot.summary;
  const shipment = detail?.shipments.find((row) => row.id === shipmentId);
  const quantities = [
    'START_LOADING',
    'CONFIRM_DELIVERY',
    'CANCEL_REMAINDER',
    'RECORD_RETURN',
  ].includes(type);
  const reasonNeeded = [
    'REJECT_ORDER',
    'CANCEL_REMAINDER',
    'RECORD_RETURN',
    'ISSUE_CREDIT_NOTE',
    'REVERSE_CREDIT_APPLICATION',
    'REVERSE_CREDIT_REFUND',
    'CORRECT_DISPATCHED_ORDER',
  ].includes(type);
  const amountNeeded = [
    'RECEIVE_CUSTOMER_PAYMENT',
    'ISSUE_CREDIT_NOTE',
    'APPLY_CREDIT_NOTE',
    'REFUND_CREDIT_NOTE',
    'REVERSE_CREDIT_APPLICATION',
    'REVERSE_CREDIT_REFUND',
  ].includes(type);
  const referenceNeeded = [
    'RECEIVE_CUSTOMER_PAYMENT',
    'REFUND_CREDIT_NOTE',
    'REVERSE_CREDIT_REFUND',
  ].includes(type);
  const creditNeeded =
    type === 'APPLY_CREDIT_NOTE' || type === 'REFUND_CREDIT_NOTE';
  const chargeNeeded = type === 'APPLY_CREDIT_NOTE' || type === 'REDEEM_POINTS';
  const quantityRows =
    type === 'START_LOADING' || type === 'CANCEL_REMAINDER'
      ? (detail?.lines ?? [])
          .map((line) => ({
            id: line.lineKey,
            label: `${line.code} · ${line.name}`,
            limit: Math.max(
              0,
              line.open - (type === 'START_LOADING' ? line.loaded : 0),
            ),
            context:
              type === 'START_LOADING' ? 'available to load' : 'unshipped',
          }))
          .filter((line) => line.limit > 0)
      : type === 'CONFIRM_DELIVERY'
        ? (shipment?.lines ?? [])
            .map((line) => ({
              id: line.id,
              label:
                data?.skus.find((sku) => sku.id === line.sku_id)?.name ??
                'Product',
              limit: line.dispatched_qty - line.delivered,
              context: 'awaiting delivery',
            }))
            .filter((line) => line.limit > 0)
        : (detail?.shipments ?? [])
            .flatMap((row, index) =>
              row.lines.map((line) => ({
                id: line.id,
                label: `${data?.skus.find((sku) => sku.id === line.sku_id)?.name ?? 'Product'} · Shipment ${index + 1}`,
                limit: line.delivered - line.returned,
                context: 'returnable',
              })),
            )
            .filter((line) => line.limit > 0);
  const selectedCredit = summary.credits.find((row) => row.id === entryId);
  const reversalEntry =
    type === 'REVERSE_CREDIT_APPLICATION'
      ? snapshot.ledger.creditApplications.find((row) => row.id === entryId)
      : snapshot.ledger.refunds.find((row) => row.id === entryId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const orderAction = [
      'SUBMIT_ORDER',
      'APPROVE_ORDER',
      'REJECT_ORDER',
      'START_LOADING',
      'DISPATCH_SHIPMENT',
      'CONFIRM_DELIVERY',
      'CANCEL_REMAINDER',
      'RECORD_RETURN',
      'CORRECT_DISPATCHED_ORDER',
    ].includes(type);
    const payload: Record<string, unknown> = orderAction
      ? { orderId: detail!.order.id }
      : { customerId: summary.customer.id };
    if (reasonNeeded) payload.reason = form.get('reason');
    if (type === 'APPROVE_ORDER' || type === 'REJECT_ORDER')
      payload.revision = detail!.order.current_revision;
    if (quantities) {
      payload.items = quantityRows
        .map((line) => ({
          [type === 'START_LOADING' || type === 'CANCEL_REMAINDER'
            ? 'lineKey'
            : 'shipmentLineId']: line.id,
          qty: Number(form.get(`qty-${line.id}`)),
        }))
        .filter((line) => line.qty > 0);
      if (!(payload.items as unknown[]).length) {
        setError('Enter a quantity for at least one item.');
        return;
      }
    }
    if (type === 'DISPATCH_SHIPMENT' || type === 'CONFIRM_DELIVERY')
      payload.shipmentId = shipmentId;
    try {
      if (type === 'RECORD_RETURN') payload.feePaise = paise(form.get('fee'));
      if (amountNeeded) payload.amountPaise = paise(form.get('amount'));
      if (referenceNeeded) payload.reference = form.get('reference');
      if (creditNeeded) payload.creditNoteId = entryId ?? form.get('credit');
      if (chargeNeeded) payload.chargeId = form.get('charge');
      if (type === 'REDEEM_POINTS') payload.points = Number(form.get('points'));
      if (type === 'REVERSE_CREDIT_APPLICATION')
        payload.applicationId = entryId;
      if (type === 'REVERSE_CREDIT_REFUND') payload.refundId = entryId;
      if (type === 'CORRECT_DISPATCHED_ORDER') {
        payload.items = (data?.skus ?? [])
          .map((sku) => ({
            skuId: sku.id,
            qty: Number(form.get(`extra-${sku.id}`)),
            unitPricePaise: paise(form.get(`price-${sku.id}`)),
            deliveredQty: Number(form.get(`delivered-${sku.id}`)),
          }))
          .filter((line) => line.qty > 0);
        payload.evidence = form.get('evidence');
        payload.authorizationReference = form.get('authorization');
        payload.location =
          physical === 'new' ? 'NEW_SHIPMENT' : 'EXISTING_SHIPMENT';
        if (physical === 'new')
          payload.dispatchedAt = new Date(
            String(form.get('dispatchedAt')),
          ).toISOString();
        else payload.shipmentId = physical;
      }
      const parsed = crmActionSchema.safeParse({ type, payload });
      if (!parsed.success) {
        setError(parsed.error.issues.map((issue) => issue.message).join('. '));
        return;
      }
      const result = await command.execute(
        parsed.data,
        orderAction ? detail!.order.version : summary.customer.version,
        `${titles[type] ?? 'Activity'} completed.`,
      );
      if (result) onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Check the form details.',
      );
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose();
      }}
    >
      <DialogContent
        className={
          quantities || type === 'CORRECT_DISPATCHED_ORDER'
            ? 'max-w-3xl bg-white'
            : 'bg-white'
        }
      >
        <div className="space-y-2 pr-6">
          <DialogTitle>{titles[type] ?? 'Record activity'}</DialogTitle>
          <DialogDescription>
            {summary.customer.name}
            {detail ? ` · ${detail.order.number}` : ''}
          </DialogDescription>
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <fieldset disabled={command.pending} className="space-y-5">
            {type === 'SUBMIT_ORDER' && (
              <p className="text-sm text-muted-foreground">
                Submit revision {detail!.order.current_revision} for commercial
                approval. Fulfillment can begin after approval.
              </p>
            )}
            {type === 'APPROVE_ORDER' && (
              <p className="text-sm text-muted-foreground">
                Approve revision {detail!.order.current_revision} with an order
                value of{' '}
                <strong>
                  {money(
                    detail!.lines.reduce(
                      (sum, line) => sum + line.qty * line.unitPricePaise,
                      0,
                    ),
                  )}
                </strong>
                .
              </p>
            )}
            {type === 'DISPATCH_SHIPMENT' && (
              <p className="text-sm text-muted-foreground">
                Confirm that these{' '}
                {shipment?.lines.reduce(
                  (sum, line) => sum + line.loaded_qty,
                  0,
                )}{' '}
                units have left the warehouse. The dispatched shipment will be
                retained in the order history.
              </p>
            )}
            {type === 'ALLOCATE_PAYMENT' && (
              <p className="text-sm text-muted-foreground">
                Allocate up to {money(summary.unappliedCashPaise)} of available
                cash to this customer's oldest outstanding charges.
              </p>
            )}
            {quantities && (
              <div className="overflow-hidden rounded-lg border">
                <Table columns={['Item', 'Available', 'Quantity']}>
                  {quantityRows.map((line) => (
                    <tr key={line.id}>
                      <td className="min-w-40">{line.label}</td>
                      <td className="text-muted-foreground">
                        {line.limit} {line.context}
                      </td>
                      <td>
                        <Input
                          className="w-24 bg-white"
                          aria-label={`Quantity for ${line.label}`}
                          name={`qty-${line.id}`}
                          type="number"
                          min={0}
                          max={line.limit}
                          step={1}
                          defaultValue={
                            type === 'RECORD_RETURN' ? 0 : line.limit
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
            {type === 'RECORD_RETURN' && (
              <Field name="fee" label="Return deduction (₹)">
                <Input
                  id="fee"
                  name="fee"
                  inputMode="decimal"
                  defaultValue="0.00"
                  required
                />
              </Field>
            )}
            {creditNeeded &&
              (selectedCredit ? (
                <p className="rounded-md bg-muted p-3 text-sm">
                  Available credit:{' '}
                  <strong>{money(selectedCredit.availablePaise)}</strong>
                </p>
              ) : (
                <Field name="credit" label="Credit note">
                  <NativeSelect
                    id="credit"
                    name="credit"
                    required
                    className="w-full"
                  >
                    <option value="">Select credit</option>
                    {summary.credits
                      .filter((credit) => credit.availablePaise > 0)
                      .map((credit, index) => (
                        <option key={credit.id} value={credit.id}>
                          Credit {index + 1} · {money(credit.availablePaise)}{' '}
                          available
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
              ))}
            {reversalEntry && (
              <p className="rounded-md bg-muted p-3 text-sm">
                Original amount:{' '}
                <strong>{money(Number(reversalEntry.amount_paise))}</strong>.
                Enter the amount to reverse. The original entry will remain in
                account history.
              </p>
            )}
            {chargeNeeded && (
              <Field name="charge" label="Outstanding charge">
                <NativeSelect
                  id="charge"
                  name="charge"
                  required
                  className="w-full"
                >
                  <option value="">Select charge</option>
                  {summary.charges
                    .filter((charge) => charge.outstandingPaise > 0)
                    .map((charge, index) => (
                      <option key={charge.id} value={charge.id}>
                        {
                          snapshot.orders.find(
                            (row) => row.order.id === charge.order_id,
                          )?.order.number
                        }{' '}
                        · Charge {index + 1} · {money(charge.outstandingPaise)}{' '}
                        due
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            )}
            {amountNeeded && (
              <Field name="amount" label="Amount (₹)">
                <Input
                  id="amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  required
                />
              </Field>
            )}
            {referenceNeeded && (
              <Field name="reference" label="Payment / bank reference">
                <Input
                  id="reference"
                  name="reference"
                  required
                  minLength={type === 'RECEIVE_CUSTOMER_PAYMENT' ? 1 : 3}
                  maxLength={200}
                  placeholder="Transaction reference"
                />
              </Field>
            )}
            {type === 'REDEEM_POINTS' && (
              <Field
                name="points"
                label="Points to redeem"
                hint={`${summary.points.available.toLocaleString()} available. One point offsets one paise.`}
              >
                <Input
                  id="points"
                  name="points"
                  type="number"
                  min={1}
                  max={summary.points.available}
                  step={1}
                  required
                />
              </Field>
            )}
            {type === 'CORRECT_DISPATCHED_ORDER' && (
              <>
                <Field name="physical" label="Physical dispatch">
                  <NativeSelect
                    id="physical"
                    className="w-full"
                    value={physical}
                    required
                    onChange={(event) => setPhysical(event.target.value)}
                  >
                    <option value="">
                      Where were the extra items shipped?
                    </option>
                    {detail!.shipments.map((row, index) =>
                      row.dispatched_at ? (
                        <option value={row.id} key={row.id}>
                          Shipment {index + 1} ·{' '}
                          {new Date(row.dispatched_at).toLocaleDateString()}
                        </option>
                      ) : null,
                    )}
                    <option value="new">A separate shipment</option>
                  </NativeSelect>
                </Field>
                {physical === 'new' && (
                  <Field
                    name="dispatchedAt"
                    label="Actual dispatch date and time"
                  >
                    <Input
                      id="dispatchedAt"
                      name="dispatchedAt"
                      type="datetime-local"
                      required
                    />
                  </Field>
                )}
                <div className="overflow-hidden rounded-lg border">
                  <Table
                    columns={[
                      'Product',
                      'Extra units',
                      'Delivered',
                      'Unit price (₹)',
                    ]}
                  >
                    {data?.skus.map((sku) => (
                      <tr key={sku.id}>
                        <td className="min-w-32">
                          {sku.code}
                          <span className="block text-xs text-muted-foreground">
                            {sku.name}
                          </span>
                        </td>
                        <td>
                          <Input
                            className="w-20"
                            aria-label={`Extra ${sku.code} units`}
                            name={`extra-${sku.id}`}
                            type="number"
                            min={0}
                            max={10000}
                            defaultValue={0}
                          />
                        </td>
                        <td>
                          <Input
                            className="w-20"
                            aria-label={`Delivered ${sku.code} units`}
                            name={`delivered-${sku.id}`}
                            type="number"
                            min={0}
                            max={10000}
                            defaultValue={0}
                          />
                        </td>
                        <td>
                          <Input
                            className="w-28"
                            aria-label={`${sku.code} unit price`}
                            name={`price-${sku.id}`}
                            inputMode="decimal"
                            defaultValue={decimal(
                              detail!.lines.find(
                                (line) => line.skuId === sku.id,
                              )?.unitPricePaise ?? sku.price_paise,
                            )}
                          />
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
                <Field name="evidence" label="Supporting evidence">
                  <Input
                    id="evidence"
                    name="evidence"
                    required
                    minLength={8}
                    maxLength={2000}
                    placeholder="Dispatch document or customer confirmation"
                  />
                </Field>
                <Field name="authorization" label="Authorization reference">
                  <Input
                    id="authorization"
                    name="authorization"
                    required
                    minLength={3}
                    maxLength={1000}
                  />
                </Field>
              </>
            )}
            {reasonNeeded && (
              <Field name="reason" label="Reason">
                <Input
                  id="reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  placeholder="Explain this change"
                />
              </Field>
            )}
            {(error || command.error) && (
              <ErrorNotice message={error || command.error} />
            )}
            {command.error && (
              <Button variant="outline" onClick={refresh}>
                Reload current record
              </Button>
            )}
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button
                variant="outline"
                disabled={command.pending}
                onClick={onClose}
              >
                Close
              </Button>
              <Button
                type="submit"
                disabled={
                  command.pending || (quantities && !quantityRows.length)
                }
                variant={
                  type === 'CANCEL_REMAINDER' || type === 'REJECT_ORDER'
                    ? 'destructive'
                    : 'default'
                }
              >
                {command.pending ? 'Saving…' : (titles[type] ?? 'Confirm')}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
