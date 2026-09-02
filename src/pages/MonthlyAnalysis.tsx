import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { db, getOrCreateSettings } from '../db/database';
import { formatCurrency, getShortMonthName } from '../utils/formatters';
import type { Bill, ExtraFund, IncomeSource, MonthlyConfig, RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';
import { PageSpinner } from '../components/PageSpinner';

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

  if (!analysis) return <PageSpinner label="Analisando os últimos 12 meses" />;

  // Escala comum a todos os meses: as barras só são comparáveis entre si se
  // dividirem o mesmo teto.
  const scale = Math.max(
    ...analysis.rows.map((r) => Math.max(r.totalIncome, r.totalDue)),
    1
  );

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center justify-between gap-2 pt-1">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Análise mensal</h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Receita contra despesas nos últimos 12 meses
          </p>
        </div>
        <HelpButton
          title="Como usar a Análise"
          items={[
            { icon: '📅', title: 'Últimos 12 meses', description: 'A análise compara automaticamente receita vs despesas dos últimos 12 meses.' },
            { icon: '🔴', title: 'Meses no vermelho', description: 'Mostra quantos meses as despesas superaram a receita.' },
            { icon: '📊', title: 'Duas barras por mês', description: 'A barra de cima é a receita, a de baixo é o quanto foi devido. Todas usam a mesma escala, então dá para comparar meses entre si.' },
            { icon: '📉', title: 'Pior/Melhor mês', description: 'Identifica o mês com maior déficit e o melhor saldo.' },
          ]}
        />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 stagger">
        <StatCard
          icon={<AlertTriangle size={16} />}
          label="Meses no vermelho"
          value={String(analysis.negativeMonths.length)}
          hint="nos últimos 12 meses"
          tone={analysis.negativeMonths.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}
        />
        <StatCard
          icon={<TrendingDown size={16} />}
          label="Pior mês"
          value={formatCurrency(analysis.worstMonth.difference)}
          hint={analysis.worstMonth.label}
          tone="var(--color-danger)"
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="Melhor mês"
          value={formatCurrency(analysis.bestMonth.difference)}
          hint={analysis.bestMonth.label}
          tone="var(--color-success)"
        />
      </div>

      {analysis.negativeMonths.length === 0 && (
        <div
          className="card flex items-center gap-3"
          style={{ borderColor: 'var(--color-success)' }}
        >
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
          >
            <CheckCircle2 size={18} />
          </span>
          <span className="text-sm font-semibold">
            Você ficou dentro da renda em todos os últimos 12 meses.
          </span>
        </div>
      )}

      <section className="card">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold tracking-tight">Receita e despesas</h2>
          <div className="flex items-center gap-3">
            <LegendDot color="var(--color-primary)" label="Receita" />
            <LegendDot color="var(--color-text-tertiary)" label="Devido" />
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)] mb-4">
          Mesma escala em todos os meses
        </p>

        <div className="space-y-3.5 stagger">
          {analysis.rows.map((row) => (
            <MonthRow key={`${row.month}-${row.year}`} row={row} scale={scale} />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className="card !p-3.5">
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-surface-2)', color: tone }}
        >
          {icon}
        </span>
        <span className="label-caps truncate">{label}</span>
      </div>
      <p className="text-xl font-extrabold tnum mt-2 tracking-tight" style={{ color: tone }}>
        {value}
      </p>
      <p className="text-[11px] text-[var(--color-text-tertiary)]">{hint}</p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/**
 * Um mês do gráfico: duas barras na mesma escala, receita em cima e devido
 * embaixo. Ver as duas lado a lado diz na hora se o mês fechou — bem mais
 * rápido do que ler três números.
 */
function MonthRow({
  row,
  scale,
}: {
  row: { label: string; totalIncome: number; totalDue: number; difference: number };
  scale: number;
}) {
  const overBudget = row.difference < 0;
  const pct = (v: number) => `${Math.max(1.5, (v / scale) * 100)}%`;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-bold capitalize">{row.label}</span>
        <span
          className="text-xs font-bold tnum"
          style={{ color: overBudget ? 'var(--color-danger)' : 'var(--color-success)' }}
        >
          {formatCurrency(row.difference)}
        </span>
      </div>

      <div className="space-y-1">
        <div className="h-2 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: pct(row.totalIncome), background: 'var(--color-primary)' }}
          />
        </div>
        <div className="h-2 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: pct(row.totalDue),
              background: overBudget ? 'var(--color-danger)' : 'var(--color-text-tertiary)',
            }}
          />
        </div>
      </div>

      <div className="flex justify-between mt-1 text-[10px] text-[var(--color-text-tertiary)] tnum">
        <span>recebeu {formatCurrency(row.totalIncome)}</span>
        <span>deveu {formatCurrency(row.totalDue)}</span>
      </div>
    </div>
  );
}
