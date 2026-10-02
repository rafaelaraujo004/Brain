import { CalendarClock, CircleDot, MapPin } from 'lucide-react';
import type { Bill } from '../../types';
import type { PostponeStatus } from '../../utils/bills';
import { formatCurrency, formatDate, getShortMonthName } from '../../utils/formatters';
import { resolveCostProfile } from '../../advisor/categories';
import { estimateCharges } from '../../advisor/snapshot';

function monthLabel(month: number, year: number): string {
  return `${getShortMonthName(month)}/${year}`;
}

/**
 * Histórico de adiamentos em forma de linha do tempo: onde a conta nasceu,
 * cada vez que foi empurrada e onde ela está hoje. Uma leitura de cima para
 * baixo, sem códigos — "venceu", "adiada", "está aqui".
 */
export function PostponeTimeline({ bill, status }: { bill: Bill; status: PostponeStatus }) {
  const isPaid = bill.status === 'paid';
  const informed = Math.abs(bill.finalValue - bill.initialValue) > 0.005;
  const charges =
    !isPaid && !informed && status.daysLate > 0
      ? estimateCharges(bill.finalValue, resolveCostProfile(bill), status.daysLate)
      : 0;

  const steps: Array<{ title: string; detail: string; tone: string; icon: 'origin' | 'move' | 'here' }> = [];

  const first = status.history[0];
  steps.push({
    icon: 'origin',
    title: `${status.daysLate > 0 || status.times > 0 || isPaid ? "Venceu" : "Vence"} em ${formatDate(status.originalDueDate)}`,
    detail: `Conta de ${status.originLabel}`,
    tone: status.daysLate > 0 && !isPaid ? 'var(--color-danger)' : 'var(--color-text-tertiary)',
  });

  status.history.forEach((entry) => {
    steps.push({
      icon: 'move',
      title: `Adiada em ${formatDate(entry.postponedAt)}`,
      detail: `${monthLabel(entry.fromMonth, entry.fromYear)} → ${monthLabel(entry.toMonth, entry.toYear)}${
        entry.auto ? ' · automático na virada do mês' : ''
      }`,
      tone: 'var(--color-warning)',
    });
  });

  steps.push({
    icon: 'here',
    title: isPaid
      ? `Paga em ${monthLabel(bill.month, bill.year)}`
      : bill.status === 'skipped'
      ? `Saiu de ${monthLabel(bill.month, bill.year)}`
      : `Está em ${monthLabel(bill.month, bill.year)}`,
    detail: isPaid
      ? 'Quitada'
      : bill.status === 'skipped'
      ? 'Foi adiada para o mês seguinte'
      : status.daysLate > 0
      ? `Atrasada ${status.overdueLabel}`
      : 'Dentro do prazo',
    tone: isPaid ? 'var(--color-success)' : 'var(--color-primary)',
  });

  return (
    <div className="mt-3.5 rounded-2xl p-3.5 bg-[var(--color-surface-2)]">
      {/* Resumo em três números, antes da linha do tempo */}
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        <Summary
          label="Adiada"
          value={status.times === 0 ? 'nunca' : `${status.times}x`}
          tone={status.times >= 2 ? 'var(--color-warning)' : undefined}
        />
        <Summary
          label="Atraso"
          value={isPaid || status.daysLate === 0 ? '—' : `${status.daysLate} dia${status.daysLate === 1 ? '' : 's'}`}
          tone={status.daysLate > 0 && !isPaid ? 'var(--color-danger)' : undefined}
        />
        <Summary
          label={charges > 0 ? 'C/ encargos' : 'Valor'}
          value={formatCurrency(bill.finalValue + charges)}
          tone={charges > 0 ? 'var(--color-danger)' : undefined}
        />
      </div>

      <ol className="relative">
        {steps.map((step, index) => {
          const Icon = step.icon === 'origin' ? CalendarClock : step.icon === 'here' ? MapPin : CircleDot;
          const isLast = index === steps.length - 1;
          return (
            <li key={index} className="relative flex gap-3 pb-3 last:pb-0">
              {!isLast && (
                <span
                  className="absolute left-[11px] top-6 bottom-0 w-px"
                  style={{ background: 'var(--border-strong)' }}
                />
              )}
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 relative"
                style={{ background: 'var(--color-surface)', color: step.tone, border: `1.5px solid ${step.tone}` }}
              >
                <Icon size={12} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[12px] font-bold leading-tight tnum">{step.title}</p>
                <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug mt-0.5 tnum">
                  {step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {first === undefined && !isPaid && (
        <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2">Esta conta nunca foi adiada.</p>
      )}
      {charges > 0 && (
        <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2.5 leading-relaxed">
          Encargos estimados: {formatCurrency(charges)} de multa e juros. Ajuste em Editar → Tipo e encargos.
        </p>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl px-2 py-1.5 text-center" style={{ background: 'var(--color-surface)' }}>
      <p className="label-caps !text-[9.5px]">{label}</p>
      <p className="text-[12px] font-extrabold tnum mt-0.5 truncate" style={{ color: tone }}>
        {value}
      </p>
    </div>
  );
}
