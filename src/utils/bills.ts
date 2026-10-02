import type { Bill, PostponeRecord, RecurringDebt } from '../types';
import {
  buildDueDate,
  daysInMonth,
  daysOverdue,
  formatDate,
  formatOverdueSpan,
  getMonthName,
  startOfToday,
} from './formatters';

/** Competência de origem da conta (antes de qualquer adiamento). */
export function getOriginMonthYear(bill: Bill): { month: number; year: number } {
  return {
    month: bill.originMonth ?? bill.carriedFromMonth ?? bill.month,
    year: bill.originYear ?? bill.carriedFromYear ?? bill.year,
  };
}

/** Histórico de adiamentos, com fallback para as contas antigas de 1 salto. */
export function getPostponeHistory(bill: Bill): PostponeRecord[] {
  if (bill.postponeHistory?.length) return bill.postponeHistory;
  if (bill.carriedFromMonth && bill.carriedFromYear) {
    return [
      {
        fromMonth: bill.carriedFromMonth,
        fromYear: bill.carriedFromYear,
        toMonth: bill.month,
        toYear: bill.year,
        postponedAt: new Date(bill.year, bill.month - 1, 1).toISOString(),
        dueDate: buildDueDate(bill.carriedFromMonth, bill.carriedFromYear, bill.dueDay).toISOString(),
        auto: true,
      },
    ];
  }
  return [];
}

/** Vencimento efetivo da conta na competência em que ela está hoje. */
export function getCurrentDueDate(bill: Bill): Date {
  return buildDueDate(bill.month, bill.year, bill.dueDay);
}

/** Vencimento original — o que a conta tinha antes do primeiro adiamento. */
export function getOriginalDueDate(bill: Bill): Date {
  if (bill.originalDueDate) {
    const parsed = new Date(bill.originalDueDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const origin = getOriginMonthYear(bill);
  return buildDueDate(origin.month, origin.year, bill.dueDay);
}

export interface PostponeStatus {
  /** Quantas vezes a conta já foi empurrada */
  times: number;
  history: PostponeRecord[];
  /** true quando a conta chegou aqui vinda de outra competência */
  isCarried: boolean;
  originLabel: string;
  originalDueDate: Date;
  currentDueDate: Date;
  /** Data do último adiamento (null se nunca foi adiada) */
  lastPostponedAt: Date | null;
  /** O vencimento da competência atual já passou (vale para meses anteriores) */
  isOverdue: boolean;
  /**
   * A conta está atrasada em relação ao vencimento ORIGINAL. Continua true
   * mesmo depois de adiada para um mês futuro — é o atraso que acompanha a
   * dívida ao longo de toda a cadeia de adiamentos.
   */
  isLate: boolean;
  /** Dias corridos desde o vencimento original */
  daysLate: number;
  /** "há 1 mês e 4 dias" */
  overdueLabel: string;
}

/**
 * Consolida tudo que a interface precisa saber sobre o atraso e os adiamentos
 * de uma conta. A conta é considerada vencida quando o vencimento da
 * competência atual dela já passou — inclusive em meses anteriores, que antes
 * ficavam eternamente como "pendente".
 */
export function getPostponeStatus(bill: Bill, today: Date = startOfToday()): PostponeStatus {
  const history = getPostponeHistory(bill);
  const origin = getOriginMonthYear(bill);
  const currentDueDate = getCurrentDueDate(bill);
  const originalDueDate = getOriginalDueDate(bill);
  const isSettled = bill.status === 'paid' || bill.status === 'skipped';
  const daysLate = daysOverdue(originalDueDate, today);

  return {
    times: history.length,
    history,
    isCarried: history.length > 0,
    originLabel: `${getMonthName(origin.month)}/${origin.year}`,
    originalDueDate,
    currentDueDate,
    lastPostponedAt: bill.postponedAt ? new Date(bill.postponedAt) : null,
    isOverdue: !isSettled && daysOverdue(currentDueDate, today) > 0,
    isLate: !isSettled && daysLate > 0,
    daysLate,
    overdueLabel: formatOverdueSpan(daysLate),
  };
}

/** Linha compacta: "Adiada 3x • desde Mar/2026 • última em 05/06/2026". */
export function formatPostponeSummary(status: PostponeStatus): string {
  if (status.times === 0) return '';
  const parts = [`Adiada ${status.times}x`, `desde ${status.originLabel}`];
  if (status.lastPostponedAt) {
    parts.push(`última em ${formatDate(status.lastPostponedAt)}`);
  }
  return parts.join(' • ');
}

/**
 * Situação de uma parcela recorrente numa competência. Antes cada tela
 * recalculava isso na mão e todas repetiam o mesmo erro: só consideravam
 * atraso quando a competência era o mês corrente, então parcelas vencidas
 * em meses anteriores apareciam para sempre como "pendente".
 */
export interface RecurringStatus {
  applies: boolean;
  installmentNumber: number;
  status: 'paid' | 'pending' | 'overdue';
  dueDate: Date;
  daysLate: number;
  overdueLabel: string;
}

export function getRecurringStatusForMonth(
  debt: RecurringDebt,
  month: number,
  year: number,
  today: Date = startOfToday()
): RecurringStatus {
  const monthsSinceStart = (year - debt.startYear) * 12 + (month - debt.startMonth);
  const installmentNumber = monthsSinceStart + 1;
  const dueDate = buildDueDate(month, year, debt.dueDay);

  if (installmentNumber < 1 || installmentNumber > debt.totalInstallments) {
    return {
      applies: false,
      installmentNumber: 0,
      status: 'pending',
      dueDate,
      daysLate: 0,
      overdueLabel: '',
    };
  }

  const isPaid = debt.paidInstallments >= installmentNumber;
  const daysLate = isPaid ? 0 : daysOverdue(dueDate, today);

  return {
    applies: true,
    installmentNumber,
    status: isPaid ? 'paid' : daysLate > 0 ? 'overdue' : 'pending',
    dueDate,
    daysLate,
    overdueLabel: formatOverdueSpan(daysLate),
  };
}

export interface MonthlyBudget {
  /** Renda do mês (salário + rendas fixas + fundos extras) */
  income: number;
  /** O que já saiu da conta */
  paid: number;
  /** Tudo que o mês deve, pago ou não */
  due: number;
  /** Quanto ainda não saiu da conta: income - paid */
  available: number;
  /** Do que ainda não saiu, quanto já tem destino: due - paid */
  committed: number;
  /** O que sobra depois de honrar tudo: income - due. Negativo = falta */
  free: number;
  /** true quando as contas do mês passam da renda */
  isShort: boolean;
  /** Dias restantes no mês (0 quando a competência não é a atual) */
  daysLeft: number;
  /** Quanto dá para gastar por dia com o que sobra livre (0 se não sobra) */
  perDay: number;
}

/**
 * Separa duas perguntas que o painel misturava.
 *
 * "Saldo" (income - due) é uma projeção: o que vai sobrar SE tudo for pago.
 * Não responde a pergunta do dia a dia, que é quanto dinheiro ainda não saiu
 * da conta (income - paid). Os dois números convivem aqui para a diferença
 * ficar explícita.
 */
export function getMonthlyBudget(
  income: number,
  paid: number,
  due: number,
  month: number,
  year: number,
  today: Date = startOfToday()
): MonthlyBudget {
  const available = income - paid;
  const committed = Math.max(0, due - paid);
  const free = income - due;

  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const daysLeft = isCurrentMonth ? daysInMonth(month, year) - today.getDate() + 1 : 0;

  return {
    income,
    paid,
    due,
    available,
    committed,
    free,
    isShort: free < 0,
    daysLeft,
    perDay: daysLeft > 0 && free > 0 ? free / daysLeft : 0,
  };
}

/** Trilha detalhada, uma linha por adiamento, para o painel expandido. */
export function formatPostponeTimeline(status: PostponeStatus): string[] {
  return status.history.map((entry, index) => {
    const from = `${getMonthName(entry.fromMonth)}/${entry.fromYear}`;
    const to = `${getMonthName(entry.toMonth)}/${entry.toYear}`;
    const when = formatDate(entry.postponedAt);
    const how = entry.auto ? 'automático' : 'manual';
    return `${index + 1}. ${from} → ${to} · adiada em ${when} · venc. ${formatDate(entry.dueDate)} · ${how}`;
  });
}

/**
 * Uma parcela de dívida parcelada vista a partir de uma competência.
 * `isCarried` = parcela de um mês anterior que ainda não foi paga e por isso
 * aparece no mês vigente, como acontece com as contas adiadas.
 */
export interface InstallmentEntry {
  debt: RecurringDebt;
  installmentNumber: number;
  /** Competência a que a parcela pertence */
  month: number;
  year: number;
  dueDate: Date;
  status: 'paid' | 'pending' | 'overdue';
  daysLate: number;
  overdueLabel: string;
  isCarried: boolean;
  originLabel: string;
}

function installmentMonth(debt: RecurringDebt, installmentNumber: number): { month: number; year: number } {
  const index = debt.startYear * 12 + (debt.startMonth - 1) + installmentNumber - 1;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

function buildInstallmentEntry(
  debt: RecurringDebt,
  installmentNumber: number,
  isCarried: boolean,
  today: Date
): InstallmentEntry {
  const { month, year } = installmentMonth(debt, installmentNumber);
  const dueDate = buildDueDate(month, year, debt.dueDay);
  const isPaid = debt.paidInstallments >= installmentNumber;
  const daysLate = isPaid ? 0 : daysOverdue(dueDate, today);
  return {
    debt,
    installmentNumber,
    month,
    year,
    dueDate,
    status: isPaid ? 'paid' : daysLate > 0 ? 'overdue' : 'pending',
    daysLate,
    overdueLabel: formatOverdueSpan(daysLate),
    isCarried,
    originLabel: `${getMonthName(month)}/${year}`,
  };
}

/**
 * Parcelas que uma competência deve mostrar para uma dívida parcelada.
 *
 * É a regra que faz Contas e Dívidas contarem a mesma história. Se a aba
 * Dívidas diz "2 atrasadas", o mês vigente em Contas mostra as duas: a
 * parcela do próprio mês e a do mês anterior que ficou para trás — do mesmo
 * jeito que uma conta adiada aparece no mês de destino.
 *
 * Meses anteriores e futuros continuam mostrando só a parcela deles.
 *
 * `linkedMonths` são as competências ("2026-9") em que a parcela já virou
 * uma conta (pelo "Adiar" antigo); nelas quem representa a parcela é a conta.
 */
export function getInstallmentsForMonth(
  debt: RecurringDebt,
  month: number,
  year: number,
  linkedMonths: Set<string> = new Set(),
  today: Date = startOfToday()
): InstallmentEntry[] {
  const entries: InstallmentEntry[] = [];
  const target = (year - debt.startYear) * 12 + (month - debt.startMonth) + 1;
  const isCurrent = today.getFullYear() === year && today.getMonth() + 1 === month;

  if (isCurrent) {
    const lastPast = Math.min(target - 1, debt.totalInstallments);
    for (let n = debt.paidInstallments + 1; n <= lastPast; n++) {
      const when = installmentMonth(debt, n);
      if (linkedMonths.has(`${when.year}-${when.month}`)) continue;
      entries.push(buildInstallmentEntry(debt, n, true, today));
    }
  }

  if (target >= 1 && target <= debt.totalInstallments && !linkedMonths.has(`${year}-${month}`)) {
    entries.push(buildInstallmentEntry(debt, target, false, today));
  }
  return entries;
}

/**
 * Situação de uma dívida parcelada hoje: quantas parcelas já venceram sem
 * pagamento e se a do mês ainda está para vencer. Usa o vencimento real, não
 * só o mês — a parcela do dia 20 não está atrasada no dia 2.
 */
export function getRecurringBacklog(debt: RecurringDebt, today: Date = startOfToday()) {
  const entries = getInstallmentsForMonth(debt, today.getMonth() + 1, today.getFullYear(), new Set(), today)
    .filter((e) => e.status !== 'paid');
  const overdue = entries.filter((e) => e.status === 'overdue');
  return {
    overdue,
    overdueCount: overdue.length,
    overdueAmount: overdue.length * debt.installmentValue,
    dueThisMonth: entries.find((e) => e.status === 'pending'),
    oldest: overdue[0],
  };
}
