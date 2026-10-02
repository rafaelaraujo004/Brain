import type { Bill, InformalLoan, RecurringDebt } from '../types';
import { getPostponeStatus, installmentFraction, installmentLimit, isOpenEnded } from '../utils/bills';
import { buildDueDate, daysOverdue, formatOverdueSpan, getMonthName, getShortMonthName, startOfToday } from '../utils/formatters';
import { inferSpendingGroup, SPENDING_GROUPS, type SpendingGroup } from '../spending/groups';
import { priorityKey } from '../priorities/priorities';

/**
 * Extrato do que se deve: cada conta em aberto, cada parcela que falta e o
 * dinheiro pego com agiota. É a base da aba Totais.
 *
 * A aba antes mostrava só o que já tinha vencido, embora dissesse "quanto
 * você deve". Aqui entra tudo, com a situação de cada item explícita.
 */
export type LedgerStatus = 'atrasada' | 'a_vencer' | 'futura' | 'agiota';

export interface LedgerItem {
  /** "bill-12", "inst-3-7", "future-3", "loan-1" — os dois primeiros iguais aos do assistente */
  id: string;
  accountKey: string;
  accountName: string;
  /** Linha principal do item, ex.: "Outubro/2026", "Parcela 3/10" */
  title: string;
  /** Situação em texto, ex.: "venceu em 05/09/2026 · há 27 dias" */
  detail: string;
  amount: number;
  status: LedgerStatus;
  /** Data que manda na situação: o vencimento original se atrasada, o atual se a vencer */
  dueDate: Date | null;
  group: SpendingGroup;
  postponedTimes: number;
  daysLate: number;
}

export interface LedgerAccount {
  key: string;
  name: string;
  group: SpendingGroup;
  items: LedgerItem[];
  total: number;
  late: number;
  /** "2 atrasadas · 1 a vencer" */
  summary: string;
  /** Dívida sem número de parcelas: o total não inclui o futuro */
  openEndedMonthly?: number;
}

export interface LedgerTotals {
  total: number;
  late: number;
  upcoming: number;
  future: number;
  loanPrincipal: number;
  lateCount: number;
  oldestLate?: LedgerItem;
}

export interface Ledger {
  items: LedgerItem[];
  accounts: LedgerAccount[];
  totals: LedgerTotals;
}

function monthIndex(month: number, year: number) {
  return year * 12 + (month - 1);
}

function fromIndex(index: number) {
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

function dateLabel(date: Date) {
  return date.toLocaleDateString('pt-BR');
}

export function buildLedger(
  bills: Bill[],
  debts: RecurringDebt[],
  loans: InformalLoan[],
  today: Date = startOfToday()
): Ledger {
  const items: LedgerItem[] = [];
  const names = new Map<string, string>();
  const openEnded = new Map<string, number>();
  const currentIndex = monthIndex(today.getMonth() + 1, today.getFullYear());
  const loanById = new Map(loans.map((l) => [l.id, l]));

  /* --- Contas em aberto ----------------------------------------------- */
  for (const bill of bills) {
    if (bill.status !== 'pending') continue;
    const description = bill.originalDescription ?? bill.description;
    const loan = bill.loanId !== undefined ? loanById.get(bill.loanId) : undefined;
    const accountKey = bill.loanId !== undefined ? `loan-${bill.loanId}` : `conta-${priorityKey(description)}`;
    names.set(accountKey, loan ? loan.lender : description);

    const status = getPostponeStatus(bill, today);
    const late = status.daysLate > 0;
    const here = `${getMonthName(bill.month)}/${bill.year}`;
    const detail = late
      ? `venceu em ${dateLabel(status.originalDueDate)} · ${status.overdueLabel}${
          status.isCarried ? ` · está em ${here}` : ''
        }`
      : `vence em ${dateLabel(status.currentDueDate)}${status.isCarried ? ` · veio de ${status.originLabel}` : ''}`;

    items.push({
      id: `bill-${bill.id}`,
      accountKey,
      accountName: names.get(accountKey) as string,
      title: loan ? `Juros de ${status.originLabel}` : status.isCarried ? `Conta de ${status.originLabel}` : `Conta de ${here}`,
      detail: status.times > 0 ? `${detail} · adiada ${status.times}x` : detail,
      amount: bill.finalValue,
      status: late ? 'atrasada' : 'a_vencer',
      dueDate: late ? status.originalDueDate : status.currentDueDate,
      group: loan ? 'dividas' : inferSpendingGroup(description, bill.category),
      postponedTimes: status.times,
      daysLate: status.daysLate,
    });
  }

  /* --- Parcelas que faltam -------------------------------------------- */
  for (const debt of debts) {
    if (!debt.id) continue;
    const limit = installmentLimit(debt);
    if (debt.paidInstallments >= limit) continue;
    const accountKey = `debt-${debt.id}`;
    names.set(accountKey, debt.description);
    const group = inferSpendingGroup(debt.description, debt.category);
    const start = monthIndex(debt.startMonth, debt.startYear);
    // Parcela que virou conta (pelo "Adiar" de parcela) já está entre as contas.
    const linked = new Set(
      bills.filter((b) => b.recurringDebtId === debt.id).map((b) => monthIndex(b.month, b.year))
    );

    let futureCount = 0;
    let futureAmount = 0;
    let futureLast = 0;
    const lastNumber = isOpenEnded(debt) ? Math.max(debt.paidInstallments + 1, currentIndex - start + 1) : limit;

    for (let n = debt.paidInstallments + 1; n <= lastNumber; n++) {
      const index = start + n - 1;
      if (linked.has(index)) continue;
      const when = fromIndex(index);
      const due = buildDueDate(when.month, when.year, debt.dueDay);
      const daysLate = daysOverdue(due, today);

      // Parcelas de meses à frente do atual viram um item só, para a lista
      // não ganhar 40 linhas de um financiamento.
      if (index > currentIndex) {
        futureCount++;
        futureAmount += debt.installmentValue;
        futureLast = index;
        continue;
      }
      items.push({
        id: `inst-${debt.id}-${n}`,
        accountKey,
        accountName: debt.description,
        title: `Parcela ${installmentFraction(debt, n)}`,
        detail: daysLate > 0
          ? `venceu em ${dateLabel(due)} · ${formatOverdueSpan(daysLate)}`
          : `vence em ${dateLabel(due)}`,
        amount: debt.installmentValue,
        status: daysLate > 0 ? 'atrasada' : 'a_vencer',
        dueDate: due,
        group,
        postponedTimes: 0,
        daysLate,
      });
    }

    if (futureCount > 0) {
      const first = fromIndex(futureLast - futureCount + 1);
      const last = fromIndex(futureLast);
      items.push({
        id: `future-${debt.id}`,
        accountKey,
        accountName: debt.description,
        title: `${futureCount} ${futureCount === 1 ? 'parcela futura' : 'parcelas futuras'}`,
        detail:
          futureCount === 1
            ? `${getShortMonthName(first.month)}/${first.year}`
            : `de ${getShortMonthName(first.month)}/${first.year} a ${getShortMonthName(last.month)}/${last.year}`,
        amount: futureAmount,
        status: 'futura',
        dueDate: null,
        group,
        postponedTimes: 0,
        daysLate: 0,
      });
    }
    if (isOpenEnded(debt)) openEnded.set(accountKey, debt.installmentValue);
  }

  /* --- Dinheiro com agiota -------------------------------------------- */
  for (const loan of loans) {
    if (loan.status !== 'active' || loan.id === undefined) continue;
    const accountKey = `loan-${loan.id}`;
    names.set(accountKey, loan.lender);
    items.push({
      id: `loan-${loan.id}`,
      accountKey,
      accountName: loan.lender,
      title: 'Valor pego',
      detail: `pego em ${getShortMonthName(loan.takenMonth)}/${loan.takenYear} · só quita devolvendo tudo de uma vez`,
      amount: loan.principal,
      status: 'agiota',
      dueDate: null,
      group: 'dividas',
      postponedTimes: 0,
      daysLate: 0,
    });
  }

  /* --- Agrupa por conta ----------------------------------------------- */
  const order: Record<LedgerStatus, number> = { atrasada: 0, a_vencer: 1, futura: 2, agiota: 3 };
  const byAccount = new Map<string, LedgerItem[]>();
  for (const item of items) {
    item.accountName = names.get(item.accountKey) ?? item.accountName;
    const list = byAccount.get(item.accountKey) ?? [];
    list.push(item);
    byAccount.set(item.accountKey, list);
  }

  const accounts: LedgerAccount[] = [...byAccount.entries()].map(([key, list]) => {
    list.sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)
    );
    const count = (status: LedgerStatus) => list.filter((i) => i.status === status).length;
    const parts: string[] = [];
    const lateCount = count('atrasada');
    const upcomingCount = count('a_vencer');
    if (lateCount) parts.push(`${lateCount} ${lateCount === 1 ? 'atrasada' : 'atrasadas'}`);
    if (upcomingCount) parts.push(`${upcomingCount} a vencer`);
    const future = list.find((i) => i.status === 'futura');
    if (future) parts.push(future.title);
    if (list.some((i) => i.status === 'agiota')) parts.unshift('valor pego');
    const monthly = openEnded.get(key);
    if (monthly) parts.push('sem prazo');

    return {
      key,
      name: list[0].accountName,
      group: list[0].group,
      items: list,
      total: list.reduce((s, i) => s + i.amount, 0),
      late: list.filter((i) => i.status === 'atrasada').reduce((s, i) => s + i.amount, 0),
      summary: parts.join(' · '),
      openEndedMonthly: monthly,
    };
  });
  accounts.sort((a, b) => b.late - a.late || b.total - a.total);

  const sum = (status: LedgerStatus) => items.filter((i) => i.status === status).reduce((s, i) => s + i.amount, 0);
  const lateItems = items.filter((i) => i.status === 'atrasada');
  return {
    items,
    accounts,
    totals: {
      total: items.reduce((s, i) => s + i.amount, 0),
      late: sum('atrasada'),
      upcoming: sum('a_vencer'),
      future: sum('futura'),
      loanPrincipal: sum('agiota'),
      lateCount: lateItems.length,
      oldestLate: lateItems.reduce<LedgerItem | undefined>((a, b) => (!a || b.daysLate > a.daysLate ? b : a), undefined),
    },
  };
}

export function groupLabel(group: SpendingGroup): string {
  return SPENDING_GROUPS[group].label;
}
