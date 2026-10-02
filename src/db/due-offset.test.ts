import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureMonthlyBillOccurrences, skipBillToNextMonth } from './database';
import type { Bill } from '../types';
import { getPostponeStatus } from '../utils/bills';
import { buildBillDueDate, formatDate, parseInputDate, toInputDate } from '../utils/formatters';

/** Energia de outubro que vence em 01/11 — como o formulário grava. */
async function octoberBillDueInNovember(overrides: Partial<Bill> = {}): Promise<Bill> {
  const id = await db.bills.add({
    description: 'Energia',
    originalDescription: 'Energia',
    initialValue: 150,
    finalValue: 150,
    status: 'pending',
    dueDay: 1,
    dueMonthOffset: 1,
    observation: '',
    month: 10,
    year: 2026,
    originMonth: 10,
    originYear: 2026,
    originalDueDate: new Date(2026, 10, 1).toISOString(),
    postponeHistory: [],
    ...overrides,
  });
  await db.bills.update(id as number, { seriesId: id as number });
  return (await db.bills.get(id as number)) as Bill;
}

describe('conta que vence no mês seguinte', () => {
  beforeEach(async () => {
    await db.bills.clear();
  });

  it('fica no mês dela, vencendo no seguinte', async () => {
    const bill = await octoberBillDueInNovember();
    const status = getPostponeStatus(bill, new Date(2026, 9, 20));
    expect(formatDate(status.currentDueDate)).toBe('01/11/2026');
    // Em 20/10 ela ainda não venceu, mesmo sendo de outubro.
    expect(status.isOverdue).toBe(false);
    expect(getPostponeStatus(bill, new Date(2026, 10, 2)).isLate).toBe(true);
  });

  it('adiada, continua vencendo um mês depois do mês em que está', async () => {
    const bill = await octoberBillDueInNovember();
    await skipBillToNextMonth(bill);
    const carried = (await db.bills.where({ month: 11, year: 2026 }).first())!;

    expect(carried.dueMonthOffset).toBe(1);
    expect(formatDate(getPostponeStatus(carried).currentDueDate)).toBe('01/12/2026');
    // O que ficou para trás foi o vencimento de 01/11, não 01/10.
    expect(formatDate(carried.postponeHistory![0].dueDate)).toBe('01/11/2026');
    expect(formatDate(getPostponeStatus(carried).originalDueDate)).toBe('01/11/2026');
  });

  it('repetindo todo mês, cada fatura vence no mês seguinte ao dela', async () => {
    await octoberBillDueInNovember({ isMonthly: true });
    await ensureMonthlyBillOccurrences(12, 2026);
    const december = (await db.bills.where({ month: 12, year: 2026 }).first())!;

    expect(december.dueMonthOffset).toBe(1);
    expect(formatDate(getPostponeStatus(december).currentDueDate)).toBe('01/01/2027');
  });

  it('vira o ano corretamente', () => {
    expect(formatDate(buildBillDueDate(12, 2026, 31, 1))).toBe('31/01/2027');
    // 31 num mês de 30 dias vira o último dia.
    expect(formatDate(buildBillDueDate(10, 2026, 31, 1))).toBe('30/11/2026');
  });

  it('o campo de data só aceita data completa', () => {
    expect(parseInputDate('2026-11-01')).toEqual({ day: 1, month: 11, year: 2026 });
    expect(parseInputDate('')).toBeNull();
    expect(parseInputDate('2026-11')).toBeNull();
    expect(toInputDate(new Date(2026, 10, 1))).toBe('2026-11-01');
  });
});
