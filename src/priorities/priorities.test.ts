import { beforeEach, describe, expect, it } from 'vitest';
import type { Bill, PriorityItem, RecurringDebt } from '../types';
import { buildPriorityList, priorityKey, suggestPriority } from './priorities';
import { db, excludePriority, reinstatePriorityOnAdd, restorePriority, setPriorityLevel } from '../db/database';

const TODAY = new Date(2026, 9, 15); // 15/10/2026

function bill(partial: Partial<Bill> & Pick<Bill, 'id' | 'description'>): Bill {
  return {
    initialValue: 100,
    finalValue: 100,
    status: 'pending',
    dueDay: 20,
    observation: '',
    month: 10,
    year: 2026,
    postponeHistory: [],
    ...partial,
  } as Bill;
}

const base = { maxPostponed: 0, maxDaysLate: 0 };

describe('prioridade automática', () => {
  it('essencial e agiota vêm primeiro, com o motivo', () => {
    expect(suggestPriority({ ...base, description: 'Energia' })).toEqual({
      level: 'alta',
      reason: 'risco de corte de energia',
    });
    expect(suggestPriority({ ...base, description: 'Aluguel' }).level).toBe('alta');
    expect(suggestPriority({ ...base, description: 'Juros — Agiota', isLoan: true }).level).toBe('alta');
  });

  it('juros cadastrados, adiamentos e atraso longo sobem a prioridade', () => {
    expect(suggestPriority({ ...base, description: 'Cartão', monthlyInterestPercent: 12 }).reason).toContain('12%');
    expect(suggestPriority({ ...base, description: 'ZCXCXZ', maxPostponed: 2 }).level).toBe('alta');
    expect(suggestPriority({ ...base, description: 'ZCXCXZ', maxDaysLate: 45 }).level).toBe('alta');
  });

  it('assinatura, lazer e dívida com pessoa próxima podem esperar', () => {
    expect(suggestPriority({ ...base, description: 'Netflix' }).level).toBe('baixa');
    expect(suggestPriority({ ...base, description: 'Cinema' }).level).toBe('baixa');
    expect(suggestPriority({ ...base, description: 'Devo a minha mãe' }).level).toBe('baixa');
  });

  it('o resto é normal', () => {
    expect(suggestPriority({ ...base, description: 'Faculdade' }).level).toBe('media');
    // Cartão sem juros cadastrados não é tratado como caro por padrão.
    expect(suggestPriority({ ...base, description: 'Cartão Nubank' }).level).toBe('media');
  });
});

describe('lista de prioridades', () => {
  it('entra sozinha toda conta em aberto, mensal ou do mês, e toda dívida ativa', () => {
    const debt: RecurringDebt = {
      id: 1, description: 'Carro', totalInstallments: 10, paidInstallments: 2, installmentValue: 900,
      dueDay: 5, startMonth: 8, startYear: 2026, observation: '', isActive: true,
    };
    const list = buildPriorityList(
      [
        bill({ id: 1, description: 'Energia' }),
        bill({ id: 2, description: 'Netflix', status: 'paid', isMonthly: true }),
        // Conta avulsa paga em março: não pede decisão, fica de fora.
        bill({ id: 3, description: 'Reforma', status: 'paid', month: 3 }),
      ],
      [debt],
      [],
      TODAY
    );
    expect(list.entries.map((e) => e.description).sort()).toEqual(['Carro', 'Energia', 'Netflix']);
    const carro = list.entries.find((e) => e.description === 'Carro')!;
    expect(carro.kind).toBe('dívida parcelada');
    // Agosto e setembro pagos; a de outubro venceu no dia 5.
    expect(carro.openCount).toBe(1);
    expect(carro.openAmount).toBe(900);
  });

  it('soma as faturas em aberto da mesma conta e usa o pior atraso', () => {
    const list = buildPriorityList(
      [
        bill({ id: 1, description: 'Internet', originMonth: 8, originYear: 2026, originalDueDate: new Date(2026, 7, 20).toISOString(), month: 10, postponeHistory: [{ fromMonth: 8, fromYear: 2026, toMonth: 9, toYear: 2026, postponedAt: '', dueDate: '' }, { fromMonth: 9, fromYear: 2026, toMonth: 10, toYear: 2026, postponedAt: '', dueDate: '' }] }),
        bill({ id: 2, description: 'Internet' }),
      ],
      [],
      [],
      TODAY
    );
    const internet = list.entries[0];
    expect(internet.openCount).toBe(2);
    expect(internet.openAmount).toBe(200);
    expect(internet.level).toBe('alta');
    expect(internet.reason).toContain('adiada 2x');
  });

  it('a escolha manual vence o automático e aceita chaves antigas', () => {
    const stored: PriorityItem[] = [{ keyword: 'faculdade', level: 'alta' }, { keyword: 'água', level: 'baixa' }];
    const list = buildPriorityList(
      [bill({ id: 1, description: 'Faculdade' }), bill({ id: 2, description: 'Água' })],
      [],
      stored,
      TODAY
    );
    const faculdade = list.entries.find((e) => e.description === 'Faculdade')!;
    expect(faculdade).toMatchObject({ level: 'alta', autoLevel: 'media', manual: true });
    expect(list.levelOf.get(priorityKey('Água'))).toBe('baixa');
  });

  it('conta excluída sai da lista e vai para as excluídas', () => {
    const list = buildPriorityList(
      [bill({ id: 1, description: 'Netflix' }), bill({ id: 2, description: 'Energia' })],
      [],
      [{ keyword: 'netflix', level: 'media', excluded: true }],
      TODAY
    );
    expect(list.entries.map((e) => e.description)).toEqual(['Energia']);
    expect(list.excluded.map((e) => e.description)).toEqual(['Netflix']);
    expect(list.levelOf.has('netflix')).toBe(false);
  });
});

describe('gravação das prioridades', () => {
  beforeEach(async () => {
    await db.priorities.clear();
  });

  it('fixar, voltar ao automático, excluir e restaurar', async () => {
    await db.priorities.add({ keyword: 'água', level: 'media' }); // chave antiga
    await setPriorityLevel('agua', 'alta');
    expect(await db.priorities.toArray()).toEqual([expect.objectContaining({ keyword: 'agua', level: 'alta' })]);

    await setPriorityLevel('agua', null);
    expect(await db.priorities.count()).toBe(0);

    await excludePriority('agua');
    expect((await db.priorities.toArray())[0]).toMatchObject({ keyword: 'agua', excluded: true });

    await restorePriority('agua');
    expect(await db.priorities.count()).toBe(0);
  });

  it('cadastrar de novo uma conta excluída a traz de volta', async () => {
    await excludePriority(priorityKey('Netflix'));
    await reinstatePriorityOnAdd('Netflix');
    expect(await db.priorities.count()).toBe(0);
  });
});
