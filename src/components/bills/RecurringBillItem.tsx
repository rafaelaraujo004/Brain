import { useRef, useState } from 'react';
import { Check, Undo2, RefreshCw, ArrowRight } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';
import type { RecurringDebt } from '../../types';

/** Cartão de uma parcela de dívida recorrente que ainda não virou conta. */
export function RecurringBillItem({
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
