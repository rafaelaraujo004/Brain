import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Check, ChevronDown, Layers, PartyPopper, X } from 'lucide-react';
import { useFinancialSnapshot } from '../advisor/useFinancialSnapshot';
import { rankDebts, computeTotals } from '../advisor/strategy';
import type { RankedDebt } from '../advisor/types';
import { formatCurrency, formatDate, getMonthName } from '../utils/formatters';
import { AnimatedCurrency } from '../components/AnimatedCurrency';
import { HelpButton } from '../components/HelpModal';
import { ListSkeleton } from '../components/PageSpinner';

type GroupMode = 'conta' | 'mes' | 'tipo' | 'lista';
type Scope = 'atraso' | 'aberto';

interface Group {
  key: string;
  title: string;
  subtitle: string;
  items: RankedDebt[];
  total: number;
  amount: number;
}

const GROUP_LABELS: Record<GroupMode, string> = {
  conta: 'Por conta',
  mes: 'Por mês',
  tipo: 'Por tipo',
  lista: 'Lista',
};

function cleanName(description: string): string {
  return description.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

function monthTitle(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${getMonthName(month)}/${year}`;
}

function buildGroups(debts: RankedDebt[], mode: GroupMode): Group[] {
  if (mode === 'lista') {
    return debts.map((d) => ({
      key: d.id,
      title: d.description,
      subtitle: d.originLabel,
      items: [d],
      total: d.updatedAmount,
      amount: d.amount,
    }));
  }

  const map = new Map<string, RankedDebt[]>();
  for (const debt of debts) {
    const key = mode === 'conta' ? debt.groupKey : mode === 'mes' ? debt.originKey : debt.category;
    const list = map.get(key) ?? [];
    list.push(debt);
    map.set(key, list);
  }

  const groups = [...map.entries()].map(([key, items]) => {
    const first = items[0];
    const title =
      mode === 'conta' ? cleanName(first.description) : mode === 'mes' ? monthTitle(key) : first.categoryLabel;
    const oldest = items.reduce((a, b) => (a.daysLate >= b.daysLate ? a : b));
    const count = `${items.length} ${items.length === 1 ? 'dívida' : 'dívidas'}`;
    const subtitle =
      mode === 'conta'
        ? items.length > 1
          ? `${items.length} faturas · desde ${oldest.originLabel}`
          : `${first.originLabel}${first.postponedTimes ? ` · adiada ${first.postponedTimes}x` : ''}`
        : mode === 'mes'
        ? `${count} · venceram neste mês`
        : count;
    return {
      key,
      title,
      subtitle,
      items: [...items].sort((a, b) => a.originalDueDate.getTime() - b.originalDueDate.getTime()),
      total: items.reduce((s, d) => s + d.updatedAmount, 0),
      amount: items.reduce((s, d) => s + d.amount, 0),
    };
  });

  if (mode === 'mes') return groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups.sort((a, b) => b.total - a.total);
}

/**
 * Pressionar e segurar entra no modo de seleção; depois disso, um toque
 * marca e desmarca. Mesmo gesto da tela de Contas.
 */
function usePressable(onLongPress: () => void, onTap: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(12);
        onLongPress();
      }, 450);
    },
    // Rolar a tela não pode virar seleção.
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return;
      if (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  };
}

export function DebtsByAccount() {
  const snapshot = useFinancialSnapshot();
  const navigate = useNavigate();
  const [mode, setMode] = useState<GroupMode>('conta');
  const [scope, setScope] = useState<Scope>('atraso');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const debts = useMemo(() => {
    if (!snapshot) return [];
    if (scope === 'atraso') return snapshot.overdue;
    return rankDebts([...snapshot.overdue, ...snapshot.upcoming]);
  }, [snapshot, scope]);

  const totals = useMemo(() => computeTotals(debts), [debts]);
  const groups = useMemo(() => buildGroups(debts, mode), [debts, mode]);
  const selectedDebts = useMemo(() => debts.filter((d) => selected.has(d.id)), [debts, selected]);
  const selectedTotals = useMemo(() => computeTotals(selectedDebts), [selectedDebts]);
  const selecting = selected.size > 0;

  const toggleIds = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const askAboutSelection = () => {
    navigate('/assistente', {
      state: {
        scopeIds: [...selected],
        ask: 'Qual a melhor forma de quitar estas dívidas?',
      },
    });
  };

  // Faixas da barra: essenciais, caras e o resto.
  const tiers = useMemo(() => {
    const sum = (t: number[]) => debts.filter((d) => t.includes(d.tier)).reduce((s, d) => s + d.updatedAmount, 0);
    return [
      { label: 'Essenciais', value: sum([0]), color: 'var(--color-danger)' },
      { label: 'Com juros', value: sum([1]), color: 'var(--color-warning)' },
      { label: 'Demais', value: sum([2, 3]), color: 'var(--color-primary)' },
    ];
  }, [debts]);

  return (
    <div className={`space-y-4 ${selecting ? 'pb-36' : 'pb-4'}`}>
      <header className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 text-white"
            style={{
              background: 'linear-gradient(135deg, var(--color-danger), var(--color-accent))',
              boxShadow: 'var(--shadow-primary)',
            }}
          >
            <Layers size={19} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight">Dívidas por conta</h1>
            <p className="text-xs text-[var(--color-text-tertiary)] truncate">
              Quanto você deve em cada conta, somando todos os meses
            </p>
          </div>
        </div>
        <HelpButton
          title="Dívidas por conta"
          items={[
            { icon: '🧮', title: 'Total por conta', description: 'Cada cartão soma todas as faturas em aberto da mesma conta — energia de agosto, setembro e outubro viram um total só.' },
            { icon: '👆', title: 'Pressione e segure', description: 'Segure uma conta ou uma fatura para começar a selecionar. Depois, cada toque marca ou desmarca. A soma aparece embaixo.' },
            { icon: '📂', title: 'Ver as faturas', description: 'Toque na seta do cartão para ver cada fatura com o mês de origem, o vencimento e quantas vezes foi adiada.' },
            { icon: '💸', title: 'Encargos', description: 'O valor com encargos é uma estimativa de multa e juros pelo tipo da conta. Ajuste em Contas → Editar → Tipo e encargos.' },
            { icon: '🧠', title: 'Perguntar', description: 'Com dívidas selecionadas, toque em Perguntar para o assistente analisar só elas.' },
          ]}
        />
      </header>

      {snapshot === undefined ? (
        <ListSkeleton />
      ) : (
        <>
          {/* --- Total ---------------------------------------------------- */}
          <section className="card card-feature animate-rise">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label-caps">{scope === 'atraso' ? 'Total em atraso' : 'Total em aberto'}</p>
                <AnimatedCurrency
                  value={totals.updatedAmount}
                  className={`money-hero block mt-1 ${totals.count > 0 ? 'text-[var(--color-danger)]' : 'text-gradient'}`}
                />
                <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 tnum">
                  {formatCurrency(totals.amount)} das contas
                  {totals.charges > 0 && (
                    <>
                      {' '}+ <span className="font-semibold text-[var(--color-danger)]">{formatCurrency(totals.charges)}</span> de
                      multa e juros (estim.)
                    </>
                  )}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-2xl font-extrabold tnum leading-none">{totals.count}</p>
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                  {totals.count === 1 ? 'dívida' : 'dívidas'}
                </p>
              </div>
            </div>

            {totals.updatedAmount > 0 && (
              <>
                <div className="meter mt-4">
                  {tiers.map((t) =>
                    t.value > 0 ? (
                      <div
                        key={t.label}
                        className="h-full"
                        style={{ width: `${(t.value / totals.updatedAmount) * 100}%`, background: t.color }}
                      />
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                  {tiers.filter((t) => t.value > 0).map((t) => (
                    <span key={t.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] tnum">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                      {t.label} {formatCurrency(t.value)}
                    </span>
                  ))}
                </div>
                {totals.monthlyCost > 0 && (
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2.5">
                    Parado, cresce cerca de{' '}
                    <span className="font-bold text-[var(--color-warning)] tnum">{formatCurrency(totals.monthlyCost)}</span> por
                    mês{totals.oldest ? ` · a mais antiga é de ${totals.oldest.originLabel}` : ''}.
                  </p>
                )}
              </>
            )}
          </section>

          {/* --- Filtros -------------------------------------------------- */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
              {(['atraso', 'aberto'] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setScope(s);
                    setSelected(new Set());
                  }}
                  className="py-2 rounded-xl text-xs font-bold transition-all duration-200"
                  style={{
                    background: scope === s ? 'var(--color-surface)' : 'transparent',
                    color: scope === s ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                    boxShadow: scope === s ? 'var(--shadow-md)' : 'none',
                  }}
                >
                  {s === 'atraso' ? 'Só atrasadas' : 'Tudo em aberto'}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(Object.keys(GROUP_LABELS) as GroupMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="flex-1 py-1.5 rounded-xl text-[11px] font-bold border transition-colors duration-200"
                  style={{
                    background: mode === m ? 'var(--color-primary-soft)' : 'transparent',
                    borderColor: mode === m ? 'var(--color-primary)' : 'var(--color-border)',
                    color: mode === m ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  }}
                >
                  {GROUP_LABELS[m]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)] px-1">
              {selecting ? 'Toque para marcar ou desmarcar.' : 'Pressione e segure uma conta para selecionar e somar.'}
            </p>
          </div>

          {/* --- Grupos --------------------------------------------------- */}
          {groups.length === 0 ? (
            <div className="card text-center py-10">
              <div
                className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
              >
                <PartyPopper size={26} />
              </div>
              <p className="text-sm font-semibold">
                {scope === 'atraso' ? 'Nenhuma dívida em atraso' : 'Nada em aberto'}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                {scope === 'atraso' ? 'Tudo o que venceu foi pago.' : 'Todas as contas estão pagas.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 stagger">
              {groups.map((group) => (
                <GroupCard
                  key={group.key}
                  group={group}
                  showItems={mode !== 'lista' && expanded.has(group.key)}
                  canExpand={mode !== 'lista'}
                  selecting={selecting}
                  selected={selected}
                  onToggleIds={toggleIds}
                  onExpand={() => toggleExpanded(group.key)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* --- Soma da seleção ---------------------------------------------- */}
      {selecting && (
        <div className="fixed left-0 right-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-6 md:left-64 z-40 px-4 animate-rise">
          <div
            className="max-w-3xl mx-auto rounded-3xl border p-3.5 flex items-center gap-3"
            style={{ background: 'var(--surface-elevated)', borderColor: 'var(--color-primary)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="min-w-0 flex-1">
              <p className="label-caps">
                {selectedDebts.length} {selectedDebts.length === 1 ? 'selecionada' : 'selecionadas'}
              </p>
              <p className="text-xl font-extrabold tnum tracking-tight text-[var(--color-primary)] leading-tight">
                {formatCurrency(selectedTotals.updatedAmount)}
              </p>
              {selectedTotals.charges > 0 && (
                <p className="text-[10px] text-[var(--color-text-tertiary)] tnum truncate">
                  {formatCurrency(selectedTotals.amount)} + {formatCurrency(selectedTotals.charges)} de encargos
                </p>
              )}
            </div>
            <button
              onClick={askAboutSelection}
              className="btn-primary !py-2.5 !px-3.5 text-xs flex items-center gap-1.5 flex-shrink-0"
            >
              <Brain size={15} />
              Perguntar
            </button>
            <button
              onClick={() => setSelected(new Set())}
              aria-label="Limpar seleção"
              className="btn-icon flex-shrink-0"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}
            >
              <X size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectBox({ state }: { state: 'all' | 'some' | 'none' }) {
  const on = state !== 'none';
  return (
    <span
      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200"
      style={{
        background: on ? 'var(--color-primary)' : 'transparent',
        border: on ? 'none' : '1.5px solid var(--color-text-tertiary)',
        color: '#fff',
      }}
    >
      {state === 'all' && <Check size={14} strokeWidth={3.5} />}
      {state === 'some' && <span className="w-2.5 h-0.5 rounded-full bg-white" />}
    </span>
  );
}

function GroupCard({
  group,
  showItems,
  canExpand,
  selecting,
  selected,
  onToggleIds,
  onExpand,
}: {
  group: Group;
  showItems: boolean;
  canExpand: boolean;
  selecting: boolean;
  selected: Set<string>;
  onToggleIds: (ids: string[]) => void;
  onExpand: () => void;
}) {
  const ids = group.items.map((d) => d.id);
  const count = ids.filter((id) => selected.has(id)).length;
  const state: 'all' | 'some' | 'none' = count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
  const lead = group.items[0];
  const accent = lead.tier === 0 ? 'var(--color-danger)' : lead.tier === 1 ? 'var(--color-warning)' : 'var(--color-primary)';

  const press = usePressable(
    () => onToggleIds(ids),
    () => {
      if (selecting) onToggleIds(ids);
      else if (canExpand) onExpand();
    }
  );

  return (
    <div
      className="card !p-0 overflow-hidden select-none transition-shadow duration-200"
      style={{
        borderColor: state !== 'none' ? 'var(--color-primary)' : undefined,
        boxShadow: state !== 'none' ? '0 0 0 3px var(--color-primary-soft)' : undefined,
      }}
    >
      <div {...press} className="flex items-center gap-3 p-3.5 cursor-pointer active:scale-[0.99] transition-transform">
        {selecting ? (
          <SelectBox state={state} />
        ) : (
          <span className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ background: accent }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold truncate">{group.title}</p>
            {group.items.length > 1 && (
              <span
                className="text-[10px] font-extrabold tnum px-1.5 py-0.5 rounded-md flex-shrink-0"
                style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
              >
                ×{group.items.length}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 truncate">{group.subtitle}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="money-lg text-[15px]" style={{ color: accent }}>
            {formatCurrency(group.total)}
          </p>
          {group.total - group.amount > 0.005 && (
            <p className="text-[10px] text-[var(--color-text-tertiary)] tnum">
              {formatCurrency(group.amount)} + encargos
            </p>
          )}
        </div>
        {canExpand && !selecting && (
          <ChevronDown
            size={16}
            className="text-[var(--color-text-tertiary)] flex-shrink-0 transition-transform duration-200"
            style={{ transform: showItems ? 'rotate(180deg)' : 'none' }}
          />
        )}
      </div>

      {(showItems || (selecting && group.items.length > 1)) && (
        <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)] animate-rise">
          {group.items.map((debt) => (
            <DebtRow
              key={debt.id}
              debt={debt}
              selecting={selecting}
              checked={selected.has(debt.id)}
              onToggle={() => onToggleIds([debt.id])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DebtRow({
  debt,
  selecting,
  checked,
  onToggle,
}: {
  debt: RankedDebt;
  selecting: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const press = usePressable(onToggle, () => {
    if (selecting) onToggle();
  });

  return (
    <div {...press} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none" style={{ background: 'var(--color-surface-2)' }}>
      {selecting && <SelectBox state={checked ? 'all' : 'none'} />}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold truncate">
          {debt.originLabel}
          {debt.installmentNumber ? ` · parcela ${debt.installmentNumber}` : ''}
        </p>
        <p className="text-[11px] text-[var(--color-text-secondary)] tnum truncate">
          {debt.daysLate > 0 ? `venceu ${formatDate(debt.originalDueDate)} · ${debt.overdueLabel}` : `vence ${formatDate(debt.originalDueDate)}`}
          {debt.postponedTimes > 0 ? ` · adiada ${debt.postponedTimes}x` : ''}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[13px] font-bold tnum">{formatCurrency(debt.updatedAmount)}</p>
        {debt.charges > 0 && (
          <p className="text-[10px] text-[var(--color-text-tertiary)] tnum">{formatCurrency(debt.amount)} + enc.</p>
        )}
      </div>
    </div>
  );
}
