import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2, Edit3, X, Calendar, Hash, CircleDollarSign } from 'lucide-react';
import { db } from '../db/database';
import { formatCurrency, getMonthName, calculateEndDate } from '../utils/formatters';
import type { RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';

export function RecurringDebts() {
  const [showForm, setShowForm] = useState(false);
  const [editingDebt, setEditingDebt] = useState<RecurringDebt | null>(null);

  const debts = useLiveQuery(() => db.recurringDebts.toArray());

  const activeDebts = debts?.filter((d) => d.isActive) ?? [];
  const completedDebts = debts?.filter((d) => !d.isActive) ?? [];

  const deleteDebt = async (id: number) => {
    await db.recurringDebts.delete(id);
  };

  const incrementPaid = async (debt: RecurringDebt) => {
    const newPaid = Math.min(debt.paidInstallments + 1, debt.totalInstallments);
    const isComplete = newPaid >= debt.totalInstallments;
    await db.recurringDebts.update(debt.id!, {
      paidInstallments: newPaid,
      isActive: !isComplete,
    });
  };

  const decrementPaid = async (debt: RecurringDebt) => {
    const newPaid = Math.max(debt.paidInstallments - 1, 0);
    await db.recurringDebts.update(debt.id!, {
      paidInstallments: newPaid,
      isActive: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Dívidas Recorrentes</h1>
        <HelpButton
          title="Como usar Dívidas Recorrentes"
          items={[
            { icon: '➕', title: 'Adicionar dívida', description: 'Use o botão + para cadastrar uma nova dívida parcelada (ex: financiamento, empréstimo).' },
            { icon: '▲▼', title: 'Parcelas pagas', description: 'Use os botões + e - no card para incrementar ou decrementar o número de parcelas pagas.' },
            { icon: '📊', title: 'Barra de progresso', description: 'Mostra visualmente quantas parcelas já foram pagas em relação ao total.' },
            { icon: '✏️', title: 'Editar/Excluir', description: 'Toque nos ícones de editar ou lixeira para modificar ou remover uma dívida.' },
            { icon: '✅', title: 'Concluídas', description: 'Dívidas com todas as parcelas pagas aparecem na seção "Concluídas" abaixo.' },
          ]}
        />
      </div>

      {activeDebts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            Ativas ({activeDebts.length})
          </h2>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {activeDebts.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              onIncrement={() => incrementPaid(debt)}
              onDecrement={() => decrementPaid(debt)}
              onEdit={() => {
                setEditingDebt(debt);
                setShowForm(true);
              }}
              onDelete={() => deleteDebt(debt.id!)}
            />
          ))}
          </div>
        </div>
      )}

      {completedDebts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            Finalizadas ({completedDebts.length})
          </h2>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {completedDebts.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              onIncrement={() => incrementPaid(debt)}
              onDecrement={() => decrementPaid(debt)}
              onEdit={() => {
                setEditingDebt(debt);
                setShowForm(true);
              }}
              onDelete={() => deleteDebt(debt.id!)}
            />
          ))}
          </div>
        </div>
      )}

      {debts?.length === 0 && (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">
          <CircleDollarSign size={48} className="mx-auto mb-3 opacity-30" />
          <p>Nenhuma dívida recorrente cadastrada</p>
          <p className="text-sm mt-1">Toque no + para adicionar</p>
        </div>
      )}

      <button
        onClick={() => {
          setEditingDebt(null);
          setShowForm(true);
        }}
        className="fixed bottom-20 md:bottom-8 right-4 md:right-8 w-14 h-14 bg-[var(--color-primary)] text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 hover:bg-[var(--color-primary-dark)] transition-all z-40"
      >
        <Plus size={28} />
      </button>

      {showForm && (
        <DebtForm
          debt={editingDebt}
          onClose={() => {
            setShowForm(false);
            setEditingDebt(null);
          }}
        />
      )}
    </div>
  );
}

function DebtCard({
  debt,
  onIncrement,
  onDecrement,
  onEdit,
  onDelete,
}: {
  debt: RecurringDebt;
  onIncrement: () => void;
  onDecrement: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const remaining = debt.totalInstallments - debt.paidInstallments;
  const progressPercent = (debt.paidInstallments / debt.totalInstallments) * 100;
  const totalValue = debt.installmentValue * debt.totalInstallments;
  const paidValue = debt.installmentValue * debt.paidInstallments;
  const endDate = calculateEndDate(debt.startMonth, debt.startYear, debt.totalInstallments);

  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const monthsSinceStart = (currentYear - debt.startYear) * 12 + (currentMonth - debt.startMonth);
  const expectedPaid = Math.min(monthsSinceStart + 1, debt.totalInstallments);
  const overdue = debt.isActive && debt.paidInstallments < expectedPaid ? expectedPaid - debt.paidInstallments : 0;

  return (
    <div className={`card space-y-3 ${!debt.isActive ? 'opacity-50' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{debt.description}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            {formatCurrency(debt.installmentValue)}/mês • Dia {debt.dueDay}
          </p>
        </div>
        <div className="text-right flex-shrink-0 ml-2">
          {overdue > 0 ? (
            <span className="badge-overdue">{overdue} atrasada{overdue > 1 ? 's' : ''}</span>
          ) : !debt.isActive ? (
            <span className="badge-paid">Finalizada</span>
          ) : (
            <span className="badge-pending">{remaining} restante{remaining > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-[var(--color-text-secondary)] mb-1">
          <span>{debt.paidInstallments}/{debt.totalInstallments} parcelas</span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="w-full h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              !debt.isActive ? 'bg-[var(--color-success)]' : overdue > 0 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-primary)]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-[var(--color-border)]">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Hash size={14} className="text-[var(--color-text-secondary)]" />
              <span>Pago: {formatCurrency(paidValue)}</span>
            </div>
            <div className="flex items-center gap-2">
              <CircleDollarSign size={14} className="text-[var(--color-text-secondary)]" />
              <span>Total: {formatCurrency(totalValue)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-[var(--color-text-secondary)]" />
              <span>Início: {getMonthName(debt.startMonth).slice(0, 3)}/{debt.startYear}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-[var(--color-text-secondary)]" />
              <span>Fim: {getMonthName(endDate.month).slice(0, 3)}/{endDate.year}</span>
            </div>
          </div>

          {debt.observation && (
            <p className="text-xs text-[var(--color-warning)]">📝 {debt.observation}</p>
          )}

          <div className="flex gap-2">
            {debt.isActive && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onDecrement(); }}
                  className="btn-secondary flex-1 py-2 text-sm"
                  disabled={debt.paidInstallments === 0}
                >
                  - Parcela
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onIncrement(); }}
                  className="btn-primary flex-1 py-2 text-sm"
                >
                  + Parcela Paga
                </button>
              </>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-2 rounded-xl bg-blue-500/15 text-blue-500"
            >
              <Edit3 size={18} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-2 rounded-xl bg-red-500/15 text-red-500"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DebtForm({
  debt,
  onClose,
}: {
  debt: RecurringDebt | null;
  onClose: () => void;
}) {
  const now = new Date();
  const [description, setDescription] = useState(debt?.description ?? '');
  const [totalInstallments, setTotalInstallments] = useState(debt?.totalInstallments?.toString() ?? '');
  const [paidInstallments, setPaidInstallments] = useState(debt?.paidInstallments?.toString() ?? '0');
  const [installmentValue, setInstallmentValue] = useState(debt?.installmentValue?.toString() ?? '');
  const [dueDay, setDueDay] = useState(debt?.dueDay?.toString() ?? '');
  const [startMonth, setStartMonth] = useState(debt?.startMonth?.toString() ?? (now.getMonth() + 1).toString());
  const [startYear, setStartYear] = useState(debt?.startYear?.toString() ?? now.getFullYear().toString());
  const [observation, setObservation] = useState(debt?.observation ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const total = parseInt(totalInstallments) || 1;
    const paid = Math.min(parseInt(paidInstallments) || 0, total);

    const data: Omit<RecurringDebt, 'id'> = {
      description: description.trim(),
      totalInstallments: total,
      paidInstallments: paid,
      installmentValue: parseFloat(installmentValue.replace(',', '.')) || 0,
      dueDay: parseInt(dueDay) || 1,
      startMonth: parseInt(startMonth) || 1,
      startYear: parseInt(startYear) || now.getFullYear(),
      observation: observation.trim(),
      isActive: paid < total,
    };

    if (debt?.id) {
      await db.recurringDebts.update(debt.id, data);
    } else {
      await db.recurringDebts.add(data);
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
          <h3 className="text-lg font-bold">{debt ? 'Editar Dívida' : 'Nova Dívida Recorrente'}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--color-surface-2)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Descrição (ex: Carro, Faculdade...)"
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
              placeholder="Valor parcela (R$)"
              value={installmentValue}
              onChange={(e) => setInstallmentValue(e.target.value)}
              className="input-field"
              required
            />
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Total de parcelas"
              value={totalInstallments}
              onChange={(e) => setTotalInstallments(e.target.value)}
              className="input-field"
              min="1"
              required
            />
            <input
              type="number"
              inputMode="numeric"
              placeholder="Parcelas pagas"
              value={paidInstallments}
              onChange={(e) => setPaidInstallments(e.target.value)}
              className="input-field"
              min="0"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Mês início</label>
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="input-field"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {getMonthName(i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Ano início</label>
              <input
                type="number"
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                className="input-field"
                min="2020"
                max="2035"
              />
            </div>
          </div>

          <input
            type="text"
            placeholder="Observação (opcional)"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="input-field"
          />

          <button type="submit" className="btn-primary w-full">
            {debt ? 'Salvar' : 'Adicionar'}
          </button>
        </form>
      </div>
    </div>
  );
}
