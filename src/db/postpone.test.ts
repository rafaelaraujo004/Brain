import { beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  returnBillToOriginalMonth,
  skipBillToNextMonth,
  undoSkipBill,
} from './database';
import type { Bill } from '../types';
import { getPostponeStatus } from '../utils/bills';

async function addBill(overrides: Partial<Bill> = {}): Promise<Bill> {
  const id = await db.bills.add({
    description: 'Energia',
    originalDescription: 'Energia',
    initialValue: 150,
    finalValue: 150,
    status: 'pending',
    dueDay: 10,
    observation: '',
    month: 6,
    year: 2026,
    originMonth: 6,
    originYear: 2026,
    originalDueDate: new Date(2026, 5, 10).toISOString(),
    postponeHistory: [],
    ...overrides,
  });
  return (await db.bills.get(id as number)) as Bill;
}

/** A conta que o adiamento criou na competência seguinte. */
async function carryOf(billId: number): Promise<Bill | undefined> {
  return db.bills.where('carriedFromBillId').equals(billId).first();
}

describe('cadeia de adiamentos', () => {
  beforeEach(async () => {
    await db.bills.clear();
  });

  it('adiar cria a conta no mês seguinte e marca a original como adiada', async () => {
    const bill = await addBill();
    await skipBillToNextMonth(bill);

    const original = await db.bills.get(bill.id!);
    const carry = await carryOf(bill.id!);

    expect(original?.status).toBe('skipped');
    expect(carry).toBeDefined();
    expect(carry?.month).toBe(7);
    expect(carry?.year).toBe(2026);
    expect(carry?.status).toBe('pending');
    expect(carry?.finalValue).toBe(150);
    expect(carry?.postponeHistory).toHaveLength(1);
    expect(carry?.postponeHistory?.[0]).toMatchObject({
      fromMonth: 6,
      fromYear: 2026,
      toMonth: 7,
      toYear: 2026,
    });
  });

  it('não duplica o adiamento se a ação for repetida na mesma conta', async () => {
    const bill = await addBill();
    await skipBillToNextMonth(bill);
    await skipBillToNextMonth(bill);

    expect(await db.bills.where('carriedFromBillId').equals(bill.id!).count()).toBe(1);
  });

  it('permite adiar várias vezes, acumulando o histórico', async () => {
    // Era o bloqueio principal: uma conta já adiada não podia ser adiada de
    // novo, então a dívida travava depois do primeiro salto.
    let current = await addBill();
    for (let i = 0; i < 3; i++) {
      await skipBillToNextMonth(current);
      current = (await carryOf(current.id!)) as Bill;
    }

    expect(current.month).toBe(9);
    expect(current.year).toBe(2026);

    const status = getPostponeStatus(current, new Date(2026, 8, 2));
    expect(status.times).toBe(3);
    expect(status.originLabel).toBe('Junho/2026');
    expect(status.isLate).toBe(true);

    // Cada salto guarda a própria data e o vencimento que ficou para trás.
    const from = current.postponeHistory?.map((h) => `${h.fromMonth}/${h.fromYear}`);
    expect(from).toEqual(['6/2026', '7/2026', '8/2026']);
    for (const entry of current.postponeHistory ?? []) {
      expect(Number.isNaN(new Date(entry.postponedAt).getTime())).toBe(false);
      expect(Number.isNaN(new Date(entry.dueDate).getTime())).toBe(false);
    }
  });

  it('preserva a competência original ao virar o ano', async () => {
    let current = await addBill({
      month: 12,
      year: 2026,
      originMonth: 12,
      originYear: 2026,
      originalDueDate: new Date(2026, 11, 10).toISOString(),
    });
    await skipBillToNextMonth(current);
    current = (await carryOf(current.id!)) as Bill;

    expect(current.month).toBe(1);
    expect(current.year).toBe(2027);
    expect(current.originMonth).toBe(12);
    expect(current.originYear).toBe(2026);
  });

  it('devolver ao mês de origem limpa toda a cadeia', async () => {
    let current = await addBill();
    for (let i = 0; i < 3; i++) {
      await skipBillToNextMonth(current);
      current = (await carryOf(current.id!)) as Bill;
    }

    await returnBillToOriginalMonth(current);

    const all = await db.bills.toArray();
    // Sobra exatamente uma conta, paga, no mês de origem — sem registros
    // órfãos nos meses intermediários.
    expect(all).toHaveLength(1);
    expect(all[0].month).toBe(6);
    expect(all[0].year).toBe(2026);
    expect(all[0].status).toBe('paid');
    expect(all[0].description).toBe('Energia');
    expect(all[0].postponeHistory).toEqual([]);
    expect(all[0].carriedFromBillId).toBeUndefined();
  });

  it('desfazer o adiamento apaga a conta criada e reabre a original', async () => {
    const bill = await addBill();
    await skipBillToNextMonth(bill);
    await undoSkipBill(bill.id!);

    const all = await db.bills.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(bill.id);
    expect(all[0].status).toBe('pending');
    expect(all[0].month).toBe(6);
  });

  it('quitar a conta remove os adiamentos pendentes que ela gerou', async () => {
    let current = await addBill();
    await skipBillToNextMonth(current);
    current = (await carryOf(current.id!)) as Bill;
    await skipBillToNextMonth(current);

    // A conta de julho é paga: o adiamento dela em agosto deixa de existir.
    const { removeCarryOverForPaidBill } = await import('./database');
    await removeCarryOverForPaidBill(current.id!);

    const months = (await db.bills.toArray()).map((b) => b.month).sort();
    expect(months).toEqual([6, 7]);
  });
});
