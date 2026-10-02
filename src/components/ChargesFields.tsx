import { useState } from 'react';
import { ChevronDown, ShieldAlert } from 'lucide-react';
import type { DebtCategory } from '../types';
import { CATEGORY_INFO, CATEGORY_ORDER, inferCategory } from '../advisor/categories';

/** "2,5" → 2.5; vazio ou inválido → undefined (usa o padrão do tipo). */
export function parsePercent(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function formatPct(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/**
 * Tipo da dívida e encargos por atraso. Tudo opcional: o tipo é deduzido da
 * descrição e, sem percentual preenchido, a conta não tem multa nem juros.
 * Fica recolhido para não pesar o formulário de quem só quer lançar uma conta.
 */
export function ChargesFields({
  description,
  category,
  lateFee,
  interest,
  onCategory,
  onLateFee,
  onInterest,
}: {
  description: string;
  category: DebtCategory | '';
  lateFee: string;
  interest: string;
  onCategory: (value: DebtCategory | '') => void;
  onLateFee: (value: string) => void;
  onInterest: (value: string) => void;
}) {
  const hasCustom = Boolean(category || lateFee || interest);
  const [open, setOpen] = useState(hasCustom);

  const guessed = inferCategory(description);
  const effective = category || guessed;
  const info = CATEGORY_INFO[effective];
  const fee = parsePercent(lateFee) ?? 0;
  const rate = parsePercent(interest) ?? 0;
  const hasCharges = fee > 0 || rate > 0;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-3.5 text-left"
      >
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: info.essential ? 'var(--color-danger-soft)' : 'var(--color-primary-soft)',
            color: info.essential ? 'var(--color-danger)' : 'var(--color-primary)',
          }}
        >
          <ShieldAlert size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {info.label}
            <span className="font-normal text-[var(--color-text-tertiary)]">
              {category ? '' : ' · automático'}
            </span>
          </span>
          <span className="block text-[11px] text-[var(--color-text-secondary)] mt-0.5 tnum">
            {hasCharges
              ? `Se atrasar: multa ${formatPct(fee)} + juros ${formatPct(rate)} ao mês`
              : 'Sem multa nem juros — toque para cadastrar'}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="text-[var(--color-text-tertiary)] transition-transform duration-200 flex-shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 space-y-3 animate-rise">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Tipo da conta</label>
            <select
              value={category}
              onChange={(e) => onCategory(e.target.value as DebtCategory | '')}
              className="input-field"
            >
              <option value="">Automático — {CATEGORY_INFO[guessed].label}</option>
              {CATEGORY_ORDER.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_INFO[key].label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Multa (%)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={lateFee}
                onChange={(e) => onLateFee(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">Juros ao mês (%)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={interest}
                onChange={(e) => onInterest(e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
            Se não pagar: <span className="font-semibold text-[var(--color-text)]">{info.consequence}</span>.
            Em branco, a conta não soma multa nem juros.
            {info.typicalMonthlyInterestPercent > 0 &&
              ` Referência comum para ${info.label.toLowerCase()}: multa de ${formatPct(info.typicalLateFeePercent)} e juros de ${formatPct(info.typicalMonthlyInterestPercent)} ao mês.`}
          </p>
        </div>
      )}
    </div>
  );
}
