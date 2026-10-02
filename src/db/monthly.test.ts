import { beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  ensureMonthlyBillOccurrences,
  planAutoRecurrenceCleanup,
  setBillSeriesMonthly,
  skipBillToNextMonth,
} from './database';
import type { Bill } from '../types';

/** Cria a primeira ocorrência de uma conta mensal, como o formulário faz. */
async function createMonthlyBill(overrides: Partial<Bill> = {}): Promise<Bill> {
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
    isMonthly: true,
    originMonth: 6,
    originYear: 2026,
    originalDueDate: new Date(2026, 5, 10).toISOString(),
    postponeHistory: [],
    ...overrides,
  });
  await db.bills.update(id as number, { seriesId: id as number });
  return (await db.bills.get(id as number)) as Bill;
}

async function billsOf(month: number, year: number): Promise<Bill[]> {
  return db.bills.where({ month, year }).toArray();
}

describe('contas mensais', () => {
  beforeEach(async () => {
    await db.bills.clear();
  });

  it('gera a fatura de cada competência a partir do início da série', async () => {
    await createMonthlyBill();

    expect(await ensureMonthlyBillOccurrences(7, 2026)).toBe(1);
    expect(await ensureMonthlyBillOccurrences(8, 2026)).toBe(1);

    const julho = await billsOf(7, 2026);
    expect(julho).toHaveLength(1);
    expect(julho[0].originMonth).toBe(7);
    expect(julho[0].isMonthly).toBe(true);
    expect(julho[0].finalValue).toBe(150);
  });

  it('não gera duas vezes a mesma competência', async () => {
    await createMonthlyBill();
    await ensureMonthlyBillOccurrences(7, 2026);
    expect(await ensureMonthlyBillOccurrences(7, 2026)).toBe(0);
    expect(await billsOf(7, 2026)).toHaveLength(1);
  });

  it('não gera antes do início da série', async () => {
    await createMonthlyBill();
    expect(await ensureMonthlyBillOccurrences(5, 2026)).toBe(0);
    expect(await billsOf(5, 2026)).toHaveLength(0);
  });

  it('gera também para meses futuros', async () => {
    // A fatura de um mês que ainda não chegou é devida quando chegar, e sem
    // ela o adiamento para frente não teria com o que somar: o débito viajava
    // sozinho até o mês de destino.
    await createMonthlyBill();
    expect(await ensureMonthlyBillOccurrences(12, 2026)).toBe(1);

    const dezembro = await billsOf(12, 2026);
    expect(dezembro).toHaveLength(1);
    expect(dezembro[0].originMonth).toBe(12);
  });

  it('adiar não faz a competência de origem gerar outra fatura', async () => {
    // Este é o ponto central: a fatura de junho continua sendo a de junho,
    // mesmo depois de empurrada — senão junho geraria uma substituta e a
    // dívida se duplicaria sozinha.
    const junho = await createMonthlyBill();
    await skipBillToNextMonth(junho);

    expect(await ensureMonthlyBillOccurrences(6, 2026)).toBe(0);
    const emJunho = await billsOf(6, 2026);
    expect(emJunho).toHaveLength(1);
    expect(emJunho[0].status).toBe('skipped');
  });

  it('acumula: meses sem pagar viram uma dívida cada', async () => {
    // Cenário de quem não pagou nada: em cada mês a fatura daquela
    // competência nasce e tudo que está em aberto é empurrado adiante.
    await createMonthlyBill();

    for (const from of [6, 7, 8]) {
      await ensureMonthlyBillOccurrences(from, 2026);
      const emAberto = (await billsOf(from, 2026)).filter((b) => b.status === 'pending');
      for (const conta of emAberto) await skipBillToNextMonth(conta);
    }
    await ensureMonthlyBillOccurrences(9, 2026);

    const setembro = (await billsOf(9, 2026)).filter((b) => b.status === 'pending');
    const origens = setembro.map((b) => `${b.originMonth}/${b.originYear}`).sort();

    // Uma dívida por competência não paga, cada uma sabendo de onde veio.
    expect(origens).toEqual(['6/2026', '7/2026', '8/2026', '9/2026']);
    expect(setembro.reduce((s, b) => s + b.finalValue, 0)).toBe(600);

    // A de junho foi empurrada três vezes; a de agosto, uma só.
    expect(setembro.find((b) => b.originMonth === 6)?.postponeHistory).toHaveLength(3);
    expect(setembro.find((b) => b.originMonth === 8)?.postponeHistory).toHaveLength(1);
    // A do próprio setembro nasceu aqui e nunca foi adiada.
    expect(setembro.find((b) => b.originMonth === 9)?.postponeHistory).toHaveLength(0);

    // Os meses intermediários não ficam com dívida em aberto: tudo andou.
    for (const m of [6, 7, 8]) {
      const abertas = (await billsOf(m, 2026)).filter((b) => b.status === 'pending');
      expect(abertas).toHaveLength(0);
    }
  });

  it('conta avulsa que ninguém adiou não gera nada', async () => {
    // A geração é consequência do adiamento, não do simples cadastro: uma
    // reforma paga em junho não pode virar uma reforma por mês.
    await createMonthlyBill({ isMonthly: false, description: 'Reforma' });

    expect(await ensureMonthlyBillOccurrences(7, 2026)).toBe(0);
    expect(await billsOf(7, 2026)).toHaveLength(0);
  });

  it('usa a ocorrência mais recente como molde do valor', async () => {
    const junho = await createMonthlyBill();
    await ensureMonthlyBillOccurrences(7, 2026);

    // A conta de julho veio mais cara; agosto deve seguir o valor novo.
    const julho = (await billsOf(7, 2026))[0];
    await db.bills.update(julho.id!, { initialValue: 210, finalValue: 210 });

    await ensureMonthlyBillOccurrences(8, 2026);
    const agosto = (await billsOf(8, 2026))[0];
    expect(agosto.finalValue).toBe(210);
    expect(agosto.seriesId).toBe(junho.id);
  });

  it('desmarcar a repetição vale para a série inteira', async () => {
    const junho = await createMonthlyBill();
    await ensureMonthlyBillOccurrences(7, 2026);

    await setBillSeriesMonthly(junho.seriesId!, false);

    const todas = await db.bills.toArray();
    expect(todas.every((b) => b.isMonthly === false)).toBe(true);
    expect(await ensureMonthlyBillOccurrences(8, 2026)).toBe(0);
  });
});

describe('adiar não cria recorrência', () => {
  beforeEach(async () => {
    await db.bills.clear();
  });

  it('adiar uma conta avulsa não a transforma em mensal', async () => {
    const avulsa = await createMonthlyBill({ isMonthly: false });
    await skipBillToNextMonth(avulsa);

    expect((await db.bills.get(avulsa.id!))?.isMonthly).toBe(false);
    // Julho tem só a dívida adiada; nenhum mês seguinte ganha fatura nova.
    for (const mes of [7, 8, 9, 10]) await ensureMonthlyBillOccurrences(mes, 2026);
    expect(await billsOf(7, 2026)).toHaveLength(1);
    for (const mes of [8, 9, 10]) expect(await billsOf(mes, 2026)).toHaveLength(0);
  });

  it('setembro adiado até novembro é uma dívida só, com o histórico dos dois adiamentos', async () => {
    const setembro = await createMonthlyBill({
      month: 9,
      year: 2026,
      originMonth: 9,
      originYear: 2026,
      originalDueDate: new Date(2026, 8, 1).toISOString(),
      dueDay: 1,
      finalValue: 500,
      initialValue: 500,
      isMonthly: false,
      description: 'ZCXCXZ',
    });

    await skipBillToNextMonth(setembro);
    await ensureMonthlyBillOccurrences(10, 2026);
    const outubro = (await billsOf(10, 2026)).filter((b) => b.status === 'pending');
    expect(outubro).toHaveLength(1);

    await skipBillToNextMonth(outubro[0]);
    await ensureMonthlyBillOccurrences(11, 2026);
    await ensureMonthlyBillOccurrences(12, 2026);

    const novembro = (await billsOf(11, 2026)).filter((b) => b.status === 'pending');
    expect(novembro).toHaveLength(1);
    expect(novembro[0]).toMatchObject({ originMonth: 9, finalValue: 500 });
    expect(novembro[0].postponeHistory).toHaveLength(2);

    // Ela para em novembro: dezembro não recebe nada sem um novo adiamento.
    expect(await billsOf(12, 2026)).toHaveLength(0);
  });

  it('conta não paga fica no mês dela até alguém adiar', async () => {
    const junho = await createMonthlyBill({ isMonthly: false });
    await ensureMonthlyBillOccurrences(7, 2026);

    expect((await db.bills.get(junho.id!))?.status).toBe('pending');
    expect(await billsOf(7, 2026)).toHaveLength(0);
  });

  it('conta marcada como mensal continua gerando e somando, por escolha do usuário', async () => {
    const setembro = await createMonthlyBill({
      month: 9,
      year: 2026,
      originMonth: 9,
      originYear: 2026,
      originalDueDate: new Date(2026, 8, 1).toISOString(),
      isMonthly: true,
    });

    await skipBillToNextMonth(setembro);
    await ensureMonthlyBillOccurrences(10, 2026);
    const outubro = (await billsOf(10, 2026)).filter((b) => b.status === 'pending');
    expect(outubro.map((b) => b.originMonth).sort()).toEqual([10, 9]);
  });
});

describe('limpeza das recorrências criadas pelo adiamento', () => {
  const today = new Date(2026, 9, 2); // outubro/2026

  function bill(partial: Partial<Bill> & Pick<Bill, 'id' | 'month'>): Bill {
    return {
      description: 'Conta',
      initialValue: 100,
      finalValue: 100,
      status: 'pending',
      dueDay: 5,
      observation: '',
      year: 2026,
      seriesId: 1,
      originMonth: partial.month,
      originYear: 2026,
      postponeHistory: [],
      isMonthly: true,
      ...partial,
    } as Bill;
  }

  const manual = { fromMonth: 9, fromYear: 2026, toMonth: 10, toYear: 2026, postponedAt: '', dueDate: '' };

  it('desliga a repetição e apaga só as faturas futuras que ela gerou', () => {
    const plan = planAutoRecurrenceCleanup(
      [
        bill({ id: 1, month: 9, status: 'skipped' }),
        bill({ id: 2, month: 10, originMonth: 9, postponeHistory: [manual], carriedFromBillId: 1 }),
        bill({ id: 3, month: 10 }), // gerada no mês atual: o usuário decide
        bill({ id: 4, month: 11 }), // futura gerada: sai
        bill({ id: 5, month: 12 }), // futura gerada: sai
        bill({ id: 6, month: 11, status: 'paid' }), // já paga: fica
      ],
      today
    );
    expect(plan.unmarkIds.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.deleteIds.sort()).toEqual([4, 5]);
  });

  it('não mexe em série mensal que nunca foi adiada à mão', () => {
    const plan = planAutoRecurrenceCleanup(
      [bill({ id: 1, month: 10 }), bill({ id: 2, month: 11 })],
      today
    );
    expect(plan).toEqual({ unmarkIds: [], deleteIds: [] });
  });

  it('não mexe nos juros do agiota', () => {
    const plan = planAutoRecurrenceCleanup(
      [bill({ id: 1, month: 11, loanId: 3, postponeHistory: [manual] })],
      today
    );
    expect(plan).toEqual({ unmarkIds: [], deleteIds: [] });
  });
});
