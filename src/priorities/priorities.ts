import type { Bill, PriorityItem, PriorityLevel, RecurringDebt } from '../types';
import { resolveCostProfile } from '../advisor/categories';
import { normalize } from '../advisor/text';
import { inferSpendingGroup } from '../spending/groups';
import { getPostponeStatus, getRecurringBacklog, installmentLimit } from '../utils/bills';
import { formatOverdueSpan, startOfToday } from '../utils/formatters';

/**
 * Prioridade de pagamento de cada conta.
 *
 * A lógica antiga deixava tudo em "Média" até alguém tocar, e o toque girava
 * entre os níveis sem dizer por quê. Agora toda conta nasce com um nível
 * AUTOMÁTICO, calculado pelo que acontece se ela não for paga, e com o
 * motivo escrito. O usuário pode fixar outro nível (vira MANUAL) ou tirar a
 * conta da lista (EXCLUÍDA).
 */
export const PRIORITY_INFO: Record<PriorityLevel, { label: string; short: string; color: string; soft: string; order: number }> = {
  alta: { label: 'Pagar primeiro', short: 'Primeiro', color: 'var(--color-danger)', soft: 'var(--color-danger-soft)', order: 0 },
  media: { label: 'Normal', short: 'Normal', color: 'var(--color-warning)', soft: 'var(--color-warning-soft)', order: 1 },
  baixa: { label: 'Pode esperar', short: 'Esperar', color: 'var(--color-primary)', soft: 'var(--color-primary-soft)', order: 2 },
};

export const PRIORITY_LEVELS: PriorityLevel[] = ['alta', 'media', 'baixa'];

/** Chave de uma conta: "Faculdade (3/10)", "faculdade" e "FACULDADE" são a mesma. */
export function priorityKey(description: string): string {
  return normalize(description.replace(/\s*\((\d+\/\d+|parcela \d+|\d+)\)\s*$/i, ''));
}

export interface PrioritySignals {
  description: string;
  category?: Bill['category'];
  monthlyInterestPercent?: number;
  /** Conta de agiota (juros mensais de um empréstimo informal) */
  isLoan?: boolean;
  /** Maior número de adiamentos entre as faturas em aberto */
  maxPostponed: number;
  /** Maior atraso, em dias, entre as faturas em aberto */
  maxDaysLate: number;
}

/**
 * Nível sugerido e o motivo. Em ordem de peso:
 *
 * 1. O que ameaça casa, serviço essencial, saúde ou traz cobrança pesada
 *    (aluguel, energia, água, pensão, plano, agiota) → pagar primeiro.
 * 2. O que tem juros altos cadastrados, já foi adiado 2 vezes ou está
 *    atrasado há mais de um mês → pagar primeiro: está virando bola de neve.
 * 3. Assinatura, lazer, compras e dívida com pessoa próxima → pode esperar.
 * 4. O resto → normal.
 */
export function suggestPriority(signals: PrioritySignals): { level: PriorityLevel; reason: string } {
  if (signals.isLoan) return { level: 'alta', reason: 'agiota: atrasar costuma trazer cobrança pesada' };

  const profile = resolveCostProfile({
    description: signals.description,
    category: signals.category,
    monthlyInterestPercent: signals.monthlyInterestPercent,
  });
  if (profile.essential) return { level: 'alta', reason: profile.consequence };

  const rate = signals.monthlyInterestPercent ?? 0;
  if (rate >= 3) {
    return { level: 'alta', reason: `juros de ${rate.toLocaleString('pt-BR')}% ao mês cadastrados` };
  }
  if (signals.maxPostponed >= 2) {
    return { level: 'alta', reason: `já adiada ${signals.maxPostponed}x — está virando bola de neve` };
  }
  if (signals.maxDaysLate > 30) {
    return { level: 'alta', reason: `atrasada ${formatOverdueSpan(signals.maxDaysLate)}` };
  }

  if (profile.category === 'assinatura') return { level: 'baixa', reason: 'assinatura: dá para pausar sem prejuízo' };
  if (profile.category === 'pessoal') return { level: 'baixa', reason: 'pessoa próxima e sem juros: dá para combinar prazo' };
  const spending = inferSpendingGroup(signals.description, signals.category);
  if (spending === 'lazer' || spending === 'compras') {
    return { level: 'baixa', reason: 'gasto que pode ser adiado ou cortado' };
  }

  if (signals.maxDaysLate > 0) return { level: 'media', reason: `vencida ${formatOverdueSpan(signals.maxDaysLate)}` };
  return { level: 'media', reason: profile.consequence };
}

export interface PriorityEntry {
  key: string;
  description: string;
  kind: 'conta' | 'dívida parcelada';
  /** Nível em vigor: o manual, se houver; senão o automático */
  level: PriorityLevel;
  autoLevel: PriorityLevel;
  reason: string;
  manual: boolean;
  /** Quanto está em aberto hoje desta conta (todas as faturas/parcelas) */
  openAmount: number;
  openCount: number;
}

export interface PriorityList {
  entries: PriorityEntry[];
  excluded: PriorityEntry[];
  /** Nível em vigor por chave — para quem só precisa consultar */
  levelOf: Map<string, PriorityLevel>;
}

interface Accumulator {
  key: string;
  description: string;
  kind: PriorityEntry['kind'];
  category?: Bill['category'];
  monthlyInterestPercent?: number;
  isLoan: boolean;
  maxPostponed: number;
  maxDaysLate: number;
  openAmount: number;
  openCount: number;
  relevant: boolean;
}

/**
 * Monta a lista de prioridades a partir das contas e dívidas cadastradas.
 *
 * É calculada ao vivo — por isso se atualiza sozinha quando uma conta ou
 * dívida é adicionada. Entram as contas que pedem decisão: com alguma fatura
 * em aberto, que se repetem todo mês ou que estão no mês atual, e as dívidas
 * parceladas ativas. Conta paga e encerrada sai sozinha.
 */
export function buildPriorityList(
  bills: Bill[],
  debts: RecurringDebt[],
  stored: PriorityItem[],
  today: Date = startOfToday()
): PriorityList {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const accounts = new Map<string, Accumulator>();

  const touch = (description: string, kind: PriorityEntry['kind']): Accumulator => {
    const key = priorityKey(description);
    let acc = accounts.get(key);
    if (!acc) {
      acc = {
        key,
        description: description.replace(/\s*\(\d+\/\d+\)\s*$/, ''),
        kind,
        isLoan: false,
        maxPostponed: 0,
        maxDaysLate: 0,
        openAmount: 0,
        openCount: 0,
        relevant: false,
      };
      accounts.set(key, acc);
    }
    return acc;
  };

  for (const bill of bills) {
    if (bill.status === 'skipped' || bill.loanPayoff) continue;
    const acc = touch(bill.originalDescription ?? bill.description, 'conta');
    acc.category = acc.category ?? bill.category;
    if (typeof bill.monthlyInterestPercent === 'number') acc.monthlyInterestPercent = bill.monthlyInterestPercent;
    if (bill.loanId !== undefined) acc.isLoan = true;
    if (bill.isMonthly || (bill.month === month && bill.year === year)) acc.relevant = true;
    if (bill.status === 'pending') {
      const status = getPostponeStatus(bill, today);
      acc.relevant = true;
      acc.openAmount += bill.finalValue;
      acc.openCount++;
      acc.maxPostponed = Math.max(acc.maxPostponed, status.times);
      acc.maxDaysLate = Math.max(acc.maxDaysLate, status.isLate ? status.daysLate : 0);
    }
  }

  for (const debt of debts) {
    if (!debt.isActive && debt.paidInstallments >= installmentLimit(debt)) continue;
    const acc = touch(debt.description, 'dívida parcelada');
    acc.kind = 'dívida parcelada';
    acc.category = acc.category ?? debt.category;
    if (typeof debt.monthlyInterestPercent === 'number') acc.monthlyInterestPercent = debt.monthlyInterestPercent;
    acc.relevant = true;
    const backlog = getRecurringBacklog(debt, today);
    acc.openAmount += backlog.overdueAmount + (backlog.dueThisMonth ? debt.installmentValue : 0);
    acc.openCount += backlog.overdueCount + (backlog.dueThisMonth ? 1 : 0);
    if (backlog.oldest) acc.maxDaysLate = Math.max(acc.maxDaysLate, backlog.oldest.daysLate);
  }

  // Escolhas gravadas. Chaves antigas eram só minúsculas (com acento); a
  // normalização faz as duas formas apontarem para a mesma conta.
  const manual = new Map<string, PriorityLevel>();
  const excludedKeys = new Set<string>();
  for (const item of stored) {
    const key = priorityKey(item.keyword);
    if (item.excluded) excludedKeys.add(key);
    else manual.set(key, item.level);
  }

  const entries: PriorityEntry[] = [];
  const excluded: PriorityEntry[] = [];
  const levelOf = new Map<string, PriorityLevel>();

  for (const acc of accounts.values()) {
    if (!acc.relevant) continue;
    const auto = suggestPriority(acc);
    const chosen = manual.get(acc.key);
    const entry: PriorityEntry = {
      key: acc.key,
      description: acc.description,
      kind: acc.kind,
      level: chosen ?? auto.level,
      autoLevel: auto.level,
      reason: auto.reason,
      manual: chosen !== undefined,
      openAmount: acc.openAmount,
      openCount: acc.openCount,
    };
    if (excludedKeys.has(acc.key)) {
      excluded.push(entry);
    } else {
      entries.push(entry);
      levelOf.set(acc.key, entry.level);
    }
  }

  const sort = (a: PriorityEntry, b: PriorityEntry) =>
    PRIORITY_INFO[a.level].order - PRIORITY_INFO[b.level].order ||
    b.openAmount - a.openAmount ||
    a.description.localeCompare(b.description);
  entries.sort(sort);
  excluded.sort((a, b) => a.description.localeCompare(b.description));
  return { entries, excluded, levelOf };
}
