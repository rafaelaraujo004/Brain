import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureLoanInterestBills, ensureMonthlyBillOccurrences } from '../db/database';
import { getCurrentMonthYear } from '../utils/formatters';
import { buildSnapshot } from './snapshot';
import type { FinancialSnapshot } from './types';

/**
 * Retrato financeiro ao vivo: refaz as contas sozinho quando qualquer conta,
 * renda ou prioridade muda. `undefined` enquanto o banco carrega.
 */
export function useFinancialSnapshot(): FinancialSnapshot | undefined {
  // As faturas do mês corrente normalmente nascem ao abrir o Início ou as
  // Contas. Quem cai direto aqui também precisa delas.
  useEffect(() => {
    const { month, year } = getCurrentMonthYear();
    void (async () => {
      await ensureLoanInterestBills(month, year);
      await ensureMonthlyBillOccurrences(month, year);
    })();
  }, []);

  const raw = useLiveQuery(async () => {
    const [bills, recurringDebts, priorities, settings, monthlyConfigs, extraFunds, incomeSources, loans] =
      await Promise.all([
        db.bills.toArray(),
        db.recurringDebts.toArray(),
        db.priorities.toArray(),
        db.settings.toCollection().first(),
        db.monthlyConfigs.toArray(),
        db.extraFunds.toArray(),
        db.incomeSources.toArray(),
        db.loans.toArray(),
      ]);
    return { bills, recurringDebts, priorities, settings, monthlyConfigs, extraFunds, incomeSources, loans };
  }, []);

  return useMemo(() => (raw ? buildSnapshot(raw) : undefined), [raw]);
}
