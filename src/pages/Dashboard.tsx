import { useLiveQuery } from 'dexie-react-hooks';
import { TrendingUp, TrendingDown, Wallet, DollarSign, RefreshCw } from 'lucide-react';
import { db, getOrCreateSettings, ensureCarryOverBillsForMonth, ensureMonthlyConfig } from '../db/database';
import { formatCurrency, formatDate } from '../utils/formatters';
import { getPostponeStatus, getRecurringStatusForMonth } from '../utils/bills';
import { useMonthNavigation } from '../hooks/useMonthNavigation';
import { MonthSelector } from '../components/MonthSelector';
import { useEffect, useState, useMemo } from 'react';
import { HelpButton } from '../components/HelpModal';
import { ListSkeleton } from '../components/PageSpinner';
import { RemainingIncomeCard } from '../components/RemainingIncomeCard';
import { AnimatedCurrency } from '../components/AnimatedCurrency';

interface UnifiedItem {
  id: string;
  description: string;
  value: number;
  dueDay: number;
  dueDate: Date;
  status: 'paid' | 'pending' | 'overdue';
  type: 'bill' | 'recurring';
  installmentInfo?: string;
  /** Quantas vezes a conta já foi adiada (0 quando nunca foi) */
  postponedTimes: number;
  /** "há 2 meses e 4 dias", medido do vencimento original */
  overdueLabel: string;
}

export function Dashboard() {
  const { month, year, goToPrev, goToNext } = useMonthNavigation();
  const [salary, setSalary] = useState(0);

  const bills = useLiveQuery(
    () => db.bills.where({ month, year }).toArray(),
    [month, year]
  );

  const recurringDebts = useLiveQuery(
    () => db.recurringDebts.filter((d) => d.isActive).toArray(),
    []
  );

  const extraFunds = useLiveQuery(
    () => db.extraFunds.where({ month, year }).toArray(),
    [month, year]
  );

  const incomeSources = useLiveQuery(
    () => db.incomeSources.filter((i) => i.isActive).toArray(),
    []
  );

  useEffect(() => {
    (async () => {
      await ensureCarryOverBillsForMonth(month, year);
      const settings = await getOrCreateSettings();
      const config = await ensureMonthlyConfig(month, year, settings.defaultSalary);
      setSalary(config.salary);
    })();
  }, [month, year]);

  // Unify bills + recurring debts for the selected month
  const allItems = useMemo((): UnifiedItem[] => {
    const items: UnifiedItem[] = [];

    // Regular bills
    bills?.forEach((b) => {
      // Skip bills that were postponed
      if (b.status === 'skipped') return;

      const postpone = getPostponeStatus(b);

      items.push({
        id: `bill-${b.id}`,
        description: b.originalDescription ?? b.description,
        value: b.finalValue,
        dueDay: b.dueDay,
        dueDate: postpone.currentDueDate,
        status: b.status === 'paid' ? 'paid' : postpone.isLate ? 'overdue' : 'pending',
        type: 'bill',
        postponedTimes: postpone.times,
        overdueLabel: postpone.overdueLabel,
      });
    });

    // Recurring debts that apply to this month
    recurringDebts?.forEach((d) => {
      const recurring = getRecurringStatusForMonth(d, month, year);
      if (!recurring.applies) return;

      // Skip if there's already a bill linked to this recurring debt
      const hasLinkedBill = bills?.some((b) => b.recurringDebtId === d.id);
      if (hasLinkedBill) return;

      items.push({
        id: `recurring-${d.id}`,
        description: d.description,
        value: d.installmentValue,
        dueDay: d.dueDay,
        dueDate: recurring.dueDate,
        status: recurring.status,
        type: 'recurring',
        installmentInfo: `${recurring.installmentNumber}/${d.totalInstallments}`,
        postponedTimes: 0,
        overdueLabel: recurring.overdueLabel,
      });
    });

    return items;
  }, [bills, recurringDebts, month, year]);

  const totalDue = allItems.reduce((sum, i) => sum + i.value, 0);
  const totalPaid = allItems.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.value, 0);
  const amountToSettle = allItems
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + i.value, 0);
  const totalExtra = extraFunds?.reduce((sum, f) => sum + f.value, 0) ?? 0;
  const totalIncomeSources = incomeSources?.reduce((sum, i) => sum + i.value, 0) ?? 0;
  const totalIncome = salary + totalExtra + totalIncomeSources;
  const difference = totalIncome - totalDue;
  const pendingCount = allItems.filter((i) => i.status !== 'paid').length;
  const paidCount = allItems.filter((i) => i.status === 'paid').length;
  const overdueCount = allItems.filter((i) => i.status === 'overdue').length;

  const progressPercent = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

  // useLiveQuery devolve undefined até a primeira resposta do Dexie.
  const isLoading = bills === undefined || recurringDebts === undefined;

  // Atrasadas primeiro e, entre elas, as que já foram mais empurradas —
  // é a dívida que vem se arrastando que precisa aparecer no topo.
  const upcomingItems = allItems
    .filter((i) => i.status !== 'paid')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'overdue' ? -1 : 1;
      if (a.postponedTimes !== b.postponedTimes) return b.postponedTimes - a.postponedTimes;
      return a.dueDate.getTime() - b.dueDate.getTime();
    })
    .slice(0, 8);

  return (
    <div className="space-y-4 pb-4">
      {/* --- Cabeçalho ---------------------------------------------------- */}
      <header className="flex items-center justify-between gap-2 pt-1">
        <MonthSelector month={month} year={year} onPrev={goToPrev} onNext={goToNext} />
        <HelpButton
          title="Como usar o Início"
          items={[
            { icon: '◀▶', title: 'Navegar meses', description: 'Use as setas para alternar entre os meses e ver o resumo de cada período.' },
            { icon: '💰', title: 'Ainda me resta', description: 'Renda menos o que já saiu da conta. Diferente do Saldo, que é o que vai sobrar se você pagar tudo.' },
            { icon: '📊', title: 'Barra de composição', description: 'Mostra a renda dividida em já pago, comprometido e livre.' },
            { icon: '🔄', title: 'Ícone de recorrente', description: 'Itens com ícone de setas são dívidas recorrentes (parcelas).' },
            { icon: '⚠️', title: 'Contas vencidas', description: 'Aparecem primeiro na lista, com há quanto tempo estão vencidas.' },
          ]}
        />
      </header>

      {/* --- Herói: quanto ainda resta ------------------------------------ */}
      <RemainingIncomeCard
        totalIncome={totalIncome}
        totalPaid={totalPaid}
        totalDue={totalDue}
        month={month}
        year={year}
      />

      {/* --- Progresso do mês --------------------------------------------- */}
      <section className="card animate-rise" style={{ animationDelay: '60ms' }}>
        <div className="flex justify-between items-baseline mb-3">
          <span className="label-caps">Progresso do mês</span>
          <span className="text-lg font-extrabold tnum tracking-tight">{progressPercent}%</span>
        </div>

        <div className="meter">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progressPercent}%`,
              background: 'linear-gradient(90deg, var(--color-success), var(--color-primary))',
            }}
          />
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs">
          <Stat dot="var(--color-success)" label={`${paidCount} pagas`} />
          {overdueCount > 0 && (
            <Stat
              dot="var(--color-danger)"
              label={`${overdueCount} vencida${overdueCount > 1 ? 's' : ''}`}
              danger
            />
          )}
          <Stat dot="var(--color-text-tertiary)" label={`${pendingCount} pendentes`} />
        </div>
      </section>

      {/* --- Números do mês ------------------------------------------------ */}
      <section
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger"
        style={{ animationDelay: '120ms' }}
      >
        <SummaryCard
          icon={<DollarSign size={16} />}
          label="Renda total"
          value={totalIncome}
          tone="primary"
        />
        <SummaryCard
          icon={<Wallet size={16} />}
          label="Total devido"
          value={totalDue}
          tone="neutral"
        />
        <SummaryCard
          icon={<TrendingUp size={16} />}
          label="Já pago"
          value={totalPaid}
          tone="success"
        />
        <SummaryCard
          icon={difference >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          label="Saldo previsto"
          value={difference}
          tone={difference >= 0 ? 'success' : 'danger'}
          hint={difference >= 0 ? 'se pagar tudo' : 'acima da renda'}
        />
      </section>

      {/* --- Próximas contas ---------------------------------------------- */}
      <section className="card">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-bold tracking-tight">Próximas contas</h3>
          {amountToSettle > 0 && (
            <span className="text-xs text-[var(--color-text-secondary)]">
              falta <span className="font-bold text-[var(--color-text)] tnum">{formatCurrency(amountToSettle)}</span>
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)] mb-3">
          Vencidas primeiro, depois as mais adiadas
        </p>

        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : upcomingItems.length > 0 ? (
          <div className="stagger -mx-1">
            {upcomingItems.map((item) => (
              <UpcomingRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-3xl mb-2">{allItems.length === 0 ? '📭' : '🎉'}</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {allItems.length === 0 ? 'Nenhuma conta cadastrada' : 'Tudo pago neste mês!'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/** Legenda com marcador colorido usada sob a barra de progresso. */
function Stat({ dot, label, danger }: { dot: string; label: string; danger?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 font-semibold ${
        danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]'
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}

const TONE_STYLES = {
  primary: { color: 'var(--color-primary)', soft: 'var(--color-primary-soft)' },
  success: { color: 'var(--color-success)', soft: 'var(--color-success-soft)' },
  danger: { color: 'var(--color-danger)', soft: 'var(--color-danger-soft)' },
  neutral: { color: 'var(--color-text-secondary)', soft: 'var(--color-surface-2)' },
} as const;

function SummaryCard({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof TONE_STYLES;
  hint?: string;
}) {
  const { color, soft } = TONE_STYLES[tone];

  return (
    <div className="card !p-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: soft, color }}
        >
          {icon}
        </span>
        <span className="label-caps truncate">{label}</span>
      </div>
      <div>
        <AnimatedCurrency
          value={value}
          className="money-lg text-[17px] block"
          durationMs={700}
        />
        {hint && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{hint}</span>
        )}
      </div>
    </div>
  );
}

function UpcomingRow({ item }: { item: UnifiedItem }) {
  const isOverdue = item.status === 'overdue';

  return (
    <div className="flex items-center gap-3 px-1 py-2.5 rounded-xl transition-colors hover:bg-[var(--color-surface-2)]">
      {/* Data em bloco: o dia é o que o olho procura ao varrer a lista. */}
      <div
        className="w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 border"
        style={{
          background: isOverdue ? 'var(--color-danger-soft)' : 'var(--color-surface-2)',
          borderColor: isOverdue ? 'transparent' : 'var(--color-border)',
          color: isOverdue ? 'var(--color-danger)' : 'var(--color-text)',
        }}
      >
        <span className="text-[15px] font-extrabold leading-none tnum">
          {item.dueDate.getDate()}
        </span>
        <span className="text-[9px] font-bold uppercase opacity-70 mt-0.5">
          {item.dueDate.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.type === 'recurring' && (
            <RefreshCw size={12} className="text-[var(--color-primary)] flex-shrink-0" />
          )}
          <p className="text-sm font-semibold truncate">{item.description}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {item.installmentInfo && (
            <span className="text-[11px] text-[var(--color-primary)] font-semibold">
              Parcela {item.installmentInfo}
            </span>
          )}
          {item.postponedTimes > 0 && (
            <span className="text-[11px] font-semibold text-[var(--color-warning)]">
              adiada {item.postponedTimes}x
            </span>
          )}
          {isOverdue && (
            <span className="text-[11px] font-semibold text-[var(--color-danger)]">
              vencida {item.overdueLabel}
            </span>
          )}
          {!isOverdue && !item.installmentInfo && item.postponedTimes === 0 && (
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {formatDate(item.dueDate)}
            </span>
          )}
        </div>
      </div>

      <span
        className={`money-lg text-sm flex-shrink-0 ${
          isOverdue ? 'text-[var(--color-danger)]' : ''
        }`}
      >
        {formatCurrency(item.value)}
      </span>
    </div>
  );
}
