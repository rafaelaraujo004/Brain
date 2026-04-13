import { useState, useMemo, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Brain,
  AlertTriangle,
  Lightbulb,
  Calculator,
  CheckCircle2,
  Clock,
  TrendingDown,
  Zap,
  ChevronDown,
  ChevronUp,
  Settings2,
  Plus,
  X,
} from 'lucide-react';
import { db, getOrCreateSettings, ensureDefaultPriorities } from '../db/database';
import { formatCurrency, getMonthName } from '../utils/formatters';
import type { RecurringDebt, PriorityItem, PriorityLevel } from '../types';
import { HelpButton } from '../components/HelpModal';

interface Suggestion {
  type: 'alert' | 'tip' | 'warning';
  icon: typeof AlertTriangle;
  title: string;
  message: string;
  priority: number;
}

interface SimItem {
  id: string;
  description: string;
  value: number;
  dueDay: number;
  priority: number;
  type: 'bill' | 'recurring';
  selected: boolean;
}

const LEVEL_SCORE: Record<PriorityLevel, number> = { alta: 10, media: 5, baixa: 2 };
const LEVEL_COLORS: Record<PriorityLevel, { bg: string; text: string; label: string }> = {
  alta: { bg: 'bg-red-500/15', text: 'text-red-500', label: 'Alta' },
  media: { bg: 'bg-yellow-500/15', text: 'text-yellow-500', label: 'Média' },
  baixa: { bg: 'bg-blue-500/15', text: 'text-blue-500', label: 'Baixa' },
};
const LEVEL_CYCLE: PriorityLevel[] = ['baixa', 'media', 'alta'];

function getPriorityScore(description: string, priorities: PriorityItem[]): number {
  const lower = description.toLowerCase();
  for (const p of priorities) {
    if (lower.includes(p.keyword)) {
      return LEVEL_SCORE[p.level];
    }
  }
  return 0;
}

function getPriorityLevel(description: string, priorities: PriorityItem[]): PriorityLevel | null {
  const lower = description.toLowerCase();
  for (const p of priorities) {
    if (lower.includes(p.keyword)) {
      return p.level;
    }
  }
  return null;
}

function getRecurringForCurrentMonth(debt: RecurringDebt, month: number, year: number) {
  const monthsSinceStart = (year - debt.startYear) * 12 + (month - debt.startMonth);
  const installmentNumber = monthsSinceStart + 1;
  if (installmentNumber < 1 || installmentNumber > debt.totalInstallments) return null;
  const isPaid = debt.paidInstallments >= installmentNumber;
  return { installmentNumber, isPaid };
}

export function FinancialAdvisor() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const currentDay = today.getDate();

  const [budgetInput, setBudgetInput] = useState('');
  const [showSimulation, setShowSimulation] = useState(false);
  const [manualSelections, setManualSelections] = useState<Set<string>>(new Set());
  const [simMode, setSimMode] = useState<'auto' | 'manual'>('auto');
  const [showPriorities, setShowPriorities] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');

  useEffect(() => {
    ensureDefaultPriorities();
  }, []);

  const priorities = useLiveQuery(
    () => db.priorities.toArray(),
    []
  );

  const bills = useLiveQuery(
    () => db.bills.where({ month, year }).toArray(),
    [month, year]
  );

  const recurringDebts = useLiveQuery(
    () => db.recurringDebts.filter((d) => d.isActive).toArray(),
    []
  );

  const allBills = useLiveQuery(() => db.bills.toArray(), []);
  const settings = useLiveQuery(() => getOrCreateSettings(), []);
  const monthlyConfig = useLiveQuery(
    () => db.monthlyConfigs.where({ month, year }).first(),
    [month, year]
  );
  const extraFunds = useLiveQuery(
    () => db.extraFunds.where({ month, year }).toArray(),
    [month, year]
  );
  const incomeSources = useLiveQuery(
    () => db.incomeSources.filter((i) => i.isActive).toArray(),
    []
  );

  // Calculate total income
  const totalIncome = useMemo(() => {
    const salary = monthlyConfig?.salary ?? settings?.defaultSalary ?? 0;
    const extra = extraFunds?.reduce((s, f) => s + f.value, 0) ?? 0;
    const income = incomeSources?.reduce((s, i) => s + i.value, 0) ?? 0;
    return salary + extra + income;
  }, [monthlyConfig, settings, extraFunds, incomeSources]);

  // Build pending items for simulation
  const pendingItems = useMemo((): SimItem[] => {
    if (!priorities) return [];
    const items: SimItem[] = [];

    bills?.forEach((b) => {
      if (b.status !== 'pending') return;
      items.push({
        id: `bill-${b.id}`,
        description: b.description,
        value: b.finalValue,
        dueDay: b.dueDay,
        priority: getPriorityScore(b.description, priorities),
        type: 'bill',
        selected: false,
      });
    });

    recurringDebts?.forEach((d) => {
      const info = getRecurringForCurrentMonth(d, month, year);
      if (!info || info.isPaid) return;
      // Check if already linked as bill
      const hasLinkedBill = bills?.some((b) => b.recurringDebtId === d.id);
      if (hasLinkedBill) return;

      items.push({
        id: `rec-${d.id}`,
        description: `${d.description} (${info.installmentNumber}/${d.totalInstallments})`,
        value: d.installmentValue,
        dueDay: d.dueDay,
        priority: getPriorityScore(d.description, priorities),
        type: 'recurring',
        selected: false,
      });
    });

    // Sort by priority (high first), then by due day (earliest first)
    return items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.dueDay - b.dueDay;
    });
  }, [bills, recurringDebts, month, year, priorities]);

  // Smart suggestions
  const suggestions = useMemo((): Suggestion[] => {
    const tips: Suggestion[] = [];

    if (!bills || !recurringDebts) return tips;

    const pendingBills = bills.filter((b) => b.status === 'pending');
    const totalPending = pendingBills.reduce((s, b) => s + b.finalValue, 0);

    // Alert: bills due in the next 3 days
    const urgentBills = pendingBills.filter((b) => {
      const diff = b.dueDay - currentDay;
      return diff >= 0 && diff <= 3;
    });
    if (urgentBills.length > 0) {
      tips.push({
        type: 'alert',
        icon: AlertTriangle,
        title: 'Contas vencendo em breve!',
        message: `${urgentBills.map((b) => `${b.description} (dia ${b.dueDay})`).join(', ')} — total de ${formatCurrency(urgentBills.reduce((s, b) => s + b.finalValue, 0))}`,
        priority: 100,
      });
    }

    // Alert: overdue bills
    const overdueBills = pendingBills.filter((b) => b.dueDay < currentDay);
    if (overdueBills.length > 0) {
      tips.push({
        type: 'warning',
        icon: Clock,
        title: `${overdueBills.length} conta${overdueBills.length > 1 ? 's' : ''} atrasada${overdueBills.length > 1 ? 's' : ''}`,
        message: `${overdueBills.map((b) => b.description).join(', ')} — total atrasado: ${formatCurrency(overdueBills.reduce((s, b) => s + b.finalValue, 0))}`,
        priority: 90,
      });
    }

    // Tip: income vs expenses
    if (totalIncome > 0) {
      const recurringPending = recurringDebts
        .filter((d) => {
          const info = getRecurringForCurrentMonth(d, month, year);
          return info && !info.isPaid;
        })
        .reduce((s, d) => s + d.installmentValue, 0);

      const totalExpenses = totalPending + recurringPending;
      const balance = totalIncome - totalExpenses;

      if (balance < 0) {
        tips.push({
          type: 'warning',
          icon: TrendingDown,
          title: 'Despesas acima da renda',
          message: `Suas despesas pendentes (${formatCurrency(totalExpenses)}) superam sua renda (${formatCurrency(totalIncome)}) em ${formatCurrency(Math.abs(balance))}. Considere postergar contas de menor prioridade.`,
          priority: 85,
        });
      } else if (balance < totalIncome * 0.1) {
        tips.push({
          type: 'tip',
          icon: Lightbulb,
          title: 'Margem apertada',
          message: `Após pagar tudo, sobram apenas ${formatCurrency(balance)} (${Math.round((balance / totalIncome) * 100)}% da renda). Cuidado com gastos extras.`,
          priority: 60,
        });
      } else {
        tips.push({
          type: 'tip',
          icon: CheckCircle2,
          title: 'Situação confortável',
          message: `Após pagar todas as contas, sobram ${formatCurrency(balance)} (${Math.round((balance / totalIncome) * 100)}% da renda).`,
          priority: 30,
        });
      }
    }

    // Tip: high-priority bills unpaid
    const highPriorityUnpaid = pendingBills.filter((b) => getPriorityScore(b.description, priorities ?? []) > 5);
    if (highPriorityUnpaid.length > 0) {
      tips.push({
        type: 'tip',
        icon: Zap,
        title: 'Prioridades pendentes',
        message: `${highPriorityUnpaid.map((b) => b.description).join(', ')} são contas prioritárias ainda pendentes.`,
        priority: 70,
      });
    }

    // Tip: recurring debts nearing completion
    recurringDebts.forEach((d) => {
      const remaining = d.totalInstallments - d.paidInstallments;
      if (remaining > 0 && remaining <= 3) {
        tips.push({
          type: 'tip',
          icon: CheckCircle2,
          title: `${d.description} quase quitada!`,
          message: `Faltam apenas ${remaining} parcela${remaining > 1 ? 's' : ''} de ${formatCurrency(d.installmentValue)}.`,
          priority: 40,
        });
      }
    });

    // Tip: month spending pattern
    if (allBills && allBills.length > 0) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevBills = allBills.filter((b) => b.month === prevMonth && b.year === prevYear);
      const prevTotal = prevBills.reduce((s, b) => s + b.finalValue, 0);
      const currentTotal = bills.reduce((s, b) => s + b.finalValue, 0);

      if (prevTotal > 0 && currentTotal > prevTotal * 1.2) {
        tips.push({
          type: 'warning',
          icon: TrendingDown,
          title: 'Gastos aumentaram',
          message: `Este mês (${formatCurrency(currentTotal)}) tem ${Math.round(((currentTotal - prevTotal) / prevTotal) * 100)}% mais despesas que ${getMonthName(prevMonth)} (${formatCurrency(prevTotal)}).`,
          priority: 50,
        });
      }
    }

    return tips.sort((a, b) => b.priority - a.priority);
  }, [bills, recurringDebts, allBills, totalIncome, currentDay, month, year, priorities]);

  // Simulation logic
  const budget = parseFloat(budgetInput.replace(',', '.')) || 0;

  const simulationResult = useMemo(() => {
    if (budget <= 0) return null;

    if (simMode === 'manual') {
      const selected = pendingItems.filter((i) => manualSelections.has(i.id));
      const totalSelected = selected.reduce((s, i) => s + i.value, 0);
      return {
        selected,
        totalSelected,
        remaining: budget - totalSelected,
        canAfford: totalSelected <= budget,
      };
    }

    // Auto mode: greedy by priority then due date
    const selected: SimItem[] = [];
    let remaining = budget;

    for (const item of pendingItems) {
      if (item.value <= remaining) {
        selected.push(item);
        remaining -= item.value;
      }
    }

    return {
      selected,
      totalSelected: budget - remaining,
      remaining,
      canAfford: true,
    };
  }, [budget, pendingItems, simMode, manualSelections]);

  const toggleManualSelect = (id: string) => {
    setManualSelections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const addPriority = useCallback(async () => {
    const keyword = newKeyword.trim().toLowerCase();
    if (!keyword || !priorities) return;
    if (priorities.some((p) => p.keyword === keyword)) return;
    await db.priorities.add({ keyword, level: 'media' });
    setNewKeyword('');
  }, [newKeyword, priorities]);

  const removePriority = useCallback(async (id: number) => {
    await db.priorities.delete(id);
  }, []);

  const cyclePriorityLevel = useCallback(async (item: PriorityItem) => {
    const currentIdx = LEVEL_CYCLE.indexOf(item.level);
    const nextLevel = LEVEL_CYCLE[(currentIdx + 1) % LEVEL_CYCLE.length];
    await db.priorities.update(item.id!, { level: nextLevel });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={24} className="text-[var(--color-primary)]" />
          <h1 className="text-xl font-bold">Assistente Financeiro</h1>
        </div>
        <HelpButton
          title="Como usar o Assistente"
          items={[
            { icon: '🧠', title: 'Sugestões', description: 'O assistente analisa suas contas e gera alertas e dicas automaticamente.' },
            { icon: '⚠️', title: 'Alertas', description: 'Contas vencendo em breve ou atrasadas aparecem destacadas em vermelho.' },
            { icon: '💡', title: 'Dicas', description: 'Dicas sobre margem financeira, prioridades e padrões de gastos.' },
            { icon: '🧮', title: 'Simulador', description: 'Informe um valor e veja quais contas cabem nesse orçamento.' },
            { icon: '🔄', title: 'Auto vs Manual', description: 'No modo Auto, as contas mais prioritárias são selecionadas. No Manual, você escolhe.' },
          ]}
        />
      </div>

      {/* Smart Suggestions */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          Sugestões do mês — {getMonthName(month)}
        </h2>

        {suggestions.length === 0 ? (
          <div className="card text-center py-6">
            <CheckCircle2 size={32} className="mx-auto text-[var(--color-success)] mb-2" />
            <p className="text-sm text-[var(--color-text-secondary)]">Tudo em dia! Nenhum alerta no momento.</p>
          </div>
        ) : (
          suggestions.map((s, i) => (
            <div
              key={i}
              className={`card flex gap-3 items-start border-l-4 ${
                s.type === 'alert'
                  ? 'border-l-red-500'
                  : s.type === 'warning'
                  ? 'border-l-orange-500'
                  : 'border-l-blue-500'
              }`}
            >
              <s.icon
                size={20}
                className={`flex-shrink-0 mt-0.5 ${
                  s.type === 'alert'
                    ? 'text-red-500'
                    : s.type === 'warning'
                    ? 'text-orange-500'
                    : 'text-blue-500'
                }`}
              />
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">{s.message}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Priority Editor */}
      <div className="space-y-2">
        <button
          onClick={() => setShowPriorities(!showPriorities)}
          className="flex items-center justify-between w-full card py-3"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={20} className="text-[var(--color-primary)]" />
            <span className="text-sm font-semibold">Gerenciar Prioridades</span>
          </div>
          {showPriorities ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showPriorities && (
          <div className="space-y-3">
            <div className="card space-y-3">
              <p className="text-xs text-[var(--color-text-secondary)]">
                Toque no nível para alternar entre Alta, Média e Baixa. Adicione palavras-chave para identificar contas.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ex: aluguel, internet..."
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPriority()}
                  className="input-field flex-1"
                />
                <button
                  onClick={addPriority}
                  disabled={!newKeyword.trim()}
                  className="bg-[var(--color-primary)] text-white p-2.5 rounded-xl disabled:opacity-40"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>

            {priorities && priorities.length > 0 && (
              <div className="space-y-1">
                {priorities.map((p) => {
                  const colors = LEVEL_COLORS[p.level];
                  return (
                    <div
                      key={p.id}
                      className="card flex items-center gap-3 py-2.5"
                    >
                      <span className="text-sm flex-1 truncate">{p.keyword}</span>
                      <button
                        onClick={() => cyclePriorityLevel(p)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold ${colors.bg} ${colors.text} transition-colors`}
                      >
                        {colors.label}
                      </button>
                      <button
                        onClick={() => removePriority(p.id!)}
                        className="p-1 rounded-lg hover:bg-red-500/10 text-red-500"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {priorities && priorities.length === 0 && (
              <div className="card text-center py-4">
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Nenhuma prioridade definida. Adicione palavras-chave acima.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Simulator */}
      <div className="space-y-3">
        <button
          onClick={() => setShowSimulation(!showSimulation)}
          className="flex items-center justify-between w-full card py-3"
        >
          <div className="flex items-center gap-2">
            <Calculator size={20} className="text-[var(--color-primary)]" />
            <span className="text-sm font-semibold">Simulador de Pagamento</span>
          </div>
          {showSimulation ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showSimulation && (
          <div className="space-y-3">
            <div className="card space-y-3">
              <label className="text-sm font-medium">Quanto você tem para pagar este mês?</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Ex: 2000,00"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="input-field"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => setSimMode('auto')}
                  className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-colors ${
                    simMode === 'auto'
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  Auto (prioridade)
                </button>
                <button
                  onClick={() => setSimMode('manual')}
                  className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-colors ${
                    simMode === 'manual'
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  Manual (escolher)
                </button>
              </div>
            </div>

            {budget > 0 && (
              <>
                {/* Pending items list */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">
                    {simMode === 'auto' ? 'Contas selecionadas por prioridade' : 'Selecione as contas para pagar'}
                  </h3>

                  {pendingItems.map((item) => {
                    const isSelected =
                      simMode === 'auto'
                        ? simulationResult?.selected.some((s) => s.id === item.id) ?? false
                        : manualSelections.has(item.id);

                    return (
                      <div
                        key={item.id}
                        onClick={() => simMode === 'manual' && toggleManualSelect(item.id)}
                        className={`card flex items-center gap-3 transition-all duration-200 ${
                          simMode === 'manual' ? 'cursor-pointer active:scale-[0.98]' : ''
                        } ${isSelected ? 'ring-2 ring-[var(--color-success)] bg-green-500/5' : 'opacity-60'}`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isSelected
                              ? 'bg-green-500/15 text-green-500'
                              : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {isSelected ? <CheckCircle2 size={16} /> : <span className="text-xs">{item.dueDay}</span>}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-[var(--color-text-secondary)]">Dia {item.dueDay}</span>
                            {item.priority > 0 && (() => {
                              const level = getPriorityLevel(item.description, priorities ?? []);
                              if (!level) return null;
                              const colors = LEVEL_COLORS[level];
                              return (
                                <span className={`text-xs font-medium ${colors.text}`}>
                                  ★ {colors.label}
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        <span className={`text-sm font-bold ${isSelected ? 'text-[var(--color-success)]' : ''}`}>
                          {formatCurrency(item.value)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Simulation result */}
                {simulationResult && (
                  <div className={`card border-2 ${simulationResult.remaining >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-xs text-[var(--color-text-secondary)]">Orçamento</p>
                        <p className="text-sm font-bold">{formatCurrency(budget)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-text-secondary)]">Selecionado</p>
                        <p className="text-sm font-bold text-[var(--color-primary)]">
                          {formatCurrency(simulationResult.totalSelected)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-text-secondary)]">Sobra</p>
                        <p className={`text-sm font-bold ${simulationResult.remaining >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                          {formatCurrency(simulationResult.remaining)}
                        </p>
                      </div>
                    </div>

                    {simulationResult.remaining < 0 && simMode === 'manual' && (
                      <p className="text-xs text-red-500 mt-3 text-center">
                        ⚠️ Orçamento insuficiente! Remova {formatCurrency(Math.abs(simulationResult.remaining))} em contas.
                      </p>
                    )}

                    {simulationResult.selected.length > 0 && simulationResult.remaining >= 0 && (
                      <p className="text-xs text-[var(--color-success)] mt-3 text-center">
                        ✅ Você consegue pagar {simulationResult.selected.length} conta{simulationResult.selected.length > 1 ? 's' : ''} com esse valor!
                      </p>
                    )}

                    {pendingItems.length > 0 && simulationResult.selected.length < pendingItems.length && simulationResult.remaining >= 0 && simMode === 'auto' && (
                      <p className="text-xs text-orange-500 mt-3 text-center">
                        ⚠️ {pendingItems.length - simulationResult.selected.length} conta{pendingItems.length - simulationResult.selected.length > 1 ? 's não cabem' : ' não cabe'} no orçamento. Considere postergar.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
