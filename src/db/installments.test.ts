import { beforeEach, describe, expect, it } from 'vitest';
import { db, skipRecurringToNextMonth, updateBillStatusWithSync } from './database';
import type { RecurringDebt } from '../types';
import { getInstallmentsForMonth, getRecurringBacklog } from '../utils/bills';

const TODAY = new Date(2026, 9, 20); // 20/10/2026

function debt(overrides: Partial<RecurringDebt> = {}): RecurringDebt {
  return {
    id: 1,
    description: 'Empréstimo',
    totalInstallments: 10,
    paidInstallments: 2,
    installmentValue: 300,
    dueDay: 15,
    startMonth: 7,
    startYear: 2026,
    observation: '',
    isActive: true,
    ...overrides,
  };
}

describe('Contas e Dívidas contam a mesma história', () => {
  it('as atrasadas da aba Dívidas aparecem todas no mês vigente', () => {
    // Parcelas: 1 jul, 2 ago (pagas), 3 set e 4 out em aberto.
    const d = debt();
    const backlog = getRecurringBacklog(d, TODAY);
    expect(backlog.overdueCount).toBe(2);

    const october = getInstallmentsForMonth(d, 10, 2026, new Set(), TODAY);
    expect(october.map((e) => [e.installmentNumber, e.isCarried, e.status])).toEqual([
      [3, true, 'overdue'],
      [4, false, 'overdue'],
    ]);
  });

  it('a parcela do mês que ainda não venceu não conta como atrasada', () => {
    const early = new Date(2026, 9, 2);
    const backlog = getRecurringBacklog(debt(), early);
    expect(backlog.overdueCount).toBe(1);
    expect(backlog.dueThisMonth?.installmentNumber).toBe(4);
  });

  it('meses que não são o vigente mostram só a parcela deles', () => {
    const september = getInstallmentsForMonth(debt(), 9, 2026, new Set(), TODAY);
    expect(september.map((e) => e.installmentNumber)).toEqual([3]);
  });

  it('parcela que virou conta não aparece duas vezes', () => {
    const october = getInstallmentsForMonth(debt(), 10, 2026, new Set(['2026-9']), TODAY);
    expect(october.map((e) => e.installmentNumber)).toEqual([4]);
  });

  it('dívida que já acabou continua mostrando as parcelas não pagas', () => {
    const d = debt({ totalInstallments: 3, paidInstallments: 1 });
    const october = getInstallmentsForMonth(d, 10, 2026, new Set(), TODAY);
    expect(october.map((e) => e.installmentNumber)).toEqual([2, 3]);
  });
});

describe('pagar a parcela adiada baixa a parcela na aba Dívidas', () => {
  beforeEach(async () => {
    await db.bills.clear();
    await db.recurringDebts.clear();
  });

  it('a conta criada pelo adiamento sabe de qual parcela veio', async () => {
    const d = debt({ paidInstallments: 2 });
    await db.recurringDebts.add(d);

    // Adia a parcela 3 (setembro) para outubro.
    await skipRecurringToNextMonth(d, 3, 9, 2026);
    const carried = await db.bills.where({ month: 10, year: 2026 }).first();
    expect(carried?.recurringDebtId).toBeUndefined();

    await updateBillStatusWithSync(carried!.id!, 'paid');
    const updated = await db.recurringDebts.get(1);
    expect(updated?.paidInstallments).toBe(3);
  });
});
