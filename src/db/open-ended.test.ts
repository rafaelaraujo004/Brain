import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, finishOpenEndedDebt, reopenOpenEndedDebt, updateRecurringDebtPaidInstallmentsWithSync } from './database';
import type { RecurringDebt } from '../types';
import { getInstallmentsForMonth, getRecurringBacklog, installmentFraction } from '../utils/bills';
import { parseMoneyInput } from '../utils/formatters';
import { nextDueDate } from '../components/debts/DebtCard';

const TODAY = new Date(2026, 9, 20); // 20/10/2026

/** Dívida sem número de parcelas: começou em agosto, vence todo dia 15. */
function openDebt(overrides: Partial<RecurringDebt> = {}): RecurringDebt {
  return {
    id: 1,
    description: 'Empréstimo da tia',
    paidInstallments: 1,
    installmentValue: 200,
    dueDay: 15,
    startMonth: 8,
    startYear: 2026,
    observation: '',
    isActive: true,
    ...overrides,
  };
}

describe('dívida sem número de parcelas', () => {
  it('cobra todo mês, sem fim', () => {
    const d = openDebt();
    const months = [10, 11, 12].map((m) => getInstallmentsForMonth(d, m, 2026, new Set(), TODAY));
    // Outubro (vigente) traz setembro atrasado + a própria; os seguintes, a deles.
    expect(months[0].map((e) => e.installmentNumber)).toEqual([2, 3]);
    expect(months[1].map((e) => e.installmentNumber)).toEqual([4]);
    expect(getInstallmentsForMonth(d, 6, 2030, new Set(), TODAY)[0].installmentNumber).toBe(47);
  });

  it('conta atraso igual às parceladas', () => {
    expect(getRecurringBacklog(openDebt(), TODAY).overdueCount).toBe(2);
  });

  it('mostra o número da parcela sem total', () => {
    expect(installmentFraction(openDebt(), 3)).toBe('3');
    expect(installmentFraction(openDebt({ totalInstallments: 10 }), 3)).toBe('3/10');
  });

  it('próximo vencimento é o da parcela seguinte às pagas', () => {
    expect(nextDueDate(openDebt()).toLocaleDateString('pt-BR')).toBe('15/09/2026');
    expect(nextDueDate(openDebt({ paidInstallments: 3 })).toLocaleDateString('pt-BR')).toBe('15/11/2026');
  });
});

describe('encerrar dívida sem prazo', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
    await db.recurringDebts.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('para as parcelas novas, mas mantém as já vencidas como devidas', async () => {
    await db.recurringDebts.add(openDebt());
    await finishOpenEndedDebt(1);

    const debt = (await db.recurringDebts.get(1))!;
    // Ago (paga), set e out já venceram: o total vira 3 e faltam 2.
    expect(debt.totalInstallments).toBe(3);
    expect(debt.isActive).toBe(true);
    expect(getInstallmentsForMonth(debt, 11, 2026, new Set(), TODAY)).toEqual([]);

    await updateRecurringDebtPaidInstallmentsWithSync(1, 3);
    expect((await db.recurringDebts.get(1))?.isActive).toBe(false);
  });

  it('em dia, encerra na hora', async () => {
    await db.recurringDebts.add(openDebt({ paidInstallments: 3 }));
    await finishOpenEndedDebt(1);
    expect(await db.recurringDebts.get(1)).toMatchObject({ totalInstallments: 3, isActive: false });
  });

  it('desfazer volta a cobrar sem prazo', async () => {
    await db.recurringDebts.add(openDebt({ paidInstallments: 3 }));
    await finishOpenEndedDebt(1);
    await reopenOpenEndedDebt(1);
    const debt = (await db.recurringDebts.get(1))!;
    expect(debt.totalInstallments).toBeUndefined();
    expect(debt.isActive).toBe(true);
  });

  it('marcar parcela paga não encerra dívida sem prazo', async () => {
    await db.recurringDebts.add(openDebt());
    await updateRecurringDebtPaidInstallmentsWithSync(1, 50);
    expect(await db.recurringDebts.get(1)).toMatchObject({ paidInstallments: 50, isActive: true });
  });
});

describe('leitura de valores digitados', () => {
  it('entende milhar e decimal do jeito brasileiro', () => {
    expect(parseMoneyInput('5.000')).toBe(5000);
    expect(parseMoneyInput('5.000,50')).toBe(5000.5);
    expect(parseMoneyInput('150,5')).toBe(150.5);
    expect(parseMoneyInput('150.5')).toBe(150.5);
    expect(parseMoneyInput('R$ 1.200')).toBe(1200);
    expect(parseMoneyInput('')).toBe(0);
  });
});
