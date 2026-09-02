import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthName, startOfToday } from '../utils/formatters';

interface MonthSelectorProps {
  month: number;
  year: number;
  onPrev: () => void;
  onNext: () => void;
}

export function MonthSelector({ month, year, onPrev, onNext }: MonthSelectorProps) {
  const today = startOfToday();
  const isCurrent = today.getFullYear() === year && today.getMonth() + 1 === month;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onPrev}
        aria-label="Mês anterior"
        className="btn-icon text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="px-1 text-center min-w-[9.5rem]">
        <h2 className="text-[17px] font-extrabold tracking-tight leading-tight">
          {getMonthName(month)}{' '}
          <span className="text-[var(--color-text-tertiary)] font-bold tnum">{year}</span>
        </h2>
        {/* Âncora temporal: sem isso é fácil navegar meses e esquecer onde
            você está de verdade. */}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)] h-3">
          {isCurrent ? 'Mês atual' : ''}
        </p>
      </div>

      <button
        onClick={onNext}
        aria-label="Próximo mês"
        className="btn-icon text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
