import Dexie, { type Table } from 'dexie';
import type { Bill, RecurringDebt, ExtraFund, MonthlyConfig, AppSettings, IncomeSource, PriorityItem, PostponeRecord, InformalLoan } from '../types';
import { buildDueDate, getMonthName } from '../utils/formatters';
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
  loans!: Table<InformalLoan>;

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

    // v6: historico de adiamentos com datas. Retroalimenta as contas que ja
    // existiam percorrendo a cadeia carriedFromBillId.
    this.version(6).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId, [originYear+originMonth], postponedAt',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
      priorities: '++id, keyword, level',
    }).upgrade(async (tx) => {
      const billsTable = tx.table('bills');
      const all: Bill[] = await billsTable.toArray();
      const byId = new Map<number, Bill>();
      for (const b of all) if (b.id) byId.set(b.id, b);

      for (const bill of all) {
        if (!bill.id || bill.postponeHistory) continue;

        // Reconstroi a cadeia do mais antigo ao mais recente.
        const chain: Bill[] = [];
        const seen = new Set<number>();
        let cursor: Bill | undefined = bill;
        while (cursor?.carriedFromBillId && cursor.carriedFromMonth && cursor.carriedFromYear) {
          chain.unshift(cursor);
          const prevId: number = cursor.carriedFromBillId;
          if (seen.has(prevId)) break;
          seen.add(prevId);
          cursor = byId.get(prevId);
        }

        if (chain.length === 0) {
          // Nunca foi adiada: so registra a origem e o vencimento original.
          await billsTable.update(bill.id, {
            originMonth: bill.month,
            originYear: bill.year,
            originalDueDate: buildDueDate(bill.month, bill.year, bill.dueDay).toISOString(),
            postponeHistory: [],
          });
          continue;
        }

        const history: PostponeRecord[] = chain.map((step) => {
          const fromMonth = step.carriedFromMonth as number;
          const fromYear = step.carriedFromYear as number;
          return {
            fromMonth,
            fromYear,
            toMonth: step.month,
            toYear: step.year,
            // Sem timestamp real nos dados antigos: usamos o primeiro dia da
            // competencia de destino, que e quando a virada aconteceu.
            postponedAt: new Date(step.year, step.month - 1, 1).toISOString(),
            dueDate: buildDueDate(fromMonth, fromYear, step.dueDay).toISOString(),
            auto: true,
          };
        });

        const first = history[0];
        const last = history[history.length - 1];
        await billsTable.update(bill.id, {
          originMonth: first.fromMonth,
          originYear: first.fromYear,
          originalDueDate: first.dueDate,
          postponedAt: last.postponedAt,
          postponeHistory: history,
        });
      }
    });

    // v7: contas mensais. Cada ocorrência carrega o id da série para que as
    // competências seguintes saibam que já existe (ou não) uma fatura daquele
    // mês.
    this.version(7).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId, [originYear+originMonth], postponedAt, seriesId, isMonthly',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
      priorities: '++id, keyword, level',
    }).upgrade(async (tx) => {
      const billsTable = tx.table('bills');
      const all: Bill[] = await billsTable.toArray();
      const byId = new Map<number, Bill>();
      for (const b of all) if (b.id) byId.set(b.id, b);

      // A série de uma conta antiga é a raiz da cadeia de adiamentos: todas
      // as contas que vieram de um mesmo original pertencem à mesma série.
      for (const bill of all) {
        if (!bill.id || bill.seriesId) continue;

        let rootId = bill.id;
        const seen = new Set<number>([bill.id]);
        let cursor: Bill | undefined = bill;
        while (cursor?.carriedFromBillId && !seen.has(cursor.carriedFromBillId)) {
          seen.add(cursor.carriedFromBillId);
          const previous: Bill | undefined = byId.get(cursor.carriedFromBillId);
          if (!previous?.id) break;
          rootId = previous.id;
          cursor = previous;
        }

        await billsTable.update(bill.id, { seriesId: rootId });
      }
    });

    // v8: dinheiro com agiota. As cobranças mensais de juros são contas
    // comuns ligadas ao empréstimo por loanId.
    this.version(8).stores({
      bills: '++id, [month+year], recurringDebtId, status, dueDay, carriedFromBillId, [originYear+originMonth], postponedAt, seriesId, isMonthly, loanId',
      recurringDebts: '++id, isActive',
      extraFunds: '++id, [month+year]',
      monthlyConfigs: '++id, [month+year]',
      incomeSources: '++id, isActive',
      settings: '++id',
      priorities: '++id, keyword, level',
      loans: '++id, status',
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
  loans?: InformalLoan[];
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
  const [bills, recurringDebts, extraFunds, monthlyConfigs, incomeSources, settings, priorities, loans] =
    await Promise.all([
      db.bills.toArray(),
      db.recurringDebts.toArray(),
      db.extraFunds.toArray(),
      db.monthlyConfigs.toArray(),
      db.incomeSources.toArray(),
      db.settings.toArray(),
      db.priorities.toArray(),
      db.loans.toArray(),
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
    loans,
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
    normalizeArray(snapshot.priorities).length > 0 ||
    normalizeArray(snapshot.loans).length > 0
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
    db.loans.count(),
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
  const loans = normalizeArray<InformalLoan>(snapshot.loans);

  isApplyingCloudData = true;
  try {
    await db.transaction(
      'rw',
      [db.bills, db.recurringDebts, db.extraFunds, db.monthlyConfigs, db.incomeSources, db.settings, db.priorities, db.loans],
      async () => {
        await db.bills.clear();
        await db.recurringDebts.clear();
        await db.extraFunds.clear();
        await db.monthlyConfigs.clear();
        await db.incomeSources.clear();
        await db.settings.clear();
        await db.priorities.clear();
        await db.loans.clear();

        if (bills.length > 0) await db.bills.bulkAdd(bills as never[]);
        if (recurringDebts.length > 0) await db.recurringDebts.bulkAdd(recurringDebts as never[]);
        if (extraFunds.length > 0) await db.extraFunds.bulkAdd(extraFunds as never[]);
        if (monthlyConfigs.length > 0) await db.monthlyConfigs.bulkAdd(monthlyConfigs as never[]);
        if (incomeSources.length > 0) await db.incomeSources.bulkAdd(incomeSources as never[]);
        if (settings.length > 0) await db.settings.bulkAdd(settings as never[]);
        if (priorities.length > 0) await db.priorities.bulkAdd(priorities as never[]);
        if (loans.length > 0) await db.loans.bulkAdd(loans as never[]);
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

  const tables = [db.bills, db.recurringDebts, db.extraFunds, db.monthlyConfigs, db.incomeSources, db.settings, db.priorities, db.loans];

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
/**
 * As rotinas que geram contas (faturas do mês, carry-over, juros do
 * agiota) leem o banco, decidem o que falta e só então gravam. Se duas
 * rodarem ao mesmo tempo — o Início e o resumo de atrasos abrem juntos, e o
 * StrictMode do React roda cada efeito duas vezes — as duas veem o mesmo
 * buraco e criam a mesma conta duas vezes. Esta fila faz uma esperar a
 * outra.
 */
let generationChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = generationChain.then(task, task);
  generationChain = run.catch(() => undefined);
  return run;
}

export function ensureCarryOverBillsForMonth(
  month: number,
  year: number,
  only?: (bill: Bill) => boolean
): Promise<number> {
  return exclusive(() => carryOverBillsForMonth(month, year, only));
}

async function carryOverBillsForMonth(
  month: number,
  year: number,
  only?: (bill: Bill) => boolean
): Promise<number> {
  const prev = getPreviousMonthYear(month, year);

  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const prevMonthEnded =
    prev.year < currentYear || (prev.year === currentYear && prev.month < currentMonth);

  if (!prevMonthEnded) return 0;

  const [previousMonthBills, currentMonthBills] = await Promise.all([
    db.bills
      .where('[month+year]')
      .equals([prev.month, prev.year])
      .and((b) => b.status === 'pending' && (!only || only(b)))
      .toArray(),
    db.bills.where('[month+year]').equals([month, year]).toArray(),
  ]);

  if (previousMonthBills.length === 0) return 0;

  const newCarryOvers: Bill[] = [];

  for (const prevBill of previousMonthBills) {
    if (!prevBill.id) continue;

    const alreadyCarried = currentMonthBills.some((b) => b.carriedFromBillId === prevBill.id);
    if (alreadyCarried) continue;

    const baseDescription = prevBill.originalDescription ?? prevBill.description;
    const tracking = buildPostponementFields(prevBill, { month, year }, { auto: true });
    newCarryOvers.push({
      description: baseDescription,
      originalDescription: baseDescription,
      initialValue: prevBill.finalValue,
      finalValue: prevBill.finalValue,
      status: 'pending',
      dueDay: prevBill.dueDay,
      observation: prevBill.observation,
      month,
      year,
      // A fatura adiada continua pertencendo à mesma série mensal, mas deixa
      // de gerar novas: quem gera é a ocorrência da competência, não esta.
      isMonthly: prevBill.isMonthly,
      ...pickCostFields(prevBill),
      seriesId: prevBill.seriesId ?? prevBill.id,
      carriedFromBillId: prevBill.id,
      carriedFromMonth: prev.month,
      carriedFromYear: prev.year,
      ...tracking,
    });
  }

  if (newCarryOvers.length === 0) return 0;

  await db.bills.bulkAdd(newCarryOvers);

  // A original precisa sair do mês de origem. Sem isto a mesma dívida ficava
  // pendente nos dois lugares: junho continuava devendo R$ 150 mesmo depois de
  // a conta ter sido empurrada para julho, e a soma dos meses contava em
  // dobro.
  const movedIds = newCarryOvers
    .map((b) => b.carriedFromBillId)
    .filter((id): id is number => typeof id === 'number');

  if (movedIds.length > 0) {
    await db.bills.bulkUpdate(movedIds.map((key) => ({ key, changes: { status: 'skipped' } })));
  }

  return newCarryOvers.length;
}

/** Chave de competência, para comparar meses como texto ordenável. */
function competenceKey(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Garante que toda conta marcada como mensal tenha a fatura da competência
 * pedida.
 *
 * É isto que faz o adiamento acumular: adiar a energia de junho move aquela
 * dívida para julho, mas julho gera a própria fatura de julho do mesmo jeito.
 * Três meses sem pagar viram três dívidas, cada uma com o mês de origem.
 *
 * Uma ocorrência é identificada por (série + competência de origem), e não
 * pelo mês onde ela está hoje — uma fatura de junho adiada para setembro
 * continua sendo a de junho, então junho não gera outra.
 *
 * Vale também para meses futuros. A energia de outubro é devida em outubro
 * mesmo que ainda estejamos em setembro, e sem isso adiar uma conta para
 * frente deixava os meses seguintes sem a fatura deles: o débito viajava
 * sozinho em vez de somar.
 *
 * Devolve quantas faturas foram criadas.
 */
export function ensureMonthlyBillOccurrences(month: number, year: number): Promise<number> {
  return exclusive(() => monthlyBillOccurrences(month, year));
}

async function monthlyBillOccurrences(month: number, year: number): Promise<number> {
  const targetKey = competenceKey(month, year);

  const monthlyBills = await db.bills.filter((b) => b.isMonthly === true).toArray();
  if (monthlyBills.length === 0) return 0;

  interface SeriesInfo {
    startKey: string;
    /** Ocorrência mais recente, usada como molde (valor e dia podem ter mudado) */
    template: Bill;
    templateKey: string;
    origins: Set<string>;
  }

  const series = new Map<number, SeriesInfo>();

  for (const bill of monthlyBills) {
    const seriesId = bill.seriesId ?? bill.id;
    if (!seriesId) continue;

    const originMonth = bill.originMonth ?? bill.month;
    const originYear = bill.originYear ?? bill.year;
    const key = competenceKey(originMonth, originYear);

    const existing = series.get(seriesId);
    if (!existing) {
      series.set(seriesId, {
        startKey: key,
        template: bill,
        templateKey: key,
        origins: new Set([key]),
      });
      continue;
    }

    existing.origins.add(key);
    if (key < existing.startKey) existing.startKey = key;
    if (key > existing.templateKey) {
      existing.template = bill;
      existing.templateKey = key;
    }
  }

  const newOccurrences: Bill[] = [];

  for (const [seriesId, info] of series) {
    // A série ainda não tinha começado nesta competência.
    if (targetKey < info.startKey) continue;
    // Esta competência já tem a fatura dela (mesmo que adiada para outro mês).
    if (info.origins.has(targetKey)) continue;

    const template = info.template;
    const description = template.originalDescription ?? template.description;

    newOccurrences.push({
      description,
      originalDescription: description,
      initialValue: template.initialValue,
      finalValue: template.finalValue,
      status: 'pending',
      dueDay: template.dueDay,
      observation: '',
      month,
      year,
      isMonthly: true,
      ...pickCostFields(template),
      seriesId,
      originMonth: month,
      originYear: year,
      originalDueDate: buildDueDate(month, year, template.dueDay).toISOString(),
      postponeHistory: [],
    });
  }

  if (newOccurrences.length > 0) {
    await db.bills.bulkAdd(newOccurrences);
  }

  return newOccurrences.length;
}

/**
 * Liga ou desliga a repetição mensal de uma série inteira.
 *
 * A marcação vive em todas as ocorrências, então desmarcar numa delas precisa
 * valer para as irmãs — senão a série continuaria gerando faturas a partir de
 * qualquer ocorrência que ainda estivesse marcada.
 */
export async function setBillSeriesMonthly(
  seriesId: number,
  isMonthly: boolean
): Promise<void> {
  const siblings = await db.bills.where('seriesId').equals(seriesId).toArray();
  const ids = siblings.map((b) => b.id).filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) return;

  await db.bills.bulkUpdate(ids.map((key) => ({ key, changes: { isMonthly } })));
  markLocalChanged();
  scheduleCloudSync();
}

function getNextMonthYear(month: number, year: number): { month: number; year: number } {
  if (month === 12) {
    return { month: 1, year: year + 1 };
  }
  return { month: month + 1, year };
}

/**
 * Monta os campos de rastreio que a nova conta (a que vai para o mes seguinte)
 * precisa carregar: competencia de origem, vencimento original, data deste
 * adiamento e o historico acumulado. Ao encadear adiamentos, o historico da
 * conta anterior e preservado e a nova entrada e acrescentada no fim.
 */
/**
 * Categoria e encargos que uma cópia da conta (adiada ou fatura do mês
 * seguinte) precisa herdar — senão a dívida adiada perderia a multa e os
 * juros que o usuário cadastrou e o assistente voltaria aos padrões.
 */
function pickCostFields(bill: Bill): Pick<Bill, 'category' | 'lateFeePercent' | 'monthlyInterestPercent' | 'loanId'> {
  const fields: Pick<Bill, 'category' | 'lateFeePercent' | 'monthlyInterestPercent' | 'loanId'> = {};
  // Juros de agiota adiados continuam sendo daquele empréstimo.
  if (bill.loanId !== undefined) fields.loanId = bill.loanId;
  if (bill.category) fields.category = bill.category;
  if (typeof bill.lateFeePercent === 'number') fields.lateFeePercent = bill.lateFeePercent;
  if (typeof bill.monthlyInterestPercent === 'number') fields.monthlyInterestPercent = bill.monthlyInterestPercent;
  return fields;
}

/**
 * Aplica categoria e encargos a todas as ocorrências de uma série, como
 * setBillSeriesMonthly faz com a repetição: editar a energia de outubro vale
 * também para as faturas de agosto e setembro que ainda estão em aberto.
 */
export async function setBillSeriesCost(
  seriesId: number,
  fields: Pick<Bill, 'category' | 'lateFeePercent' | 'monthlyInterestPercent'>
): Promise<void> {
  const siblings = await db.bills.where('seriesId').equals(seriesId).toArray();
  const ids = siblings.map((b) => b.id).filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) return;

  await db.bills.bulkUpdate(ids.map((key) => ({ key, changes: fields })));
  markLocalChanged();
  scheduleCloudSync();
}

function buildPostponementFields(
  source: Bill,
  target: { month: number; year: number },
  options: { auto?: boolean; at?: Date } = {}
): Pick<Bill, 'originMonth' | 'originYear' | 'originalDueDate' | 'postponedAt' | 'postponeHistory'> {
  const at = options.at ?? new Date();
  const originMonth = source.originMonth ?? source.month;
  const originYear = source.originYear ?? source.year;
  const missedDueDate = buildDueDate(source.month, source.year, source.dueDay);

  const entry: PostponeRecord = {
    fromMonth: source.month,
    fromYear: source.year,
    toMonth: target.month,
    toYear: target.year,
    postponedAt: at.toISOString(),
    dueDate: missedDueDate.toISOString(),
    ...(options.auto ? { auto: true } : {}),
  };

  return {
    originMonth,
    originYear,
    originalDueDate:
      source.originalDueDate ?? buildDueDate(originMonth, originYear, source.dueDay).toISOString(),
    postponedAt: entry.postponedAt,
    postponeHistory: [...(source.postponeHistory ?? []), entry],
  };
}

/** Quantas vezes a conta ja foi empurrada. */
export function getPostponeCount(bill: Bill): number {
  if (bill.postponeHistory) return bill.postponeHistory.length;
  return bill.carriedFromBillId ? 1 : 0;
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

/**
 * A que parcela uma conta corresponde. Conta ligada direto à dívida responde
 * pela competência dela. Parcela adiada vira uma conta sem o vínculo (para
 * não esconder a parcela do mês de destino), então o vínculo é buscado na
 * raiz da cadeia de adiamentos — sem isso, pagar a parcela adiada em Contas
 * não baixava nada na aba Dívidas.
 */
async function resolveRecurringLink(
  bill: Bill
): Promise<{ debtId: number; month: number; year: number } | null> {
  if (bill.recurringDebtId) {
    return { debtId: bill.recurringDebtId, month: bill.month, year: bill.year };
  }
  const seen = new Set<number>();
  let cursorId = bill.carriedFromBillId;
  while (cursorId && !seen.has(cursorId)) {
    seen.add(cursorId);
    const previous: Bill | undefined = await db.bills.get(cursorId);
    if (!previous) return null;
    if (previous.recurringDebtId) {
      return { debtId: previous.recurringDebtId, month: previous.month, year: previous.year };
    }
    cursorId = previous.carriedFromBillId;
  }
  return null;
}

async function syncRecurringDebtFromBillStatus(
  bill: Bill,
  nextStatus: Bill['status']
): Promise<void> {
  const link = await resolveRecurringLink(bill);
  if (!link) return;

  const debt = await db.recurringDebts.get(link.debtId);
  if (!debt || !debt.id) return;

  const installmentNumber = getInstallmentNumberForDebtMonth(debt, link.month, link.year);
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
  const tracking = buildPostponementFields(bill, next);
  await db.bills.add({
    description: baseDescription,
    originalDescription: baseDescription,
    initialValue: bill.finalValue,
    finalValue: bill.finalValue,
    status: 'pending',
    dueDay: bill.dueDay,
    observation: bill.observation,
    month: next.month,
    year: next.year,
    isMonthly: bill.isMonthly,
    ...pickCostFields(bill),
    seriesId: bill.seriesId ?? bill.id,
    carriedFromBillId: bill.id,
    carriedFromMonth: bill.month,
    carriedFromYear: bill.year,
    ...tracking,
  });

  // Mark original as skipped
  await updateBillStatusWithSync(bill.id, 'skipped');

  // Adiar é assumir que esta conta volta no mês seguinte: a competência de
  // destino passa a gerar a própria fatura, e a adiada se soma a ela em vez de
  // ocupar o lugar dela. É isso que faz três adiamentos virarem três dívidas
  // individuais, cada uma com o vencimento que ficou para trás.
  //
  // Se a conta for mesmo avulsa, basta desmarcar "repete todo mês" na edição
  // que ela para de gerar novas.
  // Juros de agiota já são gerados todo mês pelo empréstimo.
  if (!bill.isMonthly && bill.loanId === undefined) {
    await setBillSeriesMonthly(bill.seriesId ?? bill.id, true);
  }
}

/**
 * Desfaz um adiamento: apaga a conta criada no mês seguinte e devolve a
 * original para 'pending'. É o par do skipBillToNextMonth, usado pelo
 * "Desfazer" do aviso que aparece logo após a ação.
 */
export async function undoSkipBill(billId: number): Promise<void> {
  const bill = await db.bills.get(billId);
  if (!bill) return;

  await removeCarryOverForPaidBill(billId);
  if (bill.status === 'skipped') {
    await updateBillStatusWithSync(billId, 'pending');
  }
}

/** Recria uma conta excluída com o mesmo id, para o "Desfazer" da exclusão. */
export async function restoreBill(bill: Bill): Promise<void> {
  if (!bill.id) return;
  await db.bills.put(bill);
  markLocalChanged();
  scheduleCloudSync();
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

  const originalDueDate = buildDueDate(month, year, debt.dueDay).toISOString();

  // Create a skipped bill for the current month (so it appears as "adiado")
  const skippedBill: Bill = {
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
    originMonth: month,
    originYear: year,
    originalDueDate,
    postponeHistory: [],
  };
  const skippedBillId = await db.bills.add(skippedBill);

  // Create a pending bill for next month as carry-over
  const tracking = buildPostponementFields({ ...skippedBill, id: skippedBillId as number }, next);
  const carryDescription = `Parcela de ${debt.description} - ${getMonthName(month)} (${installmentNumber}/${debt.totalInstallments})`;

  await db.bills.add({
    description: carryDescription,
    originalDescription: debt.description,
    initialValue: debt.installmentValue,
    finalValue: debt.installmentValue,
    status: 'pending',
    dueDay: debt.dueDay,
    observation: `Parcela adiada 1x — vencimento original em ${getMonthName(month)}/${year}`,
    month: next.month,
    year: next.year,
    carriedFromBillId: skippedBillId as number,
    carriedFromMonth: month,
    carriedFromYear: year,
    ...tracking,
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

  // Move a conta postergada para a competência de origem real (a primeira da
  // cadeia, nao apenas a anterior) e marca como paga.
  const originMonth = bill.originMonth ?? bill.carriedFromMonth;
  const originYear = bill.originYear ?? bill.carriedFromYear;

  // Percorre a cadeia inteira para tras. Com adiamentos encadeados sobram
  // registros 'skipped' em cada mes intermediario; eles nao sao obrigacoes
  // daqueles meses (a obrigacao andou junto com a conta), entao sao removidos
  // para que a divida apareca uma unica vez, no mes de origem.
  const upstreamIds: number[] = [];
  const seen = new Set<number>();
  let recurringDebtId = bill.recurringDebtId;
  let cursorId = bill.carriedFromBillId;

  while (cursorId && !seen.has(cursorId)) {
    seen.add(cursorId);
    const previous: Bill | undefined = await db.bills.get(cursorId);
    if (!previous?.id) break;
    upstreamIds.push(previous.id);
    // O vinculo com a divida recorrente vive na primeira conta da cadeia;
    // preserva-lo evita que a parcela volte a aparecer como em aberto.
    recurringDebtId = recurringDebtId ?? previous.recurringDebtId;
    cursorId = previous.carriedFromBillId;
  }

  await db.bills.update(bill.id, {
    month: originMonth,
    year: originYear,
    description: originalDescription,
    status: 'paid',
    observation: bill.observation ? `${bill.observation} (paga com devolução)` : 'Paga com devolução ao mês original',
    recurringDebtId,
    carriedFromBillId: undefined,
    carriedFromMonth: undefined,
    carriedFromYear: undefined,
    postponedAt: undefined,
    postponeHistory: [],
    originMonth,
    originYear,
  });

  if (upstreamIds.length > 0) {
    await db.bills.bulkDelete(upstreamIds);
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

/* --- Dinheiro com agiota ---------------------------------------------- */

function monthIndex(month: number, year: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): { month: number; year: number } {
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

/** Juros cobrados por mês: o percentual sobre o valor pego. */
export function loanMonthlyInterest(loan: Pick<InformalLoan, 'principal' | 'monthlyRatePercent'>): number {
  return Math.round(loan.principal * loan.monthlyRatePercent) / 100;
}

/**
 * Garante as cobranças de juros de cada empréstimo com agiota até a
 * competência pedida: uma conta por mês, a partir do mês seguinte ao
 * empréstimo, até o mês em que ele foi quitado.
 *
 * Como nas contas mensais, a identidade de cada cobrança é (empréstimo +
 * competência de origem): os juros de setembro adiados para outubro
 * continuam sendo os de setembro, e setembro não gera outros.
 *
 * Quando o empréstimo é lançado com data retroativa, os meses que já
 * passaram ganham as cobranças deles e as que estão em aberto são trazidas
 * mês a mês até hoje — como teria acontecido se o app tivesse sido aberto
 * em cada mês. Só as cobranças do agiota andam; as outras contas não.
 */
export function ensureLoanInterestBills(month: number, year: number): Promise<number> {
  return exclusive(() => loanInterestBills(month, year));
}

async function loanInterestBills(month: number, year: number): Promise<number> {
  const loans = await db.loans.toArray();
  if (loans.length === 0) return 0;

  const target = monthIndex(month, year);
  const today = new Date();
  const current = monthIndex(today.getMonth() + 1, today.getFullYear());
  const created: Bill[] = [];

  for (const loan of loans) {
    if (!loan.id) continue;
    const first = monthIndex(loan.takenMonth, loan.takenYear) + 1;
    const last =
      loan.status === 'paid' && loan.paidOffMonth && loan.paidOffYear
        ? Math.min(target, monthIndex(loan.paidOffMonth, loan.paidOffYear))
        : target;
    if (last < first) continue;

    const existing = await db.bills.where('loanId').equals(loan.id).toArray();
    const origins = new Set(
      existing
        .filter((b) => !b.loanPayoff)
        .map((b) => monthIndex(b.originMonth ?? b.month, b.originYear ?? b.year))
    );

    const value = loanMonthlyInterest(loan);
    const description = `Juros — ${loan.lender}`;
    const principalLabel = loan.principal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    for (let index = first; index <= last; index++) {
      if (origins.has(index)) continue;
      const when = fromMonthIndex(index);
      created.push({
        description,
        originalDescription: description,
        initialValue: value,
        finalValue: value,
        status: 'pending',
        dueDay: loan.dueDay,
        observation: `${loan.monthlyRatePercent.toLocaleString('pt-BR')}% de ${principalLabel} — não abate o valor pego`,
        month: when.month,
        year: when.year,
        originMonth: when.month,
        originYear: when.year,
        originalDueDate: buildDueDate(when.month, when.year, loan.dueDay).toISOString(),
        postponeHistory: [],
        category: 'emprestimo',
        loanId: loan.id,
      });
    }
  }

  if (created.length === 0) return 0;
  await db.bills.bulkAdd(created);

  // Atraso retroativo: leva as cobranças em aberto de meses que já
  // terminaram até o mês corrente, uma competência por vez.
  const pastIndexes = created
    .map((b) => monthIndex(b.month, b.year))
    .filter((index) => index < current);
  if (pastIndexes.length > 0) {
    for (let index = Math.min(...pastIndexes) + 1; index <= current; index++) {
      const when = fromMonthIndex(index);
      await carryOverBillsForMonth(when.month, when.year, (b) => b.loanId !== undefined);
    }
  }

  markLocalChanged();
  scheduleCloudSync();
  return created.length;
}

export async function addInformalLoan(
  input: Omit<InformalLoan, 'id' | 'status' | 'createdAt' | 'paidOffMonth' | 'paidOffYear' | 'paidOffAt'>
): Promise<number> {
  const id = await db.loans.add({ ...input, status: 'active', createdAt: new Date().toISOString() });
  const today = new Date();
  await ensureLoanInterestBills(today.getMonth() + 1, today.getFullYear());
  return id as number;
}

/**
 * Registra a devolução do valor cheio. A partir do mês seguinte não há mais
 * juros; a devolução entra como conta paga no mês, para que o dinheiro que
 * saiu apareça no orçamento.
 */
export async function payOffInformalLoan(loanId: number): Promise<void> {
  const loan = await db.loans.get(loanId);
  if (!loan || loan.status === 'paid') return;
  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  // Os juros deste mês continuam devidos; os de depois, não.
  await ensureLoanInterestBills(month, year);

  await db.loans.update(loanId, {
    status: 'paid',
    paidOffMonth: month,
    paidOffYear: year,
    paidOffAt: today.toISOString(),
  });

  const description = `Devolução — ${loan.lender}`;
  await db.bills.add({
    description,
    originalDescription: description,
    initialValue: loan.principal,
    finalValue: loan.principal,
    status: 'paid',
    dueDay: today.getDate(),
    observation: 'Valor pego devolvido por inteiro — empréstimo quitado',
    month,
    year,
    originMonth: month,
    originYear: year,
    originalDueDate: buildDueDate(month, year, today.getDate()).toISOString(),
    postponeHistory: [],
    category: 'emprestimo',
    loanId,
    loanPayoff: true,
  });

  // Cobranças já geradas para meses depois da quitação deixam de existir.
  const all = await db.bills.where('loanId').equals(loanId).toArray();
  const stale = all
    .filter((b) => !b.loanPayoff && b.status === 'pending')
    .filter((b) => monthIndex(b.originMonth ?? b.month, b.originYear ?? b.year) > monthIndex(month, year))
    .map((b) => b.id as number);
  if (stale.length > 0) await db.bills.bulkDelete(stale);

  markLocalChanged();
  scheduleCloudSync();
}

/** Desfaz a quitação: o empréstimo volta a cobrar juros. */
export async function reopenInformalLoan(loanId: number): Promise<void> {
  const payoffs = await db.bills
    .where('loanId')
    .equals(loanId)
    .and((b) => b.loanPayoff === true)
    .toArray();
  await db.bills.bulkDelete(payoffs.map((b) => b.id as number));
  await db.loans.update(loanId, {
    status: 'active',
    paidOffMonth: undefined,
    paidOffYear: undefined,
    paidOffAt: undefined,
  });
  const today = new Date();
  await ensureLoanInterestBills(today.getMonth() + 1, today.getFullYear());
  markLocalChanged();
  scheduleCloudSync();
}

/** Muda o percentual. Vale também para as cobranças ainda não pagas. */
export async function updateInformalLoanRate(loanId: number, monthlyRatePercent: number): Promise<void> {
  const loan = await db.loans.get(loanId);
  if (!loan) return;
  await db.loans.update(loanId, { monthlyRatePercent });
  const value = loanMonthlyInterest({ principal: loan.principal, monthlyRatePercent });
  const pending = await db.bills
    .where('loanId')
    .equals(loanId)
    .and((b) => b.status === 'pending' && !b.loanPayoff)
    .toArray();
  if (pending.length > 0) {
    await db.bills.bulkUpdate(
      pending.map((b) => ({ key: b.id as number, changes: { initialValue: value, finalValue: value } }))
    );
  }
  markLocalChanged();
  scheduleCloudSync();
}

/** Apaga o empréstimo e todas as contas que ele gerou. */
export async function deleteInformalLoan(loanId: number): Promise<void> {
  const bills = await db.bills.where('loanId').equals(loanId).toArray();
  await db.bills.bulkDelete(bills.map((b) => b.id as number));
  await db.loans.delete(loanId);
  markLocalChanged();
  scheduleCloudSync();
}
