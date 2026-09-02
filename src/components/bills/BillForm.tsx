import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { db, setBillSeriesMonthly, updateBillStatusWithSync } from '../../db/database';
import { buildDueDate } from '../../utils/formatters';
import type { Bill } from '../../types';

/** Formulário de criação e edição de conta. */
export function BillForm({
  bill,
  month,
  year,
  onClose,
}: {
  bill: Bill | null;
  month: number;
  year: number;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(bill?.description ?? '');
  const [initialValue, setInitialValue] = useState(bill?.initialValue?.toString() ?? '');
  const [finalValue, setFinalValue] = useState(bill?.finalValue?.toString() ?? '');
  const [dueDay, setDueDay] = useState(bill?.dueDay?.toString() ?? '');
  const [observation, setObservation] = useState(bill?.observation ?? '');
  const [status, setStatus] = useState<'pending' | 'paid' | 'skipped'>(bill?.status ?? 'pending');
  const [isMonthly, setIsMonthly] = useState(bill?.isMonthly ?? false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const initial = parseFloat(initialValue.replace(',', '.')) || 0;
    const final = parseFloat(finalValue.replace(',', '.')) || initial;

    const data: Omit<Bill, 'id'> = {
      description: description.trim(),
      initialValue: initial,
      finalValue: final || initial,
      status,
      dueDay: parseInt(dueDay) || 1,
      observation: observation.trim(),
      month,
      year,
      recurringDebtId: bill?.recurringDebtId,
    };

    if (bill?.id) {
      await db.bills.update(bill.id, { ...data, status: bill.status });
      await updateBillStatusWithSync(bill.id, status);
      // A marcação vale para a série inteira, não só para esta competência.
      if (isMonthly !== (bill.isMonthly ?? false)) {
        await setBillSeriesMonthly(bill.seriesId ?? bill.id, isMonthly);
      }
    } else {
      const day = parseInt(dueDay) || 1;
      const newId = await db.bills.add({
        ...data,
        isMonthly,
        originMonth: month,
        originYear: year,
        originalDueDate: buildDueDate(month, year, day).toISOString(),
        postponeHistory: [],
      });
      // A primeira ocorrência dá nome à série.
      await db.bills.update(newId as number, { seriesId: newId as number });
    }

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center animate-fade"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="animate-sheet w-full max-w-lg rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 space-y-4 max-h-[90vh] overflow-y-auto border border-[var(--color-border)]"
        style={{ background: 'var(--surface-elevated)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold tracking-tight">
            {bill ? 'Editar conta' : 'Nova conta'}
          </h3>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="btn-icon hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Descrição (ex: Energia, Internet...)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
            required
            autoFocus
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Valor (R$)"
              value={initialValue}
              onChange={(e) => {
                setInitialValue(e.target.value);
                if (!finalValue) setFinalValue(e.target.value);
              }}
              className="input-field"
              required
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Valor final (R$)"
              value={finalValue}
              onChange={(e) => setFinalValue(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Dia vencimento"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              className="input-field"
              min="1"
              max="31"
              required
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'pending' | 'paid' | 'skipped')}
              className="input-field"
            >
              <option value="pending">Pendente</option>
              <option value="paid">Pago</option>
              <option value="skipped">Adiado</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="Observação (opcional)"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="input-field"
          />

          {/* Repetição mensal. Liga sozinha no primeiro adiamento, então o
              texto serve mais para explicar o que já está acontecendo e para
              dar o caminho de volta em conta que era mesmo avulsa. */}
          <button
            type="button"
            onClick={() => setIsMonthly((v) => !v)}
            aria-pressed={isMonthly}
            className="w-full flex items-start gap-3 p-3.5 rounded-2xl border text-left transition-colors duration-200"
            style={{
              background: isMonthly ? 'var(--color-primary-soft)' : 'var(--color-surface-2)',
              borderColor: isMonthly ? 'var(--color-primary)' : 'var(--color-border)',
            }}
          >
            <span
              className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-200"
              style={{
                background: isMonthly ? 'var(--color-primary)' : 'transparent',
                border: isMonthly ? 'none' : '1.5px solid var(--color-text-tertiary)',
                color: '#fff',
              }}
            >
              {isMonthly && <Check size={13} strokeWidth={3.5} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Repete todo mês</span>
              <span className="block text-[11px] text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
                {isMonthly
                  ? 'Cada mês ganha a própria fatura, e a adiada se soma à nova — três meses sem pagar viram três dívidas separadas. Desmarque se esta conta não volta todo mês.'
                  : 'Conta avulsa: não gera fatura nos meses seguintes. Adiar liga esta opção automaticamente.'}
              </span>
            </span>
          </button>

          <button type="submit" className="btn-primary w-full">
            {bill ? 'Salvar' : 'Adicionar'}
          </button>
        </form>
      </div>
    </div>
  );
}
