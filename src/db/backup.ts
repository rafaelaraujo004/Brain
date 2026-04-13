import { db } from './database';

export interface BackupData {
  version: number;
  createdAt: string;
  bills: unknown[];
  recurringDebts: unknown[];
  extraFunds: unknown[];
  monthlyConfigs: unknown[];
  incomeSources: unknown[];
  settings: unknown[];
  priorities?: unknown[];
}

export async function exportBackup(): Promise<string> {
  const [bills, recurringDebts, extraFunds, monthlyConfigs, incomeSources, settings, priorities] =
    await Promise.all([
      db.bills.toArray(),
      db.recurringDebts.toArray(),
      db.extraFunds.toArray(),
      db.monthlyConfigs.toArray(),
      db.incomeSources.toArray(),
      db.settings.toArray(),
      db.priorities.toArray(),
    ]);

  const backup: BackupData = {
    version: 1,
    createdAt: new Date().toISOString(),
    bills,
    recurringDebts,
    extraFunds,
    monthlyConfigs,
    incomeSources,
    settings,
    priorities,
  };

  return JSON.stringify(backup, null, 2);
}

export function downloadBackup(json: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paguei-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importBackup(file: File): Promise<{ success: boolean; message: string }> {
  try {
    const text = await file.text();
    const data: BackupData = JSON.parse(text);

    if (!data.version || !data.bills || !data.recurringDebts) {
      return { success: false, message: 'Arquivo inválido. Não é um backup do Paguei.' };
    }

    // Clear all tables and import
    await db.transaction('rw', [db.bills, db.recurringDebts, db.extraFunds, db.monthlyConfigs, db.incomeSources, db.settings, db.priorities], async () => {
      await db.bills.clear();
      await db.recurringDebts.clear();
      await db.extraFunds.clear();
      await db.monthlyConfigs.clear();
      await db.incomeSources.clear();
      await db.settings.clear();
      await db.priorities.clear();

      if (data.bills.length > 0) await db.bills.bulkAdd(data.bills as never[]);
      if (data.recurringDebts.length > 0) await db.recurringDebts.bulkAdd(data.recurringDebts as never[]);
      if (data.extraFunds.length > 0) await db.extraFunds.bulkAdd(data.extraFunds as never[]);
      if (data.monthlyConfigs.length > 0) await db.monthlyConfigs.bulkAdd(data.monthlyConfigs as never[]);
      if (data.incomeSources?.length > 0) await db.incomeSources.bulkAdd(data.incomeSources as never[]);
      if (data.settings.length > 0) await db.settings.bulkAdd(data.settings as never[]);
      if (data.priorities?.length && data.priorities.length > 0) await db.priorities.bulkAdd(data.priorities as never[]);
    });

    return {
      success: true,
      message: `Backup restaurado! ${data.bills.length} contas, ${data.recurringDebts.length} dívidas recorrentes.`,
    };
  } catch {
    return { success: false, message: 'Erro ao ler o arquivo. Verifique se é um backup válido.' };
  }
}
