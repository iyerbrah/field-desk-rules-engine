import assert from 'node:assert/strict';
import type { CustomerSnapshot } from '@crm/shared/crm';

/**
 * Checks that an account balances three independent ways (ledger sums,
 * summary net, and open positions) and that every order line keeps its
 * quantity partition. Shared by the scenario test files.
 */
export function assertAccount(snapshot: CustomerSnapshot, expectedNet: number) {
  const { summary, ledger, orders } = snapshot;
  const sum = (rows: Record<string, unknown>[], key: string) =>
    rows.reduce((total, row) => total + Number(row[key]), 0);
  const recognized = sum(ledger.finance, 'amount_paise');
  const receipts = sum(ledger.receipts, 'amount_paise');
  const refunds = sum(ledger.refunds, 'amount_paise');
  const redeemed = sum(ledger.redemptions, 'points');
  assert.equal(summary.netBalancePaise, expectedNet);
  assert.equal(recognized - receipts + refunds - redeemed, expectedNet);
  assert.equal(
    summary.outstandingPaise -
      summary.unappliedCashPaise -
      summary.creditsOpenPaise,
    expectedNet,
  );
  for (const order of orders) {
    for (const line of order.lines) {
      assert.equal(line.qty, line.canceled + line.dispatched + line.open);
      assert.ok(
        line.returned <= line.delivered &&
          line.delivered <= line.dispatched &&
          line.open >= 0,
      );
    }
  }
}
