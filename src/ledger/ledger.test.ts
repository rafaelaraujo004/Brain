import { describe, expect, it } from 'vitest';
import type { Bill, InformalLoan, RecurringDebt } from '../types';
import { buildLedger } from './ledger';
import { buildSnapshot } from '../advisor/snapshot';

const TODAY = new Date(2026, 9, 15); // 15/10/2026

function bill(partial: Partial<Bill> & Pick<Bill, 'id' | 'description' | 'finalValue'>): Bill {
  return {
    initialValue: partial.finalValue,
    status: 'pending',
    dueDay: 20,
    observation: '',
    month: 10,
    year: 2026,
    postponeHistory: [],
    ...partial,
  } as Bill;
}

const carro: RecurringDebt = {
  id: 1, description: 'Carro', totalInstallments: 10, paidInstallments: 2, installmentValue: 900,
  dueDay: 5, startMonth: 8, startYear: 2026, observation: '', isActive: true,
};

const agiota: InformalLoan = {
  id: 3, lender: 'Agiota', principal: 5000, monthlyRatePercent: 10, takenMonth: 8, takenYear: 2026,
  dueDay: 2, status: 'active', createdAt: '2026-08-01T00:00:00.000Z',
};

const bills: Bill[] = [
  // Cartão de setembro, adiado para outubro: atrasado desde 05/09.
  bill({
    id: 1, description: 'Cartão Nubank', finalValue: 1000, dueDay: 5, originMonth: 9, originYear: 2026,
    originalDueDate: new Date(2026, 8, 5).toISOString(),
    postponeHistory: [{ fromMonth: 9, fromYear: 2026, toMonth: 10, toYear: 2026, postponedAt: '2026-09-20T00:00:00.000Z', dueDate: new Date(2026, 8, 5).toISOString() }],
  }),
  // Energia de outubro, vence dia 20: a vencer.
  bill({ id: 2, description: 'Energia', finalValue: 150 }),
  // Adiada para novembro antes de vencer: a vencer, em mês futuro.
  bill({ id: 3, description: 'Internet', finalValue: 120, month: 11, originMonth: 10, originYear: 2026, originalDueDate: new Date(2026, 9, 25).toISOString() }),
  // Juros do agiota de outubro, vencidos dia 02.
  bill({ id: 4, description: 'Juros — Agiota', finalValue: 500, dueDay: 2, loanId: 3 }),
  // Paga: não entra.
  bill({ id: 5, description: 'Aluguel', finalValue: 1200, status: 'paid' }),
];

describe('extrato do que se deve', () => {
  const ledger = buildLedger(bills, [carro], [agiota], TODAY);

  it('soma tudo: atrasado, a vencer, parcelas futuras e valor pego com agiota', () => {
    expect(ledger.totals).toMatchObject({
      late: 1000 + 500 + 900, // cartão + juros + parcela de outubro do carro
      upcoming: 150 + 120,
      future: 7 * 900, // novembro a maio
      loanPrincipal: 5000,
    });
    expect(ledger.totals.total).toBe(2400 + 270 + 6300 + 5000);
  });

  it('diz quando a conta adiada venceu e em que mês ela está', () => {
    const cartao = ledger.items.find((i) => i.id === 'bill-1')!;
    expect(cartao.status).toBe('atrasada');
    expect(cartao.title).toBe('Conta de Setembro/2026');
    expect(cartao.detail).toContain('venceu em 05/09/2026');
    expect(cartao.detail).toContain('está em Outubro/2026');
    expect(cartao.detail).toContain('adiada 1x');
  });

  it('conta adiada para um mês futuro aparece como a vencer', () => {
    const internet = ledger.items.find((i) => i.id === 'bill-3')!;
    expect(internet.status).toBe('a_vencer');
    expect(internet.detail).toContain('vence em 20/11/2026');
  });

  it('agiota junta valor pego e juros na mesma conta', () => {
    const account = ledger.accounts.find((a) => a.key === 'loan-3')!;
    expect(account.name).toBe('Agiota');
    expect(account.total).toBe(5500);
    expect(account.summary).toContain('valor pego');
  });

  it('parcelas futuras viram uma linha só', () => {
    const future = ledger.items.find((i) => i.id === 'future-1')!;
    expect(future).toMatchObject({ title: '7 parcelas futuras', amount: 6300, status: 'futura' });
    expect(future.detail).toBe('de Nov/2026 a Mai/2027');
  });

  it('dívida sem número de parcelas não soma o futuro infinito', () => {
    const tia: RecurringDebt = {
      id: 9, description: 'Tia', paidInstallments: 0, installmentValue: 200, dueDay: 1,
      startMonth: 8, startYear: 2026, observation: '', isActive: true,
    };
    const result = buildLedger([], [tia], [], TODAY);
    // Agosto, setembro e outubro vencidos; nada além do mês atual.
    expect(result.totals.late).toBe(600);
    expect(result.totals.future).toBe(0);
    expect(result.accounts[0].summary).toContain('sem prazo');
  });

  it('o "em atraso" bate com o do assistente e do Início', () => {
    const snapshot = buildSnapshot(
      {
        bills,
        recurringDebts: [carro],
        priorities: [],
        monthlyConfigs: [],
        extraFunds: [],
        incomeSources: [],
        loans: [agiota],
      },
      TODAY
    );
    expect(ledger.totals.late).toBe(snapshot.totals.amount);
    expect(ledger.totals.lateCount).toBe(snapshot.totals.count);
  });
});
