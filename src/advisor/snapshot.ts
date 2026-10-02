import type {
  AppSettings,
  Bill,
  ExtraFund,
  IncomeSource,
  InformalLoan,
  MonthlyConfig,
  PriorityItem,
  RecurringDebt,
} from '../types';
import { buildDueDate, daysOverdue, formatOverdueSpan, getMonthName, startOfToday } from '../utils/formatters';
import {
  getMonthlyBudget,
  getOriginMonthYear,
  getPostponeStatus,
  getRecurringStatusForMonth,
  installmentFraction,
  installmentLimit,
} from '../utils/bills';
import { resolveCostProfile, type CostProfile } from './categories';
import { cents } from './money';
import { computeTotals, rankDebts } from './strategy';
import type { FinancialSnapshot, InformalLoanSummary, OpenDebt } from './types';
import { normalize } from './text';

export interface RawFinancialData {
  bills: Bill[];
  recurringDebts: RecurringDebt[];
  priorities: PriorityItem[];
  settings?: AppSettings;
  monthlyConfigs: MonthlyConfig[];
  extraFunds: ExtraFund[];
  incomeSources: IncomeSource[];
  loans?: InformalLoan[];
}

/**
 * Encargos acumulados de uma dívida vencida há `daysLate` dias: multa uma
 * vez, mais juros proporcionais ao tempo — compostos para crédito, simples
 * para contas de consumo.
 */
export function estimateCharges(amount: number, profile: CostProfile, daysLate: number): number {
  if (daysLate <= 0 || amount <= 0) return 0;
  const months = daysLate / 30;
  const fee = amount * (profile.lateFeePercent / 100);
  const rate = profile.monthlyInterestPercent / 100;
  const interest = profile.compound
    ? amount * (Math.pow(1 + rate, months) - 1)
    : amount * rate * months;
  return cents(fee + interest);
}

function competenceKey(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function addMonths(month: number, year: number, delta: number): { month: number; year: number } {
  const index = year * 12 + (month - 1) + delta;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

function buildDebt(params: {
  id: string;
  description: string;
  groupKey: string;
  profile: CostProfile;
  amount: number;
  informedValue: boolean;
  originalDueDate: Date;
  originMonth: number;
  originYear: number;
  postponedTimes: number;
  month: number;
  year: number;
  today: Date;
  userLevel?: OpenDebt['userLevel'];
  billId?: number;
  recurringDebtId?: number;
  installmentNumber?: number;
}): OpenDebt {
  const { profile, amount, today } = params;
  const daysLate = daysOverdue(params.originalDueDate, today);
  const charges = params.informedValue ? 0 : estimateCharges(amount, profile, daysLate);
  const updatedAmount = cents(amount + charges);
  const rate = profile.monthlyInterestPercent / 100;
  const monthlyCost = cents((profile.compound ? updatedAmount : amount) * rate);
  const postponeCost = daysLate > 0
    ? monthlyCost
    : cents(amount * (profile.lateFeePercent / 100 + rate));

  return {
    id: params.id,
    billId: params.billId,
    recurringDebtId: params.recurringDebtId,
    installmentNumber: params.installmentNumber,
    description: params.description,
    groupKey: params.groupKey,
    category: profile.category,
    categoryLabel: profile.label,
    categoryAuto: profile.categoryAuto,
    risk: profile.risk,
    essential: profile.essential,
    consequence: profile.consequence,
    lateFeePercent: profile.lateFeePercent,
    monthlyInterestPercent: profile.monthlyInterestPercent,
    compound: profile.compound,
    customRates: profile.customRates,
    amount: cents(amount),
    charges,
    updatedAmount,
    informedValue: params.informedValue,
    monthlyCost,
    postponeCost,
    originalDueDate: params.originalDueDate,
    daysLate,
    overdueLabel: formatOverdueSpan(daysLate),
    originLabel: `${getMonthName(params.originMonth)}/${params.originYear}`,
    originKey: competenceKey(params.originMonth, params.originYear),
    postponedTimes: params.postponedTimes,
    month: params.month,
    year: params.year,
    userLevel: params.userLevel,
  };
}

function billToDebt(bill: Bill, today: Date, levels: Map<string, OpenDebt['userLevel']>): OpenDebt {
  const description = bill.originalDescription ?? bill.description;
  const status = getPostponeStatus(bill, today);
  const origin = getOriginMonthYear(bill);
  return buildDebt({
    id: `bill-${bill.id}`,
    billId: bill.id,
    recurringDebtId: bill.recurringDebtId,
    description,
    groupKey:
      bill.loanId !== undefined
        ? `loan-${bill.loanId}`
        : bill.seriesId
        ? `series-${bill.seriesId}`
        : `desc-${normalize(description)}`,
    // Juros de agiota vão para a frente da fila: atrasar com agiota não
    // gera só juros, gera cobrança pesada.
    profile:
      bill.loanId !== undefined
        ? {
            ...resolveCostProfile(bill),
            label: 'Agiota',
            risk: 8,
            essential: true,
            consequence: 'atrasar com agiota costuma trazer cobrança pesada',
          }
        : resolveCostProfile(bill),
    amount: bill.finalValue,
    // Valor final diferente do inicial = o usuário já atualizou o valor da
    // dívida à mão (com juros, ou com desconto negociado). Somar encargos
    // estimados por cima contaria duas vezes.
    informedValue: Math.abs(bill.finalValue - bill.initialValue) > 0.005,
    originalDueDate: status.originalDueDate,
    originMonth: origin.month,
    originYear: origin.year,
    postponedTimes: status.times,
    month: bill.month,
    year: bill.year,
    today,
    userLevel: levels.get(normalize(description)) ?? levels.get(description.toLowerCase()),
  });
}

/**
 * Monta o retrato financeiro que o assistente usa para responder. Função
 * pura: recebe o conteúdo do banco e a data de hoje, o que permite testar
 * qualquer cenário sem IndexedDB.
 */
export function buildSnapshot(data: RawFinancialData, today: Date = startOfToday()): FinancialSnapshot {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const levels = new Map<string, OpenDebt['userLevel']>();
  for (const p of data.priorities) {
    levels.set(p.keyword, p.level);
    levels.set(normalize(p.keyword), p.level);
  }

  /* --- Renda -------------------------------------------------------- */
  const config = data.monthlyConfigs.find((c) => c.month === month && c.year === year);
  const salary = config?.salary ?? data.settings?.defaultSalary ?? 0;
  const fixedIncome = data.incomeSources.filter((i) => i.isActive).reduce((s, i) => s + i.value, 0);
  const extras = data.extraFunds
    .filter((f) => f.month === month && f.year === year)
    .reduce((s, f) => s + f.value, 0);
  const recurringIncome = salary + fixedIncome;
  const monthIncome = recurringIncome + extras;

  /* --- Dívidas em atraso -------------------------------------------- */
  const overdue: OpenDebt[] = [];
  const upcoming: OpenDebt[] = [];

  for (const bill of data.bills) {
    if (bill.status !== 'pending' || !bill.id) continue;
    const debt = billToDebt(bill, today, levels);
    if (debt.daysLate > 0) overdue.push(debt);
    else if (bill.month === month && bill.year === year) upcoming.push(debt);
  }

  // Parcelas vencidas que nunca viraram conta. Quando uma parcela é adiada
  // ela vira uma conta (já contada acima), então só entram aqui as que
  // ficaram para trás sem ninguém mexer.
  for (const debt of data.recurringDebts) {
    if (!debt.id || debt.paidInstallments >= installmentLimit(debt)) continue;
    const profile = resolveCostProfile(debt);

    // Sem número de parcelas o laço só termina no mês corrente (break abaixo).
    for (let n = debt.paidInstallments + 1; n <= installmentLimit(debt); n++) {
      const when = addMonths(debt.startMonth, debt.startYear, n - 1);
      const dueDate = buildDueDate(when.month, when.year, debt.dueDay);
      const hasBill = data.bills.some(
        (b) => b.recurringDebtId === debt.id && b.month === when.month && b.year === when.year
      );
      if (hasBill) continue;

      const isPast = daysOverdue(dueDate, today) > 0;
      const isThisMonth = when.month === month && when.year === year;
      if (!isPast && !isThisMonth) break;

      const entry = buildDebt({
        id: `inst-${debt.id}-${n}`,
        recurringDebtId: debt.id,
        installmentNumber: n,
        description: `${debt.description} (${installmentFraction(debt, n)})`,
        groupKey: `recurring-${debt.id}`,
        profile,
        amount: debt.installmentValue,
        informedValue: false,
        originalDueDate: dueDate,
        originMonth: when.month,
        originYear: when.year,
        postponedTimes: 0,
        month: when.month,
        year: when.year,
        today,
        userLevel: levels.get(normalize(debt.description)) ?? levels.get(debt.description.toLowerCase()),
      });
      if (isPast) overdue.push(entry);
      else upcoming.push(entry);
    }
  }

  const ranked = rankDebts(overdue);

  /* --- Agiota ------------------------------------------------------- */
  const informalLoans: InformalLoanSummary[] = (data.loans ?? [])
    .filter((loan) => loan.status === 'active' && loan.id !== undefined)
    .map((loan) => {
      const charges = data.bills.filter((b) => b.loanId === loan.id && !b.loanPayoff);
      const pending = charges.filter((b) => b.status === 'pending');
      return {
        id: loan.id as number,
        lender: loan.lender,
        principal: loan.principal,
        ratePct: loan.monthlyRatePercent,
        monthlyInterest: cents((loan.principal * loan.monthlyRatePercent) / 100),
        takenLabel: `${getMonthName(loan.takenMonth)}/${loan.takenYear}`,
        interestPaid: cents(charges.filter((b) => b.status === 'paid').reduce((s, b) => s + b.finalValue, 0)),
        pendingCharges: pending.length,
        pendingAmount: cents(pending.reduce((s, b) => s + b.finalValue, 0)),
      };
    });

  /* --- Contas fixas do mês ------------------------------------------ */
  // O que o mês cobra por si só: as contas cuja competência de origem é a
  // do mês (não as herdadas de meses anteriores) e as parcelas do mês. É a
  // melhor estimativa do que vai se repetir nos meses seguintes.
  const ownObligations = (m: number, y: number) => {
    const bills = data.bills.filter((b) => {
      if (b.month !== m || b.year !== y || b.status === 'skipped') return false;
      const origin = getOriginMonthYear(b);
      return origin.month === m && origin.year === y;
    });
    let total = bills.reduce((s, b) => s + b.finalValue, 0);
    let installments = 0;
    for (const debt of data.recurringDebts) {
      if (!getRecurringStatusForMonth(debt, m, y, today).applies) continue;
      installments += debt.installmentValue;
      // Parcela que já virou conta neste mês já foi somada como conta.
      if (!bills.some((b) => b.recurringDebtId === debt.id)) total += debt.installmentValue;
    }
    return { total, installments };
  };

  let fixed = ownObligations(month, year);
  let fixedMonthlySource: FinancialSnapshot['fixedMonthlySource'] = 'current';
  if (fixed.total <= 0) {
    const prev = addMonths(month, year, -1);
    fixed = ownObligations(prev.month, prev.year);
    fixedMonthlySource = fixed.total > 0 ? 'previous' : 'none';
  }

  /* --- Orçamento do mês corrente ------------------------------------ */
  const monthBills = data.bills.filter((b) => b.month === month && b.year === year && b.status !== 'skipped');
  let due = monthBills.reduce((s, b) => s + b.finalValue, 0);
  let paid = monthBills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.finalValue, 0);
  for (const debt of data.recurringDebts) {
    if (!debt.isActive) continue;
    const status = getRecurringStatusForMonth(debt, month, year, today);
    if (!status.applies) continue;
    if (monthBills.some((b) => b.recurringDebtId === debt.id)) continue;
    due += debt.installmentValue;
    if (status.status === 'paid') paid += debt.installmentValue;
  }

  return {
    today,
    month,
    year,
    recurringIncome: cents(recurringIncome),
    monthIncome: cents(monthIncome),
    incomeConfigured: recurringIncome > 0,
    fixedMonthly: cents(fixed.total),
    fixedMonthlySource,
    installmentsMonthly: cents(fixed.installments),
    surplus: cents(recurringIncome - fixed.total),
    overdue: ranked,
    totals: computeTotals(ranked),
    upcoming,
    monthBudget: getMonthlyBudget(monthIncome, paid, due, month, year, today),
    scoped: false,
    informalLoans,
  };
}

/** Restringe o retrato a algumas dívidas ("pergunte sobre as selecionadas"). */
export function scopeSnapshot(snapshot: FinancialSnapshot, ids: string[]): FinancialSnapshot {
  if (ids.length === 0) return snapshot;
  const wanted = new Set(ids);
  const overdue = rankDebts(snapshot.overdue.filter((d) => wanted.has(d.id)));
  return { ...snapshot, overdue, totals: computeTotals(overdue), scoped: true };
}
