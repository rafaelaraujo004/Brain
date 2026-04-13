import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthName } from '../utils/formatters';

interface MonthSelectorProps {
  month: number;
  year: number;
  onPrev: () => void;
  onNext: () => void;
}

export function MonthSelector({ month, year, onPrev, onNext }: MonthSelectorProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <button
        onClick={onPrev}
        className="p-2 rounded-xl hover:bg-[var(--color-surface-2)] transition-colors active:scale-95"
      >
        <ChevronLeft size={24} />
      </button>
      <h2 className="text-lg font-bold">
        {getMonthName(month)} {year}
      </h2>
      <button
        onClick={onNext}
        className="p-2 rounded-xl hover:bg-[var(--color-surface-2)] transition-colors active:scale-95"
      >
        <ChevronRight size={24} />
      </button>
    </div>
  );
}
