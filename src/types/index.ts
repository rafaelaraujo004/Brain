/**
 * Registro de um adiamento. Cada vez que uma conta é postergada uma entrada é
 * acrescentada ao histórico e carregada para a competência seguinte, de modo
 * que a conta sempre saiba desde quando está sendo empurrada e em que data
 * cada adiamento aconteceu.
 */
export interface PostponeRecord {
  /** Competência de onde a conta saiu */
  fromMonth: number;
  fromYear: number;
  /** Competência para onde a conta foi */
  toMonth: number;
  toYear: number;
  /** Data em que o adiamento foi registrado (ISO) */
  postponedAt: string;
  /** Vencimento que ficou para trás neste adiamento (ISO) */
  dueDate: string;
  /** true quando gerado pelo carry-over automático da virada de mês */
  auto?: boolean;
}

export interface Bill {
  id?: number;
  description: string;
  originalDescription?: string;
  initialValue: number;
  finalValue: number;
  status: 'pending' | 'paid' | 'skipped';
  dueDay: number;
  observation: string;
  month: number;
  year: number;
  recurringDebtId?: number;
  carriedFromBillId?: number;
  carriedFromMonth?: number;
  carriedFromYear?: number;
  /** Competência original, preservada por toda a cadeia de adiamentos */
  originMonth?: number;
  originYear?: number;
  /** Vencimento original (ISO), antes de qualquer adiamento */
  originalDueDate?: string;
  /** Data do último adiamento (ISO) */
  postponedAt?: string;
  /** Histórico completo de adiamentos, do mais antigo ao mais recente */
  postponeHistory?: PostponeRecord[];
}

export interface RecurringDebt {
  id?: number;
  description: string;
  totalInstallments: number;
  paidInstallments: number;
  installmentValue: number;
  dueDay: number;
  startMonth: number;
  startYear: number;
  observation: string;
  isActive: boolean;
}

export interface ExtraFund {
  id?: number;
  month: number;
  year: number;
  description: string;
  value: number;
}

export interface MonthlyConfig {
  id?: number;
  month: number;
  year: number;
  salary: number;
}

export interface IncomeSource {
  id?: number;
  description: string;
  value: number;
  isActive: boolean;
}

export interface AppSettings {
  id?: number;
  theme: 'dark' | 'light';
  defaultSalary: number;
  avatarDataUrl?: string;
}

export type PriorityLevel = 'alta' | 'media' | 'baixa';

export interface PriorityItem {
  id?: number;
  keyword: string;
  level: PriorityLevel;
}

export interface MonthYear {
  month: number;
  year: number;
}
