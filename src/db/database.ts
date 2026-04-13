import Dexie, { type Table } from 'dexie';
import type { Bill, RecurringDebt, ExtraFund, MonthlyConfig, AppSettings, IncomeSource, PriorityItem } from '../types';
import { getMonthName } from '../utils/formatters';

class AppDatabase extends Dexie {
  bills!: Table<Bill>;
  recurringDebts!: Table<RecurringDebt>;
  extraFunds!: Table<ExtraFund>;
  monthlyConfigs!: Table<MonthlyConfig>;
  incomeSources!: Table<IncomeSource>;
  settings!: Table<AppSettings>;
  priorities!: Table<PriorityItem>;

  constructor() {
    super('MinhasContasDB');

    this.version(1).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      settings: '++id',
    });

    this.version(2).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
    });

    this.version(3).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
    });

    this.version(4).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
      priorities: '++id, order',
    });

    this.version(5).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
      priorities: '++id, keyword, level',
    }).upgrade(async (tx) => {
      const priorities = tx.table('priorities');
      const all = await priorities.toArray();
      const seen = new Set<string>();
      for (const p of all) {
        if (seen.has(p.keyword)) {
          await priorities.delete(p.id);
        } else {
          seen.add(p.keyword);
          if (!p.level) {
            await priorities.update(p.id, { level: 'media' });
          }
        }
      }
    });
  }
}

export const db = new AppDatabase();

export async function getOrCreateSettings(): Promise<AppSettings> {
  const existing = await db.settings.toCollection().first();
  if (existing) return existing;

  const defaultSettings: AppSettings = {
    theme: 'dark',
    defaultSalary: 0,
  };
  const id = await db.settings.add(defaultSettings);
  return { ...defaultSettings, id: id as number };
}

export async function getMonthlyConfig(month: number, year: number): Promise<MonthlyConfig | undefined> {
  return db.monthlyConfigs.where({ month, year }).first();
}

export async function ensureMonthlyConfig(month: number, year: number, defaultSalary: number): Promise<MonthlyConfig> {
  const existing = await getMonthlyConfig(month, year);
  if (existing) return existing;

  const config: MonthlyConfig = { month, year, salary: defaultSalary };
  const id = await db.monthlyConfigs.add(config);
  return { ...config, id: id as number };
}

function getPreviousMonthYear(month: number, year: number): { month: number; year: number } {
  if (month === 1) {
    return { month: 12, year: year - 1 };
  }
  return { month: month - 1, year };
}

// Auto carry-over only runs when the previous month has already ended.
// Otherwise, user must manually click "Postergar".
export async function ensureCarryOverBillsForMonth(month: number, year: number): Promise<void> {
  const prev = getPreviousMonthYear(month, year);

  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const prevMonthEnded =
    prev.year < currentYear || (prev.year === currentYear && prev.month < currentMonth);

  if (!prevMonthEnded) return;

  const [previousMonthBills, currentMonthBills] = await Promise.all([
    db.bills
      .where('[month+year]')
      .equals([prev.month, prev.year])
      .and((b) => b.status === 'pending')
      .toArray(),
    db.bills.where('[month+year]').equals([month, year]).toArray(),
  ]);

  if (previousMonthBills.length === 0) return;

  const newCarryOvers: Bill[] = [];

  for (const prevBill of previousMonthBills) {
    if (!prevBill.id) continue;

    const alreadyCarried = currentMonthBills.some((b) => b.carriedFromBillId === prevBill.id);
    if (alreadyCarried) continue;

    const baseDescription = prevBill.originalDescription ?? prevBill.description;
    const carryDescription = `${baseDescription} [ATRASADA - ${getMonthName(prev.month)}]`;

    newCarryOvers.push({
      description: carryDescription,
      originalDescription: baseDescription,
      initialValue: prevBill.finalValue,
      finalValue: prevBill.finalValue,
      status: 'pending',
      dueDay: prevBill.dueDay,
      observation: `Conta atrasada do mês de ${getMonthName(prev.month)}`,
      month,
      year,
      carriedFromBillId: prevBill.id,
      carriedFromMonth: prev.month,
      carriedFromYear: prev.year,
    });
  }

  if (newCarryOvers.length > 0) {
    await db.bills.bulkAdd(newCarryOvers);
  }
}

function getNextMonthYear(month: number, year: number): { month: number; year: number } {
  if (month === 12) {
    return { month: 1, year: year + 1 };
  }
  return { month: month + 1, year };
}

export async function skipBillToNextMonth(bill: Bill): Promise<void> {
  if (!bill.id) return;

  const next = getNextMonthYear(bill.month, bill.year);

  // Check if carry-over already exists for this bill
  const existing = await db.bills
    .where('carriedFromBillId')
    .equals(bill.id)
    .first();
  if (existing) return;

  const baseDescription = bill.originalDescription ?? bill.description;
  const carryDescription = `${baseDescription} [ATRASADA - ${getMonthName(bill.month)}]`;

  await db.bills.add({
    description: carryDescription,
    originalDescription: baseDescription,
    initialValue: bill.finalValue,
    finalValue: bill.finalValue,
    status: 'pending',
    dueDay: bill.dueDay,
    observation: `Conta atrasada do mês de ${getMonthName(bill.month)}`,
    month: next.month,
    year: next.year,
    carriedFromBillId: bill.id,
    carriedFromMonth: bill.month,
    carriedFromYear: bill.year,
  });

  // Mark original as skipped
  await db.bills.update(bill.id, { status: 'skipped' });
}

export async function skipRecurringToNextMonth(
  debt: RecurringDebt,
  installmentNumber: number,
  month: number,
  year: number
): Promise<void> {
  if (!debt.id) return;

  // Check if a linked bill already exists for this recurring debt in this month
  const existingBill = await db.bills
    .where({ month, year })
    .and((b) => b.recurringDebtId === debt.id)
    .first();
  if (existingBill) return;

  const next = getNextMonthYear(month, year);

  // Create a skipped bill for the current month (so it appears as "adiado")
  const skippedBillId = await db.bills.add({
    description: `${debt.description} (${installmentNumber}/${debt.totalInstallments})`,
    originalDescription: debt.description,
    initialValue: debt.installmentValue,
    finalValue: debt.installmentValue,
    status: 'skipped',
    dueDay: debt.dueDay,
    observation: 'Parcela recorrente adiada',
    month,
    year,
    recurringDebtId: debt.id,
  });

  // Create a pending bill for next month as carry-over
  const carryDescription = `Parcela de ${debt.description} - ${getMonthName(month)} (${installmentNumber}/${debt.totalInstallments})`;

  await db.bills.add({
    description: carryDescription,
    originalDescription: debt.description,
    initialValue: debt.installmentValue,
    finalValue: debt.installmentValue,
    status: 'pending',
    dueDay: debt.dueDay,
    observation: 'Parcela recorrente adiada do mês anterior',
    month: next.month,
    year: next.year,
    carriedFromBillId: skippedBillId as number,
    carriedFromMonth: month,
    carriedFromYear: year,
  });
}

export async function removeCarryOverForPaidBill(billId: number): Promise<void> {
  const carriedBills = await db.bills
    .where('carriedFromBillId')
    .equals(billId)
    .and((b) => b.status === 'pending')
    .toArray();

  if (carriedBills.length === 0) return;

  const idsToDelete = carriedBills.map((b) => b.id!);
  await db.bills.bulkDelete(idsToDelete);

  // Recursively remove any carry-overs of carry-overs
  for (const carried of carriedBills) {
    if (carried.id) {
      await removeCarryOverForPaidBill(carried.id);
    }
  }
}

export async function getMonthlyIncomeTotal(month: number, year: number): Promise<number> {
  const [settings, monthlyConfig, extraFunds, incomeSources] = await Promise.all([
    getOrCreateSettings(),
    getMonthlyConfig(month, year),
    db.extraFunds.where({ month, year }).toArray(),
    db.incomeSources.filter((i) => i.isActive).toArray(),
  ]);

  const salary = monthlyConfig?.salary ?? settings.defaultSalary;
  const totalExtra = extraFunds.reduce((sum, f) => sum + f.value, 0);
  const totalIncomeSources = incomeSources.reduce((sum, i) => sum + i.value, 0);

  return salary + totalExtra + totalIncomeSources;
}
