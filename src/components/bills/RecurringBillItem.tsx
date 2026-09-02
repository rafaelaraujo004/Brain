import { useRef, useState } from 'react';
import { Check, RefreshCw, ArrowRight } from 'lucide-react';
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

  const progress = (installmentNumber / debt.totalInstallments) * 100;

  return (
    <div
      className={`card card-interactive !p-3.5 ${isPaid ? 'opacity-65' : ''}`}
      style={{
        borderColor: selected ? 'var(--color-primary)' : undefined,
        boxShadow: selected ? '0 0 0 3px var(--color-primary-soft)' : undefined,
      }}
      onPointerDown={startLongPress}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onClick={handleCardClick}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={isPaid ? 'Desmarcar parcela' : 'Marcar parcela como paga'}
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-200 active:scale-90"
          style={{
            background: isPaid ? 'var(--color-success)' : 'var(--color-surface-2)',
            border: `1px solid ${isPaid ? 'transparent' : 'var(--color-border)'}`,
            color: isPaid ? '#fff' : 'var(--color-text-tertiary)',
          }}
        >
          {isPaid ? <Check size={19} strokeWidth={3} /> : <RefreshCw size={17} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <RefreshCw size={11} className="text-[var(--color-primary)] flex-shrink-0" />
            <p className={`text-sm font-semibold truncate ${isPaid ? 'line-through' : ''}`}>
              {debt.description}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-[var(--color-text-tertiary)] tnum">
              Dia {debt.dueDay}
            </span>
            <span className="text-[11px] font-semibold text-[var(--color-primary)] tnum">
              {installmentNumber}/{debt.totalInstallments}
            </span>
          </div>
          {/* Trilho de parcelas: mostra o quanto da dívida já foi andado sem
              ocupar mais uma linha de texto. */}
          <div
            className="mt-1.5 h-1 rounded-full overflow-hidden"
            style={{ background: 'var(--color-surface-2)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'var(--color-primary)' }}
            />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span
            className="money-lg text-[15px]"
            style={{
              color: isPaid
                ? undefined
                : isOverdue
                ? 'var(--color-danger)'
                : 'var(--color-text-tertiary)',
            }}
          >
            {formatCurrency(debt.installmentValue)}
          </span>
          {selectionMode ? (
            <span className={selected ? 'badge-paid' : 'badge-pending'}>
              {selected ? 'Selecionada' : 'Selecionar'}
            </span>
          ) : isPaid ? (
            <span className="badge-paid">Pago</span>
          ) : isOverdue ? (
            <span className="badge-overdue">Vencida</span>
          ) : (
            <span className="badge-pending">Pendente</span>
          )}
        </div>
      </div>

      {showActions && !selectionMode && !isPaid && (
        <div
          className="mt-3.5 pt-3.5 border-t border-[var(--color-border)] animate-rise"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onSkip}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-transform active:scale-95 border border-[var(--color-border)]"
            style={{ color: 'var(--color-warning)', background: 'var(--color-surface-2)' }}
          >
            <ArrowRight size={14} />
            Adiar para o próximo mês
          </button>
        </div>
      )}
    </div>
  );
}
