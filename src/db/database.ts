import Dexie, { type Table } from 'dexie';
import type { Bill, RecurringDebt, ExtraFund, MonthlyConfig, AppSettings, IncomeSource, PriorityItem } from '../types';
import { getMonthName } from '../utils/formatters';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc, where, type Unsubscribe } from 'firebase/firestore';
import { firestore } from './firebase';

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

interface CloudSnapshot {
  version: number;
  updatedAt: number;
  bills: Bill[];
  recurringDebts: RecurringDebt[];
  extraFunds: ExtraFund[];
  monthlyConfigs: MonthlyConfig[];
  incomeSources: IncomeSource[];
  settings: AppSettings[];
  priorities: PriorityItem[];
}

const LOCAL_LAST_CHANGE_KEY = 'paguei_local_last_change';
const LOCAL_SYNC_OWNER_KEY = 'paguei_sync_owner';
const SHARING_INVITES_COLLECTION = 'sharingInvites';
let currentUserId: string | null = null;
let currentDataOwnerId: string | null = null;

function getCloudDocRef() {
  if (!firestore || !currentDataOwnerId) return null;
  return doc(firestore, 'users', currentDataOwnerId, 'data', 'snapshot');
}

let isApplyingCloudData = false;
let isSyncBootstrapping = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInitializedPromise: Promise<void> | null = null;
let cloudUnsubscribe: Unsubscribe | null = null;
let lastAppliedCloudUpdatedAt = 0;

function getLocalLastChangeStorageKey(): string {
  const owner = currentDataOwnerId ?? currentUserId ?? 'local';
  return `${LOCAL_LAST_CHANGE_KEY}_${owner}`;
}

function getSyncOwnerStorageKey(): string {
  const user = currentUserId ?? 'anon';
  return `${LOCAL_SYNC_OWNER_KEY}_${user}`;
}

function getLastSyncedOwnerId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(getSyncOwnerStorageKey());
}

function rememberSyncedOwnerId(ownerId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getSyncOwnerStorageKey(), ownerId);
}

function markLocalChanged(timestamp = Date.now()): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getLocalLastChangeStorageKey(), String(timestamp));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createShareInviteId(ownerUid: string, targetEmail: string): string {
  return `${ownerUid}__${normalizeEmail(targetEmail)}`;
}

async function resolveDataOwnerId(userId: string, userEmail?: string | null): Promise<string> {
  if (!firestore || !userEmail) return userId;

  const normalized = normalizeEmail(userEmail);
  if (!normalized) return userId;

  try {
    const invitationsRef = collection(firestore, SHARING_INVITES_COLLECTION);
    const activeInviteQuery = query(
      invitationsRef,
      where('targetEmail', '==', normalized),
      where('status', '==', 'active'),
      limit(1)
    );
    const inviteSnapshot = await getDocs(activeInviteQuery);
    const invite = inviteSnapshot.docs[0]?.data() as { ownerUid?: string } | undefined;
    const ownerUid = invite?.ownerUid;
    return ownerUid && typeof ownerUid === 'string' ? ownerUid : userId;
  } catch (error) {
    console.error('Falha ao resolver dataset compartilhado:', error);
    return userId;
  }
}

export async function shareDataWithEmail(ownerUid: string, email: string): Promise<{ success: boolean; message: string }> {
  if (!firestore) {
    return { success: false, message: 'Firebase não está configurado para compartilhamento.' };
  }

  const targetEmail = normalizeEmail(email);
  if (!targetEmail || !targetEmail.includes('@')) {
    return { success: false, message: 'Informe um e-mail válido.' };
  }

  try {
    const inviteId = createShareInviteId(ownerUid, targetEmail);
    const inviteRef = doc(firestore, SHARING_INVITES_COLLECTION, inviteId);
    const now = Date.now();
    await setDoc(
      inviteRef,
      {
        ownerUid,
        targetEmail,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      success: true,
      message: `Compartilhamento ativado para ${targetEmail}. Quando ela entrar com esse e-mail, verá os mesmos dados.`,
    };
  } catch (error) {
    console.error('Falha ao compartilhar dados por e-mail:', error);
    return { success: false, message: 'Não foi possível ativar o compartilhamento agora.' };
  }
}

function getLocalLastChangedAt(): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(getLocalLastChangeStorageKey());
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function buildLocalSnapshot(): Promise<CloudSnapshot> {
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

  return {
    version: 1,
    updatedAt: Date.now(),
    bills,
    recurringDebts,
    extraFunds,
    monthlyConfigs,
    incomeSources,
    settings,
    priorities,
  };
}

async function pushLocalSnapshotToCloud(allowDuringBootstrap = false): Promise<void> {
  const cloudDocRef = getCloudDocRef();
  if (!cloudDocRef || isApplyingCloudData || (isSyncBootstrapping && !allowDuringBootstrap)) return;

  const snapshot = await buildLocalSnapshot();
  lastAppliedCloudUpdatedAt = Math.max(lastAppliedCloudUpdatedAt, snapshot.updatedAt);
  await setDoc(cloudDocRef, snapshot, { merge: true });
}

function scheduleCloudSync(): void {
  if (!getCloudDocRef() || isApplyingCloudData || isSyncBootstrapping) return;

  markLocalChanged();

  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    void pushLocalSnapshotToCloud();
  }, 800);
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function hasCloudData(snapshot: Partial<CloudSnapshot>): boolean {
  return (
    normalizeArray(snapshot.bills).length > 0 ||
    normalizeArray(snapshot.recurringDebts).length > 0 ||
    normalizeArray(snapshot.extraFunds).length > 0 ||
    normalizeArray(snapshot.monthlyConfigs).length > 0 ||
    normalizeArray(snapshot.incomeSources).length > 0 ||
    normalizeArray(snapshot.settings).length > 0 ||
    normalizeArray(snapshot.priorities).length > 0
  );
}

async function getLocalItemCount(): Promise<number> {
  const counts = await Promise.all([
    db.bills.count(),
    db.recurringDebts.count(),
    db.extraFunds.count(),
    db.monthlyConfigs.count(),
    db.incomeSources.count(),
    db.settings.count(),
    db.priorities.count(),
  ]);

  return counts.reduce((sum, value) => sum + value, 0);
}

async function applyCloudSnapshotToLocal(snapshot: Partial<CloudSnapshot>): Promise<void> {
  const bills = normalizeArray<Bill>(snapshot.bills);
  const recurringDebts = normalizeArray<RecurringDebt>(snapshot.recurringDebts);
  const extraFunds = normalizeArray<ExtraFund>(snapshot.extraFunds);
  const monthlyConfigs = normalizeArray<MonthlyConfig>(snapshot.monthlyConfigs);
  const incomeSources = normalizeArray<IncomeSource>(snapshot.incomeSources);
  const settings = normalizeArray<AppSettings>(snapshot.settings);
  const priorities = normalizeArray<PriorityItem>(snapshot.priorities);

  isApplyingCloudData = true;
  try {
    await db.transaction(
      'rw',
      [db.bills, db.recurringDebts, db.extraFunds, db.monthlyConfigs, db.incomeSources, db.settings, db.priorities],
      async () => {
        await db.bills.clear();
        await db.recurringDebts.clear();
        await db.extraFunds.clear();
        await db.monthlyConfigs.clear();
        await db.incomeSources.clear();
        await db.settings.clear();
        await db.priorities.clear();

        if (bills.length > 0) await db.bills.bulkAdd(bills as never[]);
        if (recurringDebts.length > 0) await db.recurringDebts.bulkAdd(recurringDebts as never[]);
        if (extraFunds.length > 0) await db.extraFunds.bulkAdd(extraFunds as never[]);
        if (monthlyConfigs.length > 0) await db.monthlyConfigs.bulkAdd(monthlyConfigs as never[]);
        if (incomeSources.length > 0) await db.incomeSources.bulkAdd(incomeSources as never[]);
        if (settings.length > 0) await db.settings.bulkAdd(settings as never[]);
        if (priorities.length > 0) await db.priorities.bulkAdd(priorities as never[]);
      }
    );
  } finally {
    isApplyingCloudData = false;
  }
}

function registerDexieSyncHooks(): void {
  const globalState = globalThis as typeof globalThis & { __pagueiSyncHooksRegistered?: boolean };
  if (globalState.__pagueiSyncHooksRegistered) return;

  globalState.__pagueiSyncHooksRegistered = true;

  const tables = [db.bills, db.recurringDebts, db.extraFunds, db.monthlyConfigs, db.incomeSources, db.settings, db.priorities];

  for (const table of tables) {
    table.hook('creating', () => {
      scheduleCloudSync();
    });
    table.hook('updating', () => {
      scheduleCloudSync();
    });
    table.hook('deleting', () => {
      scheduleCloudSync();
    });
  }
}

function ensureRealtimeCloudListener(): void {
  const cloudDocRef = getCloudDocRef();
  if (!cloudDocRef) return;

  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }

  cloudUnsubscribe = onSnapshot(
    cloudDocRef,
    async (docSnapshot) => {
      if (!docSnapshot.exists()) return;

      const cloudSnapshot = docSnapshot.data() as Partial<CloudSnapshot>;
      const cloudUpdatedAt = typeof cloudSnapshot.updatedAt === 'number' ? cloudSnapshot.updatedAt : 0;
      if (cloudUpdatedAt <= 0 || cloudUpdatedAt <= lastAppliedCloudUpdatedAt) return;

      const localUpdatedAt = getLocalLastChangedAt();
      const localCount = await getLocalItemCount();

      if (localCount > 0 && localUpdatedAt > cloudUpdatedAt) {
        return;
      }

      if (!hasCloudData(cloudSnapshot) && localCount > 0) {
        return;
      }

      await applyCloudSnapshotToLocal(cloudSnapshot);
      lastAppliedCloudUpdatedAt = cloudUpdatedAt;
      markLocalChanged(cloudUpdatedAt);
    },
    (error) => {
      console.error('Listener de sync em tempo real falhou:', error);
    }
  );
}

export function resetFirebaseSync(): void {
  currentUserId = null;
  currentDataOwnerId = null;
  syncInitializedPromise = null;
  isSyncBootstrapping = false;
  lastAppliedCloudUpdatedAt = 0;
  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

export async function initializeFirebaseSync(userId: string, userEmail?: string | null): Promise<void> {
  if (currentUserId !== userId) {
    resetFirebaseSync();
    currentUserId = userId;
  }

  currentDataOwnerId = await resolveDataOwnerId(userId, userEmail);

  registerDexieSyncHooks();

  const cloudDocRef = getCloudDocRef();
  if (!cloudDocRef) return;
  if (syncInitializedPromise) {
    await syncInitializedPromise;
    return;
  }

  syncInitializedPromise = (async () => {
    isSyncBootstrapping = true;
    try {
      const ownerId = currentDataOwnerId ?? userId;
      const isOwnerUser = currentUserId === ownerId;
      const lastSyncedOwnerId = getLastSyncedOwnerId();
      const isFirstSyncForThisOwner = lastSyncedOwnerId !== ownerId;

      const cloudDoc = await getDoc(cloudDocRef);

      if (!cloudDoc.exists()) {
        if (isOwnerUser) {
          await pushLocalSnapshotToCloud(true);
          markLocalChanged();
        } else {
          await applyCloudSnapshotToLocal({});
          markLocalChanged();
        }
        rememberSyncedOwnerId(ownerId);
        return;
      }

      const cloudSnapshot = cloudDoc.data() as Partial<CloudSnapshot>;
      const cloudUpdatedAt = typeof cloudSnapshot.updatedAt === 'number' ? cloudSnapshot.updatedAt : 0;
      const localUpdatedAt = getLocalLastChangedAt();
      const localCount = await getLocalItemCount();
      const cloudHasData = hasCloudData(cloudSnapshot);

      // First sync on this device for this owner always trusts cloud to prevent stale local overwrite.
      if (isFirstSyncForThisOwner) {
        await applyCloudSnapshotToLocal(cloudSnapshot);
        lastAppliedCloudUpdatedAt = cloudUpdatedAt;
        markLocalChanged(cloudUpdatedAt || Date.now());
        rememberSyncedOwnerId(ownerId);
        return;
      }

      if (localCount === 0 && cloudHasData) {
        await applyCloudSnapshotToLocal(cloudSnapshot);
        lastAppliedCloudUpdatedAt = cloudUpdatedAt;
        markLocalChanged(cloudUpdatedAt || Date.now());
        rememberSyncedOwnerId(ownerId);
        return;
      }

      if (localCount > 0 && !cloudHasData) {
        if (isOwnerUser) {
          await pushLocalSnapshotToCloud(true);
          markLocalChanged();
        } else {
          await applyCloudSnapshotToLocal(cloudSnapshot);
          markLocalChanged(cloudUpdatedAt || Date.now());
        }
        rememberSyncedOwnerId(ownerId);
        return;
      }

      if (cloudUpdatedAt > localUpdatedAt) {
        await applyCloudSnapshotToLocal(cloudSnapshot);
        lastAppliedCloudUpdatedAt = cloudUpdatedAt;
        markLocalChanged(cloudUpdatedAt);
        rememberSyncedOwnerId(ownerId);
        return;
      }

      if (isOwnerUser) {
        await pushLocalSnapshotToCloud(true);
        markLocalChanged();
      } else {
        await applyCloudSnapshotToLocal(cloudSnapshot);
        markLocalChanged(cloudUpdatedAt || Date.now());
      }
      rememberSyncedOwnerId(ownerId);
    } catch (error) {
      console.error('Falha ao sincronizar dados com Firebase:', error);
    } finally {
      isSyncBootstrapping = false;
    }
  })();

  await syncInitializedPromise;
  ensureRealtimeCloudListener();
}


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

function getInstallmentNumberForDate(
  startMonth: number,
  startYear: number,
  month: number,
  year: number
): number {
  const monthsSinceStart = (year - startYear) * 12 + (month - startMonth);
  return monthsSinceStart + 1;
}

function getInstallmentNumberForDebtMonth(debt: RecurringDebt, month: number, year: number): number | null {
  const installmentNumber = getInstallmentNumberForDate(debt.startMonth, debt.startYear, month, year);
  if (installmentNumber < 1 || installmentNumber > debt.totalInstallments) {
    return null;
  }
  return installmentNumber;
}

async function syncLinkedBillsWithRecurringDebt(
  debtId: number,
  paidInstallments: number,
  keepSkipped = true
): Promise<void> {
  const [debt, linkedBills] = await Promise.all([
    db.recurringDebts.get(debtId),
    db.bills.where('recurringDebtId').equals(debtId).toArray(),
  ]);

  if (!debt || linkedBills.length === 0) return;

  for (const linkedBill of linkedBills) {
    if (!linkedBill.id) continue;
    if (keepSkipped && linkedBill.status === 'skipped') continue;

    const installmentNumber = getInstallmentNumberForDebtMonth(debt, linkedBill.month, linkedBill.year);
    if (!installmentNumber) continue;

    const shouldBePaid = paidInstallments >= installmentNumber;
    const nextStatus = shouldBePaid ? 'paid' : 'pending';
    if (linkedBill.status !== nextStatus) {
      await db.bills.update(linkedBill.id, { status: nextStatus });
    }
  }
}

async function syncRecurringDebtFromBillStatus(
  bill: Bill,
  nextStatus: Bill['status']
): Promise<void> {
  if (!bill.recurringDebtId) return;

  const debt = await db.recurringDebts.get(bill.recurringDebtId);
  if (!debt || !debt.id) return;

  const installmentNumber = getInstallmentNumberForDebtMonth(debt, bill.month, bill.year);
  if (!installmentNumber) return;

  let nextPaidInstallments = debt.paidInstallments;
  if (nextStatus === 'paid') {
    nextPaidInstallments = Math.max(nextPaidInstallments, installmentNumber);
  } else if (bill.status === 'paid') {
    nextPaidInstallments = Math.min(nextPaidInstallments, installmentNumber - 1);
  }

  const hasPaidChanged = nextPaidInstallments !== debt.paidInstallments;
  const nextIsActive = nextPaidInstallments < debt.totalInstallments;
  const hasActiveChanged = debt.isActive !== nextIsActive;

  if (hasPaidChanged || hasActiveChanged) {
    await db.recurringDebts.update(debt.id, {
      paidInstallments: nextPaidInstallments,
      isActive: nextIsActive,
    });
    await syncLinkedBillsWithRecurringDebt(debt.id, nextPaidInstallments);
  }
}

export async function updateBillStatusWithSync(billId: number, nextStatus: Bill['status']): Promise<void> {
  const bill = await db.bills.get(billId);
  if (!bill || !bill.id) return;

  if (bill.status !== nextStatus) {
    await db.bills.update(bill.id, { status: nextStatus });
  }

  await syncRecurringDebtFromBillStatus(bill, nextStatus);
}

export async function updateRecurringDebtPaidInstallmentsWithSync(
  debtId: number,
  nextPaidInstallments: number
): Promise<void> {
  const debt = await db.recurringDebts.get(debtId);
  if (!debt || !debt.id) return;

  const boundedPaid = Math.max(0, Math.min(nextPaidInstallments, debt.totalInstallments));
  const nextIsActive = boundedPaid < debt.totalInstallments;

  if (boundedPaid !== debt.paidInstallments || debt.isActive !== nextIsActive) {
    await db.recurringDebts.update(debt.id, {
      paidInstallments: boundedPaid,
      isActive: nextIsActive,
    });
  }

  await syncLinkedBillsWithRecurringDebt(debt.id, boundedPaid);
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
  await updateBillStatusWithSync(bill.id, 'skipped');
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

/**
 * Devolve uma dívida postergada ao seu mês de origem, marca como paga
 * e restaura a conta original (carriedFromBillId) para 'pending'
 * para que o mês de origem reflita corretamente o pagamento.
 *
 * Fluxo:
 * 1. Pega a conta postergada (carriedFromBillId/Month/Year preenchidos)
 * 2. Move ela de volta para o mês de origem (carriedFromMonth/Year)
 * 3. Limpa os campos "carried", restaura a descrição original
 * 4. Marca como 'paid'
 * 5. Marca a conta original (que estava 'skipped') como 'paid' também
 * 6. Remove eventuais carry-overs em cadeia da conta postergada atual
 */
export async function returnBillToOriginalMonth(bill: Bill): Promise<void> {
  if (!bill.id || !bill.carriedFromMonth || !bill.carriedFromYear) return;

  const originalDescription = bill.originalDescription ?? bill.description.replace(/\s*\[ATRASADA.*?\]/, '').trim();

  // Move a conta postergada para o mês de origem e marca como paga
  await db.bills.update(bill.id, {
    month: bill.carriedFromMonth,
    year: bill.carriedFromYear,
    description: originalDescription,
    status: 'paid',
    observation: bill.observation ? `${bill.observation} (paga com devolução)` : 'Paga com devolução ao mês original',
    carriedFromBillId: undefined,
    carriedFromMonth: undefined,
    carriedFromYear: undefined,
  });

  // Se a conta original ainda existe como 'skipped', marca como 'paid' também
  if (bill.carriedFromBillId) {
    const original = await db.bills.get(bill.carriedFromBillId);
    if (original && original.status === 'skipped') {
      await updateBillStatusWithSync(bill.carriedFromBillId, 'paid');
    }
  }

  // Remove carry-overs pendentes que esta conta tenha gerado em outros meses
  await removeCarryOverForPaidBill(bill.id);
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
