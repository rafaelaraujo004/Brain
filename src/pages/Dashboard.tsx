import { useLiveQuery } from 'dexie-react-hooks';
import { TrendingUp, TrendingDown, Wallet, DollarSign, AlertTriangle, RefreshCw } from 'lucide-react';
import { db, getOrCreateSettings, ensureCarryOverBillsForMonth, ensureMonthlyConfig } from '../db/database';
import { formatCurrency } from '../utils/formatters';
import { useMonthNavigation } from '../hooks/useMonthNavigation';
import { MonthSelector } from '../components/MonthSelector';
import { useEffect, useState, useMemo } from 'react';
import type { RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';

interface UnifiedItem {
  id: string;
  description: string;
  value: number;
  dueDay: number;
  status: 'paid' | 'pending' | 'overdue';
  type: 'bill' | 'recurring';
  installmentInfo?: string;
}

function getRecurringStatusForMonth(
  debt: RecurringDebt,
  month: number,
  year: number
): { applies: boolean; status: 'paid' | 'pending' | 'overdue'; installmentNumber: number } {
  const monthsSinceStart = (year - debt.startYear) * 12 + (month - debt.startMonth);
  const installmentNumber = monthsSinceStart + 1;

  if (installmentNumber < 1 || installmentNumber > debt.totalInstallments) {
    return { applies: false, status: 'pending', installmentNumber: 0 };
  }

  const isPaid = debt.paidInstallments >= installmentNumber;
  if (isPaid) return { applies: true, status: 'paid', installmentNumber };

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const isOverdue = isCurrentMonth && today.getDate() > debt.dueDay;

  return {
    applies: true,
    status: isOverdue ? 'overdue' : 'pending',
    installmentNumber,
  };
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

      const today = new Date();
      const isOverdue =
        b.status === 'pending' &&
        b.year === today.getFullYear() &&
        b.month === today.getMonth() + 1 &&
        today.getDate() > b.dueDay;

      items.push({
        id: `bill-${b.id}`,
        description: b.description,
        value: b.finalValue,
        dueDay: b.dueDay,
        status: b.status === 'paid' ? 'paid' : isOverdue ? 'overdue' : 'pending',
        type: 'bill',
      });
    });

    // Recurring debts that apply to this month
    recurringDebts?.forEach((d) => {
      const { applies, status, installmentNumber } = getRecurringStatusForMonth(d, month, year);
      if (!applies) return;

      // Skip if there's already a bill linked to this recurring debt
      const hasLinkedBill = bills?.some((b) => b.recurringDebtId === d.id);
      if (hasLinkedBill) return;

      items.push({
        id: `recurring-${d.id}`,
        description: d.description,
        value: d.installmentValue,
        dueDay: d.dueDay,
        status,
        type: 'recurring',
        installmentInfo: `${installmentNumber}/${d.totalInstallments}`,
      });
    });

    return items;
  }, [bills, recurringDebts, month, year]);

  const totalDue = allItems.reduce((sum, i) => sum + i.value, 0);
  const totalPaid = allItems.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.value, 0);
  const totalExtra = extraFunds?.reduce((sum, f) => sum + f.value, 0) ?? 0;
  const totalIncomeSources = incomeSources?.reduce((sum, i) => sum + i.value, 0) ?? 0;
  const totalIncome = salary + totalExtra + totalIncomeSources;
  const difference = totalIncome - totalDue;
  const pendingCount = allItems.filter((i) => i.status !== 'paid').length;
  const paidCount = allItems.filter((i) => i.status === 'paid').length;
  const overdueCount = allItems.filter((i) => i.status === 'overdue').length;

  const progressPercent = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

  const upcomingItems = allItems
    .filter((i) => i.status !== 'paid')
    .sort((a, b) => a.dueDay - b.dueDay)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <MonthSelector month={month} year={year} onPrev={goToPrev} onNext={goToNext} />
        <HelpButton
          title="Como usar o Início"
          items={[
            { icon: '◀▶', title: 'Navegar meses', description: 'Use as setas para alternar entre os meses e ver o resumo de cada período.' },
            { icon: '📊', title: 'Barra de progresso', description: 'Mostra a porcentagem de contas pagas em relação ao total do mês.' },
            { icon: '💰', title: 'Cartões de resumo', description: 'Renda Total, Total Devido, Já Pago e Saldo do mês atual.' },
            { icon: '🔄', title: 'Ícone de recorrente', description: 'Itens com ícone de setas são dívidas recorrentes (parcelas).' },
            { icon: '⚠️', title: 'Contas atrasadas', description: 'Contas com vencimento ultrapassado aparecem destacadas em vermelho.' },
          ]}
        />
      </div>

      {/* Progress bar */}
      <div className="card">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[var(--color-text-secondary)]">Progresso de pagamentos</span>
          <span className="text-sm font-bold">{progressPercent}%</span>
        </div>
        <div className="w-full h-3 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-success)] rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-[var(--color-text-secondary)]">
          <span>{paidCount} pagas</span>
          {overdueCount > 0 && (
            <span className="text-[var(--color-danger)] font-semibold flex items-center gap-1">
              <AlertTriangle size={12} />
              {overdueCount} atrasada{overdueCount > 1 ? 's' : ''}
            </span>
          )}
          <span>{pendingCount} pendentes</span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<DollarSign size={20} />}
          label="Renda Total"
          value={formatCurrency(totalIncome)}
          color="text-[var(--color-primary)]"
          bgColor="bg-blue-500/10"
        />
        <SummaryCard
          icon={<Wallet size={20} />}
          label="Total Devido"
          value={formatCurrency(totalDue)}
          color="text-[var(--color-danger)]"
          bgColor="bg-red-500/10"
        />
        <SummaryCard
          icon={<TrendingUp size={20} />}
          label="Já Pago"
          value={formatCurrency(totalPaid)}
          color="text-[var(--color-success)]"
          bgColor="bg-green-500/10"
        />
        <SummaryCard
          icon={difference >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          label="Saldo"
          value={formatCurrency(difference)}
          color={difference >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
          bgColor={difference >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}
        />
      </div>

      {/* Quick view of upcoming bills */}
      <div className="card md:col-span-2">
        <h3 className="font-bold mb-3">Próximas contas</h3>
        {upcomingItems.length > 0 ? (
          <div className="space-y-2">
            {upcomingItems.map((item) => (
                <div key={item.id} className="flex justify-between items-center py-2 border-b border-[var(--color-border)] last:border-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {item.type === 'recurring' && (
                      <RefreshCw size={14} className="text-[var(--color-primary)] flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.description}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-text-secondary)]">Dia {item.dueDay}</span>
                        {item.installmentInfo && (
                          <span className="text-xs text-[var(--color-primary)]">Parcela {item.installmentInfo}</span>
                        )}
                        {item.status === 'overdue' && (
                          <span className="text-xs text-[var(--color-danger)] font-semibold">Atrasado</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className={`text-sm font-bold flex-shrink-0 ml-2 ${item.status === 'overdue' ? 'text-[var(--color-danger)]' : ''}`}>
                    {formatCurrency(item.value)}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)] text-center py-4">
            {allItems.length === 0 ? 'Nenhuma conta cadastrada' : 'Tudo pago! 🎉'}
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="card flex flex-col gap-2">
      <div className={`w-9 h-9 rounded-xl ${bgColor} ${color} flex items-center justify-center`}>
        {icon}
      </div>
      <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-base font-bold ${color}`}>{value}</span>
    </div>
  );
}
