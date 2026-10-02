import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Car,
  ChartPie,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CreditCard,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  PawPrint,
  Popcorn,
  ShoppingBag,
  ShoppingCart,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { db, ensureLoanInterestBills, ensureMonthlyBillOccurrences, setSpendingOverride } from '../db/database';
import { formatCurrency, formatDate, getMonthName, getShortMonthName } from '../utils/formatters';
import { useMonthNavigation } from '../hooks/useMonthNavigation';
import { MonthSelector } from '../components/MonthSelector';
import { AnimatedCurrency } from '../components/AnimatedCurrency';
import { HelpButton } from '../components/HelpModal';
import { ListSkeleton } from '../components/PageSpinner';
import { RichText } from '../components/advisor/AnswerView';
import {
  collectSpending,
  monthIndex,
  wholeRange,
  type SpendingGroupSummary,
  type SpendingOverride,
  type SpendingRange,
} from '../spending/collect';
import { SPENDING_GROUPS, SPENDING_ORDER, inferSpendingGroup, type SpendingGroup } from '../spending/groups';
import { spendingInsights } from '../spending/insights';

type Period = 'mes' | 'ano' | 'tudo';
type SortBy = 'paid' | 'projected';

const ICONS: Record<SpendingGroup, LucideIcon> = {
  moradia: Home,
  servicos: Zap,
  alimentacao: ShoppingCart,
  transporte: Car,
  educacao: GraduationCap,
  saude: HeartPulse,
  dividas: CreditCard,
  lazer: Popcorn,
  compras: ShoppingBag,
  familia: Users,
  pets: PawPrint,
  impostos: Landmark,
  outros: CircleDashed,
};

function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  const value = (part / whole) * 100;
  return `${value < 1 && value > 0 ? '<1' : Math.round(value)}%`;
}

/**
 * Para onde vai o dinheiro: cada conta e parcela classificada por tipo de
 * gasto. O número principal é só o que já foi PAGO; o que está em aberto
 * aparece como projeção — no mesmo gráfico, num tom mais claro do mesmo roxo,
 * para não ser confundido com dinheiro que já saiu.
 */
export function Spending() {
  const { month, year, goToPrev, goToNext, goTo } = useMonthNavigation();
  const [period, setPeriod] = useState<Period>('mes');
  const [sortBy, setSortBy] = useState<SortBy>('paid');
  const [expanded, setExpanded] = useState<SpendingGroup | null>(null);

  useEffect(() => {
    void (async () => {
      await ensureLoanInterestBills(month, year);
      await ensureMonthlyBillOccurrences(month, year);
    })();
  }, [month, year]);

  const data = useLiveQuery(async () => {
    const [bills, recurringDebts, settings, monthlyConfigs, extraFunds, incomeSources] = await Promise.all([
      db.bills.toArray(),
      db.recurringDebts.toArray(),
      db.settings.toCollection().first(),
      db.monthlyConfigs.toArray(),
      db.extraFunds.toArray(),
      db.incomeSources.toArray(),
    ]);
    return { bills, recurringDebts, settings, monthlyConfigs, extraFunds, incomeSources };
  }, []);

  const overrides = useMemo((): SpendingOverride[] => {
    return (data?.settings?.spendingOverrides ?? [])
      .filter((o) => o.group in SPENDING_GROUPS)
      .map((o) => ({ keyword: o.keyword, group: o.group as SpendingGroup }));
  }, [data]);

  const range = useMemo((): SpendingRange | null => {
    if (!data) return null;
    if (period === 'mes') return { from: monthIndex(month, year), to: monthIndex(month, year) };
    if (period === 'ano') return { from: monthIndex(1, year), to: monthIndex(12, year) };
    return wholeRange(data);
  }, [data, period, month, year]);

  const report = useMemo(
    () => (data && range ? collectSpending(data, range, overrides) : null),
    [data, range, overrides]
  );

  const periodLabel =
    period === 'mes' ? `em ${getMonthName(month)}` : period === 'ano' ? `em ${year}` : 'em todo o período';
  const incomeLabel = period === 'mes' ? 'do mês' : period === 'ano' ? `de ${year} até agora` : 'até agora';

  const groups = useMemo(() => {
    if (!report) return [];
    const key = sortBy === 'paid' ? 'paid' : 'projected';
    return [...report.groups].sort((a, b) => b[key] - a[key] || b.projected - a.projected);
  }, [report, sortBy]);

  const maxProjected = Math.max(1, ...groups.map((g) => g.projected));
  const insights = report ? spendingInsights(report, period === 'mes' ? 'neste mês' : periodLabel) : [];

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 text-white"
            style={{
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              boxShadow: 'var(--shadow-primary)',
            }}
          >
            <ChartPie size={19} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight">Gastos</h1>
            <p className="text-xs text-[var(--color-text-tertiary)] truncate">Para onde vai o seu dinheiro</p>
          </div>
        </div>
        <HelpButton
          title="Como ler os Gastos"
          items={[
            { icon: '🏷️', title: 'Tipo de gasto', description: 'Cada conta e parcela é classificada pela descrição: faculdade é Educação, gasolina e carro são Transporte, mercado é Alimentação.' },
            { icon: '✅', title: 'Só o que foi pago', description: 'O número grande e a parte escura das barras contam apenas o que você já pagou.' },
            { icon: '🔮', title: 'Projeção', description: 'A parte clara das barras é o que está em aberto: mostra como fica se você pagar tudo.' },
            { icon: '✏️', title: 'Corrigir um tipo', description: 'Toque num grupo e mude o tipo de qualquer conta. Vale para todos os meses dela.' },
          ]}
        />
      </header>

      {/* --- Período ------------------------------------------------------ */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
        {(
          [
            ['mes', 'Mês'],
            ['ano', 'Ano'],
            ['tudo', 'Tudo'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            aria-pressed={period === key}
            className="py-2 rounded-xl text-xs font-bold transition-all duration-200"
            style={{
              background: period === key ? 'var(--color-surface)' : 'transparent',
              color: period === key ? 'var(--color-text)' : 'var(--color-text-tertiary)',
              boxShadow: period === key ? 'var(--shadow-md)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        {period === 'mes' && <MonthSelector month={month} year={year} onPrev={goToPrev} onNext={goToNext} />}
        {period === 'ano' && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => goTo(month, year - 1)}
              aria-label="Ano anterior"
              className="btn-icon text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
            >
              <ChevronLeft size={20} />
            </button>
            <h2 className="text-[17px] font-extrabold tracking-tight tnum min-w-[6rem] text-center">{year}</h2>
            <button
              onClick={() => goTo(month, year + 1)}
              aria-label="Próximo ano"
              className="btn-icon text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
        {period === 'tudo' && report && (
          <p className="text-sm font-bold py-2 tnum">
            {getShortMonthName((report.range.from % 12) + 1)}/{Math.floor(report.range.from / 12)} até{' '}
            {getShortMonthName((report.range.to % 12) + 1)}/{Math.floor(report.range.to / 12)}
          </p>
        )}
      </div>

      {!report ? (
        <ListSkeleton />
      ) : report.items.length === 0 ? (
        <div className="card text-center py-10">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
          >
            <ChartPie size={26} />
          </div>
          <p className="text-sm font-semibold">Nenhum gasto {periodLabel}</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">Cadastre contas para ver para onde vai o dinheiro.</p>
        </div>
      ) : (
        <>
          {/* --- Herói: o que já saiu ----------------------------------- */}
          <section className="card card-feature animate-rise">
            <p className="label-caps">Você já pagou {periodLabel}</p>
            <AnimatedCurrency
              value={report.paid}
              className="money-hero block mt-1 text-gradient"
              style={{ fontVariantNumeric: 'normal' }}
            />
            <p className="text-xs text-[var(--color-text-secondary)] mt-1.5">
              {report.open > 0 ? (
                <>
                  + <span className="font-semibold text-[var(--color-text)] tnum">{formatCurrency(report.open)}</span> em aberto ·
                  projeção <span className="font-semibold text-[var(--color-text)] tnum">{formatCurrency(report.projected)}</span>
                </>
              ) : (
                'Nada em aberto no período.'
              )}
            </p>

            {report.projected > 0 && (
              <>
                <div className="flex h-2.5 mt-4 rounded-full overflow-hidden gap-[2px]" role="img" aria-label={`Pago ${percent(report.paid, report.projected)} do total do período`}>
                  {report.paid > 0 && (
                    <div className="h-full" style={{ width: `${(report.paid / report.projected) * 100}%`, background: 'var(--viz-paid)' }} />
                  )}
                  {report.open > 0 && (
                    <div className="h-full" style={{ width: `${(report.open / report.projected) * 100}%`, background: 'var(--viz-open)' }} />
                  )}
                </div>
                <Legend paid={report.paid} open={report.open} projected={report.projected} />
              </>
            )}

            {report.income > 0 && (
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-3">
                Renda {incomeLabel}: <span className="tnum font-semibold text-[var(--color-text-secondary)]">{formatCurrency(report.income)}</span>
                {period !== 'mes' && report.elapsedMonths > 1 && (
                  <> · média paga por mês <span className="tnum font-semibold text-[var(--color-text-secondary)]">{formatCurrency(report.paid / report.elapsedMonths)}</span></>
                )}
              </p>
            )}
          </section>

          {insights.length > 0 && (
            <section className="card space-y-2 animate-rise" style={{ animationDelay: '60ms' }}>
              {insights.map((line) => (
                <p key={line} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                  <span className="w-1.5 h-1.5 rounded-full mt-[7px] flex-shrink-0" style={{ background: 'var(--color-primary)' }} />
                  <span>
                    <RichText text={line} />
                  </span>
                </p>
              ))}
            </section>
          )}

          {/* --- Por tipo de gasto ---------------------------------------- */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="label-caps !text-[var(--color-text-secondary)]">Por tipo de gasto</h2>
              <div className="flex gap-1 p-0.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                {(
                  [
                    ['paid', 'Pago'],
                    ['projected', 'Projeção'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    aria-pressed={sortBy === key}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors"
                    style={{
                      background: sortBy === key ? 'var(--color-surface)' : 'transparent',
                      color: sortBy === key ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card !p-1.5 stagger">
              {groups.map((g) => (
                <GroupRow
                  key={g.group}
                  summary={g}
                  share={sortBy === 'paid' ? percent(g.paid, report.paid) : percent(g.projected, report.projected)}
                  maxProjected={maxProjected}
                  expanded={expanded === g.group}
                  onToggle={() => setExpanded((current) => (current === g.group ? null : g.group))}
                />
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)] px-1">
              % {sortBy === 'paid' ? 'do que você já pagou' : 'da projeção (pago + em aberto)'} {periodLabel}.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Legend({ paid, open, projected }: { paid: number; open: number; projected: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
        <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--viz-paid)' }} />
        Pago {percent(paid, projected)}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
        <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--viz-open)' }} />
        Em aberto {percent(open, projected)}
      </span>
    </div>
  );
}

function GroupRow({
  summary,
  share,
  maxProjected,
  expanded,
  onToggle,
}: {
  summary: SpendingGroupSummary;
  share: string;
  maxProjected: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = ICONS[summary.group];
  const paidWidth = (summary.paid / maxProjected) * 100;
  const openWidth = (summary.open / maxProjected) * 100;

  return (
    <div className="rounded-2xl transition-colors" style={{ background: expanded ? 'var(--color-surface-2)' : undefined }}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="group relative w-full text-left px-2.5 py-3 rounded-2xl hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
          >
            <Icon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-bold truncate">
                {summary.label} <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)] tnum">{share}</span>
              </p>
              <p className="text-sm font-bold tnum flex-shrink-0">{formatCurrency(summary.paid)}</p>
            </div>

            {/* Barra: escura = pago, clara = em aberto. Mesma escala para todos os grupos. */}
            <div className="flex h-2 mt-1.5 gap-[2px]" aria-hidden="true">
              {summary.paid > 0 && (
                <div className="h-full last:rounded-r-[4px]" style={{ width: `${paidWidth}%`, background: 'var(--viz-paid)' }} />
              )}
              {summary.open > 0 && (
                <div
                  className="h-full rounded-r-[4px]"
                  style={{ width: `${openWidth}%`, background: 'var(--viz-open)' }}
                />
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1 tnum">
              {summary.open > 0
                ? `+ ${formatCurrency(summary.open)} em aberto · projeção ${formatCurrency(summary.projected)}`
                : 'nada em aberto'}
            </p>
          </div>
          <ChevronDown
            size={15}
            className="text-[var(--color-text-tertiary)] flex-shrink-0 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </div>

        {/* Dica ao passar o mouse (no celular, tocar abre o detalhe). */}
        <span
          role="tooltip"
          className="pointer-events-none absolute right-10 -top-2 z-10 hidden md:group-hover:block rounded-xl px-3 py-2 text-[11px] leading-relaxed border shadow-lg tnum"
          style={{ background: 'var(--surface-elevated)', borderColor: 'var(--color-border)' }}
        >
          <span className="block font-bold text-[var(--color-text)]">{summary.label}</span>
          <span className="block text-[var(--color-text-secondary)]">Pago {formatCurrency(summary.paid)}</span>
          <span className="block text-[var(--color-text-secondary)]">Em aberto {formatCurrency(summary.open)}</span>
          <span className="block text-[var(--color-text-secondary)]">Projeção {formatCurrency(summary.projected)}</span>
        </span>
      </button>

      {expanded && <GroupDetail summary={summary} />}
    </div>
  );
}

/** Lançamentos do grupo e, para cada conta, a opção de mudar o tipo. */
function GroupDetail({ summary }: { summary: SpendingGroupSummary }) {
  const accounts = useMemo(() => {
    const map = new Map<string, { ruleKey: string; description: string; manual: boolean; total: number; count: number }>();
    for (const item of summary.items) {
      const entry = map.get(item.ruleKey) ?? {
        ruleKey: item.ruleKey,
        description: item.description.replace(/\s*\(\d+\/\d+\)\s*$/, ''),
        manual: item.manual,
        total: 0,
        count: 0,
      };
      entry.total += item.amount;
      entry.count++;
      map.set(item.ruleKey, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [summary]);

  return (
    <div className="px-2.5 pb-3 space-y-3 animate-rise">
      <div className="rounded-2xl border overflow-hidden divide-y" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {summary.items.slice(0, 30).map((item) => (
          <div key={item.key} className="flex items-center gap-3 px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: item.status === 'paid' ? 'var(--viz-paid)' : 'var(--viz-open)' }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold truncate">{item.description}</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)] tnum">
                {item.status === 'paid' ? 'Pago' : 'Em aberto'} · {item.kind} de {getShortMonthName(item.month)}/{item.year} · venc.{' '}
                {formatDate(item.dueDate)}
              </p>
            </div>
            <span className="text-[13px] font-bold tnum flex-shrink-0">{formatCurrency(item.amount)}</span>
          </div>
        ))}
        {summary.items.length > 30 && (
          <p className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">+ {summary.items.length - 30} lançamentos</p>
        )}
      </div>

      <div>
        <p className="label-caps mb-1.5">Tipo de gasto de cada conta</p>
        <div className="space-y-1.5">
          {accounts.map((account) => (
            <div key={account.ruleKey} className="flex items-center gap-2">
              <p className="text-[12px] font-semibold flex-1 min-w-0 truncate">{account.description}</p>
              <select
                value={account.manual ? summary.group : ''}
                onChange={(e) => void setSpendingOverride(account.ruleKey, e.target.value || null)}
                aria-label={`Tipo de gasto de ${account.description}`}
                className="input-field !w-auto !py-1.5 !px-2.5 !rounded-xl text-[12px] max-w-[11rem]"
              >
                <option value="">Auto · {SPENDING_GROUPS[inferSpendingGroup(account.description)].label}</option>
                {SPENDING_ORDER.map((g) => (
                  <option key={g} value={g}>
                    {SPENDING_GROUPS[g].label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
