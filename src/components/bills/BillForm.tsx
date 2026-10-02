import { useMemo, useState } from 'react';
import { X, Check, CalendarClock, AlertTriangle } from 'lucide-react';
import {
  db,
  reinstatePriorityOnAdd,
  setBillSeriesCost,
  setBillSeriesMonthly,
  updateBillStatusWithSync,
} from '../../db/database';
import {
  buildBillDueDate,
  formatDate,
  getMonthName,
  parseInputDate,
  parseMoneyInput,
  toInputDate,
} from '../../utils/formatters';
import { getCurrentDueDate } from '../../utils/bills';
import type { Bill, DebtCategory } from '../../types';
import { ChargesFields, parsePercent } from '../ChargesFields';
import { useToast } from '../Toast';

/** Até quantos meses depois do mês da conta o vencimento pode cair. */
const MAX_DUE_OFFSET = 11;

/**
 * Formulário de criação e edição de conta.
 *
 * Pede duas coisas separadas, porque elas nem sempre coincidem:
 *
 * - o MÊS DE INÍCIO, onde a conta aparece (a competência);
 * - a DATA COMPLETA do vencimento.
 *
 * A energia de outubro que vence em 01/11/2026 aparece em outubro e vence
 * em novembro — sem isso, ou ela iria para a lista de novembro, ou ficaria
 * com um vencimento falso em outubro. A diferença entre os dois é guardada
 * como `dueMonthOffset` e acompanha a conta quando ela é adiada ou se repete.
 */
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
  const { showToast } = useToast();
  const [description, setDescription] = useState(bill?.description ?? '');
  const [initialValue, setInitialValue] = useState(
    bill?.initialValue !== undefined ? String(bill.initialValue).replace('.', ',') : ''
  );
  const [finalValue, setFinalValue] = useState(
    bill?.finalValue !== undefined ? String(bill.finalValue).replace('.', ',') : ''
  );
  const [startMonth, setStartMonth] = useState(bill?.month ?? month);
  const [startYear, setStartYear] = useState(bill?.year ?? year);
  const [dueDate, setDueDate] = useState(bill ? toInputDate(getCurrentDueDate(bill)) : '');
  const [observation, setObservation] = useState(bill?.observation ?? '');
  const [status, setStatus] = useState<'pending' | 'paid' | 'skipped'>(bill?.status ?? 'pending');
  const [isMonthly, setIsMonthly] = useState(bill?.isMonthly ?? false);
  const [category, setCategory] = useState<DebtCategory | ''>(bill?.category ?? '');
  const [lateFee, setLateFee] = useState(bill?.lateFeePercent?.toString().replace('.', ',') ?? '');
  const [interest, setInterest] = useState(bill?.monthlyInterestPercent?.toString().replace('.', ',') ?? '');

  // Conta adiada: o mês dela muda pelos botões Adiar/Devolver, não aqui —
  // senão o histórico de adiamentos deixaria de bater.
  const wasPostponed = (bill?.postponeHistory?.length ?? 0) > 0 || Boolean(bill?.carriedFromBillId);

  const parsedDue = parseInputDate(dueDate);
  const offset = parsedDue
    ? parsedDue.year * 12 + parsedDue.month - (startYear * 12 + startMonth)
    : null;
  const dateError =
    offset === null
      ? null
      : offset < 0
      ? `O vencimento não pode ser antes de ${getMonthName(startMonth)}/${startYear}, o mês da conta.`
      : offset > MAX_DUE_OFFSET
      ? 'O vencimento está mais de um ano depois do mês da conta. Confira a data.'
      : null;
  const canSave = parsedDue !== null && dateError === null;

  const preview = useMemo(() => {
    if (!parsedDue || offset === null || dateError) return null;
    const next =
      startMonth === 12 ? { month: 1, year: startYear + 1 } : { month: startMonth + 1, year: startYear };
    return {
      due: buildBillDueDate(startMonth, startYear, parsedDue.day, offset),
      nextDue: buildBillDueDate(next.month, next.year, parsedDue.day, offset),
      next,
    };
  }, [parsedDue, offset, dateError, startMonth, startYear]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsedDue || offset === null || dateError) return;

    const initial = parseMoneyInput(initialValue);
    const final = parseMoneyInput(finalValue) || initial;
    const dueMonthOffset = offset > 0 ? offset : undefined;
    const originalDueDate = buildBillDueDate(startMonth, startYear, parsedDue.day, offset).toISOString();

    const data: Omit<Bill, 'id'> = {
      description: description.trim(),
      initialValue: initial,
      finalValue: final,
      status,
      dueDay: parsedDue.day,
      dueMonthOffset,
      observation: observation.trim(),
      month: startMonth,
      year: startYear,
      recurringDebtId: bill?.recurringDebtId,
      // Vazio = automático: o tipo é deduzido da descrição e não há
      // encargos. `undefined` faz o Dexie apagar o campo na edição.
      category: category || undefined,
      lateFeePercent: parsePercent(lateFee),
      monthlyInterestPercent: parsePercent(interest),
    };

    if (bill?.id) {
      await db.bills.update(bill.id, {
        ...data,
        status: bill.status,
        // Conta nunca adiada: o mês e o vencimento escolhidos são os
        // originais. Adiada: a origem é a do histórico, não muda.
        ...(wasPostponed
          ? {}
          : { originMonth: startMonth, originYear: startYear, originalDueDate }),
      });
      await updateBillStatusWithSync(bill.id, status);
      // A marcação vale para a série inteira, não só para esta competência.
      if (isMonthly !== (bill.isMonthly ?? false)) {
        await setBillSeriesMonthly(bill.seriesId ?? bill.id, isMonthly);
      }
      // Tipo e encargos também: as faturas adiadas da mesma conta acompanham.
      const costChanged =
        data.category !== bill.category ||
        data.lateFeePercent !== bill.lateFeePercent ||
        data.monthlyInterestPercent !== bill.monthlyInterestPercent;
      if (costChanged && bill.seriesId) {
        await setBillSeriesCost(bill.seriesId, {
          category: data.category,
          lateFeePercent: data.lateFeePercent,
          monthlyInterestPercent: data.monthlyInterestPercent,
        });
      }
    } else {
      const newId = await db.bills.add({
        ...data,
        isMonthly,
        originMonth: startMonth,
        originYear: startYear,
        originalDueDate,
        postponeHistory: [],
      });
      // A primeira ocorrência dá nome à série.
      await db.bills.update(newId as number, { seriesId: newId as number });
      // Conta cadastrada de novo volta para a lista de prioridades.
      await reinstatePriorityOnAdd(data.description);
    }

    // Salva num mês diferente do que está na tela: a conta "some" da lista,
    // então é preciso dizer para onde ela foi.
    if (startMonth !== month || startYear !== year) {
      showToast({ message: `Conta salva em ${getMonthName(startMonth)}/${startYear}.`, tone: 'info' });
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

          {/* --- Mês de início ------------------------------------------- */}
          <div>
            <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">
              Mês de início <span className="text-[var(--color-text-tertiary)]">(mês em que a conta aparece)</span>
            </label>
            {wasPostponed ? (
              <p className="input-field !py-2.5 text-sm text-[var(--color-text-secondary)]">
                {getMonthName(startMonth)}/{startYear}
                <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                  Conta adiada: o mês muda pelos botões Adiar e Devolver.
                </span>
              </p>
            ) : (
              <div className="grid grid-cols-[1fr_5.5rem] gap-2">
                <select
                  value={startMonth}
                  onChange={(e) => setStartMonth(Number(e.target.value))}
                  className="input-field"
                  aria-label="Mês de início"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {getMonthName(i + 1)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value) || year)}
                  className="input-field !px-3"
                  min={2000}
                  max={2100}
                  aria-label="Ano de início"
                />
              </div>
            )}
          </div>

          {/* --- Vencimento ---------------------------------------------- */}
          <div>
            <label htmlFor="bill-due" className="text-xs text-[var(--color-text-secondary)] mb-1 block">
              Data do vencimento <span className="text-[var(--color-danger)]">*</span>
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                id="bill-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-field tnum"
                min="2000-01-01"
                max="2100-12-31"
                required
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'pending' | 'paid' | 'skipped')}
                className="input-field !w-auto"
                aria-label="Situação"
              >
                <option value="pending">Pendente</option>
                <option value="paid">Pago</option>
                <option value="skipped">Adiado</option>
              </select>
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1 leading-relaxed">
              Dia, mês e ano — ex.: a conta de outubro que vence no dia 1 do mês seguinte: 01/11/2026.
            </p>
          </div>

          {dateError && (
            <p className="flex items-start gap-2 text-xs font-semibold text-[var(--color-danger)]">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              {dateError}
            </p>
          )}

          {preview && (
            <div className="rounded-2xl p-3.5 space-y-1" style={{ background: 'var(--color-surface-2)' }}>
              <p className="flex items-start gap-2 text-sm">
                <CalendarClock size={16} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
                <span>
                  Aparece em <span className="font-bold">{getMonthName(startMonth)}/{startYear}</span> e vence em{' '}
                  <span className="font-bold tnum">{formatDate(preview.due)}</span>.
                </span>
              </p>
              {isMonthly && (
                <p className="text-[11px] text-[var(--color-text-secondary)] pl-6 tnum">
                  Todo mês igual: a de {getMonthName(preview.next.month)} vence em {formatDate(preview.nextDue)}.
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

          {/* Repetição mensal. Só liga quando o usuário marca: adiar não
              transforma uma conta em mensal. */}
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
                  ? 'Cada mês ganha a própria fatura, com o mesmo dia de vencimento. Desmarque se esta conta não volta todo mês.'
                  : 'Conta avulsa: aparece só no mês de início. Se adiar, ela vai apenas para o mês seguinte.'}
              </span>
            </span>
          </button>

          <ChargesFields
            description={description}
            category={category}
            lateFee={lateFee}
            interest={interest}
            onCategory={setCategory}
            onLateFee={setLateFee}
            onInterest={setInterest}
          />

          <button type="submit" className="btn-primary w-full disabled:opacity-40" disabled={!canSave}>
            {bill ? 'Salvar' : 'Adicionar'}
          </button>
        </form>
      </div>
    </div>
  );
}
