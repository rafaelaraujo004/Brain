export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Lê um valor digitado em reais: "5.000", "5.000,50", "150,5", "150.5",
 * "R$ 1.200". Ponto seguido de 3 dígitos é milhar; vírgula é decimal.
 */
export function parseMoneyInput(raw: string): number {
  const cleaned = raw.trim().replace(/\s|R\$/g, '');
  if (!cleaned) return 0;
  const normalized =
    /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned) || cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

export function getMonthName(month: number): string {
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return months[month - 1] || '';
}

export function getShortMonthName(month: number): string {
  const months = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ];
  return months[month - 1] || '';
}

export function getCurrentMonthYear() {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

/** Ultimo dia valido do mes, para nao gerar 31/02. */
export function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Monta a data de vencimento de uma competencia, limitando o dia ao
 * ultimo dia do mes (ex.: dia 31 em fevereiro vira 28/29).
 */
export function buildDueDate(month: number, year: number, dueDay: number): Date {
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(month, year));
  return new Date(year, month - 1, day);
}

/**
 * Vencimento de uma conta da competência (month, year) que vence
 * `offset` meses depois: a conta de outubro com vencimento em 01/11 tem
 * offset 1.
 */
export function buildBillDueDate(month: number, year: number, dueDay: number, offset = 0): Date {
  const index = year * 12 + (month - 1) + offset;
  return buildDueDate((index % 12) + 1, Math.floor(index / 12), dueDay);
}

/** Date → "2026-11-01", o formato do campo de data. */
export function toInputDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** "2026-11-01" → { day: 1, month: 11, year: 2026 }; null se incompleta. */
export function parseInputDate(value: string): { day: number; month: number; year: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
}

/** Meia-noite de hoje, para comparacoes de vencimento sem ruido de horario. */
export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Formata uma data ISO (ou Date) como dd/mm/aaaa. */
export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

/** Formata uma data ISO como dd/mm (para linhas compactas). */
export function formatDateShort(value: string | Date | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Dias corridos de atraso em relacao a hoje (0 quando ainda nao venceu). */
export function daysOverdue(dueDate: Date, reference: Date = startOfToday()): number {
  const diff = reference.getTime() - dueDate.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86400000);
}

/** "há 3 dias" / "há 1 mês e 5 dias" — texto curto para o cartao da conta. */
export function formatOverdueSpan(days: number): string {
  if (days <= 0) return '';
  if (days === 1) return 'há 1 dia';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  const monthLabel = months === 1 ? '1 mês' : `${months} meses`;
  if (rest === 0) return `há ${monthLabel}`;
  const restLabel = rest === 1 ? '1 dia' : `${rest} dias`;
  return `há ${monthLabel} e ${restLabel}`;
}

export function calculateEndDate(
  startMonth: number,
  startYear: number,
  totalInstallments: number
): { month: number; year: number } {
  let endMonth = startMonth + totalInstallments - 1;
  let endYear = startYear;

  while (endMonth > 12) {
    endMonth -= 12;
    endYear++;
  }

  return { month: endMonth, year: endYear };
}

export function getInstallmentStatus(
  dueDay: number,
  currentMonth: number,
  currentYear: number,
  startMonth: number,
  startYear: number,
  paidInstallments: number,
  totalInstallments: number
): 'paid' | 'pending' | 'overdue' {
  const monthsSinceStart = (currentYear - startYear) * 12 + (currentMonth - startMonth);
  const expectedInstallment = monthsSinceStart + 1;

  if (expectedInstallment > totalInstallments) return 'paid';
  if (paidInstallments >= expectedInstallment) return 'paid';

  const today = new Date();
  if (
    today.getFullYear() === currentYear &&
    today.getMonth() + 1 === currentMonth &&
    today.getDate() > dueDay &&
    paidInstallments < expectedInstallment
  ) {
    return 'overdue';
  }

  return 'pending';
}
