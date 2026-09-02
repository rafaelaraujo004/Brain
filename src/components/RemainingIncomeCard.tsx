import { Wallet, AlertTriangle, CalendarDays, ArrowRight } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import { getMonthlyBudget } from '../utils/bills';
import { AnimatedCurrency } from './AnimatedCurrency';

interface Props {
  /** Salário + rendas fixas + fundos extras do mês */
  totalIncome: number;
  /** Soma das contas já quitadas */
  totalPaid: number;
  /** Soma de tudo que o mês deve, pago ou não */
  totalDue: number;
  month: number;
  year: number;
}

/**
 * Herói da tela inicial: responde "quanto do meu salário ainda me resta?".
 *
 * O painel já tinha "Saldo" (renda − tudo que o mês deve), que é uma
 * projeção: o que vai sobrar SE tudo for pago. Isso não responde à pergunta
 * do dia a dia, que é quanto dinheiro ainda não saiu da conta. Os dois
 * números convivem aqui, junto com a parte já comprometida, para a diferença
 * ficar explícita em vez de virar armadilha.
 */
export function RemainingIncomeCard({ totalIncome, totalPaid, totalDue, month, year }: Props) {
  const { available, committed, free, isShort, daysLeft, perDay } = getMonthlyBudget(
    totalIncome,
    totalPaid,
    totalDue,
    month,
    year
  );

  if (totalIncome <= 0) {
    return (
      <div className="card card-feature flex items-center gap-3 animate-rise">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
        >
          <Wallet size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold tracking-tight">Quanto ainda me resta</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-snug">
            Cadastre seu salário em Configurações para acompanhar quanto sobra no mês.
          </p>
        </div>
        <ArrowRight size={18} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
      </div>
    );
  }

  // Quando as contas passam da renda, a escala vira o total devido — assim as
  // faixas continuam somando 100% em vez de vazarem do trilho.
  const scale = Math.max(totalIncome, totalDue);
  const pct = (v: number) => `${Math.max(0, (v / scale) * 100)}%`;

  return (
    <section className="card card-feature overflow-hidden animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-caps">Ainda me resta do mês</p>
          <AnimatedCurrency
            value={available}
            className={`money-hero block mt-1 ${
              available > 0 ? 'text-gradient' : 'text-[var(--color-danger)]'
            }`}
          />
          <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 tnum">
            de {formatCurrency(totalIncome)} de renda ·{' '}
            <span className="text-[var(--color-success)] font-semibold">
              {formatCurrency(totalPaid)} já pago
            </span>
          </p>
        </div>

        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            boxShadow: 'var(--shadow-primary)',
            color: '#fff',
          }}
        >
          <Wallet size={20} />
        </div>
      </div>

      <div className="meter mt-5">
        <div style={{ width: pct(totalPaid), background: 'var(--color-success)' }} />
        <div style={{ width: pct(committed), background: 'var(--color-warning)' }} />
        <div
          style={{
            width: pct(Math.max(0, free)),
            background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Legend color="var(--color-success)" label="Já pago" value={totalPaid} />
        <Legend color="var(--color-warning)" label="A pagar" value={committed} />
        <Legend
          color={isShort ? 'var(--color-danger)' : 'var(--color-primary)'}
          label={isShort ? 'Falta' : 'Livre'}
          value={Math.abs(free)}
          emphasis={isShort ? 'var(--color-danger)' : undefined}
        />
      </div>

      <div className="mt-4 pt-3.5 border-t border-[var(--color-border)] space-y-2">
        {isShort ? (
          <p className="text-xs text-[var(--color-danger)] flex items-start gap-2 leading-relaxed">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              As contas do mês passam da renda em{' '}
              <strong className="tnum">{formatCurrency(Math.abs(free))}</strong>. Do que ainda está
              na conta, tudo já tem destino.
            </span>
          </p>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Dos <strong className="text-[var(--color-text)] tnum">{formatCurrency(available)}</strong>{' '}
            que restam, <strong className="text-[var(--color-warning)] tnum">{formatCurrency(committed)}</strong>{' '}
            ainda vão sair para contas — sobram{' '}
            <strong className="text-[var(--color-primary)] tnum">{formatCurrency(free)}</strong> de
            verdade.
          </p>
        )}

        {perDay > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <CalendarDays size={13} className="flex-shrink-0" />
            <span>
              Faltam {daysLeft} dia{daysLeft > 1 ? 's' : ''} no mês
            </span>
            <span
              className="ml-auto px-2.5 py-1 rounded-full font-bold tnum text-[11px]"
              style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
            >
              {formatCurrency(perDay)}/dia
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function Legend({
  color,
  label,
  value,
  emphasis,
}: {
  color: string;
  label: string;
  value: number;
  emphasis?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {label}
        </span>
      </div>
      <p className="text-sm font-bold tnum mt-0.5" style={emphasis ? { color: emphasis } : undefined}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
