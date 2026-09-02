import { useMemo, useRef, useState } from 'react';
import { Check, Trash2, Edit3, ArrowRight, Undo, Clock } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { formatPostponeSummary, formatPostponeTimeline, getPostponeStatus } from '../../utils/bills';
import type { Bill } from '../../types';

/**
 * Cartão de uma conta do mês.
 *
 * Concentra tudo que o usuário precisa saber sobre atraso e adiamentos:
 * desde quando a dívida se arrasta, em que data cada adiamento aconteceu e há
 * quanto tempo ela está vencida. As ações ficam escondidas até o toque para a
 * lista respirar — o estado normal é de leitura, não de operação.
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

  // Todo o rastreio de adiamento vem do próprio registro — sem percorrer a
  // cadeia no banco a cada render.
  const postpone = useMemo(() => getPostponeStatus(bill), [bill]);
  const isCarried = postpone.isCarried;
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
    setShowActions((v) => !v);
  };

  // Uma cor por estado, usada na borda, no selo e no valor — para o estado
  // ser legível de relance sem precisar ler nada.
  const accent = isPaid
    ? 'var(--color-success)'
    : isSkipped
    ? 'var(--color-warning)'
    : postpone.isLate
    ? 'var(--color-danger)'
    : 'var(--color-text-tertiary)';

  return (
    <div
      className={`card card-interactive !p-3.5 ${isPaid || isSkipped ? 'opacity-65' : ''}`}
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
        {/* Botão de pagar. É a ação mais frequente da tela, então ganha o
            canto esquerdo e o maior alvo de toque do cartão. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={isPaid ? 'Desmarcar pagamento' : 'Marcar como paga'}
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-200 active:scale-90"
          style={{
            background: isPaid ? 'var(--color-success)' : 'var(--color-surface-2)',
            border: `1px solid ${isPaid ? 'transparent' : 'var(--color-border)'}`,
            color: isPaid ? '#fff' : 'var(--color-text-tertiary)',
          }}
        >
          {isPaid ? <Check size={19} strokeWidth={3} /> : isSkipped ? <ArrowRight size={18} /> : null}
        </button>

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-semibold truncate ${
              isPaid ? 'line-through text-[var(--color-text-secondary)]' : ''
            }`}
          >
            {bill.originalDescription ?? bill.description}
          </p>

          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 flex-wrap">
            <span className="text-[11px] text-[var(--color-text-tertiary)] tnum">
              {formatDate(postpone.currentDueDate)}
            </span>
            {isCarried && (
              <span className="text-[11px] font-semibold text-[var(--color-warning)]">
                ← {postpone.originLabel}
              </span>
            )}
            {postpone.isLate && postpone.overdueLabel && (
              <span className="text-[11px] font-bold text-[var(--color-danger)]">
                vencida {postpone.overdueLabel}
              </span>
            )}
            {bill.initialValue !== bill.finalValue && (
              <span className="text-[11px] text-[var(--color-text-tertiary)] line-through tnum">
                {formatCurrency(bill.initialValue)}
              </span>
            )}
          </div>

          {bill.observation && (
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 truncate">
              {bill.observation}
            </p>
          )}
          {postponeSummary && (
            <p className="text-[11px] text-[var(--color-warning)] mt-0.5 truncate flex items-center gap-1">
              <Clock size={10} className="flex-shrink-0" />
              {postponeSummary}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="money-lg text-[15px]" style={{ color: isPaid ? undefined : accent }}>
            {formatCurrency(bill.finalValue)}
          </span>
          {selectionMode ? (
            <span className={selected ? 'badge-paid' : 'badge-pending'}>
              {selected ? 'Selecionada' : 'Selecionar'}
            </span>
          ) : isPaid ? (
            <span className="badge-paid">Pago</span>
          ) : isSkipped ? (
            <span className="badge-postponed">Adiado</span>
          ) : isCarried ? (
            <span className="badge-postponed">Adiada {postpone.times}x</span>
          ) : postpone.isOverdue ? (
            <span className="badge-overdue">Vencida</span>
          ) : (
            <span className="badge-pending">Pendente</span>
          )}
        </div>
      </div>

      {/* --- Painel de ações e histórico --------------------------------- */}
      {showActions && !selectionMode && (
        <div
          className="mt-3.5 pt-3.5 border-t border-[var(--color-border)] animate-rise"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={onEdit} icon={<Edit3 size={14} />} label="Editar" />
            {!isPaid && !isSkipped && isCarried && (
              <ActionButton
                onClick={onReturn}
                icon={<Undo size={14} />}
                label={`Devolver a ${postpone.originLabel}`}
                tone="var(--color-success)"
              />
            )}
            {/* Uma conta já adiada continua podendo ser adiada: o histórico
                acumula e ela nunca perde a competência de origem. */}
            {!isPaid && !isSkipped && (
              <ActionButton
                onClick={onSkip}
                icon={<ArrowRight size={14} />}
                label={isCarried ? 'Adiar de novo' : 'Adiar'}
                tone="var(--color-warning)"
              />
            )}
            <ActionButton
              onClick={onDelete}
              icon={<Trash2 size={14} />}
              label="Excluir"
              tone="var(--color-danger)"
            />
          </div>

          {timeline.length > 0 && (
            <div className="mt-3.5 rounded-2xl p-3 bg-[var(--color-surface-2)] space-y-1.5">
              <p className="label-caps">Histórico de adiamentos</p>
              {timeline.map((line) => (
                <p
                  key={line}
                  className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed tnum"
                >
                  {line}
                </p>
              ))}
              <p className="text-[11px] pt-1.5 border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
                Vencimento original:{' '}
                <span className="font-bold text-[var(--color-text)] tnum">
                  {formatDate(postpone.originalDueDate)}
                </span>
                {postpone.daysLate > 0 && (
                  <span className="text-[var(--color-danger)] font-bold">
                    {' '}
                    — vencida {postpone.overdueLabel}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  tone,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 active:scale-95 border"
      style={{
        color: tone ?? 'var(--color-text-secondary)',
        background: 'var(--color-surface-2)',
        borderColor: 'var(--color-border)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
