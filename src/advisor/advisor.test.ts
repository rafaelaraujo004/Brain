import { describe, expect, it } from 'vitest';
import type { Bill, RecurringDebt } from '../types';
import { inferCategory } from './categories';
import { answerQuestion } from './engine';
import {
  annualRate,
  impliedMonthlyRate,
  monthlyNeededToClear,
  monthsToRepay,
  pmt,
  simulatePayoff,
} from './money';
import { extractNumbers, parseQuestion, wordsToDigits } from './parser';
import { buildSnapshot, estimateCharges, scopeSnapshot, type RawFinancialData } from './snapshot';
import { allocateBudget, analyzeLoan, rankDebts } from './strategy';
import { resolveCostProfile } from './categories';
import { normalize } from './text';
import type { AnswerBlock, OpenDebt } from './types';

const TODAY = new Date(2026, 9, 2); // 02/10/2026

function bill(partial: Partial<Bill> & Pick<Bill, 'id' | 'description' | 'finalValue' | 'month' | 'year'>): Bill {
  return {
    initialValue: partial.finalValue,
    status: 'pending',
    dueDay: 5,
    observation: '',
    postponeHistory: [],
    originMonth: partial.month,
    originYear: partial.year,
    ...partial,
  } as Bill;
}

function data(overrides: Partial<RawFinancialData> = {}): RawFinancialData {
  return {
    bills: [],
    recurringDebts: [],
    priorities: [],
    settings: { theme: 'dark', defaultSalary: 3000 },
    monthlyConfigs: [],
    extraFunds: [],
    incomeSources: [],
    ...overrides,
  };
}

/** Texto corrido de uma resposta, para buscas simples nos testes. */
function flatten(blocks: AnswerBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'text':
          return b.text;
        case 'verdict':
          return `${b.title} ${b.text ?? ''}`;
        case 'metrics':
          return b.items.map((i) => `${i.label} ${i.value}`).join(' ');
        case 'debts':
          return `${b.title ?? ''} ${b.items.map((i) => `${i.title} ${i.detail ?? ''} ${i.value ?? ''}`).join(' ')} ${b.footer ?? ''}`;
        case 'bullets':
          return b.items.map((i) => i.text).join(' ');
        case 'table':
          return b.rows.map((r) => r.join(' ')).join(' ');
        case 'note':
          return b.items.join(' ');
      }
    })
    .join(' ')
    .replace(/[*]{2}/g, '')
    .replace(/\u00a0/g, ' ');
}

/* --- Matemática ------------------------------------------------------- */

describe('money', () => {
  it('parcela sem juros é o valor dividido', () => {
    expect(pmt(5000, 0, 10)).toBe(500);
  });

  it('acha a taxa embutida e ela devolve a mesma parcela', () => {
    const rate = impliedMonthlyRate(5000, 500, 12);
    expect(rate).toBeGreaterThan(2.9);
    expect(rate).toBeLessThan(3);
    expect(pmt(5000, rate, 12)).toBeCloseTo(500, 2);
  });

  it('taxa zero quando o total pago não passa do emprestado', () => {
    expect(impliedMonthlyRate(5000, 500, 10)).toBe(0);
  });

  it('parcela que não cobre os juros nunca termina', () => {
    expect(monthsToRepay(1000, 10, 2)).toBe(Infinity);
    expect(monthsToRepay(1000, 100, 0)).toBe(10);
  });

  it('converte taxa mensal em anual', () => {
    expect(annualRate(1)).toBeCloseTo(12.68, 1);
  });

  it('simula a quitação de uma dívida sem juros', () => {
    const result = simulatePayoff([{ id: 'a', balance: 1000, monthlyRatePct: 0 }], 250);
    expect(result).toMatchObject({ months: 4, finished: true, totalPaid: 1000 });
  });

  it('sobra de uma dívida passa para a próxima no mesmo mês', () => {
    const result = simulatePayoff(
      [
        { id: 'a', balance: 100, monthlyRatePct: 0 },
        { id: 'b', balance: 300, monthlyRatePct: 0 },
      ],
      200
    );
    expect(result.clearedAt).toEqual({ a: 1, b: 2 });
  });

  it('não termina quando o pagamento não vence os juros', () => {
    const result = simulatePayoff([{ id: 'a', balance: 10000, monthlyRatePct: 14 }], 1000, 120);
    expect(result.finished).toBe(false);
  });

  it('acha o valor mensal mínimo para um prazo', () => {
    expect(monthlyNeededToClear([{ id: 'a', balance: 1200, monthlyRatePct: 0 }], 12)).toBe(100);
  });
});

/* --- Categorias ------------------------------------------------------- */

describe('categorias', () => {
  it('deduz o tipo pela descrição', () => {
    expect(inferCategory('Conta de luz')).toBe('energia');
    expect(inferCategory('ENEL')).toBe('energia');
    expect(inferCategory('Sabesp')).toBe('agua');
    expect(inferCategory('Aluguel apto')).toBe('moradia');
    expect(inferCategory('Fatura Nubank')).toBe('cartao');
    expect(inferCategory('Fatura da Vivo')).toBe('telecom');
    expect(inferCategory('Netflix')).toBe('assinatura');
    expect(inferCategory('Empréstimo Itaú')).toBe('emprestimo');
    expect(inferCategory('ZCXCXZ')).toBe('outros');
  });

  it('não confunde palavras curtas', () => {
    expect(inferCategory('Oito parcelas')).not.toBe('telecom');
    expect(inferCategory('Internet')).toBe('telecom');
    expect(inferCategory('Gasolina')).not.toBe('gas');
  });

  it('por padrão não há multa nem juros, nem no cartão', () => {
    const profile = resolveCostProfile({ description: 'Cartão Nubank' });
    expect(profile.category).toBe('cartao');
    expect(profile.monthlyInterestPercent).toBe(0);
    expect(profile.lateFeePercent).toBe(0);
    expect(profile.customRates).toBe(false);
    expect(estimateCharges(1000, profile, 90)).toBe(0);
  });

  it('só o percentual cadastrado na conta é usado', () => {
    const profile = resolveCostProfile({ description: 'Cartão', monthlyInterestPercent: 9 });
    expect(profile.monthlyInterestPercent).toBe(9);
    expect(profile.lateFeePercent).toBe(0);
    expect(profile.customRates).toBe(true);
  });

  it('estima multa + juros simples quando cadastrados', () => {
    const profile = resolveCostProfile({ description: 'Energia', lateFeePercent: 2, monthlyInterestPercent: 1 });
    // 2% de multa + 1% ao mês × 2 meses = 4%
    expect(estimateCharges(100, profile, 60)).toBeCloseTo(4, 2);
  });
});

/* --- Leitura da pergunta ---------------------------------------------- */

describe('parser', () => {
  it('lê números por extenso', () => {
    expect(wordsToDigits('cinco mil e quinhentos')).toBe('5500');
    expect(wordsToDigits('pegar mil reais')).toBe('pegar 1000 reais');
    expect(wordsToDigits('pegar um emprestimo')).toBe('pegar um emprestimo');
    expect(wordsToDigits('em doze vezes')).toBe('em 12 vezes');
    expect(wordsToDigits('3 mil reais')).toBe('3 mil reais');
    expect(wordsToDigits('2 mil e quinhentos')).toBe('2500');
  });

  it('entende a pergunta do empréstimo do jeito que ela é falada', () => {
    const parsed = parseQuestion(
      'Se eu pegar cinco mil emprestado, para ficar pagando 500 reais todos os meses, isso é um bom negócio?'
    );
    expect(parsed.intent).toBe('loan');
    expect(parsed.params.principal).toBe(5000);
    expect(parsed.params.monthly).toBe(500);
    expect(parsed.params.months).toBeUndefined();
  });

  it('separa valor, prazo e parcela', () => {
    const parsed = parseQuestion('empréstimo de R$ 5.000,00 em 12x de 550');
    expect(parsed.intent).toBe('loan');
    expect(parsed.params).toMatchObject({ principal: 5000, months: 12, monthly: 550 });
  });

  it('lê juros ao mês e ao ano', () => {
    expect(parseQuestion('3 mil a 4% ao mês em 10 vezes').params).toMatchObject({
      principal: 3000,
      ratePct: 4,
      months: 10,
    });
    const annual = extractNumbers(normalize('juros de 12% ao ano'));
    expect(annual[0].role).toBe('rate');
    expect(annual[0].value).toBeCloseTo(0.949, 2);
  });

  it('não confunde datas com dinheiro', () => {
    const numbers = extractNumbers(normalize('a conta de setembro de 2026 vence dia 10'));
    expect(numbers).toEqual([]);
  });

  it('reconhece as outras perguntas', () => {
    expect(parseQuestion('Tenho 1.500, quantas dívidas consigo quitar?')).toMatchObject({
      intent: 'how_many',
      params: { amount: 1500 },
    });
    expect(parseQuestion('Quais dívidas devo pagar primeiro?').intent).toBe('what_to_pay');
    expect(parseQuestion('Quanto eu devo no total?').intent).toBe('total');
    expect(parseQuestion('Em quanto tempo saio das dívidas guardando 300 por mês?')).toMatchObject({
      intent: 'payoff_time',
      params: { monthly: 300 },
    });
    expect(parseQuestion('Qual conta posso adiar este mês?').intent).toBe('postpone');
    expect(parseQuestion('Quanto sobra do meu salário?').intent).toBe('budget');
    expect(parseQuestion('Qual dívida é a mais cara?').intent).toBe('cost');
    expect(parseQuestion('Como renegociar o cartão?').intent).toBe('renegotiate');
    expect(parseQuestion('Me dá umas dicas, não sei o que fazer').intent).toBe('diagnosis');
    expect(parseQuestion('oi').intent).toBe('greeting');
  });

  it('entende as formas mais comuns de perguntar', () => {
    const cases: Array<[string, string]> = [
      ['Qual a melhor forma de quitar estas dívidas?', 'payoff_time'],
      ['Como eu saio dessa?', 'payoff_time'],
      ['Quanto preciso guardar por mês para quitar tudo em 6 meses?', 'payoff_time'],
      ['Consigo pagar tudo?', 'how_many'],
      ['O que eu faço?', 'diagnosis'],
      ['Devo fazer um empréstimo?', 'loan'],
      ['vale a pena um consignado de 3 mil?', 'loan'],
      ['Quanto tô devendo?', 'total'],
      ['Qual conta é mais urgente?', 'what_to_pay'],
      ['tenho 500 sobrando, onde coloco?', 'what_to_pay'],
      ['paguei o aluguel, quanto sobrou?', 'budget'],
      ['dá pra empurrar a internet pro mês que vem?', 'postpone'],
      ['quanto de juros estou pagando?', 'cost'],
      ['como faço acordo com o banco?', 'renegotiate'],
    ];
    for (const [question, intent] of cases) {
      expect([question, parseQuestion(question).intent]).toEqual([question, intent]);
    }
    expect(parseQuestion('Quanto preciso guardar por mês para quitar tudo em 6 meses?').params.months).toBe(6);
  });

  it('filtra por tipo de conta citado', () => {
    const parsed = parseQuestion('quanto eu devo de energia?');
    expect(parsed.intent).toBe('total');
    expect(parsed.categories).toEqual(['energia']);
  });

  it('continua a conversa anterior', () => {
    const first = parseQuestion('pegar 5 mil pagando 500 por mês');
    const next = parseQuestion('e se fossem 24 vezes?', [], { intent: first.intent, params: first.params });
    expect(next.isFollowUp).toBe(true);
    expect(next.intent).toBe('loan');
    expect(next.params).toMatchObject({ principal: 5000, monthly: 500, months: 24 });
  });

  it('pergunta nova não é sequestrada pelo contexto', () => {
    const next = parseQuestion('quanto eu devo no total?', [], { intent: 'loan', params: { principal: 5000 } });
    expect(next.intent).toBe('total');
    expect(next.isFollowUp).toBe(false);
  });

  it('nome de dívida não vira pedido de empréstimo', () => {
    const debts = [
      { id: 'bill-1', description: 'Empréstimo Itaú', category: 'emprestimo' as const, groupKey: 'a' },
      { id: 'bill-2', description: 'Energia', category: 'energia' as const, groupKey: 'b' },
    ];
    const parsed = parseQuestion('pago o empréstimo itaú ou a energia?', debts);
    expect(parsed.intent).toBe('compare');
    expect(parsed.debtIds).toEqual(['bill-1', 'bill-2']);
  });
});

/* --- Estratégia ------------------------------------------------------- */

function openDebt(partial: Partial<OpenDebt> & Pick<OpenDebt, 'id' | 'description' | 'updatedAmount'>): OpenDebt {
  const profile = resolveCostProfile({ description: partial.description });
  return {
    groupKey: partial.id,
    category: profile.category,
    categoryLabel: profile.label,
    categoryAuto: true,
    risk: profile.risk,
    essential: profile.essential,
    consequence: profile.consequence,
    lateFeePercent: profile.lateFeePercent,
    monthlyInterestPercent: profile.monthlyInterestPercent,
    compound: profile.compound,
    customRates: false,
    amount: partial.updatedAmount,
    charges: 0,
    informedValue: false,
    monthlyCost: 0,
    postponeCost: 0,
    originalDueDate: new Date(2026, 8, 5),
    daysLate: 27,
    overdueLabel: 'há 27 dias',
    originLabel: 'Setembro/2026',
    originKey: '2026-09',
    postponedTimes: 0,
    month: 10,
    year: 2026,
    ...partial,
  };
}

describe('estratégia', () => {
  it('essencial antes de caro, caro antes do resto, baixa no fim', () => {
    const ranked = rankDebts([
      openDebt({ id: 'outros', description: 'ZCXCXZ', updatedAmount: 100 }),
      openDebt({ id: 'cartao', description: 'Cartão Nubank', updatedAmount: 900 }),
      openDebt({ id: 'luz', description: 'Energia', updatedAmount: 200 }),
      openDebt({ id: 'aluguel', description: 'Aluguel', updatedAmount: 1200, userLevel: 'baixa' }),
    ]);
    expect(ranked.map((d) => d.id)).toEqual(['luz', 'cartao', 'outros', 'aluguel']);
    expect(ranked[0].reason).toContain('corte de energia');
  });

  it('pula a dívida que não cabe e paga as seguintes', () => {
    const ranked = rankDebts([
      openDebt({ id: 'luz', description: 'Energia', updatedAmount: 200 }),
      openDebt({ id: 'aluguel', description: 'Aluguel', updatedAmount: 1500 }),
      openDebt({ id: 'agua', description: 'Água', updatedAmount: 100 }),
    ]);
    const allocation = allocateBudget(ranked, 400);
    expect(allocation.paid.map((d) => d.id).sort()).toEqual(['agua', 'luz']);
    expect(allocation.leftover).toBe(100);
    expect(allocation.partial?.debt.id).toBe('aluguel');
  });

  it('modo "quantas" paga as menores primeiro', () => {
    const ranked = rankDebts([
      openDebt({ id: 'aluguel', description: 'Aluguel', updatedAmount: 300 }),
      openDebt({ id: 'a', description: 'ZZ1', updatedAmount: 100 }),
      openDebt({ id: 'b', description: 'ZZ2', updatedAmount: 100 }),
      openDebt({ id: 'c', description: 'ZZ3', updatedAmount: 100 }),
    ]);
    expect(allocateBudget(ranked, 300, 'priority').paid).toHaveLength(1);
    expect(allocateBudget(ranked, 300, 'count').paid).toHaveLength(3);
  });
});

/* --- Retrato e respostas ---------------------------------------------- */

/**
 * Cenário do usuário: energia de agosto e setembro adiadas até outubro,
 * cartão de setembro em aberto, energia de outubro ainda vai vencer.
 */
function scenario(salary = 3000): RawFinancialData {
  return data({
    settings: { theme: 'dark', defaultSalary: salary },
    bills: [
      bill({
        id: 1, description: 'Energia', finalValue: 150, month: 10, year: 2026, dueDay: 10,
        originMonth: 8, originYear: 2026, seriesId: 1, isMonthly: true,
        postponeHistory: [
          { fromMonth: 8, fromYear: 2026, toMonth: 9, toYear: 2026, postponedAt: '2026-08-20T00:00:00.000Z', dueDate: '2026-08-10T00:00:00.000Z' },
          { fromMonth: 9, fromYear: 2026, toMonth: 10, toYear: 2026, postponedAt: '2026-09-20T00:00:00.000Z', dueDate: '2026-09-10T00:00:00.000Z' },
        ],
      }),
      bill({
        id: 2, description: 'Energia', finalValue: 150, month: 10, year: 2026, dueDay: 10,
        originMonth: 9, originYear: 2026, seriesId: 1, isMonthly: true,
        postponeHistory: [
          { fromMonth: 9, fromYear: 2026, toMonth: 10, toYear: 2026, postponedAt: '2026-09-20T00:00:00.000Z', dueDate: '2026-09-10T00:00:00.000Z' },
        ],
      }),
      bill({ id: 3, description: 'Energia', finalValue: 150, month: 10, year: 2026, dueDay: 10, seriesId: 1, isMonthly: true }),
      bill({ id: 4, description: 'Cartão Nubank', finalValue: 1000, month: 9, year: 2026, dueDay: 5, lateFeePercent: 2, monthlyInterestPercent: 14 }),
      bill({ id: 5, description: 'Aluguel', finalValue: 1200, month: 10, year: 2026, dueDay: 1, status: 'paid' }),
    ],
  });
}

describe('retrato financeiro', () => {
  it('junta as dívidas em atraso de todos os meses, com encargos só onde há percentual', () => {
    const snap = buildSnapshot(scenario(), TODAY);
    expect(snap.overdue.map((d) => d.id).sort()).toEqual(['bill-1', 'bill-2', 'bill-4']);
    // Energias primeiro (essenciais), a mais antiga na frente.
    expect(snap.overdue[0].id).toBe('bill-1');
    expect(snap.overdue[2].category).toBe('cartao');
    expect(snap.totals.amount).toBe(1300);
    expect(snap.totals.charges).toBeGreaterThan(0);
    // Energia não tem percentual cadastrado: nada de encargos.
    expect(snap.overdue.filter((d) => d.category === 'energia').every((d) => d.charges === 0)).toBe(true);
    // A energia de outubro ainda não venceu.
    expect(snap.upcoming.map((d) => d.id)).toEqual(['bill-3']);
  });

  it('contas fixas são só as do próprio mês, sem os atrasos herdados', () => {
    const snap = buildSnapshot(scenario(), TODAY);
    // Energia de outubro (150) + aluguel (1200).
    expect(snap.fixedMonthly).toBe(1350);
    expect(snap.surplus).toBe(1650);
  });

  it('parcela vencida que nunca virou conta entra como atraso', () => {
    const debt: RecurringDebt = {
      id: 9, description: 'Empréstimo Itaú', totalInstallments: 10, paidInstallments: 2,
      installmentValue: 300, dueDay: 15, startMonth: 7, startYear: 2026, observation: '', isActive: true,
    };
    const snap = buildSnapshot(data({ recurringDebts: [debt] }), TODAY);
    // Parcelas 3 (set) vencida; 4 (out) ainda vai vencer.
    expect(snap.overdue.map((d) => d.id)).toEqual(['inst-9-3']);
    expect(snap.upcoming.map((d) => d.id)).toEqual(['inst-9-4']);
    expect(snap.overdue[0].category).toBe('emprestimo');
  });

  it('valor final editado à mão não recebe encargos estimados', () => {
    const snap = buildSnapshot(
      data({ bills: [bill({ id: 1, description: 'Energia', initialValue: 100, finalValue: 130, month: 8, year: 2026 })] }),
      TODAY
    );
    expect(snap.overdue[0].charges).toBe(0);
    expect(snap.overdue[0].updatedAmount).toBe(130);
  });

  it('escopo restringe às dívidas selecionadas', () => {
    const snap = scopeSnapshot(buildSnapshot(scenario(), TODAY), ['bill-4']);
    expect(snap.overdue).toHaveLength(1);
    expect(snap.totals.amount).toBe(1000);
    expect(snap.scoped).toBe(true);
  });
});

describe('assistente', () => {
  const snap = buildSnapshot(scenario(), TODAY);

  it('responde a pergunta do empréstimo sem prazo pedindo o prazo e já mostrando o que quita', () => {
    const answer = answerQuestion(
      'Se eu pegar 5 mil emprestado pagando 500 reais todos os meses, é um bom negócio? Quais dívidas eu deveria pagar?',
      snap
    );
    expect(answer.intent).toBe('loan');
    const text = flatten(answer.blocks);
    expect(text).toContain('quita 3 de 3');
    expect(text).toContain('número de parcelas');
    expect(text).toMatch(/só vale se forem até \d+ parcelas/);
    expect(answer.followUps).toContain('Em 12 vezes');
  });

  it('com prazo, dá veredito e compara com não pegar', () => {
    const first = answerQuestion('pegar 1.500 pagando 250 por mês', snap);
    const answer = answerQuestion('em 7 vezes', snap, first.context);
    expect(answer.intent).toBe('loan');
    const verdict = answer.blocks.find((b) => b.kind === 'verdict');
    expect(verdict && verdict.kind === 'verdict' ? verdict.title : '').toMatch(/Vale|Pode valer|Não recomendo/);
    expect(flatten(answer.blocks)).toContain('economia de');
    expect(answer.blocks.some((b) => b.kind === 'table' && b.columns.includes('Sem empréstimo'))).toBe(true);
  });

  it('empréstimo com parcela maior que a sobra é reprovado', () => {
    const tight = buildSnapshot(scenario(1500), TODAY); // sobra 150
    const answer = answerQuestion('empréstimo de 1.500 em 6x de 300', tight);
    const verdict = answer.blocks.find((b) => b.kind === 'verdict');
    expect(verdict && verdict.kind === 'verdict' ? verdict.tone : '').toBe('bad');
    expect(flatten(answer.blocks)).toContain('maior do que sobra');
  });

  it('empréstimo caro e sem urgência essencial é reprovado', () => {
    const onlyCard = scopeSnapshot(snap, ['bill-4']);
    const analysis = analyzeLoan(onlyCard, { principal: 1100, payment: 200, months: 12, ratePct: impliedMonthlyRate(1100, 200, 12) });
    expect(analysis.ratePct).toBeGreaterThan(8);
    expect(analysis.verdict).toBe('bad');
  });

  it('diz quantas dívidas dá para quitar com um valor', () => {
    const answer = answerQuestion('tenho 400, quantas dívidas consigo quitar?', snap);
    expect(answer.intent).toBe('how_many');
    expect(flatten(answer.blocks)).toMatch(/quita 2 de 3/);
  });

  it('soma por conta e filtra pelo nome', () => {
    const answer = answerQuestion('quanto eu devo de energia?', snap);
    const text = flatten(answer.blocks);
    expect(text).toContain('Energia ×2');
    expect(text).not.toContain('Nubank');
  });

  it('calcula em quanto tempo sai das dívidas com a sobra', () => {
    const answer = answerQuestion('em quanto tempo saio das dívidas?', snap);
    expect(answer.intent).toBe('payoff_time');
    expect(flatten(answer.blocks)).toMatch(/fica em dia em 1 mês/);
  });

  it('com prazo como meta, diz quanto separar por mês', () => {
    const answer = answerQuestion('quanto preciso guardar por mês para quitar tudo em 3 meses?', snap);
    expect(answer.intent).toBe('payoff_time');
    expect(flatten(answer.blocks)).toMatch(/Para zerar em 3 meses: R\$\s?[\d.,]+ por mês/);
  });

  it('a pergunta enviada pela seção Dívidas por conta é entendida', () => {
    const answer = answerQuestion(
      'Qual a melhor forma de quitar estas dívidas?',
      scopeSnapshot(snap, ['bill-1', 'bill-4'])
    );
    expect(answer.intent).toBe('payoff_time');
    expect(flatten(answer.blocks)).toContain('fica em dia');
  });

  it('compara duas dívidas pelo nome', () => {
    const answer = answerQuestion('pago a energia ou o cartão nubank?', snap);
    expect(answer.intent).toBe('compare');
    const verdict = answer.blocks[0];
    expect(verdict.kind === 'verdict' ? verdict.title : '').toBe('Pague primeiro: Energia');
  });

  it('sem atrasos, desaconselha empréstimo', () => {
    const clean = buildSnapshot(data(), TODAY);
    const answer = answerQuestion('vale pegar 2 mil emprestado?', clean);
    expect(flatten(answer.blocks)).toContain('Não recomendo');
  });

  it('responde quanto deve ao agiota', () => {
    const withLoan = buildSnapshot(
      {
        ...scenario(),
        loans: [
          {
            id: 1, lender: 'Agiota', principal: 5000, monthlyRatePercent: 10, takenMonth: 8, takenYear: 2026,
            dueDay: 10, status: 'active', createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
      TODAY
    );
    expect(withLoan.informalLoans[0]).toMatchObject({ principal: 5000, monthlyInterest: 500 });

    const parsed = parseQuestion('quanto eu devo pro agiota?');
    expect(parsed.intent).toBe('total');
    expect(parsed.params.interestOnly).toBe(true);

    const text = flatten(answerQuestion('quanto eu devo pro agiota?', withLoan).blocks);
    expect(text).toContain('você deve R$ 5.000,00');
    expect(text).toContain('R$ 500,00 de juros todo mês');

    // O total geral lembra do agiota, mesmo ele não estando "em atraso".
    expect(flatten(answerQuestion('quanto eu devo no total?', withLoan).blocks)).toContain('ao agiota');
  });

  it('avalia pegar dinheiro com agiota como empréstimo só de juros', () => {
    const answer = answerQuestion('vale a pena pegar 3 mil com agiota a 10%?', snap);
    expect(answer.intent).toBe('loan');
    const text = flatten(answer.blocks);
    expect(text).toContain('R$ 300,00 todo mês só de juros');
    // A sobra do mês quita tudo sozinha: o agiota só traria juros.
    expect(text).toContain('Não recomendo');
  });

  it('pergunta fora do assunto devolve exemplos', () => {
    const answer = answerQuestion('qual a capital da França?', snap);
    expect(answer.intent).toBe('unknown');
    expect(flatten(answer.blocks)).toContain('Não entendi');
  });
});
