import { useMemo, useRef, useState } from 'react';
import { Check, Undo2, Trash2, Edit3, ArrowRight, Undo } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { formatPostponeSummary, formatPostponeTimeline, getPostponeStatus } from '../../utils/bills';
import type { Bill } from '../../types';

/**
 * Cartão de uma conta do mês. Concentra tudo que o usuário precisa saber
 * sobre atraso e adiamentos: desde quando a dívida se arrasta, em que data
 * cada adiamento aconteceu e há quanto tempo ela está vencida.
 */
export function BillItem({
  bill,
  selected,
  selectionMode,
  onSelect,
  onLongPress,
  onToggle,
  onSkip,
  onReturn,
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
  onReturn: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const longPressTimeoutRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const isPaid = bill.status === 'paid';
  const isSkipped = bill.status === 'skipped';

  // Todo o rastreio de adiamento vem do proprio registro — sem percorrer a
  // cadeia no banco a cada render.
  const postpone = useMemo(() => getPostponeStatus(bill), [bill]);
  const isCarried = postpone.isCarried;
  const isOverdue = postpone.isOverdue;
  const postponeSummary = formatPostponeSummary(postpone);
  const timeline = useMemo(
    () => (showActions ? formatPostponeTimeline(postpone) : []),
    [showActions, postpone]
  );

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
      className={`card transition-all duration-200 ${
        isPaid || isSkipped ? 'opacity-60' : ''
      } ${selected ? 'ring-2 ring-[var(--color-primary)] bg-blue-500/5' : ''
      } ${postpone.isLate && !isPaid && !isSkipped
        ? 'border-l-4 border-l-[var(--color-danger)]'
        : ''
      }`}
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
          {bill.originalDescription ?? bill.description}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-[var(--color-text-secondary)]">
            Vence {formatDate(postpone.currentDueDate)}
          </span>
          {isCarried && (
            <span className="text-xs font-medium text-orange-500">
              ← {postpone.originLabel}
            </span>
          )}
          {postpone.isLate && postpone.overdueLabel && (
            <span className="text-xs font-semibold text-[var(--color-danger)]">
              vencida {postpone.overdueLabel}
            </span>
          )}
          {bill.initialValue !== bill.finalValue && (
            <span className="text-xs text-[var(--color-text-secondary)] line-through">
              {formatCurrency(bill.initialValue)}
            </span>
          )}
        </div>
        {bill.observation && (
          <p className="text-xs text-[var(--color-warning)] mt-0.5 truncate">• {bill.observation}</p>
        )}
        {postponeSummary && (
          <p className="text-[11px] text-orange-400 mt-0.5 truncate">{postponeSummary}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {selectionMode ? (
          <span className={selected ? 'badge-paid' : 'badge-pending'}>
            {selected ? 'Selecionada' : 'Selecionar'}
          </span>
        ) : !showActions ? (
          <div className="flex flex-col items-end gap-1">
            <span className={`text-sm font-bold ${isPaid ? 'text-[var(--color-success)]' : isSkipped ? 'text-yellow-500' : isOverdue ? 'text-[var(--color-danger)]' : ''}`}>
              {formatCurrency(bill.finalValue)}
            </span>
            {isPaid ? (
              <span className="badge-paid">Pago</span>
            ) : isSkipped ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500">Adiado</span>
            ) : isCarried ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-500">
                Adiada {postpone.times}x
              </span>
            ) : isOverdue ? (
              <span className="badge-overdue">Vencida</span>
            ) : (
              <span className="badge-pending">Pendente</span>
            )}
          </div>
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
            {!isPaid && !isSkipped && isCarried && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReturn();
                }}
                className="p-2 rounded-lg bg-green-500/15 text-green-500"
                title={`Devolver a ${postpone.originLabel} e pagar`}
              >
                <Undo size={16} />
              </button>
            )}
            {/* Uma conta ja adiada continua podendo ser adiada: o historico
                acumula e ela nunca perde a competencia de origem. */}
            {!isPaid && !isSkipped && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSkip();
                }}
                className="p-2 rounded-lg bg-yellow-500/15 text-yellow-500"
                title={
                  isCarried
                    ? `Adiar de novo (já adiada ${postpone.times}x)`
                    : 'Postergar para o próximo mês'
                }
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

      {timeline.length > 0 && (
        <div
          className="mt-3 pt-3 border-t border-white/10 space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            Histórico de adiamentos
          </p>
          {timeline.map((line) => (
            <p key={line} className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
              {line}
            </p>
          ))}
          <p className="text-[11px] pt-1 text-[var(--color-text-secondary)]">
            Vencimento original:{' '}
            <span className="font-medium text-[var(--color-text)]">
              {formatDate(postpone.originalDueDate)}
            </span>
            {postpone.daysLate > 0 && (
              <span className="text-[var(--color-danger)] font-medium">
                {' '}— vencida {postpone.overdueLabel}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
