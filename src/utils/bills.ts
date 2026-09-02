import type { Bill, PostponeRecord } from '../types';
import {
  buildDueDate,
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
