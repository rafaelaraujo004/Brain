import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { db, getOrCreateSettings } from '../db/database';
import { formatCurrency, getShortMonthName } from '../utils/formatters';
import type { Bill, ExtraFund, IncomeSource, MonthlyConfig, RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';

interface MonthlyResult {
  month: number;
  year: number;
  label: string;
  totalIncome: number;
  totalDue: number;
  difference: number;
}

function getRecentMonths(count = 12): { month: number; year: number }[] {
  const now = new Date();
  const result: { month: number; year: number }[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  return result;
}

function recurringAppliesToMonth(debt: RecurringDebt, month: number, year: number): boolean {
  const monthsSinceStart = (year - debt.startYear) * 12 + (month - debt.startMonth);
  const installmentNumber = monthsSinceStart + 1;
  return installmentNumber >= 1 && installmentNumber <= debt.totalInstallments;
}

function calculateMonthlyResult(
  month: number,
  year: number,
  bills: Bill[],
  recurringDebts: RecurringDebt[],
  extraFunds: ExtraFund[],
  incomeSources: IncomeSource[],
  monthlyConfigs: MonthlyConfig[],
  defaultSalary: number
): MonthlyResult {
  const billsOfMonth = bills.filter((b) => b.month === month && b.year === year && b.status !== 'skipped');
  const billDue = billsOfMonth.reduce((sum, b) => sum + b.finalValue, 0);

  const recurringDue = recurringDebts.reduce((sum, debt) => {
    if (!debt.isActive && debt.paidInstallments >= debt.totalInstallments) return sum;
    if (!recurringAppliesToMonth(debt, month, year)) return sum;

    // Avoid duplicate amount when month already has a linked bill from this recurring debt.
    const hasLinkedBill = billsOfMonth.some((b) => b.recurringDebtId === debt.id);
    if (hasLinkedBill) return sum;

    return sum + debt.installmentValue;
  }, 0);

  const totalDue = billDue + recurringDue;
  const totalExtra = extraFunds
    .filter((f) => f.month === month && f.year === year)
    .reduce((sum, f) => sum + f.value, 0);

  const totalIncomeSources = incomeSources
    .filter((i) => i.isActive)
    .reduce((sum, i) => sum + i.value, 0);

  const monthSalary = monthlyConfigs.find((m) => m.month === month && m.year === year)?.salary;
  const totalIncome = (monthSalary ?? defaultSalary) + totalExtra + totalIncomeSources;

  return {
    month,
    year,
    label: `${getShortMonthName(month)}/${year}`,
    totalIncome,
    totalDue,
    difference: totalIncome - totalDue,
  };
}

export function MonthlyAnalysis() {
  const analysis = useLiveQuery(async () => {
    const [bills, recurringDebts, extraFunds, incomeSources, monthlyConfigs, settings] = await Promise.all([
      db.bills.toArray(),
      db.recurringDebts.toArray(),
      db.extraFunds.toArray(),
      db.incomeSources.toArray(),
      db.monthlyConfigs.toArray(),
      getOrCreateSettings(),
    ]);

    const months = getRecentMonths(12);
    const rows = months.map(({ month, year }) =>
      calculateMonthlyResult(month, year, bills, recurringDebts, extraFunds, incomeSources, monthlyConfigs, settings.defaultSalary)
    );

    const negativeMonths = rows.filter((r) => r.difference < 0);
    const worstMonth = rows.reduce((acc, item) => (item.difference < acc.difference ? item : acc), rows[0]);
    const bestMonth = rows.reduce((acc, item) => (item.difference > acc.difference ? item : acc), rows[0]);

    return { rows, negativeMonths, worstMonth, bestMonth };
  }, []);

  if (!analysis) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Análise Mensal</h1>
        <HelpButton
          title="Como usar a Análise"
          items={[
            { icon: '📅', title: 'Últimos 12 meses', description: 'A análise compara automaticamente receita vs despesas dos últimos 12 meses.' },
            { icon: '🔴', title: 'Meses no vermelho', description: 'Mostra quantos meses as despesas superaram a receita.' },
            { icon: '📉', title: 'Pior/Melhor mês', description: 'Identifica o mês com maior déficit e o melhor saldo.' },
            { icon: '📊', title: 'Barras de progresso', description: 'Em cada mês, a barra verde mostra a receita e a vermelha as despesas, para comparação visual.' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card">
          <div className="flex items-center gap-2 mb-1 text-[var(--color-danger)]">
            <AlertTriangle size={16} />
            <span className="text-sm font-semibold">Meses no vermelho</span>
          </div>
          <p className="text-2xl font-bold">{analysis.negativeMonths.length}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">nos últimos 12 meses</p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-1 text-[var(--color-danger)]">
            <TrendingDown size={16} />
            <span className="text-sm font-semibold">Pior mês</span>
          </div>
          <p className="text-sm font-bold">{analysis.worstMonth.label}</p>
          <p className="text-base font-bold text-[var(--color-danger)]">{formatCurrency(analysis.worstMonth.difference)}</p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-1 text-[var(--color-success)]">
            <TrendingUp size={16} />
            <span className="text-sm font-semibold">Melhor mês</span>
          </div>
          <p className="text-sm font-bold">{analysis.bestMonth.label}</p>
          <p className="text-base font-bold text-[var(--color-success)]">{formatCurrency(analysis.bestMonth.difference)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {analysis.rows.map((row) => {
          const ratio = row.totalIncome > 0 ? Math.min(100, Math.round((row.totalDue / row.totalIncome) * 100)) : 100;
          const overBudget = row.difference < 0;

          return (
            <div key={`${row.month}-${row.year}`} className="card">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold">{row.label}</h3>
                <span className={overBudget ? 'badge-overdue' : 'badge-paid'}>
                  {overBudget ? 'Acima da renda' : 'Dentro da renda'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">Receita</p>
                  <p className="font-semibold text-[var(--color-primary)]">{formatCurrency(row.totalIncome)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">Devido</p>
                  <p className="font-semibold">{formatCurrency(row.totalDue)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">Saldo</p>
                  <p className={`font-semibold ${overBudget ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>
                    {formatCurrency(row.difference)}
                  </p>
                </div>
              </div>

              <div className="w-full h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${overBudget ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]'}`}
                  style={{ width: `${ratio}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {row.totalIncome > 0 ? `${ratio}% da receita comprometida` : 'Sem receita cadastrada'}
              </div>
            </div>
          );
        })}
      </div>

      {analysis.negativeMonths.length === 0 && (
        <div className="card flex items-center gap-2 text-[var(--color-success)]">
          <CheckCircle2 size={18} />
          <span className="text-sm font-semibold">Você ficou dentro da renda em todos os últimos 12 meses.</span>
        </div>
      )}
    </div>
  );
}