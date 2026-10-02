import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { buildPriorityList, type PriorityList } from './priorities';

/**
 * Lista de prioridades ao vivo. Recalcula sozinha quando qualquer conta,
 * dívida ou escolha muda — é isso que faz uma conta nova aparecer na lista
 * sem ninguém precisar fazer nada. `undefined` enquanto o banco carrega.
 */
export function usePriorities(): PriorityList | undefined {
  const raw = useLiveQuery(async () => {
    const [bills, debts, stored] = await Promise.all([
      db.bills.toArray(),
      db.recurringDebts.toArray(),
      db.priorities.toArray(),
    ]);
    return { bills, debts, stored };
  }, []);

  return useMemo(() => (raw ? buildPriorityList(raw.bills, raw.debts, raw.stored) : undefined), [raw]);
}
