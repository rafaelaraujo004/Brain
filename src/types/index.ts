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
