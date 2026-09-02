import { useState } from 'react';
import { X } from 'lucide-react';
import { db, updateRecurringDebtPaidInstallmentsWithSync } from '../../db/database';
import { getMonthName } from '../../utils/formatters';
import type { RecurringDebt } from '../../types';

/** Formulário de criação e edição de dívida parcelada. */
export function DebtForm({
  debt,
  onClose,
}: {
  debt: RecurringDebt | null;
  onClose: () => void;
}) {
  const now = new Date();
  const [description, setDescription] = useState(debt?.description ?? '');
  const [totalInstallments, setTotalInstallments] = useState(debt?.totalInstallments?.toString() ?? '');
  const [paidInstallments, setPaidInstallments] = useState(debt?.paidInstallments?.toString() ?? '0');
  const [installmentValue, setInstallmentValue] = useState(debt?.installmentValue?.toString() ?? '');
  const [dueDay, setDueDay] = useState(debt?.dueDay?.toString() ?? '');
  const [startMonth, setStartMonth] = useState(debt?.startMonth?.toString() ?? (now.getMonth() + 1).toString());
  const [startYear, setStartYear] = useState(debt?.startYear?.toString() ?? now.getFullYear().toString());
  const [observation, setObservation] = useState(debt?.observation ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const total = parseInt(totalInstallments) || 1;
    const paid = Math.min(parseInt(paidInstallments) || 0, total);

    const data: Omit<RecurringDebt, 'id'> = {
      description: description.trim(),
      totalInstallments: total,
      paidInstallments: paid,
      installmentValue: parseFloat(installmentValue.replace(',', '.')) || 0,
      dueDay: parseInt(dueDay) || 1,
      startMonth: parseInt(startMonth) || 1,
      startYear: parseInt(startYear) || now.getFullYear(),
      observation: observation.trim(),
      isActive: paid < total,
    };

    if (debt?.id) {
      await db.recurringDebts.update(debt.id, {
        ...data,
        paidInstallments: debt.paidInstallments,
      });
      await updateRecurringDebtPaidInstallmentsWithSync(debt.id, paid);
    } else {
      await db.recurringDebts.add(data);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] w-full max-w-lg rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">{debt ? 'Editar Dívida' : 'Nova Dívida Recorrente'}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--color-surface-2)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Descrição (ex: Carro, Faculdade...)"
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
              placeholder="Valor parcela (R$)"
              value={installmentValue}
              onChange={(e) => setInstallmentValue(e.target.value)}
              className="input-field"
              required
            />
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Total de parcelas"
              value={totalInstallments}
              onChange={(e) => setTotalInstallments(e.target.value)}
              className="input-field"
              min="1"
              required
            />
            <input
              type="number"
              inputMode="numeric"
              placeholder="Parcelas pagas"
              value={paidInstallments}
              onChange={(e) => setPaidInstallments(e.target.value)}
              className="input-field"
              min="0"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Mês início</label>
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="input-field"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {getMonthName(i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Ano início</label>
              <input
                type="number"
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                className="input-field"
                min="2020"
                max="2035"
              />
            </div>
          </div>

          <input
            type="text"
            placeholder="Observação (opcional)"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="input-field"
          />

          <button type="submit" className="btn-primary w-full">
            {debt ? 'Salvar' : 'Adicionar'}
          </button>
        </form>
      </div>
    </div>
  );
}
