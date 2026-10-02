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
  /**
   * Quantos meses depois do mês da conta ela vence. 0 (ou ausente) = vence
   * no próprio mês. Ex.: a conta de outubro que vence em 01/11 tem 1.
   */
  dueMonthOffset?: number;
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
  /**
   * Conta que chega todo mês (energia, água, internet, aluguel).
   *
   * Muda o significado do adiamento: numa conta avulsa, adiar move a mesma
   * dívida para frente. Numa conta mensal, a competência seguinte gera a
   * própria fatura de qualquer jeito — então a adiada se soma à nova, e
   * ficar três meses sem pagar significa dever três faturas.
   */
  isMonthly?: boolean;
  /**
   * Identifica todas as ocorrências da mesma conta mensal ao longo dos meses.
   * É o id da primeira ocorrência da série.
   */
  seriesId?: number;
  /**
   * Tipo da dívida. Quando ausente, é deduzido da descrição ("Enel" vira
   * energia, "Nubank" vira cartão). Define o risco de não pagar e os
   * encargos padrão por atraso.
   */
  category?: DebtCategory;
  /** Multa por atraso em %, cobrada uma vez. Ausente = sem multa */
  lateFeePercent?: number;
  /** Juros por atraso em % ao mês. Ausente = sem juros */
  monthlyInterestPercent?: number;
  /** Conta gerada por um empréstimo com agiota (juros do mês ou quitação) */
  loanId?: number;
  /** true na conta que registra a devolução do valor emprestado */
  loanPayoff?: boolean;
}

/**
 * Dinheiro pego com agiota (ou qualquer empréstimo informal só de juros).
 *
 * Todo mês, a partir do mês seguinte ao empréstimo, cobra-se o percentual
 * sobre o valor emprestado — sem abater nada dele. A dívida só termina
 * quando o valor cheio é devolvido.
 */
export interface InformalLoan {
  id?: number;
  /** "Agiota", ou o nome de quem emprestou */
  lender: string;
  /** Valor pego — e o valor que precisa ser devolvido para quitar */
  principal: number;
  /** Juros cobrados por mês sobre o valor pego, em % */
  monthlyRatePercent: number;
  /** Competência em que o dinheiro foi pego; a primeira cobrança é no mês seguinte */
  takenMonth: number;
  takenYear: number;
  /** Dia do mês em que os juros vencem */
  dueDay: number;
  status: 'active' | 'paid';
  /** Competência em que o valor cheio foi devolvido */
  paidOffMonth?: number;
  paidOffYear?: number;
  paidOffAt?: string;
  createdAt: string;
}

/**
 * Tipos de dívida que o assistente sabe tratar. Cada um carrega o risco de
 * ficar sem pagar (corte, despejo, negativação) e os encargos típicos.
 */
export type DebtCategory =
  | 'moradia'
  | 'energia'
  | 'agua'
  | 'gas'
  | 'pensao'
  | 'saude'
  | 'financiamento'
  | 'telecom'
  | 'educacao'
  | 'impostos'
  | 'cartao'
  | 'cheque_especial'
  | 'emprestimo'
  | 'assinatura'
  | 'pessoal'
  | 'outros';

export interface RecurringDebt {
  id?: number;
  description: string;
  /**
   * Número de parcelas. Ausente = dívida sem prazo definido: cobra todo mês
   * até ser encerrada.
   */
  totalInstallments?: number;
  paidInstallments: number;
  installmentValue: number;
  dueDay: number;
  startMonth: number;
  startYear: number;
  observation: string;
  isActive: boolean;
  category?: DebtCategory;
  lateFeePercent?: number;
  monthlyInterestPercent?: number;
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
  /**
   * Grupos de gasto escolhidos à mão na aba Gastos, por descrição de conta.
   * Lista (e não mapa) porque o Firestore restringe chaves de mapa.
   */
  spendingOverrides?: Array<{ keyword: string; group: string }>;
}

export type PriorityLevel = 'alta' | 'media' | 'baixa';

export interface PriorityItem {
  id?: number;
  keyword: string;
  level: PriorityLevel;
  /**
   * Conta tirada da lista de prioridades pelo usuário. Volta sozinha se uma
   * conta ou dívida com o mesmo nome for cadastrada de novo.
   */
  excluded?: boolean;
}

export interface MonthYear {
  month: number;
  year: number;
}
