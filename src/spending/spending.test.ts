import { describe, expect, it } from 'vitest';
import type { Bill, RecurringDebt } from '../types';
import { collectSpending, monthIndex, wholeRange, type SpendingData } from './collect';
import { inferSpendingGroup, spendingKey } from './groups';
import { spendingInsights } from './insights';

const TODAY = new Date(2026, 9, 15); // 15/10/2026

function bill(partial: Partial<Bill> & Pick<Bill, 'id' | 'description' | 'finalValue'>): Bill {
  return {
    initialValue: partial.finalValue,
    status: 'paid',
    dueDay: 10,
    observation: '',
    month: 10,
    year: 2026,
    ...partial,
  } as Bill;
}

function data(overrides: Partial<SpendingData> = {}): SpendingData {
  return {
    bills: [],
    recurringDebts: [],
    settings: { theme: 'dark', defaultSalary: 4000 },
    monthlyConfigs: [],
    extraFunds: [],
    incomeSources: [],
    ...overrides,
  };
}

const OCTOBER = { from: monthIndex(10, 2026), to: monthIndex(10, 2026) };

describe('tipo de gasto pela descrição', () => {
  it('reconhece os gastos do dia a dia', () => {
    expect(inferSpendingGroup('Faculdade')).toBe('educacao');
    expect(inferSpendingGroup('Gasolina')).toBe('transporte');
    expect(inferSpendingGroup('Parcela do carro')).toBe('transporte');
    expect(inferSpendingGroup('Uber')).toBe('transporte');
    expect(inferSpendingGroup('Mercado')).toBe('alimentacao');
    expect(inferSpendingGroup('iFood')).toBe('alimentacao');
    expect(inferSpendingGroup('Aluguel')).toBe('moradia');
    expect(inferSpendingGroup('Farmácia')).toBe('saude');
    expect(inferSpendingGroup('Netflix')).toBe('lazer');
    expect(inferSpendingGroup('Ração do Bob')).toBe('pets');
    expect(inferSpendingGroup('Juros — Agiota')).toBe('dividas');
  });

  it('usa a marca quando não há palavra de gasto', () => {
    expect(inferSpendingGroup('Enel')).toBe('servicos');
    expect(inferSpendingGroup('Sabesp')).toBe('servicos');
    expect(inferSpendingGroup('Fatura Nubank')).toBe('dividas');
  });

  it('não cai em armadilhas de palavras parecidas', () => {
    expect(inferSpendingGroup('Mercado Livre')).toBe('compras');
    expect(inferSpendingGroup('Conta das crianças')).not.toBe('impostos');
    expect(inferSpendingGroup('Carrefour')).toBe('alimentacao');
    expect(inferSpendingGroup('Financiamento da casa')).toBe('moradia');
  });

  it('respeita o tipo de dívida escolhido quando a descrição não diz nada', () => {
    expect(inferSpendingGroup('ZCXCXZ', 'cartao')).toBe('dividas');
    expect(inferSpendingGroup('ZCXCXZ')).toBe('outros');
    // A palavra de gasto vence um tipo genérico.
    expect(inferSpendingGroup('Gasolina', 'outros')).toBe('transporte');
  });

  it('a chave ignora o número da parcela', () => {
    expect(spendingKey('Faculdade (3/10)')).toBe(spendingKey('faculdade'));
  });
});

describe('relatório de gastos', () => {
  it('conta como gasto só o que foi pago, e projeta o que está em aberto', () => {
    const report = collectSpending(
      data({
        bills: [
          bill({ id: 1, description: 'Faculdade', finalValue: 800 }),
          bill({ id: 2, description: 'Gasolina', finalValue: 300 }),
          bill({ id: 3, description: 'Gasolina', finalValue: 200, status: 'pending' }),
          bill({ id: 4, description: 'Aluguel', finalValue: 1200, status: 'pending' }),
        ],
      }),
      OCTOBER,
      [],
      TODAY
    );

    expect(report.paid).toBe(1100);
    expect(report.open).toBe(1400);
    expect(report.projected).toBe(2500);

    const transporte = report.groups.find((g) => g.group === 'transporte')!;
    expect(transporte).toMatchObject({ paid: 300, open: 200, projected: 500 });
    const moradia = report.groups.find((g) => g.group === 'moradia')!;
    expect(moradia).toMatchObject({ paid: 0, open: 1200 });
  });

  it('não conta o registro que ficou para trás num adiamento', () => {
    const report = collectSpending(
      data({ bills: [bill({ id: 1, description: 'Internet', finalValue: 100, status: 'skipped' })] }),
      OCTOBER,
      [],
      TODAY
    );
    expect(report.items).toHaveLength(0);
  });

  it('inclui parcelas de dívidas, pagas e em aberto, cada uma no mês dela', () => {
    const carro: RecurringDebt = {
      id: 7, description: 'Carro', totalInstallments: 10, paidInstallments: 3, installmentValue: 900,
      dueDay: 5, startMonth: 8, startYear: 2026, observation: '', isActive: true,
    };
    // Ano de 2026: parcelas de ago a dez = 5; pagas 3 (ago, set, out), abertas 2.
    const report = collectSpending(
      data({ recurringDebts: [carro] }),
      { from: monthIndex(1, 2026), to: monthIndex(12, 2026) },
      [],
      TODAY
    );
    const transporte = report.groups.find((g) => g.group === 'transporte')!;
    expect(transporte.paid).toBe(2700);
    expect(transporte.open).toBe(1800);
    expect(transporte.items.map((i) => `${i.month}:${i.status}`).sort()).toEqual(
      ['8:paid', '9:paid', '10:paid', '11:open', '12:open'].sort()
    );
  });

  it('dívida sem número de parcelas termina no fim do período', () => {
    const tia: RecurringDebt = {
      id: 8, description: 'Empréstimo da tia', paidInstallments: 0, installmentValue: 200,
      dueDay: 1, startMonth: 11, startYear: 2026, observation: '', isActive: true,
    };
    const report = collectSpending(
      data({ recurringDebts: [tia] }),
      { from: monthIndex(1, 2026), to: monthIndex(12, 2026) },
      [],
      TODAY
    );
    expect(report.items).toHaveLength(2); // novembro e dezembro
  });

  it('a escolha manual vale para todas as ocorrências da conta', () => {
    const report = collectSpending(
      data({
        bills: [
          bill({ id: 1, description: 'ZCXCXZ', finalValue: 50 }),
          bill({ id: 2, description: 'ZCXCXZ', finalValue: 70, month: 9 }),
        ],
      }),
      { from: monthIndex(9, 2026), to: monthIndex(10, 2026) },
      [{ keyword: spendingKey('ZCXCXZ'), group: 'lazer' }],
      TODAY
    );
    expect(report.groups.map((g) => [g.group, g.paid])).toEqual([['lazer', 120]]);
    expect(report.items.every((i) => i.manual)).toBe(true);
  });

  it('soma a renda dos meses já começados do período', () => {
    const report = collectSpending(data(), { from: monthIndex(1, 2026), to: monthIndex(12, 2026) }, [], TODAY);
    // Janeiro a outubro: 10 meses × 4.000.
    expect(report.income).toBe(40000);
    expect(report.elapsedMonths).toBe(10);
  });

  it('período "tudo" vai do primeiro lançamento ao mais distante', () => {
    const range = wholeRange(
      data({ bills: [bill({ id: 1, description: 'x', finalValue: 1, month: 3, year: 2026 }), bill({ id: 2, description: 'y', finalValue: 1, month: 1, year: 2027 })] }),
      TODAY
    );
    expect(range).toEqual({ from: monthIndex(3, 2026), to: monthIndex(1, 2027) });
  });
});

describe('leituras do relatório', () => {
  it('aponta o maior gasto, a fatia da renda e o que muda com a projeção', () => {
    const report = collectSpending(
      data({
        bills: [
          bill({ id: 1, description: 'Faculdade', finalValue: 800 }),
          bill({ id: 2, description: 'Cartão Nubank', finalValue: 600 }),
          bill({ id: 3, description: 'Aluguel', finalValue: 1500, status: 'pending' }),
        ],
      }),
      OCTOBER,
      [],
      TODAY
    );
    const text = spendingInsights(report, 'neste mês').join(' ');
    expect(text).toContain('Seu maior gasto é **Educação**: 57%');
    expect(text).toContain('**35%** da sua renda neste mês');
    expect(text).toContain('**43%** do que você pagou foi para dívidas');
    expect(text).toContain('**Moradia** passa a ser o maior gasto');
  });

  it('sem nada pago, explica que é só projeção', () => {
    const report = collectSpending(
      data({ bills: [bill({ id: 1, description: 'Aluguel', finalValue: 1500, status: 'pending' })] }),
      OCTOBER,
      [],
      TODAY
    );
    expect(spendingInsights(report, 'neste mês')[0]).toContain('Nada foi pago ainda neste mês');
  });
});
