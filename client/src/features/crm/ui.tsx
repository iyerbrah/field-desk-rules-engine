import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { EventRow, OrderListRow } from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { ErrorNotice, Loading } from '@/components/feedback';
import { useCrm } from './context';

export function money(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(value / 100);
}
export function decimal(value: number) {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
export function paise(value: FormDataEntryValue | string | null) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error('Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount))
    throw new Error('The amount is too large.');
  return amount;
}
export function date(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';
}
const labels: Record<string, string> = {
  UNFULFILLED: 'Not started',
  PARTIALLY_DISPATCHED: 'Partly dispatched',
  PARTIALLY_DELIVERED: 'Partly delivered',
  DRAFT: 'Draft',
  PENDING: 'Pending approval',
  REAPPROVAL_REQUIRED: 'Needs reapproval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Canceled',
  LOADING: 'Loading',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  VOIDED: 'Voided',
};
export function Status({ value }: { value: string }) {
  return (
    <Badge
      className={
        value === 'APPROVED' || value === 'DELIVERED'
          ? 'bg-emerald-50 text-emerald-700'
          : value === 'REJECTED' || value === 'CANCELLED' || value === 'VOIDED'
            ? 'bg-slate-100 text-slate-600'
            : value === 'PENDING' || value === 'REAPPROVAL_REQUIRED'
              ? 'bg-amber-50 text-amber-800'
              : 'bg-blue-50 text-blue-700'
      }
    >
      {labels[value] ?? value.replaceAll('_', ' ').toLowerCase()}
    </Badge>
  );
}
export function PageHeader({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description?: string;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {back && (
        <Link
          to={back.to}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}
export function Field({
  name,
  label,
  children,
  hint,
}: {
  name: string;
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-5 py-14 text-center">
      <h2 className="font-medium">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
export function Table({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="crm-table">
        <thead>
          <tr>
            {columns.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:max-w-80">
      <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        className="bg-white pl-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
export function Pager({
  page,
  count,
  onPage,
  size = 10,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
  size?: number;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  return (
    <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
      <span>
        {count
          ? `${(page - 1) * size + 1}–${Math.min(page * size, count)} of ${count}`
          : '0 records'}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
export function WorkspaceState({ children }: { children: ReactNode }) {
  const { data, error, refresh } = useCrm();
  if (error)
    return (
      <div className="space-y-3">
        <ErrorNotice message={error} />
        <Button onClick={refresh} variant="outline">
          Try again
        </Button>
      </div>
    );
  if (!data) return <Loading label="Loading CRM…" />;
  return children;
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Array<[string, string]>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-5 overflow-x-auto border-b px-5" role="tablist">
      {items.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          className={`shrink-0 border-b-2 py-4 text-sm font-medium ${value === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function OrdersTable({ orders }: { orders: OrderListRow[] }) {
  const { data } = useCrm();
  return (
    <Table
      columns={[
        'Order',
        'Customer',
        'Date',
        'Order value',
        'Approval',
        'Fulfillment',
        'Revision',
        '',
      ]}
    >
      {orders.map((order) => (
        <tr key={order.id}>
          <td>
            <Link
              className="font-medium text-primary hover:underline"
              to={`/orders/${order.id}`}
            >
              {order.number}
            </Link>
          </td>
          <td>
            <Link
              className="hover:underline"
              to={`/customers/${order.customer_id}`}
            >
              {data?.customers.find((row) => row.id === order.customer_id)
                ?.name ?? 'Customer'}
            </Link>
          </td>
          <td>{date(order.created_at)}</td>
          <td className="whitespace-nowrap tabular-nums">
            {(() => {
              const total =
                order.totalPaise ??
                data?.orders.find((row) => row.id === order.id)?.totalPaise;
              return total === undefined ? '—' : money(total);
            })()}
          </td>
          <td>
            <Status value={order.status} />
          </td>
          <td>
            <Status
              value={
                order.fulfillmentStatus ??
                data?.orders.find((row) => row.id === order.id)
                  ?.fulfillmentStatus ??
                'UNFULFILLED'
              }
            />
          </td>
          <td>{order.current_revision}</td>
          <td className="text-right">
            <Link
              className="text-primary hover:underline"
              to={`/orders/${order.id}`}
            >
              View order
            </Link>
          </td>
        </tr>
      ))}
    </Table>
  );
}
export const activityLabels: Record<string, string> = {
  PUNCH_ORDER: 'Order created',
  EDIT_ORDER: 'Order revised',
  UPDATE_CUSTOMER: 'Customer updated',
  SUBMIT_ORDER: 'Submitted for approval',
  APPROVE_ORDER: 'Revision approved',
  REJECT_ORDER: 'Revision rejected',
  START_LOADING: 'Loading started',
  DISPATCH_SHIPMENT: 'Shipment dispatched',
  CONFIRM_DELIVERY: 'Delivery confirmed',
  CANCEL_REMAINDER: 'Unshipped units canceled',
  RECORD_RETURN: 'Goods returned',
  RECEIVE_CUSTOMER_PAYMENT: 'Payment received',
  ALLOCATE_PAYMENT: 'Cash allocated',
  REATTRIBUTE_PAYMENT: 'Payment moved between customers',
  REDEEM_POINTS: 'Points redeemed',
  ISSUE_CREDIT_NOTE: 'Customer credit reserved',
  APPLY_CREDIT_NOTE: 'Credit applied',
  REFUND_CREDIT_NOTE: 'Refund recorded',
  REVERSE_CREDIT_APPLICATION: 'Credit application reversed',
  REVERSE_CREDIT_REFUND: 'Refund reversed',
  CORRECT_DISPATCHED_ORDER: 'Shipment correction recorded',
  CORRECT_DELIVERY: 'Delivered count corrected',
};
export function ActivityList({ events }: { events: EventRow[] }) {
  if (!events.length) return <Empty title="No activity yet" />;
  return (
    <ol className="divide-y">
      {[...events].reverse().map((event) => {
        let reason = '';
        try {
          const payload = JSON.parse(event.payload) as {
            reason?: string;
            reference?: string;
            amountPaise?: number;
          };
          reason = payload.reason ?? payload.reference ?? '';
          if (payload.amountPaise)
            reason = `${money(payload.amountPaise)}${reason ? ` · ${reason}` : ''}`;
        } catch {
          /* Older activities may contain no details. */
        }
        return (
          <li key={event.id} className="flex gap-3 px-5 py-4">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {activityLabels[event.type] ??
                  event.type.replaceAll('_', ' ').toLowerCase()}
              </p>
              {reason && (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {reason}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {event.actor_name} ·{' '}
                {new Date(event.occurred_at).toLocaleString('en-IN')}
              </p>
            </div>
            {event.order_id && (
              <Link
                to={`/orders/${event.order_id}`}
                className="shrink-0 text-xs text-primary"
              >
                View order
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
export function StatusFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      aria-label="Filter by status"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">All statuses</option>
      {Object.entries(labels)
        .filter(([id]) =>
          [
            'DRAFT',
            'PENDING',
            'REAPPROVAL_REQUIRED',
            'APPROVED',
            'REJECTED',
            'CANCELLED',
          ].includes(id),
        )
        .map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
    </NativeSelect>
  );
}
export function useTablePage<T>(rows: T[], key: string) {
  const [selection, setSelection] = useState({ key, page: 1 });
  const page = Math.min(
    selection.key === key ? selection.page : 1,
    Math.max(1, Math.ceil(rows.length / 10)),
  );
  return {
    page,
    rows: rows.slice((page - 1) * 10, page * 10),
    setPage: (value: number) => setSelection({ key, page: value }),
  };
}
