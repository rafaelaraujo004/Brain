import type { DebtCategory, PriorityLevel } from '../types';
import type { MonthlyBudget } from '../utils/bills';

/**
 * Uma dívida em aberto do ponto de vista do assistente: uma conta pendente
 * ou uma parcela vencida, já com risco e encargos resolvidos.
 */
export interface OpenDebt {
  /** "bill-12" para contas, "inst-3-7" para a 7ª parcela da dívida 3 */
  id: string;
  billId?: number;
  recurringDebtId?: number;
  installmentNumber?: number;
  description: string;
  /** Agrupa as faturas da mesma conta (série mensal ou mesma descrição) */
  groupKey: string;

  category: DebtCategory;
  categoryLabel: string;
  categoryAuto: boolean;
  risk: number;
  essential: boolean;
  consequence: string;
  lateFeePercent: number;
  monthlyInterestPercent: number;
  compound: boolean;
  customRates: boolean;

  /** Valor cadastrado (o mesmo que as outras telas somam) */
  amount: number;
  /** Encargos estimados até hoje (multa + juros). 0 se o valor foi informado */
  charges: number;
  /** amount + charges */
  updatedAmount: number;
  /** true quando o valor final foi editado à mão — não estimamos encargos */
  informedValue: boolean;
  /** Quanto a dívida cresce por mês parada */
  monthlyCost: number;
  /** Quanto custa empurrar esta conta mais um mês */
  postponeCost: number;

  originalDueDate: Date;
  daysLate: number;
  overdueLabel: string;
  originLabel: string;
  /** "2026-09", para agrupar por mês de origem */
  originKey: string;
  postponedTimes: number;
  /** Competência onde a conta está hoje */
  month: number;
  year: number;

  userLevel?: PriorityLevel;
}

export type DebtTier = 0 | 1 | 2 | 3;

export interface RankedDebt extends OpenDebt {
  /** 0 essencial · 1 cara · 2 demais · 3 marcada como baixa prioridade */
  tier: DebtTier;
  /** Por que está nessa posição, em uma frase curta */
  reason: string;
  /** Posição na fila, a partir de 1 */
  rank: number;
}

export interface DebtTotals {
  count: number;
  amount: number;
  charges: number;
  updatedAmount: number;
  monthlyCost: number;
  essentialCount: number;
  essentialAmount: number;
  /** Média dos juros mensais ponderada pelo valor de cada dívida */
  weightedRatePct: number;
  oldest?: RankedDebt;
}

export interface FinancialSnapshot {
  today: Date;
  /** Competência corrente */
  month: number;
  year: number;

  /** Salário + rendas fixas: o que entra todo mês */
  recurringIncome: number;
  /** recurringIncome + fundos extras deste mês */
  monthIncome: number;
  incomeConfigured: boolean;

  /** Contas do próprio mês (sem atrasos herdados) + parcelas do mês */
  fixedMonthly: number;
  fixedMonthlySource: 'current' | 'previous' | 'none';
  /** Parcelas de dívidas parceladas que caem todo mês */
  installmentsMonthly: number;
  /** recurringIncome - fixedMonthly: o que sobra por mês para atacar atrasos */
  surplus: number;

  /** Dívidas em atraso, já na ordem de prioridade */
  overdue: RankedDebt[];
  totals: DebtTotals;

  /** Contas deste mês que ainda não venceram */
  upcoming: OpenDebt[];
  monthBudget: MonthlyBudget;

  /** Quando o usuário mandou perguntar só sobre algumas dívidas */
  scoped: boolean;

  /** Empréstimos com agiota ainda não devolvidos */
  informalLoans: InformalLoanSummary[];
}

export interface InformalLoanSummary {
  id: number;
  lender: string;
  /** Valor pego — é o que precisa ser devolvido para acabar com os juros */
  principal: number;
  ratePct: number;
  /** Juros cobrados todo mês */
  monthlyInterest: number;
  /** "Setembro/2026" */
  takenLabel: string;
  /** Quanto já foi pago só de juros */
  interestPaid: number;
  /** Cobranças de juros em aberto (já contadas entre as dívidas) */
  pendingCharges: number;
  pendingAmount: number;
}

/* --- Respostas -------------------------------------------------------- */

export type Tone = 'good' | 'warn' | 'bad' | 'info';

export interface DebtLine {
  title: string;
  detail?: string;
  value?: string;
  tone?: Tone;
  tag?: string;
}

export type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'verdict'; tone: Tone; title: string; text?: string }
  | { kind: 'metrics'; items: Array<{ label: string; value: string; tone?: Tone; hint?: string }> }
  | { kind: 'debts'; title?: string; numbered?: boolean; items: DebtLine[]; footer?: string }
  | { kind: 'bullets'; title?: string; items: Array<{ text: string; tone?: Tone }> }
  | { kind: 'table'; title?: string; columns: string[]; rows: string[][]; highlightRow?: number }
  | { kind: 'note'; title: string; items: string[] };

export type Intent =
  | 'loan'
  | 'what_to_pay'
  | 'how_many'
  | 'total'
  | 'payoff_time'
  | 'budget'
  | 'postpone'
  | 'cost'
  | 'renegotiate'
  | 'diagnosis'
  | 'compare'
  | 'help'
  | 'greeting'
  | 'thanks'
  | 'unknown';

export interface QuestionParams {
  /** Valor do empréstimo */
  principal?: number;
  /** Parcela mensal (do empréstimo ou do quanto quer guardar) */
  monthly?: number;
  /** Número de parcelas / meses */
  months?: number;
  /** Juros em % ao mês */
  ratePct?: number;
  /** Valor solto: "tenho 800", "com 3 mil" */
  amount?: number;
  /** Empréstimo só de juros (agiota): paga o percentual todo mês e devolve tudo no fim */
  interestOnly?: boolean;
}

export interface ConversationContext {
  intent: Intent;
  params: QuestionParams;
}

export interface Answer {
  intent: Intent;
  blocks: AnswerBlock[];
  followUps: string[];
  context: ConversationContext;
}
