import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, HandCoins, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  addInformalLoan,
  db,
  deleteInformalLoan,
  loanMonthlyInterest,
  payOffInformalLoan,
  reopenInformalLoan,
  updateInformalLoanRate,
} from '../../db/database';
import type { Bill, InformalLoan } from '../../types';
import { formatCurrency, getMonthName, getShortMonthName, parseMoneyInput } from '../../utils/formatters';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';

const DEFAULT_RATE = '10';

function parseRate(raw: string): number {
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nextMonth(month: number, year: number) {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

function shortLabel(month: number, year: number) {
  return `${getShortMonthName(month)}/${year}`;
}

/**
 * Configurações → Pegar dinheiro com agiota.
 *
 * O empréstimo com agiota funciona diferente de um empréstimo de banco: o
 * percentual é cobrado todo mês sobre o valor pego e nada disso abate a
 * dívida. Os juros entram sozinhos em Contas, mês a mês, até o dia em que o
 * valor cheio é devolvido e o usuário marca aqui que quitou.
 */
export function InformalLoanSection() {
  const { showToast } = useToast();
  const today = new Date();
  const loans = useLiveQuery(() => db.loans.toArray(), []);
  const loanBills = useLiveQuery(() => db.bills.filter((b) => b.loanId !== undefined).toArray(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [lender, setLender] = useState('');
  const [takenMonth, setTakenMonth] = useState(today.getMonth() + 1);
  const [takenYear, setTakenYear] = useState(today.getFullYear());
  const [dueDay, setDueDay] = useState(String(today.getDate()));
  const [confirmPayOff, setConfirmPayOff] = useState<InformalLoan | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<InformalLoan | null>(null);
  const [showPaid, setShowPaid] = useState(false);

  const active = (loans ?? []).filter((l) => l.status === 'active');
  const paid = (loans ?? []).filter((l) => l.status === 'paid');

  const amount = parseMoneyInput(principal);
  const ratePct = parseRate(rate);
  const monthly = loanMonthlyInterest({ principal: amount, monthlyRatePercent: ratePct });
  const firstCharge = nextMonth(takenMonth, takenYear);

  const billsByLoan = useMemo(() => {
    const map = new Map<number, Bill[]>();
    for (const bill of loanBills ?? []) {
      const list = map.get(bill.loanId as number) ?? [];
      list.push(bill);
      map.set(bill.loanId as number, list);
    }
    return map;
  }, [loanBills]);

  const resetForm = () => {
    setPrincipal('');
    setRate(DEFAULT_RATE);
    setLender('');
    setTakenMonth(today.getMonth() + 1);
    setTakenYear(today.getFullYear());
    setDueDay(String(today.getDate()));
  };

  const register = async () => {
    if (amount <= 0) return;
    await addInformalLoan({
      lender: lender.trim() || 'Agiota',
      principal: amount,
      monthlyRatePercent: ratePct,
      takenMonth,
      takenYear,
      dueDay: Math.min(31, Math.max(1, parseInt(dueDay) || 1)),
    });
    showToast({
      message: `Registrado. ${formatCurrency(monthly)} de juros entram em Contas todo mês a partir de ${getMonthName(firstCharge.month)}.`,
    });
    resetForm();
    setFormOpen(false);
  };

  const payOff = async () => {
    const loan = confirmPayOff;
    setConfirmPayOff(null);
    if (!loan?.id) return;
    await payOffInformalLoan(loan.id);
    showToast({
      message: `Quitado. A devolução de ${formatCurrency(loan.principal)} entrou como paga e os juros param.`,
      actionLabel: 'Desfazer',
      onAction: () => reopenInformalLoan(loan.id as number),
    });
  };

  const remove = async () => {
    const loan = confirmDelete;
    setConfirmDelete(null);
    if (!loan?.id) return;
    await deleteInformalLoan(loan.id);
    showToast({ message: 'Empréstimo e cobranças apagados.', tone: 'warning' });
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <span
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
        >
          <HandCoins size={19} />
        </span>
        <div className="min-w-0">
          <h3 className="font-bold tracking-tight">Pegar dinheiro com agiota</h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
            Os juros entram em Contas todo mês, a partir do mês seguinte, até você devolver o valor cheio e
            marcar aqui como quitado.
          </p>
        </div>
      </div>

      {/* --- Empréstimos ativos --------------------------------------- */}
      {active.map((loan) => (
        <ActiveLoan
          key={loan.id}
          loan={loan}
          bills={billsByLoan.get(loan.id as number) ?? []}
          onPayOff={() => setConfirmPayOff(loan)}
          onDelete={() => setConfirmDelete(loan)}
        />
      ))}

      {/* --- Novo empréstimo ------------------------------------------ */}
      {!formOpen ? (
        <button onClick={() => setFormOpen(true)} className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
          <Plus size={16} />
          {active.length > 0 ? 'Registrar outro valor pego' : 'Registrar valor pego'}
        </button>
      ) : (
        <div className="rounded-2xl p-3.5 space-y-3 border animate-rise" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Novo valor pego</p>
            <button
              onClick={() => {
                setFormOpen(false);
                resetForm();
              }}
              aria-label="Cancelar"
              className="btn-icon !w-8 !h-8 text-[var(--color-text-tertiary)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-[1fr_6.5rem] gap-2.5">
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Valor que vou pegar</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="R$ 5.000,00"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                className="input-field"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Juros ao mês</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="input-field !pr-8"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-tertiary)]">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Quando peguei</label>
              <div className="grid grid-cols-[1fr_4.75rem] gap-1.5">
                <select value={takenMonth} onChange={(e) => setTakenMonth(Number(e.target.value))} className="input-field !px-3">
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {getMonthName(i + 1)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={takenYear}
                  onChange={(e) => setTakenYear(Number(e.target.value) || today.getFullYear())}
                  className="input-field !px-2.5"
                  min={2020}
                  max={2100}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Dia dos juros</label>
              <input
                type="number"
                inputMode="numeric"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className="input-field !px-3"
                min={1}
                max={31}
              />
            </div>
          </div>

          <input
            type="text"
            placeholder="Nome (opcional) — ex.: Agiota do bairro"
            value={lender}
            onChange={(e) => setLender(e.target.value)}
            className="input-field"
          />

          {amount > 0 && (
            <div className="rounded-2xl p-3 space-y-1.5" style={{ background: 'var(--color-surface)' }}>
              <p className="text-sm">
                <span className="font-extrabold tnum text-[var(--color-danger)]">{formatCurrency(monthly)}</span> de juros
                todo mês, a partir de{' '}
                <span className="font-semibold">{getMonthName(firstCharge.month)}/{firstCharge.year}</span>.
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Para quitar: devolver <span className="font-bold text-[var(--color-text)] tnum">{formatCurrency(amount)}</span> de uma vez.
                Os juros não abatem nada.
              </p>
              {monthly > 0 && (
                <p className="text-xs text-[var(--color-warning)] font-semibold tnum">
                  Em 12 meses: {formatCurrency(monthly * 12)} só de juros
                  {monthly * 12 >= amount ? ' — mais do que o valor pego.' : '.'}
                </p>
              )}
            </div>
          )}

          <button onClick={register} disabled={amount <= 0} className="btn-primary w-full disabled:opacity-40">
            Registrar
          </button>
        </div>
      )}

      {/* --- Quitados --------------------------------------------------- */}
      {paid.length > 0 && (
        <div>
          <button
            onClick={() => setShowPaid((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold text-[var(--color-text-secondary)] py-1"
          >
            Quitados ({paid.length})
            <ChevronDown size={14} className="transition-transform" style={{ transform: showPaid ? 'rotate(180deg)' : 'none' }} />
          </button>
          {showPaid && (
            <div className="space-y-2 mt-2 animate-rise">
              {paid.map((loan) => {
                const bills = billsByLoan.get(loan.id as number) ?? [];
                const interestPaid = bills.filter((b) => !b.loanPayoff && b.status === 'paid').reduce((s, b) => s + b.finalValue, 0);
                return (
                  <div key={loan.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5" style={{ background: 'var(--color-surface-2)' }}>
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}>
                      <Check size={14} strokeWidth={3} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">
                        {loan.lender} · {formatCurrency(loan.principal)}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-secondary)] tnum">
                        {shortLabel(loan.takenMonth, loan.takenYear)} → quitado em{' '}
                        {loan.paidOffMonth && loan.paidOffYear ? shortLabel(loan.paidOffMonth, loan.paidOffYear) : '—'} · juros
                        pagos {formatCurrency(interestPaid)}
                      </p>
                    </div>
                    <button
                      onClick={() => setConfirmDelete(loan)}
                      aria-label="Apagar registro"
                      className="btn-icon !w-8 !h-8 text-[var(--color-text-tertiary)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmPayOff !== null}
        title="Marcar como quitado?"
        message={
          confirmPayOff
            ? `Confirme que devolveu os ${formatCurrency(confirmPayOff.principal)} cheios. A devolução entra como paga em ${getMonthName(today.getMonth() + 1)}, os juros deste mês continuam devidos e a partir do mês que vem não há mais cobrança.`
            : ''
        }
        confirmLabel="Quitei"
        destructive={false}
        onConfirm={payOff}
        onCancel={() => setConfirmPayOff(null)}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Apagar este empréstimo?"
        message="O registro e todas as cobranças de juros que ele gerou em Contas (pagas ou não) serão apagados. Use só se foi lançado por engano."
        confirmLabel="Apagar"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ActiveLoan({
  loan,
  bills,
  onPayOff,
  onDelete,
}: {
  loan: InformalLoan;
  bills: Bill[];
  onPayOff: () => void;
  onDelete: () => void;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState(String(loan.monthlyRatePercent).replace('.', ','));
  const monthly = loanMonthlyInterest(loan);
  const charges = bills.filter((b) => !b.loanPayoff);
  const paidCharges = charges.filter((b) => b.status === 'paid');
  const interestPaid = paidCharges.reduce((s, b) => s + b.finalValue, 0);
  const pending = charges.filter((b) => b.status === 'pending');
  const pendingAmount = pending.reduce((s, b) => s + b.finalValue, 0);
  const first = nextMonth(loan.takenMonth, loan.takenYear);

  const saveRate = async () => {
    const value = parseRate(rateInput);
    if (loan.id && value !== loan.monthlyRatePercent) await updateInformalLoanRate(loan.id, value);
    setEditingRate(false);
  };

  return (
    <div
      className="rounded-2xl p-3.5 border space-y-3"
      style={{ borderColor: 'color-mix(in srgb, var(--color-danger) 35%, transparent)', background: 'var(--color-surface-2)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{loan.lender}</p>
          <p className="text-[11px] text-[var(--color-text-secondary)] tnum">
            Pego em {shortLabel(loan.takenMonth, loan.takenYear)} · juros desde {shortLabel(first.month, first.year)}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="label-caps !text-[10px]">Para quitar</p>
          <p className="text-lg font-extrabold tnum tracking-tight text-[var(--color-danger)] leading-tight">
            {formatCurrency(loan.principal)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--color-surface)' }}>
          <p className="label-caps !text-[9.5px]">Juros/mês</p>
          {editingRate ? (
            <div className="flex items-center gap-1 mt-0.5">
              <input
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                inputMode="decimal"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveRate()}
                className="w-full min-w-0 bg-transparent outline-none text-[13px] font-extrabold tnum border-b border-[var(--color-primary)]"
              />
              <span className="text-xs">%</span>
              <button onClick={saveRate} aria-label="Salvar percentual" className="text-[var(--color-success)]">
                <Check size={14} />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingRate(true)} className="flex items-center gap-1 mt-0.5 text-left" aria-label="Alterar percentual">
              <span className="text-[13px] font-extrabold tnum">{formatCurrency(monthly)}</span>
              <Pencil size={10} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
            </button>
          )}
          <p className="text-[10px] text-[var(--color-text-tertiary)] tnum">{loan.monthlyRatePercent.toLocaleString('pt-BR')}% do valor</p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--color-surface)' }}>
          <p className="label-caps !text-[9.5px]">Já pagos</p>
          <p className="text-[13px] font-extrabold tnum mt-0.5">{formatCurrency(interestPaid)}</p>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">
            {paidCharges.length} {paidCharges.length === 1 ? 'mês' : 'meses'}
          </p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--color-surface)' }}>
          <p className="label-caps !text-[9.5px]">Em aberto</p>
          <p className="text-[13px] font-extrabold tnum mt-0.5" style={{ color: pending.length ? 'var(--color-warning)' : undefined }}>
            {formatCurrency(pendingAmount)}
          </p>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">
            {pending.length} {pending.length === 1 ? 'cobrança' : 'cobranças'}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onPayOff} className="btn-primary flex-1 !py-2.5 text-sm">
          Quitei — devolvi {formatCurrency(loan.principal)}
        </button>
        <button
          onClick={onDelete}
          aria-label="Apagar empréstimo"
          className="btn-icon !w-11 !h-11"
          style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
