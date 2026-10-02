import { useRef, useState } from 'react';
import { Check, RefreshCw, ArrowRight } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { installmentFraction, isOpenEnded, type InstallmentEntry } from '../../utils/bills';

/**
 * Cartão de uma parcela de dívida parcelada que ainda não virou conta.
 *
 * Parcelas de meses anteriores que não foram pagas aparecem no mês vigente
 * com a origem ("← Setembro/2026"), como as contas adiadas — é assim que o
 * número de atrasadas da aba Dívidas bate com o que se vê aqui.
 */
export function RecurringBillItem({
  entry,
  selected,
  selectionMode,
  onSelect,
  onLongPress,
  onToggle,
  onSkip,
}: {
  entry: InstallmentEntry;
  selected: boolean;
  selectionMode: boolean;
  onSelect: () => void;
  onLongPress: () => void;
  onToggle: () => void;
  onSkip: () => void;
}) {
  const { debt, installmentNumber, isCarried } = entry;
  const isPaid = entry.status === 'paid';
  const isOverdue = entry.status === 'overdue';
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

  // Dívida sem prazo não tem "quanto falta": a barra some.
  const openEnded = isOpenEnded(debt);
  const progress = openEnded ? 0 : (installmentNumber / (debt.totalInstallments as number)) * 100;

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
          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 flex-wrap">
            <span className="text-[11px] text-[var(--color-text-tertiary)] tnum">
              {formatDate(entry.dueDate)}
            </span>
            <span className="text-[11px] font-semibold text-[var(--color-primary)] tnum">
              Parcela {installmentFraction(debt, installmentNumber)}
            </span>
            {isCarried && (
              <span className="text-[11px] font-semibold text-[var(--color-warning)]">
                ← {entry.originLabel}
              </span>
            )}
            {isOverdue && entry.overdueLabel && (
              <span className="text-[11px] font-bold text-[var(--color-danger)]">
                vencida {entry.overdueLabel}
              </span>
            )}
          </div>
          {/* Trilho de parcelas: mostra o quanto da dívida já foi andado sem
              ocupar mais uma linha de texto. */}
          {!openEnded && (
          <div
            className="mt-1.5 h-1 rounded-full overflow-hidden"
            style={{ background: 'var(--color-surface-2)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'var(--color-primary)' }}
            />
          </div>
          )}
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
          ) : isCarried ? (
            <span className="badge-overdue">Atrasada</span>
          ) : isOverdue ? (
            <span className="badge-overdue">Vencida</span>
          ) : (
            <span className="badge-pending">Pendente</span>
          )}
        </div>
      </div>

      {showActions && !selectionMode && !isPaid && (
        <div
          className="mt-3.5 pt-3.5 border-t border-[var(--color-border)] animate-rise space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-2xl p-3 bg-[var(--color-surface-2)] text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            {isCarried ? (
              <>
                Parcela de <span className="font-bold text-[var(--color-text)]">{entry.originLabel}</span>,
                venceu em <span className="font-bold text-[var(--color-text)] tnum">{formatDate(entry.dueDate)}</span>
                {entry.overdueLabel && <span className="text-[var(--color-danger)] font-bold"> ({entry.overdueLabel})</span>}.
                Ela continua aqui até ser paga. As parcelas são quitadas em ordem: a mais antiga primeiro.
              </>
            ) : (
              <>
                Parcela {openEnded ? installmentNumber : `${installmentNumber} de ${debt.totalInstallments}`}, vence em{' '}
                <span className="font-bold text-[var(--color-text)] tnum">{formatDate(entry.dueDate)}</span>.
              </>
            )}
          </div>
          {!isCarried && (
          <button
            onClick={onSkip}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-transform active:scale-95 border border-[var(--color-border)]"
            style={{ color: 'var(--color-warning)', background: 'var(--color-surface-2)' }}
          >
            <ArrowRight size={14} />
            Adiar para o próximo mês
          </button>
          )}
        </div>
      )}
    </div>
  );
}
