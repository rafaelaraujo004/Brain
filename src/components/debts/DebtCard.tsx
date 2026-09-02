import { useState } from 'react';
import { Trash2, Edit3, Calendar, Hash, CircleDollarSign } from 'lucide-react';
import { formatCurrency, getMonthName, calculateEndDate } from '../../utils/formatters';
import type { RecurringDebt } from '../../types';

/** Cartão de uma dívida parcelada, com o progresso das parcelas pagas. */
export function DebtCard({
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
