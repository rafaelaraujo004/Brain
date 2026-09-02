import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, CircleDollarSign } from 'lucide-react';
import { db, updateRecurringDebtPaidInstallmentsWithSync } from '../db/database';
import type { RecurringDebt } from '../types';
import { HelpButton } from '../components/HelpModal';
import { ListSkeleton } from '../components/PageSpinner';
import { DebtCard } from '../components/debts/DebtCard';
import { DebtForm } from '../components/debts/DebtForm';

export function RecurringDebts() {
  const [showForm, setShowForm] = useState(false);
  const [editingDebt, setEditingDebt] = useState<RecurringDebt | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const debts = useLiveQuery(() => db.recurringDebts.toArray());
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const activeDebts = useMemo(() => {
    const all = debts?.filter((d) => d.isActive) ?? [];
    if (!normalizedSearch) return all;
    return all.filter((d) =>
      [d.description, d.observation]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [debts, normalizedSearch]);

  const completedDebts = useMemo(() => {
    const all = debts?.filter((d) => !d.isActive) ?? [];
    if (!normalizedSearch) return all;
    return all.filter((d) =>
      [d.description, d.observation]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [debts, normalizedSearch]);

  const deleteDebt = async (id: number) => {
    await db.recurringDebts.delete(id);
  };

  const incrementPaid = async (debt: RecurringDebt) => {
    const newPaid = Math.min(debt.paidInstallments + 1, debt.totalInstallments);
    await updateRecurringDebtPaidInstallmentsWithSync(debt.id!, newPaid);
  };

  const decrementPaid = async (debt: RecurringDebt) => {
    const newPaid = Math.max(debt.paidInstallments - 1, 0);
    await updateRecurringDebtPaidInstallmentsWithSync(debt.id!, newPaid);
  };

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center justify-between gap-2 pt-1">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Dívidas parceladas</h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Financiamentos, empréstimos e compras a prazo
          </p>
        </div>
        <HelpButton
          title="Como usar Dívidas Recorrentes"
          items={[
            { icon: '➕', title: 'Adicionar dívida', description: 'Use o botão + para cadastrar uma nova dívida parcelada (ex: financiamento, empréstimo).' },
            { icon: '▲▼', title: 'Parcelas pagas', description: 'Use os botões + e - no card para incrementar ou decrementar o número de parcelas pagas.' },
            { icon: '📊', title: 'Barra de progresso', description: 'Mostra visualmente quantas parcelas já foram pagas em relação ao total.' },
            { icon: '✏️', title: 'Editar/Excluir', description: 'Toque nos ícones de editar ou lixeira para modificar ou remover uma dívida.' },
            { icon: '✅', title: 'Concluídas', description: 'Dívidas com todas as parcelas pagas aparecem na seção "Concluídas" abaixo.' },
          ]}
        />
      </header>

      <div className="card !py-2.5 !px-4 flex items-center gap-2.5">
        <Search size={16} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Pesquisar dívida por nome ou observação"
          className="w-full bg-transparent outline-none text-sm placeholder:text-[var(--color-text-tertiary)]"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="text-xs text-[var(--color-primary)] font-bold flex-shrink-0"
          >
            Limpar
          </button>
        )}
      </div>

      {activeDebts.length > 0 && (
        <section className="space-y-2.5">
          <SectionTitle label="Ativas" count={activeDebts.length} tone="var(--color-primary)" />
          <div className="grid gap-2.5 md:grid-cols-2 stagger">
          {activeDebts.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              onIncrement={() => incrementPaid(debt)}
              onDecrement={() => decrementPaid(debt)}
              onEdit={() => {
                setEditingDebt(debt);
                setShowForm(true);
              }}
              onDelete={() => deleteDebt(debt.id!)}
            />
          ))}
          </div>
        </section>
      )}

      {completedDebts.length > 0 && (
        <section className="space-y-2.5">
          <SectionTitle
            label="Finalizadas"
            count={completedDebts.length}
            tone="var(--color-success)"
          />
          <div className="grid gap-2.5 md:grid-cols-2 stagger">
          {completedDebts.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              onIncrement={() => incrementPaid(debt)}
              onDecrement={() => decrementPaid(debt)}
              onEdit={() => {
                setEditingDebt(debt);
                setShowForm(true);
              }}
              onDelete={() => deleteDebt(debt.id!)}
            />
          ))}
          </div>
        </section>
      )}

      {debts === undefined && <ListSkeleton />}

      {debts?.length === 0 && (
        <div className="text-center py-14">
          <div
            className="w-16 h-16 rounded-3xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
          >
            <CircleDollarSign size={28} />
          </div>
          <p className="font-semibold">Nenhuma dívida parcelada</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            Toque no + para cadastrar a primeira
          </p>
        </div>
      )}

      {debts && debts.length > 0 && normalizedSearch && activeDebts.length === 0 && completedDebts.length === 0 && (
        <div className="card text-center py-6">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Nenhuma dívida encontrada para "{searchTerm}".
          </p>
        </div>
      )}

      <button
        onClick={() => {
          setEditingDebt(null);
          setShowForm(true);
        }}
        aria-label="Nova dívida"
        className="fixed bottom-24 md:bottom-8 right-4 md:right-8 w-14 h-14 text-white rounded-2xl flex items-center justify-center active:scale-90 transition-transform duration-150 z-40"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          boxShadow: 'var(--shadow-primary)',
        }}
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>

      {showForm && (
        <DebtForm
          debt={editingDebt}
          onClose={() => {
            setShowForm(false);
            setEditingDebt(null);
          }}
        />
      )}
    </div>
  );
}


/** Título de seção com contagem, usado para separar ativas de finalizadas. */
function SectionTitle({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
      <h2 className="label-caps !text-[var(--color-text-secondary)]">{label}</h2>
      <span className="text-[11px] font-bold tnum text-[var(--color-text-tertiary)]">{count}</span>
    </div>
  );
}
