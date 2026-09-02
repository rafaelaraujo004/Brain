import { Wallet, AlertTriangle, CalendarDays } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import { getMonthlyBudget } from '../utils/bills';

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
 * Responde "quanto do meu salário ainda me resta?".
 *
 * O painel já tinha "Saldo" (renda − tudo que o mês deve), que é uma
 * projeção: o que vai sobrar SE tudo for pago. Isso não responde à pergunta
 * do dia a dia, que é quanto dinheiro ainda não saiu da conta. Os dois
 * números convivem aqui, junto com a parte que ainda está comprometida, para
 * a diferença ficar explícita em vez de virar armadilha.
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
      <div className="card flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
          <Wallet size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Quanto ainda me resta</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Cadastre seu salário em Configurações para acompanhar quanto sobra no mês.
          </p>
        </div>
      </div>
    );
  }

  // Larguras da barra. Quando as contas passam da renda, os dois primeiros
  // segmentos são normalizados pelo total devido para caber em 100%.
  const scale = Math.max(totalIncome, totalDue);
  const paidPct = (totalPaid / scale) * 100;
  const committedPct = (committed / scale) * 100;
  const freePct = Math.max(0, (free / scale) * 100);

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text-secondary)]">Ainda me resta do mês</p>
          <p
            className={`text-2xl font-bold ${
              available > 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-danger)]'
            }`}
          >
            {formatCurrency(available)}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            de {formatCurrency(totalIncome)} de renda · {formatCurrency(totalPaid)} já pago
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
          <Wallet size={20} />
        </div>
      </div>

      <div className="w-full h-3 bg-[var(--color-surface-2)] rounded-full overflow-hidden flex">
        <div
          className="h-full bg-[var(--color-success)]"
          style={{ width: `${paidPct}%` }}
          title={`Já pago: ${formatCurrency(totalPaid)}`}
        />
        <div
          className="h-full bg-[var(--color-warning)]"
          style={{ width: `${committedPct}%` }}
          title={`Comprometido: ${formatCurrency(committed)}`}
        />
        <div
          className="h-full bg-[var(--color-primary)]"
          style={{ width: `${freePct}%` }}
          title={`Livre: ${formatCurrency(free)}`}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Legend color="bg-[var(--color-success)]" label="Já pago" value={totalPaid} />
        <Legend color="bg-[var(--color-warning)]" label="Comprometido" value={committed} />
        <Legend
          color={isShort ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-primary)]'}
          label={isShort ? 'Falta' : 'Livre'}
          value={Math.abs(free)}
          highlight={isShort ? 'text-[var(--color-danger)]' : undefined}
        />
      </div>

      {isShort ? (
        <p className="text-xs text-[var(--color-danger)] flex items-center gap-1.5 leading-snug">
          <AlertTriangle size={13} className="flex-shrink-0" />
          As contas do mês passam da renda em {formatCurrency(Math.abs(free))}. Do que ainda está na
          conta, tudo já tem destino.
        </p>
      ) : (
        <p className="text-xs text-[var(--color-text-secondary)] leading-snug">
          Dos {formatCurrency(available)} que restam, {formatCurrency(committed)} ainda vão sair para
          contas — sobram {formatCurrency(free)} de verdade.
        </p>
      )}

      {perDay > 0 && (
        <p className="text-xs text-[var(--color-text-secondary)] flex items-center gap-1.5">
          <CalendarDays size={13} className="flex-shrink-0" />
          Faltam {daysLeft} dia{daysLeft > 1 ? 's' : ''} no mês:{' '}
          <span className="font-semibold text-[var(--color-text)]">
            {formatCurrency(perDay)}/dia
          </span>
        </p>
      )}
    </div>
  );
}

function Legend({
  color,
  label,
  value,
  highlight,
}: {
  color: string;
  label: string;
  value: number;
  highlight?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-center gap-1.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
        <span className="text-xs text-[var(--color-text-secondary)] truncate">{label}</span>
      </div>
      <p className={`text-sm font-bold mt-0.5 ${highlight ?? ''}`}>{formatCurrency(value)}</p>
    </div>
  );
}
