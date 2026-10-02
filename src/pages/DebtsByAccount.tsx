import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brain, Check, ChevronDown, Layers, PartyPopper, X } from 'lucide-react';
import { db, ensureLoanInterestBills, ensureMonthlyBillOccurrences } from '../db/database';
import { buildLedger, groupLabel, type LedgerItem, type LedgerStatus } from '../ledger/ledger';
import { formatCurrency, formatDate, getCurrentMonthYear, getMonthName } from '../utils/formatters';
import { AnimatedCurrency } from '../components/AnimatedCurrency';
import { HelpButton } from '../components/HelpModal';
import { ListSkeleton } from '../components/PageSpinner';

type GroupMode = 'conta' | 'mes' | 'tipo' | 'lista';
type Scope = 'tudo' | 'atraso';

interface Group {
  key: string;
  title: string;
  subtitle: string;
  items: LedgerItem[];
  total: number;
  late: number;
}

const GROUP_LABELS: Record<GroupMode, string> = {
  conta: 'Por conta',
  mes: 'Por mês',
  tipo: 'Por tipo',
  lista: 'Lista',
};

/** Selo de situação: cor de status + texto, nunca só a cor. */
const STATUS_INFO: Record<LedgerStatus, { label: string; color: string; soft: string }> = {
  atrasada: { label: 'Atrasada', color: 'var(--color-danger)', soft: 'var(--color-danger-soft)' },
  a_vencer: { label: 'A vencer', color: 'var(--color-text-secondary)', soft: 'var(--color-surface-2)' },
  futura: { label: 'Futuras', color: 'var(--color-primary)', soft: 'var(--color-primary-soft)' },
  agiota: { label: 'Valor pego', color: 'var(--color-warning)', soft: 'var(--color-warning-soft)' },
};

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function buildGroups(items: LedgerItem[], mode: GroupMode, accountSummary: Map<string, string>): Group[] {
  const make = (key: string, title: string, list: LedgerItem[], subtitle: string): Group => ({
    key,
    title,
    subtitle,
    items: list,
    total: list.reduce((s, i) => s + i.amount, 0),
    late: list.filter((i) => i.status === 'atrasada').reduce((s, i) => s + i.amount, 0),
  });

  if (mode === 'lista') {
    return items.map((item) => make(item.id, `${item.accountName} · ${item.title}`, [item], item.detail));
  }

  const map = new Map<string, { title: string; sort: number; list: LedgerItem[] }>();
  for (const item of items) {
    let key: string;
    let title: string;
    let sort = 0;
    if (mode === 'conta') {
      key = item.accountKey;
      title = item.accountName;
    } else if (mode === 'tipo') {
      key = item.group;
      title = groupLabel(item.group);
    } else if (item.status === 'futura') {
      key = 'futuras';
      title = 'Parcelas dos próximos meses';
      sort = Number.MAX_SAFE_INTEGER - 1;
    } else if (item.status === 'agiota' || !item.dueDate) {
      key = 'agiota';
      title = 'Agiota — sem vencimento';
      sort = Number.MAX_SAFE_INTEGER;
    } else {
      const m = item.dueDate.getMonth() + 1;
      const y = item.dueDate.getFullYear();
      key = `${y}-${m}`;
      title = `Vencimento em ${getMonthName(m)}/${y}`;
      sort = y * 12 + m;
    }
    const entry = map.get(key) ?? { title, sort, list: [] };
    entry.list.push(item);
    map.set(key, entry);
  }

  const groups = [...map.entries()].map(([key, { title, sort, list }]) => {
    const late = list.filter((i) => i.status === 'atrasada').length;
    const subtitle =
      mode === 'conta'
        ? accountSummary.get(key) ?? ''
        : [count(list.length, 'item', 'itens'), late ? count(late, 'atrasado', 'atrasados') : '']
            .filter(Boolean)
            .join(' · ');
    return { ...make(key, title, list, subtitle), sort };
  });

  if (mode === 'mes') return groups.sort((a, b) => a.sort - b.sort);
  return groups.sort((a, b) => b.late - a.late || b.total - a.total);
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

/**
 * Aba Totais: tudo o que se deve, conta por conta.
 *
 * Soma contas em aberto (atrasadas e a vencer, em qualquer mês), as parcelas
 * que faltam das dívidas e o valor pego com agiota. Calculada ao vivo a
 * partir do banco — pagar, adiar ou cadastrar algo muda os números na hora.
 */
export function DebtsByAccount() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GroupMode>('conta');
  const [scope, setScope] = useState<Scope>('tudo');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Faturas do mês corrente que nascem sozinhas (contas mensais, agiota).
  useEffect(() => {
    const { month, year } = getCurrentMonthYear();
    void (async () => {
      await ensureLoanInterestBills(month, year);
      await ensureMonthlyBillOccurrences(month, year);
    })();
  }, []);

  const raw = useLiveQuery(async () => {
    const [bills, debts, loans] = await Promise.all([
      db.bills.toArray(),
      db.recurringDebts.toArray(),
      db.loans.toArray(),
    ]);
    return { bills, debts, loans };
  }, []);

  const ledger = useMemo(() => (raw ? buildLedger(raw.bills, raw.debts, raw.loans) : null), [raw]);

  const items = useMemo(() => {
    if (!ledger) return [];
    return scope === 'atraso' ? ledger.items.filter((i) => i.status === 'atrasada') : ledger.items;
  }, [ledger, scope]);

  const accountSummary = useMemo(
    () => new Map((ledger?.accounts ?? []).map((a) => [a.key, a.summary])),
    [ledger]
  );
  const groups = useMemo(() => buildGroups(items, mode, accountSummary), [items, mode, accountSummary]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const selectedTotal = selectedItems.reduce((s, i) => s + i.amount, 0);
  const selectedLate = selectedItems.filter((i) => i.status === 'atrasada').reduce((s, i) => s + i.amount, 0);
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
      state: { scopeIds: [...selected], ask: 'Qual a melhor forma de quitar estas dívidas?' },
    });
  };

  const totals = ledger?.totals;

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
            <p className="text-xs text-[var(--color-text-tertiary)] truncate">Tudo o que você deve, conta por conta</p>
          </div>
        </div>
        <HelpButton
          title="Dívidas por conta"
          items={[
            { icon: '🧮', title: 'O que entra', description: 'Contas em aberto de qualquer mês (atrasadas e a vencer), as parcelas que faltam das dívidas e o valor pego com agiota.' },
            { icon: '🔴', title: 'Atrasada', description: 'Passou do vencimento. Uma conta adiada continua atrasada desde o vencimento original — o card mostra quando venceu e em que mês ela está.' },
            { icon: '📅', title: 'Parcelas futuras', description: 'As parcelas dos próximos meses aparecem somadas numa linha só. Dívida sem número de parcelas mostra só até o mês atual.' },
            { icon: '👆', title: 'Pressione e segure', description: 'Segure uma conta ou um item para selecionar. Depois, cada toque marca ou desmarca. A soma aparece embaixo.' },
            { icon: '🧠', title: 'Perguntar', description: 'Com itens atrasados selecionados, o assistente analisa só eles.' },
          ]}
        />
      </header>

      {!ledger || !totals ? (
        <ListSkeleton />
      ) : (
        <>
          {/* --- Total --------------------------------------------------- */}
          <section className="card card-feature animate-rise">
            <p className="label-caps">Você deve no total</p>
            <AnimatedCurrency
              value={totals.total}
              className="money-hero block mt-1 text-gradient"
              style={{ fontVariantNumeric: 'normal' }}
            />
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Tile label="Em atraso" value={totals.late} status="atrasada" hint={totals.lateCount ? count(totals.lateCount, 'item', 'itens') : undefined} />
              <Tile label="A vencer" value={totals.upcoming} status="a_vencer" />
              <Tile label="Parcelas futuras" value={totals.future} status="futura" />
              <Tile label="Agiota" value={totals.loanPrincipal} status="agiota" hint={totals.loanPrincipal > 0 ? 'valor pego' : undefined} />
            </div>
            {totals.oldestLate && (
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-3 leading-relaxed">
                Atraso mais antigo: <span className="font-semibold text-[var(--color-text-secondary)]">{totals.oldestLate.accountName}</span>,
                {' '}venceu em {totals.oldestLate.dueDate ? formatDate(totals.oldestLate.dueDate) : '—'}.
              </p>
            )}
          </section>

          {/* --- Filtros ------------------------------------------------- */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
              {(['tudo', 'atraso'] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setScope(s);
                    setSelected(new Set());
                  }}
                  aria-pressed={scope === s}
                  className="py-2 rounded-xl text-xs font-bold transition-all duration-200"
                  style={{
                    background: scope === s ? 'var(--color-surface)' : 'transparent',
                    color: scope === s ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                    boxShadow: scope === s ? 'var(--shadow-md)' : 'none',
                  }}
                >
                  {s === 'tudo' ? 'Tudo que devo' : 'Só em atraso'}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(Object.keys(GROUP_LABELS) as GroupMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
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
              {selecting ? 'Toque para marcar ou desmarcar.' : 'Toque para ver os itens · pressione e segure para selecionar e somar.'}
            </p>
          </div>

          {/* --- Grupos -------------------------------------------------- */}
          {groups.length === 0 ? (
            <div className="card text-center py-10">
              <div
                className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
              >
                <PartyPopper size={26} />
              </div>
              <p className="text-sm font-semibold">{scope === 'atraso' ? 'Nada em atraso' : 'Você não deve nada'}</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                {scope === 'atraso' ? 'Tudo o que venceu foi pago.' : 'Nenhuma conta, parcela ou empréstimo em aberto.'}
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
              <p className="label-caps">{count(selectedItems.length, 'selecionado', 'selecionados')}</p>
              <p className="text-xl font-extrabold tnum tracking-tight text-[var(--color-primary)] leading-tight">
                {formatCurrency(selectedTotal)}
              </p>
              {selectedLate > 0 && selectedLate < selectedTotal && (
                <p className="text-[10px] text-[var(--color-text-tertiary)] tnum truncate">
                  {formatCurrency(selectedLate)} em atraso
                </p>
              )}
            </div>
            {selectedLate > 0 && (
              <button
                onClick={askAboutSelection}
                className="btn-primary !py-2.5 !px-3.5 text-xs flex items-center gap-1.5 flex-shrink-0"
              >
                <Brain size={15} />
                Perguntar
              </button>
            )}
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

function Tile({ label, value, status, hint }: { label: string; value: number; status: LedgerStatus; hint?: string }) {
  return (
    <div className="rounded-2xl p-2.5 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}>
      <p className="flex items-center gap-1.5 label-caps !text-[10px] truncate">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_INFO[status].color }} />
        {label}
      </p>
      <p className="text-[15px] font-extrabold tnum tracking-tight mt-0.5">{value > 0 ? formatCurrency(value) : '—'}</p>
      {hint && <p className="text-[10px] text-[var(--color-text-tertiary)]">{hint}</p>}
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
  const ids = group.items.map((i) => i.id);
  const chosen = ids.filter((id) => selected.has(id)).length;
  const state: 'all' | 'some' | 'none' = chosen === 0 ? 'none' : chosen === ids.length ? 'all' : 'some';
  const single = group.items.length === 1 ? group.items[0] : null;
  const accent = group.late > 0 ? 'var(--color-danger)' : single ? STATUS_INFO[single.status].color : 'var(--color-primary)';

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
          <p className="text-sm font-bold truncate">{group.title}</p>
          <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">{group.subtitle}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="money-lg text-[15px]">{formatCurrency(group.total)}</p>
          {group.late > 0 && group.late < group.total && (
            <p className="text-[10px] font-semibold text-[var(--color-danger)] tnum">{formatCurrency(group.late)} em atraso</p>
          )}
          {single && (
            <span
              className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
              style={{ background: STATUS_INFO[single.status].soft, color: STATUS_INFO[single.status].color }}
            >
              {STATUS_INFO[single.status].label}
            </span>
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

      {(showItems || (selecting && group.items.length > 1 && canExpand)) && (
        <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)] animate-rise">
          {group.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              selecting={selecting}
              checked={selected.has(item.id)}
              onToggle={() => onToggleIds([item.id])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  selecting,
  checked,
  onToggle,
}: {
  item: LedgerItem;
  selecting: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const press = usePressable(onToggle, () => {
    if (selecting) onToggle();
  });
  const info = STATUS_INFO[item.status];

  return (
    <div {...press} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none" style={{ background: 'var(--color-surface-2)' }}>
      {selecting && <SelectBox state={checked ? 'all' : 'none'} />}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold truncate">{item.title}</p>
        <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug tnum">{item.detail}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[13px] font-bold tnum">{formatCurrency(item.amount)}</p>
        <span
          className="inline-block text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md mt-0.5"
          style={{ background: info.soft, color: info.color }}
        >
          {info.label}
        </span>
      </div>
    </div>
  );
}
