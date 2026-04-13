import { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Check, Undo2, Trash2, Edit3, X, RefreshCw, ArrowRight } from 'lucide-react';
import { db, ensureCarryOverBillsForMonth, removeCarryOverForPaidBill, skipBillToNextMonth, skipRecurringToNextMonth } from '../db/database';
import { formatCurrency } from '../utils/formatters';
import { useMonthNavigation } from '../hooks/useMonthNavigation';
import { MonthSelector } from '../components/MonthSelector';
import type { Bill, RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';

function getRecurringForMonth(debt: RecurringDebt, month: number, year: number) {
  const monthsSinceStart = (year - debt.startYear) * 12 + (month - debt.startMonth);
  const installmentNumber = monthsSinceStart + 1;
  if (installmentNumber < 1 || installmentNumber > debt.totalInstallments) return null;

  const isPaid = debt.paidInstallments >= installmentNumber;
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const isOverdue = !isPaid && isCurrentMonth && today.getDate() > debt.dueDay;

  return { installmentNumber, isPaid, isOverdue };
}

export function MonthlyBills() {
  const { month, year, goToPrev, goToNext } = useMonthNavigation();
  const [showForm, setShowForm] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const bills = useLiveQuery(
    () => db.bills.where({ month, year }).sortBy('dueDay'),
    [month, year]
  );

  const recurringDebts = useLiveQuery(
    () => db.recurringDebts.toArray(),
    []
  );

  useEffect(() => {
    void ensureCarryOverBillsForMonth(month, year);
  }, [month, year]);

  useEffect(() => {
    setSelectedIds([]);
  }, [month, year]);

  // Recurring debts that apply to this month and aren't already linked as bills
  const recurringForMonth = useMemo(() => {
    if (!recurringDebts || !bills) return [];
    return recurringDebts
      .map((debt) => {
        const hasLinkedBill = bills.some((b) => b.recurringDebtId === debt.id);
        if (hasLinkedBill) return null;
        const info = getRecurringForMonth(debt, month, year);
        if (!info) return null;
        return { debt, ...info };
      })
      .filter(Boolean) as { debt: RecurringDebt; installmentNumber: number; isPaid: boolean; isOverdue: boolean }[];
  }, [recurringDebts, bills, month, year]);

  const toggleStatus = async (bill: Bill) => {
    if (bill.status === 'skipped') {
      // Revert skipped: set back to pending and remove carry-over
      await db.bills.update(bill.id!, { status: 'pending' });
      if (bill.id) {
        await removeCarryOverForPaidBill(bill.id);
      }
      return;
    }
    const newStatus = bill.status === 'paid' ? 'pending' : 'paid';
    await db.bills.update(bill.id!, { status: newStatus });
    if (newStatus === 'paid' && bill.id) {
      await removeCarryOverForPaidBill(bill.id);
    }
  };

  const toggleRecurringPaid = async (debt: RecurringDebt, installmentNumber: number, currentlyPaid: boolean) => {
    if (currentlyPaid) {
      // Unpay: set paidInstallments to installmentNumber - 1
      await db.recurringDebts.update(debt.id!, {
        paidInstallments: Math.min(debt.paidInstallments, installmentNumber - 1),
        isActive: true,
      });
    } else {
      // Pay: set paidInstallments to at least installmentNumber
      const newPaid = Math.max(debt.paidInstallments, installmentNumber);
      await db.recurringDebts.update(debt.id!, {
        paidInstallments: newPaid,
        isActive: newPaid < debt.totalInstallments,
      });
    }
  };

  const deleteBill = async (id: number) => {
    await db.bills.delete(id);
  };

  const skipBill = async (bill: Bill) => {
    await skipBillToNextMonth(bill);
  };

  const skipRecurring = async (debt: RecurringDebt, installmentNumber: number) => {
    await skipRecurringToNextMonth(debt, installmentNumber, month, year);
  };

  const isSelectionMode = selectedIds.length > 0;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const billsDue = bills?.filter((b) => b.status !== 'skipped').reduce((sum, b) => sum + b.finalValue, 0) ?? 0;
  const recurringDue = recurringForMonth.reduce((sum, r) => sum + r.debt.installmentValue, 0);
  const totalDue = billsDue + recurringDue;

  const billsPaid = bills?.filter((b) => b.status === 'paid').reduce((sum, b) => sum + b.finalValue, 0) ?? 0;
  const recurringPaid = recurringForMonth.filter((r) => r.isPaid).reduce((sum, r) => sum + r.debt.installmentValue, 0);
  const totalPaid = billsPaid + recurringPaid;

  const selectedTotal = useMemo(() => {
    const selectedSet = new Set(selectedIds);

    const selectedBillsTotal = bills?.reduce((sum, b) => {
      const id = `bill-${b.id}`;
      return selectedSet.has(id) ? sum + b.finalValue : sum;
    }, 0) ?? 0;

    const selectedRecurringTotal = recurringForMonth.reduce((sum, r) => {
      const id = `recurring-${r.debt.id}-${r.installmentNumber}`;
      return selectedSet.has(id) ? sum + r.debt.installmentValue : sum;
    }, 0);

    return selectedBillsTotal + selectedRecurringTotal;
  }, [selectedIds, bills, recurringForMonth]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <MonthSelector month={month} year={year} onPrev={goToPrev} onNext={goToNext} />
        <HelpButton
          title="Como usar as Contas"
          items={[
            { icon: '✅', title: 'Marcar como paga', description: 'Toque no ícone à esquerda da conta para alternar entre pago e pendente.' },
            { icon: '📋', title: 'Ver ações', description: 'Toque no card da conta para expandir as opções de editar, postergar e excluir.' },
            { icon: '➡️', title: 'Postergar', description: 'O botão amarelo (→) adia a conta para o próximo mês. Ela fica marcada como "Adiado".' },
            { icon: '👆', title: 'Selecionar várias', description: 'Segure pressionado em uma conta para ativar o modo de seleção e calcular o total das selecionadas.' },
            { icon: '🔄', title: 'Dívidas recorrentes', description: 'Parcelas de dívidas recorrentes aparecem automaticamente com o ícone de setas.' },
            { icon: '➕', title: 'Adicionar conta', description: 'Use o botão + no canto inferior para cadastrar uma nova conta no mês.' },
          ]}
        />
      </div>

      {/* Summary bar */}
      <div className="flex justify-between items-center card py-3">
        <div className="text-center">
          <p className="text-xs text-[var(--color-text-secondary)]">Total</p>
          <p className="text-sm font-bold">{formatCurrency(totalDue)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--color-text-secondary)]">Pago</p>
          <p className="text-sm font-bold text-[var(--color-success)]">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--color-text-secondary)]">Pendente</p>
          <p className="text-sm font-bold text-[var(--color-danger)]">{formatCurrency(totalDue - totalPaid)}</p>
        </div>
      </div>

      {isSelectionMode && (
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">Selecionadas</p>
            <p className="text-lg font-bold">{selectedIds.length}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--color-text-secondary)]">Total selecionado</p>
            <p className="text-lg font-bold text-[var(--color-primary)]">{formatCurrency(selectedTotal)}</p>
          </div>
          <button onClick={clearSelection} className="btn-secondary py-2 px-3 text-sm">
            Limpar
          </button>
        </div>
      )}

      {/* Bills list */}
      <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
        {bills?.map((bill) => (
          <BillItem
            key={bill.id}
            bill={bill}
            selected={selectedIds.includes(`bill-${bill.id}`)}
            selectionMode={isSelectionMode}
            onSelect={() => toggleSelected(`bill-${bill.id}`)}
            onLongPress={() => toggleSelected(`bill-${bill.id}`)}
            onToggle={() => toggleStatus(bill)}
            onSkip={() => skipBill(bill)}
            onDelete={() => deleteBill(bill.id!)}
            onEdit={() => {
              setEditingBill(bill);
              setShowForm(true);
            }}
          />
        ))}
        {recurringForMonth.map((r) => (
          <RecurringBillItem
            key={`recurring-${r.debt.id}`}
            debt={r.debt}
            installmentNumber={r.installmentNumber}
            isPaid={r.isPaid}
            isOverdue={r.isOverdue}
            selected={selectedIds.includes(`recurring-${r.debt.id}-${r.installmentNumber}`)}
            selectionMode={isSelectionMode}
            onSelect={() => toggleSelected(`recurring-${r.debt.id}-${r.installmentNumber}`)}
            onLongPress={() => toggleSelected(`recurring-${r.debt.id}-${r.installmentNumber}`)}
            onToggle={() => toggleRecurringPaid(r.debt, r.installmentNumber, r.isPaid)}
            onSkip={() => skipRecurring(r.debt, r.installmentNumber)}
          />
        ))}
        {(bills?.length === 0 && recurringForMonth.length === 0) && (
          <p className="text-center text-[var(--color-text-secondary)] py-8 md:col-span-2">
            Nenhuma conta cadastrada para este mês
          </p>
        )}
      </div>

      {/* Add button */}
      <button
        onClick={() => {
          setEditingBill(null);
          setShowForm(true);
        }}
        className="fixed bottom-20 md:bottom-8 right-4 md:right-8 w-14 h-14 bg-[var(--color-primary)] text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 hover:bg-[var(--color-primary-dark)] transition-all z-40"
      >
        <Plus size={28} />
      </button>

      {/* Form modal */}
      {showForm && (
        <BillForm
          bill={editingBill}
          month={month}
          year={year}
          onClose={() => {
            setShowForm(false);
            setEditingBill(null);
          }}
        />
      )}
    </div>
  );
}

function BillItem({
  bill,
  selected,
  selectionMode,
  onSelect,
  onLongPress,
  onToggle,
  onSkip,
  onDelete,
  onEdit,
}: {
  bill: Bill;
  selected: boolean;
  selectionMode: boolean;
  onSelect: () => void;
  onLongPress: () => void;
  onToggle: () => void;
  onSkip: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const longPressTimeoutRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const isPaid = bill.status === 'paid';
  const isSkipped = bill.status === 'skipped';

  const today = new Date();
  const isOverdue =
    !isPaid &&
    bill.year === today.getFullYear() &&
    bill.month === today.getMonth() + 1 &&
    today.getDate() > bill.dueDay;

  const startLongPress = () => {
    if (longPressTimeoutRef.current) window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      onLongPress();
    }, 450);
  };

  const clearLongPress = () => {
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handleCardClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    if (selectionMode) {
      onSelect();
      return;
    }

    setShowActions(!showActions);
  };

  return (
    <div
      className={`card flex items-center gap-3 transition-all duration-200 ${
        isPaid || isSkipped ? 'opacity-60' : ''
      } ${selected ? 'ring-2 ring-[var(--color-primary)] bg-blue-500/5' : ''
      }`}
      onPointerDown={startLongPress}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onClick={handleCardClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
          isPaid
            ? 'bg-green-500/15 text-green-500'
            : isSkipped
            ? 'bg-yellow-500/15 text-yellow-500'
            : isOverdue
            ? 'bg-orange-500/15 text-orange-500'
            : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
        }`}
      >
        {isPaid ? <Check size={20} /> : isSkipped ? <ArrowRight size={20} /> : <Undo2 size={20} />}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isPaid || isSkipped ? 'line-through' : ''}`}>
          {bill.description}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[var(--color-text-secondary)]">
            Dia {bill.dueDay}
          </span>
          {bill.initialValue !== bill.finalValue && (
            <span className="text-xs text-[var(--color-text-secondary)] line-through">
              {formatCurrency(bill.initialValue)}
            </span>
          )}
          {bill.observation && (
            <span className="text-xs text-[var(--color-warning)]">• {bill.observation}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {selectionMode ? (
          <span className={selected ? 'badge-paid' : 'badge-pending'}>
            {selected ? 'Selecionada' : 'Selecionar'}
          </span>
        ) : !showActions ? (
          <>
            <span className={`text-sm font-bold ${isPaid ? 'text-[var(--color-success)]' : isSkipped ? 'text-yellow-500' : isOverdue ? 'text-[var(--color-danger)]' : ''}`}>
              {formatCurrency(bill.finalValue)}
            </span>
            {isPaid ? (
              <span className="badge-paid">Pago</span>
            ) : isSkipped ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500">Adiado</span>
            ) : isOverdue ? (
              <span className="badge-overdue">Atrasado</span>
            ) : (
              <span className="badge-pending">Pendente</span>
            )}
          </>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="p-2 rounded-lg bg-blue-500/15 text-blue-500"
            >
              <Edit3 size={16} />
            </button>
            {!isPaid && !isSkipped && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSkip();
                }}
                className="p-2 rounded-lg bg-yellow-500/15 text-yellow-500"
                title="Postergar para o próximo mês"
              >
                <ArrowRight size={16} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-2 rounded-lg bg-red-500/15 text-red-500"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RecurringBillItem({
  debt,
  installmentNumber,
  isPaid,
  isOverdue,
  selected,
  selectionMode,
  onSelect,
  onLongPress,
  onToggle,
  onSkip,
}: {
  debt: RecurringDebt;
  installmentNumber: number;
  isPaid: boolean;
  isOverdue: boolean;
  selected: boolean;
  selectionMode: boolean;
  onSelect: () => void;
  onLongPress: () => void;
  onToggle: () => void;
  onSkip: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const longPressTimeoutRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const startLongPress = () => {
    if (longPressTimeoutRef.current) window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      onLongPress();
    }, 450);
  };

  const clearLongPress = () => {
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handleCardClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    if (selectionMode) {
      onSelect();
      return;
    }

    setShowActions(!showActions);
  };

  return (
    <div
      className={`card flex items-center gap-3 transition-all duration-200 ${
        isPaid ? 'opacity-60' : ''
      } ${selected ? 'ring-2 ring-[var(--color-primary)] bg-blue-500/5' : ''
      }`}
      onPointerDown={startLongPress}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onClick={handleCardClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
          isPaid
            ? 'bg-green-500/15 text-green-500'
            : isOverdue
            ? 'bg-orange-500/15 text-orange-500'
            : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
        }`}
      >
        {isPaid ? <Check size={20} /> : <Undo2 size={20} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <RefreshCw size={12} className="text-[var(--color-primary)] flex-shrink-0" />
          <p className={`text-sm font-medium truncate ${isPaid ? 'line-through' : ''}`}>
            {debt.description}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[var(--color-text-secondary)]">
            Dia {debt.dueDay}
          </span>
          <span className="text-xs text-[var(--color-primary)]">
            Parcela {installmentNumber}/{debt.totalInstallments}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {selectionMode ? (
          <span className={selected ? 'badge-paid' : 'badge-pending'}>
            {selected ? 'Selecionada' : 'Selecionar'}
          </span>
        ) : !showActions ? (
          <>
            <span className={`text-sm font-bold ${isPaid ? 'text-[var(--color-success)]' : isOverdue ? 'text-[var(--color-danger)]' : ''}`}>
              {formatCurrency(debt.installmentValue)}
            </span>
            {isPaid ? (
              <span className="badge-paid">Pago</span>
            ) : isOverdue ? (
              <span className="badge-overdue">Atrasado</span>
            ) : (
              <span className="badge-pending">Pendente</span>
            )}
          </>
        ) : (
          <div className="flex gap-2">
            {!isPaid && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSkip();
                }}
                className="p-2 rounded-lg bg-yellow-500/15 text-yellow-500"
                title="Postergar para o próximo mês"
              >
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BillForm({
  bill,
  month,
  year,
  onClose,
}: {
  bill: Bill | null;
  month: number;
  year: number;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(bill?.description ?? '');
  const [initialValue, setInitialValue] = useState(bill?.initialValue?.toString() ?? '');
  const [finalValue, setFinalValue] = useState(bill?.finalValue?.toString() ?? '');
  const [dueDay, setDueDay] = useState(bill?.dueDay?.toString() ?? '');
  const [observation, setObservation] = useState(bill?.observation ?? '');
  const [status, setStatus] = useState<'pending' | 'paid' | 'skipped'>(bill?.status ?? 'pending');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const initial = parseFloat(initialValue.replace(',', '.')) || 0;
    const final = parseFloat(finalValue.replace(',', '.')) || initial;

    const data: Omit<Bill, 'id'> = {
      description: description.trim(),
      initialValue: initial,
      finalValue: final || initial,
      status,
      dueDay: parseInt(dueDay) || 1,
      observation: observation.trim(),
      month,
      year,
      recurringDebtId: bill?.recurringDebtId,
    };

    if (bill?.id) {
      await db.bills.update(bill.id, data);
    } else {
      await db.bills.add(data);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] w-full max-w-lg rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">{bill ? 'Editar Conta' : 'Nova Conta'}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--color-surface-2)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Descrição (ex: Energia, Internet...)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
            required
            autoFocus
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Valor (R$)"
              value={initialValue}
              onChange={(e) => {
                setInitialValue(e.target.value);
                if (!finalValue) setFinalValue(e.target.value);
              }}
              className="input-field"
              required
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Valor final (R$)"
              value={finalValue}
              onChange={(e) => setFinalValue(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Dia vencimento"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              className="input-field"
              min="1"
              max="31"
              required
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'pending' | 'paid' | 'skipped')}
              className="input-field"
            >
              <option value="pending">Pendente</option>
              <option value="paid">Pago</option>
              <option value="skipped">Adiado</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="Observação (opcional)"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="input-field"
          />

          <button type="submit" className="btn-primary w-full">
            {bill ? 'Salvar' : 'Adicionar'}
          </button>
        </form>
      </div>
    </div>
  );
}
