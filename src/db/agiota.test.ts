import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addInformalLoan,
  db,
  ensureLoanInterestBills,
  ensureMonthlyBillOccurrences,
  payOffInformalLoan,
  reopenInformalLoan,
  skipBillToNextMonth,
  updateInformalLoanRate,
} from './database';
import type { Bill } from '../types';

/** Hoje, nos testes: 02/10/2026. */
const TODAY = new Date(2026, 9, 2);

async function loanBills(loanId: number): Promise<Bill[]> {
  return db.bills.where('loanId').equals(loanId).toArray();
}

async function newLoan(takenMonth: number, takenYear = 2026, principal = 5000, rate = 10) {
  return addInformalLoan({
    lender: 'Agiota',
    principal,
    monthlyRatePercent: rate,
    takenMonth,
    takenYear,
    dueDay: 10,
  });
}

describe('dinheiro com agiota', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
    await Promise.all([db.bills.clear(), db.loans.clear()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cobra 10% todo mês a partir do mês seguinte', async () => {
    const id = await newLoan(10);
    // Outubro é o mês em que pegou: ainda não há juros.
    expect(await loanBills(id)).toHaveLength(0);

    await ensureLoanInterestBills(11, 2026);
    await ensureLoanInterestBills(12, 2026);
    const bills = await loanBills(id);
    expect(bills.map((b) => [b.month, b.finalValue, b.status])).toEqual([
      [11, 500, 'pending'],
      [12, 500, 'pending'],
    ]);
    expect(bills[0].description).toBe('Juros — Agiota');
  });

  it('não duplica a cobrança quando duas telas pedem o mesmo mês ao mesmo tempo', async () => {
    const id = await newLoan(10);
    await Promise.all([
      ensureLoanInterestBills(11, 2026),
      ensureLoanInterestBills(11, 2026),
      ensureMonthlyBillOccurrences(11, 2026),
    ]);
    expect(await loanBills(id)).toHaveLength(1);
  });

  it('lançado com data antiga, cada mês fica com os juros dele, sem andar sozinho', async () => {
    await db.bills.add({
      description: 'Outra conta',
      initialValue: 80,
      finalValue: 80,
      status: 'pending',
      dueDay: 5,
      observation: '',
      month: 8,
      year: 2026,
    });
    const id = await newLoan(7); // pegou em julho → juros de ago, set e out

    const pending = (await loanBills(id))
      .filter((b) => b.status === 'pending')
      .map((b) => [b.month, b.originMonth, b.postponeHistory?.length ?? 0]);
    // Agosto, setembro e outubro, cada um no seu mês. Só um "Adiar" move.
    expect(pending.sort()).toEqual([
      [10, 10, 0],
      [8, 8, 0],
      [9, 9, 0],
    ].sort());

    // As outras contas não foram mexidas.
    const other = await db.bills.where({ month: 8, year: 2026 }).and((b) => b.loanId === undefined).first();
    expect(other?.status).toBe('pending');
  });

  it('quitar devolve o valor cheio e para os juros dos meses seguintes', async () => {
    const id = await newLoan(8);
    await ensureLoanInterestBills(12, 2026); // gera até dezembro

    await payOffInformalLoan(id);
    const loan = await db.loans.get(id);
    expect(loan).toMatchObject({ status: 'paid', paidOffMonth: 10, paidOffYear: 2026 });

    const bills = await loanBills(id);
    const payoff = bills.find((b) => b.loanPayoff);
    expect(payoff).toMatchObject({ finalValue: 5000, status: 'paid', month: 10 });
    // Novembro e dezembro deixam de existir; outubro continua devido.
    expect(bills.some((b) => !b.loanPayoff && (b.originMonth ?? b.month) > 10)).toBe(false);
    expect(bills.some((b) => !b.loanPayoff && b.originMonth === 10)).toBe(true);

    await ensureLoanInterestBills(1, 2027);
    expect((await loanBills(id)).some((b) => b.year === 2027)).toBe(false);
  });

  it('desfazer a quitação volta a cobrar', async () => {
    const id = await newLoan(9);
    await payOffInformalLoan(id);
    await reopenInformalLoan(id);
    expect((await db.loans.get(id))?.status).toBe('active');
    expect((await loanBills(id)).some((b) => b.loanPayoff)).toBe(false);
    await ensureLoanInterestBills(11, 2026);
    expect((await loanBills(id)).some((b) => b.month === 11)).toBe(true);
  });

  it('adiar os juros não cria cobrança em dobro no mês seguinte', async () => {
    const id = await newLoan(9);
    const october = (await loanBills(id)).find((b) => b.month === 10)!;
    await skipBillToNextMonth(october);
    await ensureMonthlyBillOccurrences(11, 2026);
    await ensureLoanInterestBills(11, 2026);

    const november = (await loanBills(id)).filter((b) => b.month === 11 && b.status === 'pending');
    // Os juros de outubro (adiados) e os de novembro: dois, não três.
    expect(november.map((b) => b.originMonth).sort()).toEqual([10, 11]);
    expect(november.every((b) => !b.isMonthly)).toBe(true);
  });

  it('mudar o percentual atualiza as cobranças em aberto', async () => {
    const id = await newLoan(9);
    await updateInformalLoanRate(id, 15);
    const pending = (await loanBills(id)).filter((b) => b.status === 'pending');
    expect(pending.every((b) => b.finalValue === 750)).toBe(true);
  });
});
