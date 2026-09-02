import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search } from 'lucide-react';
import {
  db,
  ensureCarryOverBillsForMonth,
  ensureMonthlyBillOccurrences,
  removeCarryOverForPaidBill,
  skipBillToNextMonth,
  skipRecurringToNextMonth,
  returnBillToOriginalMonth,
  restoreBill,
  undoSkipBill,
  updateBillStatusWithSync,
  updateRecurringDebtPaidInstallmentsWithSync,
} from '../db/database';
import { formatCurrency, getMonthName } from '../utils/formatters';
import { AnimatedCurrency } from '../components/AnimatedCurrency';
import { getPostponeStatus, getRecurringStatusForMonth } from '../utils/bills';
import { useMonthNavigation } from '../hooks/useMonthNavigation';
import { MonthSelector } from '../components/MonthSelector';
import type { Bill, RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';
import { useToast } from '../components/Toast';
import { BillItem } from '../components/bills/BillItem';
import { RecurringBillItem } from '../components/bills/RecurringBillItem';
import { BillForm } from '../components/bills/BillForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ListSkeleton } from '../components/PageSpinner';

function getRecurringForMonth(debt: RecurringDebt, month: number, year: number) {
  const recurring = getRecurringStatusForMonth(debt, month, year);
  if (!recurring.applies) return null;

  return {
    installmentNumber: recurring.installmentNumber,
    isPaid: recurring.status === 'paid',
    isOverdue: recurring.status === 'overdue',
  };
}

export function MonthlyBills() {
  const { month, year, goToPrev, goToNext } = useMonthNavigation();
  const [showForm, setShowForm] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [billPendingDeletion, setBillPendingDeletion] = useState<Bill | null>(null);
  const { showToast } = useToast();

  const bills = useLiveQuery(
    () => db.bills.where({ month, year }).sortBy('dueDay'),
    [month, year]
  );

  const recurringDebts = useLiveQuery(
    () => db.recurringDebts.toArray(),
    []
  );

  useEffect(() => {
    void (async () => {
      // Primeiro as faturas do próprio mês, depois o que ficou para trás —
      // nesta ordem a conta mensal adiada encontra a fatura nova já criada.
      await ensureMonthlyBillOccurrences(month, year);
      const carried = await ensureCarryOverBillsForMonth(month, year);

      // O carry-over automático movia contas em silêncio na virada do mês; o
      // usuário via a lista mudar sem entender de onde vieram os itens.
      if (carried > 0) {
        showToast({
          message: `${carried} conta${carried > 1 ? 's atrasadas foram trazidas' : ' atrasada foi trazida'} do mês anterior.`,
          tone: 'info',
        });
      }
    })();
  }, [month, year, showToast]);

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

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredBills = useMemo(() => {
    if (!bills) return [];
    if (!normalizedSearch) return bills;

    return bills.filter((bill) =>
      [bill.description, bill.originalDescription, bill.observation]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [bills, normalizedSearch]);

  const filteredRecurringForMonth = useMemo(() => {
    if (!normalizedSearch) return recurringForMonth;

    return recurringForMonth.filter((entry) =>
      [entry.debt.description, entry.debt.observation]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [recurringForMonth, normalizedSearch]);

  const toggleStatus = async (bill: Bill) => {
    if (bill.status === 'skipped') {
      // Revert skipped: set back to pending and remove carry-over
      await updateBillStatusWithSync(bill.id!, 'pending');
      if (bill.id) {
        await removeCarryOverForPaidBill(bill.id);
      }
      return;
    }
    const newStatus = bill.status === 'paid' ? 'pending' : 'paid';
    await updateBillStatusWithSync(bill.id!, newStatus);
    if (newStatus === 'paid' && bill.id) {
      await removeCarryOverForPaidBill(bill.id);
    }
  };

  const toggleRecurringPaid = async (debt: RecurringDebt, installmentNumber: number, currentlyPaid: boolean) => {
    if (currentlyPaid) {
      // Unpay: set paidInstallments to installmentNumber - 1
      await updateRecurringDebtPaidInstallmentsWithSync(
        debt.id!,
        Math.min(debt.paidInstallments, installmentNumber - 1)
      );
    } else {
      // Pay: set paidInstallments to at least installmentNumber
      const newPaid = Math.max(debt.paidInstallments, installmentNumber);
      await updateRecurringDebtPaidInstallmentsWithSync(debt.id!, newPaid);
    }
  };

  const confirmDeleteBill = async () => {
    const bill = billPendingDeletion;
    setBillPendingDeletion(null);
    if (!bill?.id) return;

    await db.bills.delete(bill.id);
    showToast({
      message: `"${bill.originalDescription ?? bill.description}" foi excluída.`,
      tone: 'warning',
      actionLabel: 'Desfazer',
      onAction: () => restoreBill(bill),
    });
  };

  const skipBill = async (bill: Bill) => {
    if (!bill.id) return;
    const next = month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
    await skipBillToNextMonth(bill);
    showToast({
      message: `Adiada para ${getMonthName(next.month)}/${next.year}.`,
      actionLabel: 'Desfazer',
      onAction: () => undoSkipBill(bill.id as number),
    });
  };

  const returnBill = async (bill: Bill) => {
    const postpone = getPostponeStatus(bill);
    await returnBillToOriginalMonth(bill);
    showToast({
      message: `Devolvida para ${postpone.originLabel} e marcada como paga.`,
    });
  };

  const skipRecurring = async (debt: RecurringDebt, installmentNumber: number) => {
    await skipRecurringToNextMonth(debt, installmentNumber, month, year);
  };

  // useLiveQuery devolve undefined até a primeira resposta do Dexie.
  const isLoading = bills === undefined || recurringDebts === undefined;
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
    <div className="space-y-4 pb-4">
      <header className="flex items-center justify-between gap-2 pt-1">
        <MonthSelector month={month} year={year} onPrev={goToPrev} onNext={goToNext} />
        <HelpButton
          title="Como usar as Contas"
          items={[
            { icon: '✅', title: 'Marcar como paga', description: 'Toque no ícone à esquerda da conta para alternar entre pago e pendente.' },
            { icon: '📋', title: 'Ver ações', description: 'Toque no card da conta para expandir as opções de editar, postergar e excluir.' },
            { icon: '➡️', title: 'Postergar', description: 'O botão amarelo (→) adia a conta para o próximo mês. Ela fica marcada como "Adiado".' },            { icon: '↩️', title: 'Devolver ao mês original', description: 'Contas atrasadas (postergadas de outro mês) mostram o botão verde (↩) para devolver ao mês de origem e marcar como paga.' },            { icon: '🔄', title: 'Dívidas recorrentes', description: 'Parcelas de dívidas recorrentes aparecem automaticamente com o ícone de setas.' },
            { icon: '➕', title: 'Adicionar conta', description: 'Use o botão + no canto inferior para cadastrar uma nova conta no mês.' },
          ]}
        />
      </header>

      <div className="card !py-2.5 !px-4 flex items-center gap-2.5">
        <Search size={16} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Pesquisar contas e dívidas do mês"
          className="w-full bg-transparent outline-none text-sm placeholder:text-[var(--color-text-tertiary)]"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="text-xs text-[var(--color-primary)] font-bold flex-shrink-0"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Totais do mês */}
      <div className="card grid grid-cols-3 divide-x divide-[var(--color-border)]">
        <Total label="Total" value={totalDue} />
        <Total label="Pago" value={totalPaid} color="var(--color-success)" />
        <Total label="Pendente" value={totalDue - totalPaid} color="var(--color-danger)" />
      </div>

      {isSelectionMode && (
        <div className="card card-feature flex items-center justify-between gap-3 animate-rise">
          <div>
            <p className="label-caps">Selecionadas</p>
            <p className="text-xl font-extrabold tnum">{selectedIds.length}</p>
          </div>
          <div className="text-right">
            <p className="label-caps">Total selecionado</p>
            <p className="text-xl font-extrabold tnum text-[var(--color-primary)]">
              {formatCurrency(selectedTotal)}
            </p>
          </div>
          <button onClick={clearSelection} className="btn-secondary !py-2 !px-4 text-sm">
            Limpar
          </button>
        </div>
      )}

      {/* Bills list */}
      <div className="grid gap-2.5 md:grid-cols-2 stagger">
        {filteredBills.map((bill) => (
          <BillItem
            key={bill.id}
            bill={bill}
            selected={selectedIds.includes(`bill-${bill.id}`)}
            selectionMode={isSelectionMode}
            onSelect={() => toggleSelected(`bill-${bill.id}`)}
            onLongPress={() => toggleSelected(`bill-${bill.id}`)}
            onToggle={() => toggleStatus(bill)}
            onSkip={() => skipBill(bill)}
            onReturn={() => returnBill(bill)}
            onDelete={() => setBillPendingDeletion(bill)}
            onEdit={() => {
              setEditingBill(bill);
              setShowForm(true);
            }}
          />
        ))}
        {filteredRecurringForMonth.map((r) => (
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
        {isLoading && (
          <div className="md:col-span-2">
            <ListSkeleton />
          </div>
        )}
        {!isLoading && filteredBills.length === 0 && filteredRecurringForMonth.length === 0 && (
          <div className="text-center py-12 md:col-span-2">
            <p className="text-4xl mb-3">{normalizedSearch ? '🔍' : '🧾'}</p>
            <p className="text-sm font-semibold">
              {normalizedSearch
                ? `Nada encontrado para "${searchTerm}"`
                : 'Nenhuma conta neste mês'}
            </p>
            {!normalizedSearch && (
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                Toque no + para cadastrar a primeira
              </p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={billPendingDeletion !== null}
        title="Excluir conta?"
        message={
          billPendingDeletion
            ? `"${billPendingDeletion.originalDescription ?? billPendingDeletion.description}" será removida deste mês. Você poderá desfazer logo em seguida.`
            : ''
        }
        onConfirm={confirmDeleteBill}
        onCancel={() => setBillPendingDeletion(null)}
      />

      {/* Add button */}
      <button
        onClick={() => {
          setEditingBill(null);
          setShowForm(true);
        }}
        aria-label="Nova conta"
        className="fixed bottom-24 md:bottom-8 right-4 md:right-8 w-14 h-14 text-white rounded-2xl flex items-center justify-center active:scale-90 transition-transform duration-150 z-40"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          boxShadow: 'var(--shadow-primary)',
        }}
      >
        <Plus size={26} strokeWidth={2.5} />
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


/** Uma das três colunas da barra de totais do mês. */
function Total({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center px-1">
      <p className="label-caps">{label}</p>
      <AnimatedCurrency
        value={value}
        className="money-lg text-[15px] block mt-0.5"
        durationMs={500}
        style={color ? { color } : undefined}
      />
    </div>
  );
}
