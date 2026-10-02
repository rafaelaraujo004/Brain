import { useMemo, useState } from 'react';
import { X, CalendarClock, AlertTriangle } from 'lucide-react';
import { db, reinstatePriorityOnAdd, updateRecurringDebtPaidInstallmentsWithSync } from '../../db/database';
import {
  buildDueDate,
  formatCurrency,
  formatDate,
  getMonthName,
  parseInputDate,
  parseMoneyInput,
  startOfToday,
  toInputDate,
} from '../../utils/formatters';
import type { DebtCategory, RecurringDebt } from '../../types';
import { ChargesFields, parsePercent } from '../ChargesFields';
import { nextDueDate } from './DebtCard';

function shiftMonth(month: number, year: number, delta: number): { month: number; year: number } {
  const index = year * 12 + (month - 1) + delta;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

/**
 * Formulário de criação e edição de dívida parcelada.
 *
 * O vencimento é pedido como a data completa da PRÓXIMA parcela a pagar
 * ("01/11/2026"), não como "dia + mês de início": é a informação que a
 * pessoa tem em mãos no boleto ou no app do banco. O dia da data vira o dia
 * de vencimento de todo mês, e o mês de início é deduzido descontando as
 * parcelas já pagas.
 *
 * O número de parcelas é opcional. Sem ele, a dívida cobra todo mês até ser
 * encerrada no cartão dela.
 */
export function DebtForm({
  debt,
  onClose,
}: {
  debt: RecurringDebt | null;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(debt?.description ?? '');
  const [totalInstallments, setTotalInstallments] = useState(debt?.totalInstallments?.toString() ?? '');
  const [paidInstallments, setPaidInstallments] = useState(debt?.paidInstallments?.toString() ?? '0');
  const [installmentValue, setInstallmentValue] = useState(
    debt?.installmentValue ? String(debt.installmentValue).replace('.', ',') : ''
  );
  const [nextDue, setNextDue] = useState(debt ? toInputDate(nextDueDate(debt)) : '');
  const [dateTouched, setDateTouched] = useState(false);
  const [observation, setObservation] = useState(debt?.observation ?? '');
  const [category, setCategory] = useState<DebtCategory | ''>(debt?.category ?? '');
  const [lateFee, setLateFee] = useState(debt?.lateFeePercent?.toString().replace('.', ',') ?? '');
  const [interest, setInterest] = useState(debt?.monthlyInterestPercent?.toString().replace('.', ',') ?? '');

  const parsedDate = parseInputDate(nextDue);
  const totalNumber = parseInt(totalInstallments);
  const total = Number.isFinite(totalNumber) && totalNumber > 0 ? totalNumber : undefined;
  const paid = Math.max(0, parseInt(paidInstallments) || 0);
  const boundedPaid = total !== undefined ? Math.min(paid, total) : paid;
  const value = parseMoneyInput(installmentValue);

  // Resumo do que vai acontecer, para conferir antes de salvar.
  const preview = useMemo(() => {
    if (!parsedDate) return null;
    const due = buildDueDate(parsedDate.month, parsedDate.year, parsedDate.day);
    const isPast = due < startOfToday();
    const nextNumber = boundedPaid + 1;
    const finished = total !== undefined && boundedPaid >= total;
    const last =
      total !== undefined ? shiftMonth(parsedDate.month, parsedDate.year, total - nextNumber) : null;
    return { due, isPast, nextNumber, finished, last };
  }, [parsedDate, boundedPaid, total]);

  const handlePaidChange = (raw: string) => {
    setPaidInstallments(raw);
    // Editando sem mexer na data: marcar mais uma parcela paga empurra o
    // próximo vencimento um mês, como na vida real.
    if (debt && !dateTouched) {
      const shifted = Math.max(0, parseInt(raw) || 0);
      setNextDue(toInputDate(nextDueDate({ ...debt, paidInstallments: shifted })));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsedDate) return;

    // A data informada é a da parcela seguinte às pagas, então a primeira
    // parcela foi `pagas` meses antes dela.
    const start = shiftMonth(parsedDate.month, parsedDate.year, -boundedPaid);

    const data: Omit<RecurringDebt, 'id'> = {
      description: description.trim(),
      totalInstallments: total,
      paidInstallments: boundedPaid,
      installmentValue: value,
      dueDay: parsedDate.day,
      startMonth: start.month,
      startYear: start.year,
      observation: observation.trim(),
      isActive: total === undefined || boundedPaid < total,
      category: category || undefined,
      lateFeePercent: parsePercent(lateFee),
      monthlyInterestPercent: parsePercent(interest),
    };

    if (debt?.id) {
      await db.recurringDebts.update(debt.id, {
        ...data,
        paidInstallments: debt.paidInstallments,
      });
      await updateRecurringDebtPaidInstallmentsWithSync(debt.id, boundedPaid);
    } else {
      await db.recurringDebts.add(data);
      // Dívida cadastrada de novo volta para a lista de prioridades.
      await reinstatePriorityOnAdd(data.description);
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
            {debt ? 'Editar dívida' : 'Nova dívida'}
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
            placeholder="Descrição (ex: Carro, Empréstimo…)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
            required
            autoFocus
          />

          <div>
            <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Valor da parcela</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="R$ 0,00"
              value={installmentValue}
              onChange={(e) => setInstallmentValue(e.target.value)}
              className="input-field"
              required
            />
          </div>

          <div>
            <label htmlFor="next-due" className="text-xs text-[var(--color-text-secondary)] mb-1 block">
              Data do próximo vencimento <span className="text-[var(--color-danger)]">*</span>
            </label>
            <input
              id="next-due"
              type="date"
              value={nextDue}
              onChange={(e) => {
                setNextDue(e.target.value);
                setDateTouched(true);
              }}
              className="input-field tnum"
              min="2000-01-01"
              max="2100-12-31"
              required
            />
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1 leading-relaxed">
              Dia, mês e ano da próxima parcela a pagar — ex.: em outubro, se vence todo dia 1, informe
              01/11/2026. O dia vale para todos os meses.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">
                Nº de parcelas <span className="text-[var(--color-text-tertiary)]">(opcional)</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Sem prazo"
                value={totalInstallments}
                onChange={(e) => setTotalInstallments(e.target.value)}
                className="input-field"
                min="1"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Parcelas já pagas</label>
              <input
                type="number"
                inputMode="numeric"
                value={paidInstallments}
                onChange={(e) => handlePaidChange(e.target.value)}
                className="input-field"
                min="0"
                max={total}
              />
            </div>
          </div>

          {/* Conferência: o que o app vai entender destes números */}
          {preview && (
            <div className="rounded-2xl p-3.5 space-y-1.5" style={{ background: 'var(--color-surface-2)' }}>
              <p className="flex items-start gap-2 text-sm">
                <CalendarClock size={16} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
                {preview.finished ? (
                  <span>Todas as {total} parcelas já estão pagas.</span>
                ) : (
                  <span>
                    Parcela{' '}
                    <span className="font-bold tnum">
                      {total !== undefined ? `${preview.nextNumber}/${total}` : preview.nextNumber}
                    </span>{' '}
                    vence em <span className="font-bold tnum">{formatDate(preview.due)}</span>
                    {value > 0 && <span className="tnum"> · {formatCurrency(value)}</span>}
                  </span>
                )}
              </p>
              {!preview.finished && (
                <p className="text-[11px] text-[var(--color-text-secondary)] pl-6 leading-relaxed">
                  {preview.last
                    ? `Depois, todo dia ${parsedDate?.day} até a última parcela, em ${getMonthName(preview.last.month)}/${preview.last.year}.`
                    : `Depois, todo dia ${parsedDate?.day}, sem prazo — até você encerrar a dívida.`}
                </p>
              )}
              {preview.isPast && !preview.finished && (
                <p className="flex items-start gap-2 text-[11px] font-semibold text-[var(--color-warning)] pl-6">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  Essa data já passou: a parcela vai aparecer como atrasada em Contas.
                </p>
              )}
            </div>
          )}

          <input
            type="text"
            placeholder="Observação (opcional)"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="input-field"
          />

          <ChargesFields
            description={description}
            category={category}
            lateFee={lateFee}
            interest={interest}
            onCategory={setCategory}
            onLateFee={setLateFee}
            onInterest={setInterest}
          />

          <button type="submit" className="btn-primary w-full" disabled={!parsedDate}>
            {debt ? 'Salvar' : 'Adicionar'}
          </button>
        </form>
      </div>
    </div>
  );
}
