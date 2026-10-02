import { useState } from 'react';
import { ChevronDown, Flag, RotateCcw, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { excludePriority, restorePriority, setPriorityLevel } from '../../db/database';
import { PRIORITY_INFO, PRIORITY_LEVELS, type PriorityEntry } from '../../priorities/priorities';
import { usePriorities } from '../../priorities/usePriorities';
import type { PriorityLevel } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { ListSkeleton } from '../PageSpinner';
import { useToast } from '../Toast';

/**
 * Prioridades de pagamento.
 *
 * Cada conta entra sozinha, com um nível automático e o motivo. Tocar num
 * nível fixa a escolha; a lixeira tira a conta da lista. Nada aqui precisa
 * ser mantido à mão: conta nova aparece, conta quitada some.
 */
export function PrioritiesPanel() {
  const list = usePriorities();
  const { showToast } = useToast();
  const [showExcluded, setShowExcluded] = useState(false);

  if (!list) return <ListSkeleton />;

  const counts = PRIORITY_LEVELS.map((level) => ({
    level,
    entries: list.entries.filter((e) => e.level === level),
  }));

  const exclude = async (entry: PriorityEntry) => {
    await excludePriority(entry.key);
    showToast({
      message: `"${entry.description}" saiu das prioridades.`,
      tone: 'warning',
      actionLabel: 'Desfazer',
      onAction: async () => {
        await restorePriority(entry.key);
        // Quem desfaz espera ver a conta como estava, inclusive a escolha manual.
        if (entry.manual) await setPriorityLevel(entry.key, entry.level);
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="card card-feature animate-rise">
        <div className="flex items-start gap-3">
          <span
            className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
          >
            <Sparkles size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-bold tracking-tight">Prioridades automáticas</p>
            <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed mt-0.5">
              Toda conta ou dívida nova entra aqui sozinha, com um nível calculado pelo que acontece se ela não for
              paga. Toque em outro nível para fixar, ou na lixeira para tirar da lista.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          {counts.map(({ level, entries }) => (
            <div key={level} className="rounded-2xl p-2.5 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}>
              <p className="flex items-center gap-1.5 label-caps !text-[10px] truncate">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIORITY_INFO[level].color }} />
                {PRIORITY_INFO[level].short}
              </p>
              <p className="text-lg font-extrabold tracking-tight mt-0.5">{entries.length}</p>
            </div>
          ))}
        </div>
      </div>

      {list.entries.length === 0 && (
        <div className="card text-center py-8">
          <p className="text-sm font-semibold">Nenhuma conta pedindo decisão</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            Contas em aberto, mensais e dívidas ativas aparecem aqui assim que forem cadastradas.
          </p>
        </div>
      )}

      {counts.map(({ level, entries }) =>
        entries.length === 0 ? null : (
          <section key={level} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 label-caps !text-[var(--color-text-secondary)]">
                <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_INFO[level].color }} />
                {PRIORITY_INFO[level].label} · {entries.length}
              </h2>
              <span className="text-[11px] text-[var(--color-text-tertiary)] tnum">
                {formatCurrency(entries.reduce((s, e) => s + e.openAmount, 0))} em aberto
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 stagger">
              {entries.map((entry) => (
                <PriorityRow key={entry.key} entry={entry} onExclude={() => void exclude(entry)} />
              ))}
            </div>
          </section>
        )
      )}

      {list.excluded.length > 0 && (
        <section>
          <button
            onClick={() => setShowExcluded((v) => !v)}
            className="w-full flex items-center justify-between px-1 py-1 label-caps !text-[var(--color-text-secondary)]"
          >
            Fora das prioridades · {list.excluded.length}
            <ChevronDown size={14} className="transition-transform" style={{ transform: showExcluded ? 'rotate(180deg)' : 'none' }} />
          </button>
          {showExcluded && (
            <div className="card !p-1.5 mt-2 animate-rise">
              {list.excluded.map((entry) => (
                <div key={entry.key} className="flex items-center gap-3 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate">{entry.description}</p>
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      Automático seria: {PRIORITY_INFO[entry.autoLevel].label}
                    </p>
                  </div>
                  <button
                    onClick={() => void restorePriority(entry.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-primary)' }}
                  >
                    <Undo2 size={13} />
                    Restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[var(--color-text-tertiary)] px-1 mt-1.5">
            Se você cadastrar de novo uma conta com o mesmo nome, ela volta sozinha.
          </p>
        </section>
      )}
    </div>
  );
}

function PriorityRow({ entry, onExclude }: { entry: PriorityEntry; onExclude: () => void }) {
  const info = PRIORITY_INFO[entry.level];

  const choose = (level: PriorityLevel) => {
    // Escolher o mesmo nível que o automático daria é o mesmo que deixar
    // no automático — assim a conta continua acompanhando as mudanças.
    void setPriorityLevel(entry.key, level === entry.autoLevel ? null : level);
  };

  return (
    <div className="card !p-3" style={{ borderLeft: `3px solid ${info.color}` }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {entry.level === 'alta' && <Flag size={12} className="flex-shrink-0" style={{ color: info.color }} />}
            <p className="text-sm font-bold truncate">{entry.description}</p>
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug mt-0.5">
            {entry.manual ? (
              <>
                <span className="font-semibold text-[var(--color-text)]">Você escolheu</span> · automático seria{' '}
                {PRIORITY_INFO[entry.autoLevel].label.toLowerCase()} ({entry.reason})
              </>
            ) : (
              <>
                <span className="font-semibold" style={{ color: info.color }}>Automático</span> · {entry.reason}
              </>
            )}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[13px] font-bold tnum">{entry.openCount > 0 ? formatCurrency(entry.openAmount) : '—'}</p>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">
            {entry.openCount > 0 ? `${entry.openCount} em aberto` : entry.kind}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-2.5">
        <div className="flex-1 grid grid-cols-3 gap-1 p-0.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]" role="radiogroup" aria-label={`Prioridade de ${entry.description}`}>
          {PRIORITY_LEVELS.map((level) => {
            const active = entry.level === level;
            return (
              <button
                key={level}
                role="radio"
                aria-checked={active}
                onClick={() => choose(level)}
                className="py-1.5 rounded-lg text-[11px] font-bold transition-all duration-150 active:scale-95"
                style={{
                  background: active ? PRIORITY_INFO[level].soft : 'transparent',
                  color: active ? PRIORITY_INFO[level].color : 'var(--color-text-tertiary)',
                }}
              >
                {PRIORITY_INFO[level].short}
              </button>
            );
          })}
        </div>
        {entry.manual && (
          <button
            onClick={() => void setPriorityLevel(entry.key, null)}
            aria-label="Voltar ao automático"
            title="Voltar ao automático"
            className="btn-icon !w-8 !h-8 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)]"
          >
            <RotateCcw size={14} />
          </button>
        )}
        <button
          onClick={onExclude}
          aria-label={`Tirar ${entry.description} das prioridades`}
          className="btn-icon !w-8 !h-8 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
