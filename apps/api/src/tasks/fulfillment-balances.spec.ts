import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { invoiceBalance, quantityBalance } from './fulfillment-balances.js';

const decimal = (value: string) => new Prisma.Decimal(value);

describe('CORE-08 balances', () => {
  it('tracks the exact outstanding amount, overdue flag and most recent valid payment', () => {
    const invoice = {
      amount: decimal('0.31'),
      dueOn: new Date('2026-01-31'),
      approvedAt: new Date('2026-01-15'),
      cancelledAt: null,
      payments: [
        {
          amount: decimal('0.10'),
          paidOn: new Date('2026-01-20'),
          cancelledAt: null,
        },
        {
          amount: decimal('0.20'),
          paidOn: new Date('2026-01-22'),
          cancelledAt: null,
        },
        {
          amount: decimal('0.01'),
          paidOn: new Date('2026-01-23'),
          cancelledAt: new Date('2026-01-24'),
        },
      ],
    };
    const result = invoiceBalance(invoice, '2026-02-01');
    expect(result.paid.toString()).toBe('0.3');
    expect(result.remaining.toString()).toBe('0.01');
    expect(result.lastPaymentOn).toEqual(new Date('2026-01-22'));
    expect(result).toMatchObject({
      paymentStatus: 'PARTIALLY_PAID',
      approvalStatus: 'APPROVED',
      overdue: true,
    });
    expect(invoiceBalance(invoice, '2026-01-31').overdue).toBe(false);
  });

  it('separates gross receipts, returns and handover at the supported precision', () => {
    const result = quantityBalance([
      { kind: 'RECEIPT', quantity: decimal('1.123') },
      { kind: 'RECEIPT', quantity: decimal('0.877') },
      { kind: 'RETURN', quantity: decimal('0.003') },
      { kind: 'HANDOVER', quantity: decimal('1.000') },
      { kind: 'DISCREPANCY', quantity: decimal('0.005') },
      { kind: 'RESOLUTION', quantity: decimal('0.005') },
    ]);
    expect(Object.values(result).map((value) => value.toString())).toEqual([
      '2',
      '0.003',
      '1.997',
      '1',
    ]);
  });
});
