import { describe, expect, it } from 'vitest';
import type { Bill, RecurringDebt } from '../types';
import {
  formatPostponeSummary,
  formatPostponeTimeline,
  getOriginMonthYear,
  getPostponeStatus,
  getRecurringStatusForMonth,
} from './bills';
import { buildDueDate, daysInMonth, formatOverdueSpan } from './formatters';

const TODAY = new Date(2026, 8, 2); // 02/09/2026

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 1,
    description: 'Energia',
    initialValue: 150,
    finalValue: 150,
    status: 'pending',
    dueDay: 10,
    observation: '',
    month: 6,
    year: 2026,
    ...overrides,
  };
}

/** Simula a propagação que o banco faz a cada adiamento. */
function postpone(bill: Bill, at: Date): Bill {
  const next =
    bill.month === 12
      ? { month: 1, year: bill.year + 1 }
      : { month: bill.month + 1, year: bill.year };
  const originMonth = bill.originMonth ?? bill.month;
  const originYear = bill.originYear ?? bill.year;

  return {
    ...bill,
    month: next.month,
    year: next.year,
    originMonth,
    originYear,
    originalDueDate:
      bill.originalDueDate ?? buildDueDate(originMonth, originYear, bill.dueDay).toISOString(),
    postponedAt: at.toISOString(),
    postponeHistory: [
      ...(bill.postponeHistory ?? []),
      {
        fromMonth: bill.month,
        fromYear: bill.year,
        toMonth: next.month,
        toYear: next.year,
        postponedAt: at.toISOString(),
        dueDate: buildDueDate(bill.month, bill.year, bill.dueDay).toISOString(),
      },
    ],
  };
}

describe('buildDueDate', () => {
  it('limita o dia ao último do mês', () => {
    // Fevereiro de 2026 tem 28 dias: dia 31 não pode virar 03/03.
    expect(buildDueDate(2, 2026, 31).getDate()).toBe(28);
    expect(daysInMonth(2, 2024)).toBe(29);
  });

  it('mantém o dia quando ele existe no mês', () => {
    const date = buildDueDate(6, 2026, 10);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(10);
  });
});

describe('getPostponeStatus', () => {
  it('conta nunca adiada não tem histórico', () => {
    const status = getPostponeStatus(makeBill({ month: 9, year: 2026, dueDay: 20 }), TODAY);
    expect(status.times).toBe(0);
    expect(status.isCarried).toBe(false);
    expect(status.isOverdue).toBe(false);
    expect(status.isLate).toBe(false);
  });

  it('marca como vencida uma conta pendente de mês anterior', () => {
    // Este era o bug: o cálculo antigo só olhava o mês corrente, então uma
    // conta de junho continuava "pendente" para sempre.
    const status = getPostponeStatus(makeBill(), TODAY);
    expect(status.isOverdue).toBe(true);
    expect(status.daysLate).toBe(84);
    expect(status.overdueLabel).toBe('há 2 meses e 24 dias');
  });

  it('não marca como vencida uma conta paga ou adiada', () => {
    expect(getPostponeStatus(makeBill({ status: 'paid' }), TODAY).isLate).toBe(false);
    expect(getPostponeStatus(makeBill({ status: 'skipped' }), TODAY).isLate).toBe(false);
  });

  it('preserva a competência de origem por toda a cadeia', () => {
    let bill = makeBill();
    bill = postpone(bill, new Date(2026, 6, 11));
    bill = postpone(bill, new Date(2026, 7, 11));
    bill = postpone(bill, new Date(2026, 8, 1));

    const status = getPostponeStatus(bill, TODAY);
    expect(bill.month).toBe(9);
    expect(status.times).toBe(3);
    expect(status.originLabel).toBe('Junho/2026');
    expect(getOriginMonthYear(bill)).toEqual({ month: 6, year: 2026 });
  });

  it('mede o atraso pelo vencimento original mesmo após ser empurrada', () => {
    let bill = makeBill();
    bill = postpone(bill, new Date(2026, 6, 11));
    bill = postpone(bill, new Date(2026, 7, 11));
    bill = postpone(bill, new Date(2026, 8, 1));

    const status = getPostponeStatus(bill, TODAY);
    // Vence 10/09 (ainda não chegou), mas a dívida é de 10/06.
    expect(status.isOverdue).toBe(false);
    expect(status.isLate).toBe(true);
    expect(status.daysLate).toBe(84);
    expect(status.originalDueDate.getMonth()).toBe(5);
  });

  it('registra a data de cada adiamento', () => {
    let bill = makeBill();
    bill = postpone(bill, new Date(2026, 6, 11));
    bill = postpone(bill, new Date(2026, 7, 11));

    const status = getPostponeStatus(bill, TODAY);
    expect(status.history).toHaveLength(2);
    expect(status.history[0]).toMatchObject({ fromMonth: 6, toMonth: 7 });
    expect(status.history[1]).toMatchObject({ fromMonth: 7, toMonth: 8 });
    expect(new Date(status.history[0].postponedAt).getDate()).toBe(11);
    expect(status.lastPostponedAt?.getMonth()).toBe(7);
  });

  it('vira o ano corretamente ao adiar em dezembro', () => {
    let bill = makeBill({ month: 12, year: 2026 });
    bill = postpone(bill, new Date(2027, 0, 2));
    expect(bill.month).toBe(1);
    expect(bill.year).toBe(2027);
    expect(getPostponeStatus(bill, TODAY).originLabel).toBe('Dezembro/2026');
  });

  it('lê contas antigas que só têm os campos carriedFrom', () => {
    // Dados anteriores à v6 do schema não têm postponeHistory.
    const legacy = makeBill({
      month: 7,
      year: 2026,
      carriedFromBillId: 99,
      carriedFromMonth: 6,
      carriedFromYear: 2026,
    });

    const status = getPostponeStatus(legacy, TODAY);
    expect(status.times).toBe(1);
    expect(status.isCarried).toBe(true);
    expect(status.originLabel).toBe('Junho/2026');
  });
});

describe('formatação do adiamento', () => {
  it('resume adiamentos numa linha', () => {
    let bill = makeBill();
    bill = postpone(bill, new Date(2026, 6, 11));
    bill = postpone(bill, new Date(2026, 7, 11));

    const summary = formatPostponeSummary(getPostponeStatus(bill, TODAY));
    expect(summary).toContain('Adiada 2x');
    expect(summary).toContain('desde Junho/2026');
    expect(summary).toContain('11/08/2026');
  });

  it('não resume o que nunca foi adiado', () => {
    expect(formatPostponeSummary(getPostponeStatus(makeBill(), TODAY))).toBe('');
  });

  it('detalha uma linha por adiamento', () => {
    let bill = makeBill();
    bill = postpone(bill, new Date(2026, 6, 11));
    bill = postpone(bill, new Date(2026, 7, 11));

    const lines = formatPostponeTimeline(getPostponeStatus(bill, TODAY));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Junho/2026');
    expect(lines[0]).toContain('Julho/2026');
    expect(lines[0]).toContain('11/07/2026');
    expect(lines[0]).toContain('manual');
  });
});

describe('formatOverdueSpan', () => {
  const cases: Array<[number, string]> = [
    [0, ''],
    [1, 'há 1 dia'],
    [15, 'há 15 dias'],
    [30, 'há 1 mês'],
    [45, 'há 1 mês e 15 dias'],
    [84, 'há 2 meses e 24 dias'],
  ];

  it.each(cases)('converte %i dias', (days, expected) => {
    expect(formatOverdueSpan(days)).toBe(expected);
  });
});

describe('getRecurringStatusForMonth', () => {
  const debt: RecurringDebt = {
    id: 1,
    description: 'Financiamento',
    totalInstallments: 12,
    paidInstallments: 2,
    installmentValue: 500,
    dueDay: 10,
    startMonth: 6,
    startYear: 2026,
    observation: '',
    isActive: true,
  };

  it('ignora meses fora da janela de parcelas', () => {
    expect(getRecurringStatusForMonth(debt, 5, 2026, TODAY).applies).toBe(false);
    expect(getRecurringStatusForMonth(debt, 7, 2027, TODAY).applies).toBe(false);
  });

  it('numera a parcela a partir do início', () => {
    expect(getRecurringStatusForMonth(debt, 6, 2026, TODAY).installmentNumber).toBe(1);
    expect(getRecurringStatusForMonth(debt, 9, 2026, TODAY).installmentNumber).toBe(4);
  });

  it('considera paga a parcela já quitada', () => {
    expect(getRecurringStatusForMonth(debt, 7, 2026, TODAY).status).toBe('paid');
  });

  it('marca atraso em competência passada', () => {
    // Parcela 3 (agosto) não foi paga e venceu em 10/08.
    const status = getRecurringStatusForMonth(debt, 8, 2026, TODAY);
    expect(status.status).toBe('overdue');
    expect(status.daysLate).toBe(23);
  });

  it('não marca atraso antes do vencimento', () => {
    // Parcela 4 vence 10/09 e hoje é 02/09.
    expect(getRecurringStatusForMonth(debt, 9, 2026, TODAY).status).toBe('pending');
  });
});
