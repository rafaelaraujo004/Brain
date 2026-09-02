import { useState } from 'react';
import { Trash2, Edit3, Calendar, Minus, Plus } from 'lucide-react';
import { formatCurrency, getMonthName, calculateEndDate } from '../../utils/formatters';
import type { RecurringDebt } from '../../types';

/**
 * Cartão de uma dívida parcelada.
 *
 * O que importa aqui é a distância até o fim: quantas parcelas faltam, quanto
 * ainda falta pagar e em que mês acaba. O progresso é o elemento central, com
 * marcas por parcela quando são poucas — em 12 parcelas dá para contar as
 * marcas; em 60, vira uma barra contínua.
 */
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
  const remainingValue = totalValue - paidValue;
  const endDate = calculateEndDate(debt.startMonth, debt.startYear, debt.totalInstallments);

  const today = new Date();
  const monthsSinceStart =
    (today.getFullYear() - debt.startYear) * 12 + (today.getMonth() + 1 - debt.startMonth);
  const expectedPaid = Math.min(monthsSinceStart + 1, debt.totalInstallments);
  const overdue =
    debt.isActive && debt.paidInstallments < expectedPaid ? expectedPaid - debt.paidInstallments : 0;

  const accent = !debt.isActive
    ? 'var(--color-success)'
    : overdue > 0
    ? 'var(--color-danger)'
    : 'var(--color-primary)';

  // Marcas por parcela só quando dá para distinguir a olho.
  const showTicks = debt.totalInstallments <= 24;

  return (
    <div
      className={`card card-interactive ${!debt.isActive ? 'opacity-60' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold truncate tracking-tight">{debt.description}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 tnum">
            {formatCurrency(debt.installmentValue)}/mês · dia {debt.dueDay}
          </p>
        </div>
        <div className="flex-shrink-0">
          {overdue > 0 ? (
            <span className="badge-overdue">
              {overdue} atrasada{overdue > 1 ? 's' : ''}
            </span>
          ) : !debt.isActive ? (
            <span className="badge-paid">Quitada</span>
          ) : (
            <span className="badge-pending">
              faltam {remaining}
            </span>
          )}
        </div>
      </div>

      {/* --- Progresso ---------------------------------------------------- */}
      <div className="mt-4">
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-xs font-semibold tnum">
            <span style={{ color: accent }}>{debt.paidInstallments}</span>
            <span className="text-[var(--color-text-tertiary)]">/{debt.totalInstallments}</span>
            <span className="text-[var(--color-text-tertiary)] font-normal"> parcelas</span>
          </span>
          <span className="text-xs font-bold tnum" style={{ color: accent }}>
            {Math.round(progressPercent)}%
          </span>
        </div>

        {showTicks ? (
          <div className="flex gap-[3px]">
            {Array.from({ length: debt.totalInstallments }).map((_, i) => (
              <div
                key={i}
                className="h-2 flex-1 rounded-full transition-colors duration-300"
                style={{
                  background: i < debt.paidInstallments ? accent : 'var(--color-surface-2)',
                }}
              />
            ))}
          </div>
        ) : (
          <div className="meter !h-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${progressPercent}%`, background: accent }}
            />
          </div>
        )}

        <div className="flex justify-between items-baseline mt-2">
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            falta{' '}
            <span className="font-bold text-[var(--color-text)] tnum">
              {formatCurrency(remainingValue)}
            </span>
          </span>
          <span className="text-[11px] text-[var(--color-text-tertiary)] flex items-center gap-1">
            <Calendar size={10} />
            até {getMonthName(endDate.month).slice(0, 3)}/{endDate.year}
          </span>
        </div>
      </div>

      {/* --- Detalhes e ações --------------------------------------------- */}
      {expanded && (
        <div
          className="mt-4 pt-3.5 border-t border-[var(--color-border)] space-y-3 animate-rise"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Já pago" value={formatCurrency(paidValue)} tone="var(--color-success)" />
            <Detail label="Total da dívida" value={formatCurrency(totalValue)} />
            <Detail
              label="Início"
              value={`${getMonthName(debt.startMonth).slice(0, 3)}/${debt.startYear}`}
            />
            <Detail
              label="Última parcela"
              value={`${getMonthName(endDate.month).slice(0, 3)}/${endDate.year}`}
            />
          </div>

          {debt.observation && (
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {debt.observation}
            </p>
          )}

          <div className="flex gap-2">
            {debt.isActive && (
              <>
                <button
                  onClick={onDecrement}
                  disabled={debt.paidInstallments === 0}
                  aria-label="Remover uma parcela paga"
                  className="btn-secondary !py-2.5 !px-3 disabled:opacity-40"
                >
                  <Minus size={16} />
                </button>
                <button onClick={onIncrement} className="btn-primary flex-1 !py-2.5 text-sm flex items-center justify-center gap-1.5">
                  <Plus size={16} />
                  Paguei uma parcela
                </button>
              </>
            )}
            <button
              onClick={onEdit}
              aria-label="Editar dívida"
              className="btn-icon"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}
            >
              <Edit3 size={16} />
            </button>
            <button
              onClick={onDelete}
              aria-label="Excluir dívida"
              className="btn-icon"
              style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: 'var(--color-surface-2)' }}>
      <p className="label-caps">{label}</p>
      <p className="text-sm font-bold tnum mt-0.5" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  );
}
