import type { AppSettings, Bill, ExtraFund, IncomeSource, MonthlyConfig, RecurringDebt } from '../types';
import { getCurrentDueDate, installmentLimit } from '../utils/bills';
import { buildDueDate, startOfToday } from '../utils/formatters';
import { inferSpendingGroup, spendingKey, SPENDING_GROUPS, type SpendingGroup } from './groups';

export interface SpendingOverride {
  /** spendingKey da descrição */
  keyword: string;
  group: SpendingGroup;
}

export interface SpendingItem {
  /** "bill-12" ou "inst-3-5" */
  key: string;
  description: string;
  /** Chave usada para reclassificar todas as ocorrências da mesma conta */
  ruleKey: string;
  group: SpendingGroup;
  /** true quando o usuário escolheu o grupo na aba Gastos */
  manual: boolean;
  amount: number;
  status: 'paid' | 'open';
  month: number;
  year: number;
  dueDate: Date;
  kind: 'conta' | 'parcela';
}

export interface SpendingGroupSummary {
  group: SpendingGroup;
  label: string;
  paid: number;
  open: number;
  /** paid + open: quanto o grupo custa se tudo for pago */
  projected: number;
  items: SpendingItem[];
}

export interface SpendingRange {
  /** Índice de competência: ano × 12 + (mês − 1) */
  from: number;
  to: number;
}

export interface SpendingReport {
  range: SpendingRange;
  items: SpendingItem[];
  groups: SpendingGroupSummary[];
  paid: number;
  open: number;
  projected: number;
  /** Renda dos meses do período até hoje (0 quando não cadastrada) */
  income: number;
  /** Quantos meses do período já começaram — para médias mensais */
  elapsedMonths: number;
}

export interface SpendingData {
  bills: Bill[];
  recurringDebts: RecurringDebt[];
  settings?: AppSettings;
  monthlyConfigs: MonthlyConfig[];
  extraFunds: ExtraFund[];
  incomeSources: IncomeSource[];
}

export function monthIndex(month: number, year: number): number {
  return year * 12 + (month - 1);
}

function fromIndex(index: number): { month: number; year: number } {
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

/** Período "tudo": do primeiro ao último mês com algum lançamento, incluindo o atual. */
export function wholeRange(data: SpendingData, today: Date = startOfToday()): SpendingRange {
  const current = monthIndex(today.getMonth() + 1, today.getFullYear());
  let from = current;
  let to = current;
  for (const bill of data.bills) {
    const index = monthIndex(bill.month, bill.year);
    from = Math.min(from, index);
    to = Math.max(to, index);
  }
  for (const debt of data.recurringDebts) {
    from = Math.min(from, monthIndex(debt.startMonth, debt.startYear));
  }
  return { from, to };
}

/**
 * Junta tudo que é gasto num período: contas e parcelas de dívidas, cada uma
 * com seu grupo e situação.
 *
 * - Pago: conta marcada como paga, ou parcela já contada como paga na dívida.
 * - Em aberto: conta pendente, ou parcela ainda não paga do período.
 * - Contas adiadas (o registro que ficou para trás) não entram: a dívida
 *   continua viva no mês para onde foi, e é lá que ela conta.
 *
 * Cada lançamento pertence ao mês dele, então um período de vários meses
 * soma cada coisa uma vez só.
 */
export function collectSpending(
  data: SpendingData,
  range: SpendingRange,
  overrides: SpendingOverride[] = [],
  today: Date = startOfToday()
): SpendingReport {
  const manual = new Map(overrides.map((o) => [o.keyword, o.group]));
  const items: SpendingItem[] = [];

  const classify = (description: string, category?: Bill['category']) => {
    const ruleKey = spendingKey(description);
    const chosen = manual.get(ruleKey);
    return {
      ruleKey,
      group: chosen ?? inferSpendingGroup(description, category),
      manual: chosen !== undefined,
    };
  };

  for (const bill of data.bills) {
    if (bill.status === 'skipped') continue;
    const index = monthIndex(bill.month, bill.year);
    if (index < range.from || index > range.to) continue;
    const description = bill.originalDescription ?? bill.description;
    items.push({
      key: `bill-${bill.id}`,
      description,
      ...classify(description, bill.category),
      amount: bill.finalValue,
      status: bill.status === 'paid' ? 'paid' : 'open',
      month: bill.month,
      year: bill.year,
      dueDate: getCurrentDueDate(bill),
      kind: 'conta',
    });
  }

  for (const debt of data.recurringDebts) {
    if (!debt.id) continue;
    // Parcela que virou conta (pelo "Adiar" de parcela) já está entre as contas.
    const linked = new Set(
      data.bills.filter((b) => b.recurringDebtId === debt.id).map((b) => monthIndex(b.month, b.year))
    );
    const start = monthIndex(debt.startMonth, debt.startYear);
    const limit = installmentLimit(debt);
    const firstNumber = Math.max(1, range.from - start + 1);
    const lastNumber = Math.min(limit, range.to - start + 1);
    const { ruleKey, group, manual: isManual } = classify(debt.description, debt.category);

    for (let n = firstNumber; n <= lastNumber; n++) {
      const index = start + n - 1;
      if (linked.has(index)) continue;
      const when = fromIndex(index);
      items.push({
        key: `inst-${debt.id}-${n}`,
        description: debt.description,
        ruleKey,
        group,
        manual: isManual,
        amount: debt.installmentValue,
        status: n <= debt.paidInstallments ? 'paid' : 'open',
        month: when.month,
        year: when.year,
        dueDate: buildDueDate(when.month, when.year, debt.dueDay),
        kind: 'parcela',
      });
    }
  }

  const byGroup = new Map<SpendingGroup, SpendingGroupSummary>();
  for (const item of items) {
    const summary =
      byGroup.get(item.group) ??
      { group: item.group, label: SPENDING_GROUPS[item.group].label, paid: 0, open: 0, projected: 0, items: [] };
    if (item.status === 'paid') summary.paid += item.amount;
    else summary.open += item.amount;
    summary.projected += item.amount;
    summary.items.push(item);
    byGroup.set(item.group, summary);
  }
  for (const summary of byGroup.values()) {
    summary.items.sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
  }

  // Renda dos meses do período que já começaram.
  const current = monthIndex(today.getMonth() + 1, today.getFullYear());
  const fixedIncome = data.incomeSources.filter((i) => i.isActive).reduce((s, i) => s + i.value, 0);
  let income = 0;
  let elapsedMonths = 0;
  for (let index = range.from; index <= Math.min(range.to, current); index++) {
    const { month, year } = fromIndex(index);
    const salary =
      data.monthlyConfigs.find((c) => c.month === month && c.year === year)?.salary ??
      data.settings?.defaultSalary ??
      0;
    const extras = data.extraFunds
      .filter((f) => f.month === month && f.year === year)
      .reduce((s, f) => s + f.value, 0);
    income += salary + fixedIncome + extras;
    elapsedMonths++;
  }

  const groups = [...byGroup.values()];
  const paid = groups.reduce((s, g) => s + g.paid, 0);
  const open = groups.reduce((s, g) => s + g.open, 0);
  return { range, items, groups, paid, open, projected: paid + open, income, elapsedMonths };
}
