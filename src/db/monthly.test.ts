import { beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  ensureCarryOverBillsForMonth,
  ensureMonthlyBillOccurrences,
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

  it('não inventa fatura de mês que ainda não chegou', async () => {
    await createMonthlyBill();
    // "Hoje" nos testes é a data real; 2099 nunca chegou.
    expect(await ensureMonthlyBillOccurrences(1, 2099)).toBe(0);
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

describe('adiar acumula sozinho', () => {
  beforeEach(async () => {
    await db.bills.clear();
  });

  it('adiar uma conta avulsa passa a gerar as faturas seguintes', async () => {
    // O usuário não precisa lembrar de marcar nada: adiar já significa que a
    // conta volta no mês que vem.
    const avulsa = await createMonthlyBill({ isMonthly: false });
    expect(avulsa.isMonthly).toBe(false);

    await skipBillToNextMonth(avulsa);

    const depois = await db.bills.get(avulsa.id!);
    expect(depois?.isMonthly).toBe(true);
    expect(await ensureMonthlyBillOccurrences(7, 2026)).toBe(1);
  });

  it('tres adiamentos viram tres dividas individuais no destino', async () => {
    // Cenário do usuário: adiei a mesma conta por três meses e quero ver as
    // três no mês de destino, cada uma sabendo quando venceu.
    await createMonthlyBill({ isMonthly: false });

    for (const mes of [6, 7, 8]) {
      await ensureMonthlyBillOccurrences(mes, 2026);
      const emAberto = (await billsOf(mes, 2026)).filter((b) => b.status === 'pending');
      for (const conta of emAberto) await skipBillToNextMonth(conta);
    }
    await ensureMonthlyBillOccurrences(9, 2026);

    const setembro = (await billsOf(9, 2026)).filter((b) => b.status === 'pending');

    const adiadas = setembro
      .filter((b) => (b.postponeHistory ?? []).length > 0)
      .map((b) => ({
        venceu: `${b.originMonth}/${b.originYear}`,
        vezes: (b.postponeHistory ?? []).length,
      }))
      .sort((a, b) => a.venceu.localeCompare(b.venceu));

    expect(adiadas).toEqual([
      { venceu: '6/2026', vezes: 3 },
      { venceu: '7/2026', vezes: 2 },
      { venceu: '8/2026', vezes: 1 },
    ]);
  });

  it('desmarcar depois interrompe a geração', async () => {
    // Escape para quem adiou uma conta que era mesmo avulsa.
    const avulsa = await createMonthlyBill({ isMonthly: false });
    await skipBillToNextMonth(avulsa);
    await setBillSeriesMonthly(avulsa.seriesId ?? avulsa.id!, false);

    expect(await ensureMonthlyBillOccurrences(7, 2026)).toBe(0);
  });
});

describe('carry-over automático da virada de mês', () => {
  beforeEach(async () => {
    await db.bills.clear();
  });

  it('tira a dívida do mês de origem em vez de contar nos dois', async () => {
    // Antes a original ficava pendente e uma cópia ia para o mês seguinte, o
    // que fazia a mesma dívida ser somada duas vezes.
    const junho = await createMonthlyBill({ isMonthly: false });

    const trazidas = await ensureCarryOverBillsForMonth(7, 2026);
    expect(trazidas).toBe(1);

    const emJunho = await billsOf(6, 2026);
    expect(emJunho).toHaveLength(1);
    expect(emJunho[0].status).toBe('skipped');
    expect(emJunho[0].id).toBe(junho.id);

    const emJulho = await billsOf(7, 2026);
    expect(emJulho).toHaveLength(1);
    expect(emJulho[0].status).toBe('pending');
    expect(emJulho[0].originMonth).toBe(6);

    // Somando os dois meses, a dívida aparece uma vez só.
    const todas = await db.bills.toArray();
    const emAberto = todas.filter((b) => b.status === 'pending');
    expect(emAberto.reduce((s, b) => s + b.finalValue, 0)).toBe(150);
  });
});
