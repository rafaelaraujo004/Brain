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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Dívidas Recorrentes</h1>
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
      </div>

      <div className="card py-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-[var(--color-text-secondary)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar dívida por nome ou observação"
            className="w-full bg-transparent outline-none text-sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-xs text-[var(--color-primary)] font-semibold"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {activeDebts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            Ativas ({activeDebts.length})
          </h2>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
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
        </div>
      )}

      {completedDebts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            Finalizadas ({completedDebts.length})
          </h2>
          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
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
        </div>
      )}

      {debts === undefined && <ListSkeleton />}

      {debts?.length === 0 && (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">
          <CircleDollarSign size={48} className="mx-auto mb-3 opacity-30" />
          <p>Nenhuma dívida recorrente cadastrada</p>
          <p className="text-sm mt-1">Toque no + para adicionar</p>
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
        className="fixed bottom-20 md:bottom-8 right-4 md:right-8 w-14 h-14 bg-[var(--color-primary)] text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 hover:bg-[var(--color-primary-dark)] transition-all z-40"
      >
        <Plus size={28} />
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

