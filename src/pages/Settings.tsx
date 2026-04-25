import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sun, Moon, Plus, Trash2, DollarSign, PiggyBank, Download, Upload, Database, CheckCircle2, AlertTriangle, Smartphone, ShieldAlert, X, LogOut, Pencil, Camera } from 'lucide-react';
import { db, getOrCreateSettings, ensureMonthlyConfig } from '../db/database';
import { exportBackup, downloadBackup, importBackup } from '../db/backup';
import { formatCurrency, getMonthName } from '../utils/formatters';
import { useTheme } from '../hooks/useTheme';
import { useMonthNavigation } from '../hooks/useMonthNavigation';
import { MonthSelector } from '../components/MonthSelector';
import type { AppSettings } from '../types';
import { HelpButton } from '../components/HelpModal';
import { useAuth } from '../contexts/AuthContext';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function compressImageToDataUrl(file: File, size: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas não suportado'));
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar imagem')); };
    img.src = url;
  });
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user, logout, authError, updateUserProfile } = useAuth();
  const { month, year, goToPrev, goToNext } = useMonthNavigation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [newIncomeDesc, setNewIncomeDesc] = useState('');
  const [newIncomeValue, setNewIncomeValue] = useState('');
  const [newFundDesc, setNewFundDesc] = useState('');
  const [newFundValue, setNewFundValue] = useState('');
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ label: string; confirmText: string; action: () => Promise<void> } | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteMessage, setDeleteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authActionMessage, setAuthActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if already installed as standalone
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setIsInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const incomeSources = useLiveQuery(
    () => db.incomeSources.filter((i) => i.isActive).toArray(),
    []
  );

  const extraFunds = useLiveQuery(
    () => db.extraFunds.where({ month, year }).toArray(),
    [month, year]
  );

  useEffect(() => {
    (async () => {
      const s = await getOrCreateSettings();
      setSettings(s);
      setSalaryInput(s.defaultSalary > 0 ? s.defaultSalary.toString() : '');
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getOrCreateSettings();
      const config = await ensureMonthlyConfig(month, year, s.defaultSalary);
      setMonthlySalary(config.salary > 0 ? config.salary.toString() : '');
    })();
  }, [month, year]);

  const saveDefaultSalary = async () => {
    if (!settings) return;
    const value = parseFloat(salaryInput.replace(',', '.')) || 0;
    await db.settings.update(settings.id!, { defaultSalary: value });
    setSettings({ ...settings, defaultSalary: value });
  };

  const saveMonthlySalary = async () => {
    const value = parseFloat(monthlySalary.replace(',', '.')) || 0;
    const config = await ensureMonthlyConfig(month, year, value);
    await db.monthlyConfigs.update(config.id!, { salary: value });
  };

  const addExtraFund = async () => {
    if (!newFundDesc.trim() || !newFundValue.trim()) return;
    await db.extraFunds.add({
      month,
      year,
      description: newFundDesc.trim(),
      value: parseFloat(newFundValue.replace(',', '.')) || 0,
    });
    setNewFundDesc('');
    setNewFundValue('');
  };

  const deleteExtraFund = async (id: number) => {
    await db.extraFunds.delete(id);
  };

  const addIncomeSource = async () => {
    if (!newIncomeDesc.trim() || !newIncomeValue.trim()) return;
    await db.incomeSources.add({
      description: newIncomeDesc.trim(),
      value: parseFloat(newIncomeValue.replace(',', '.')) || 0,
      isActive: true,
    });
    setNewIncomeDesc('');
    setNewIncomeValue('');
  };

  const deleteIncomeSource = async (id: number) => {
    await db.incomeSources.delete(id);
  };

  const totalExtra = extraFunds?.reduce((sum, f) => sum + f.value, 0) ?? 0;
  const totalIncomeSources = incomeSources?.reduce((sum, i) => sum + i.value, 0) ?? 0;
  const currentSalary = parseFloat(monthlySalary.replace(',', '.')) || 0;
  const totalIncomeForMonth = currentSalary + totalIncomeSources + totalExtra;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setAuthActionMessage({ type: 'error', text: 'Imagem muito grande. Máximo 2MB.' });
      return;
    }
    setProfileLoading(true);
    setAuthActionMessage(null);
    try {
      const dataUrl = await compressImageToDataUrl(file, 128, 0.7);
      const s = await getOrCreateSettings();
      await db.settings.update(s.id!, { avatarDataUrl: dataUrl });
      setSettings((prev) => prev ? { ...prev, avatarDataUrl: dataUrl } : prev);
      setAuthActionMessage({ type: 'success', text: 'Foto atualizada!' });
    } catch {
      setAuthActionMessage({ type: 'error', text: 'Erro ao atualizar foto.' });
    } finally {
      setProfileLoading(false);
      e.target.value = '';
    }
  }

  async function handleSaveName() {
    if (!nameInput.trim()) return;
    setProfileLoading(true);
    setAuthActionMessage(null);
    try {
      await updateUserProfile(nameInput.trim());
      setEditingName(false);
      setAuthActionMessage({ type: 'success', text: 'Nome atualizado!' });
    } catch {
      setAuthActionMessage({ type: 'error', text: 'Erro ao atualizar nome.' });
    } finally {
      setProfileLoading(false);
    }
  }
  const displayName = user?.displayName?.trim() || 'Usuário';
  const displayEmail = user?.email?.trim() || 'Sem e-mail disponível';
  const photoUrl = settings?.avatarDataUrl || user?.photoURL || null;
  const avatarFallback = (displayName[0] || displayEmail[0] || 'U').toUpperCase();

  const handleLogout = async () => {
    setAuthActionLoading(true);
    try {
      await logout();
    } catch {
      setAuthActionMessage({ type: 'error', text: 'Erro ao sair.' });
    } finally {
      setAuthActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Configurações</h1>
        <HelpButton
          title="Como usar as Configurações"
          items={[
            { icon: '🌙', title: 'Tema', description: 'Alterne entre modo claro e escuro tocando no botão de aparência.' },
            { icon: '💵', title: 'Salário padrão', description: 'Defina o salário base que será usado em todos os meses como referência.' },
            { icon: '💰', title: 'Rendas globais', description: 'Adicione fontes de renda fixas (ex: freelance, aluguel) que são aplicadas a todos os meses.' },
            { icon: '📅', title: 'Salário do mês', description: 'Defina um salário diferente para um mês específico (sobrescreve o padrão).' },
            { icon: '🎁', title: 'Fundos extras', description: 'Adicione rendas extras pontuais (ex: bônus, 13º) que valem apenas para o mês selecionado.' },
            { icon: '💾', title: 'Backup', description: 'Exporte seus dados como arquivo JSON para guardar ou restaure um backup anterior.' },
          ]}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-semibold">Conta</h3>
          <span className={`text-xs px-2.5 py-1 rounded-full ${user ? 'bg-green-500/15 text-green-500' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'}`}>
            {user ? 'Conectado' : 'Desconectado'}
          </span>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] mb-3">
          {/* Avatar com botão de trocar foto */}
          <div className="relative flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Foto do perfil"
                className="w-14 h-14 rounded-full object-cover border border-[var(--color-border)]"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-lg">
                {avatarFallback}
              </div>
            )}
            {user && (
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={profileLoading}
                title="Trocar foto"
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                <Camera size={12} />
              </button>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>

          {/* Nome editável */}
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                  className="flex-1 text-sm font-semibold bg-[var(--color-surface)] border border-[var(--color-primary)] rounded-lg px-2 py-1 focus:outline-none"
                />
                <button
                  onClick={() => void handleSaveName()}
                  disabled={profileLoading}
                  className="text-xs text-[var(--color-primary)] font-semibold disabled:opacity-60"
                >
                  {profileLoading ? '...' : 'Salvar'}
                </button>
                <button onClick={() => setEditingName(false)} className="text-[var(--color-text-secondary)]">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold truncate">{displayName}</p>
                {user && (
                  <button
                    onClick={() => { setNameInput(displayName); setEditingName(true); }}
                    className="flex-shrink-0 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                    title="Editar nome"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-[var(--color-text-secondary)] truncate">{displayEmail}</p>
          </div>
        </div>

        {(authError || authActionMessage) && (
          <div className={`flex items-center gap-2 p-3 rounded-xl mb-3 ${(authActionMessage?.type === 'success') ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
            {authActionMessage?.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <p className="text-sm">{authActionMessage?.text || authError}</p>
          </div>
        )}

        <div className="flex gap-3">
          {!user ? (
            <p className="text-sm text-[var(--color-text-secondary)] text-center py-2">Faça login para sincronizar seus dados.</p>
          ) : (
            <button
              onClick={handleLogout}
              disabled={authActionLoading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 text-red-500 font-medium text-sm hover:bg-red-500/20 transition-colors disabled:opacity-60"
            >
              <LogOut size={18} />
              {authActionLoading ? 'Saindo...' : 'Sair da conta'}
            </button>
          )}
        </div>
      </div>

      <div className="md:grid md:grid-cols-2 md:gap-6 space-y-6 md:space-y-0">

      {/* Theme */}
      <div className="card">
        <h3 className="font-semibold mb-3">Aparência</h3>
        <div className="flex gap-3">
          <button
            onClick={() => setTheme('light')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${
              theme === 'light'
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
            }`}
          >
            <Sun size={18} />
            Claro
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all ${
              theme === 'dark'
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
            }`}
          >
            <Moon size={18} />
            Escuro
          </button>
        </div>
      </div>

      {/* Default Salary */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign size={18} className="text-[var(--color-primary)]" />
          <h3 className="font-semibold">Salário Padrão</h3>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-3">
          Usado como base para novos meses
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="R$ 0,00"
            value={salaryInput}
            onChange={(e) => setSalaryInput(e.target.value)}
            className="input-field flex-1"
          />
          <button onClick={saveDefaultSalary} className="btn-primary px-4">
            Salvar
          </button>
        </div>
      </div>

      {/* Global Monthly Incomes */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign size={18} className="text-[var(--color-success)]" />
          <h3 className="font-semibold">Rendas Mensais</h3>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-3">
          Somam com o salário em todos os meses e em todas as abas
        </p>

        <div className="space-y-2 mb-3">
          {incomeSources?.map((income) => (
            <div key={income.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
              <div>
                <p className="text-sm font-medium">{income.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[var(--color-success)]">
                  {formatCurrency(income.value)}
                </span>
                <button
                  onClick={() => deleteIncomeSource(income.id!)}
                  className="p-1.5 rounded-lg bg-red-500/15 text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {totalIncomeSources > 0 && (
            <div className="flex justify-between py-2 text-sm font-bold">
              <span>Total rendas mensais</span>
              <span className="text-[var(--color-success)]">{formatCurrency(totalIncomeSources)}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Descrição da renda"
            value={newIncomeDesc}
            onChange={(e) => setNewIncomeDesc(e.target.value)}
            className="input-field flex-1"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="R$"
            value={newIncomeValue}
            onChange={(e) => setNewIncomeValue(e.target.value)}
            className="input-field w-24"
          />
          <button onClick={addIncomeSource} className="btn-primary px-3">
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* Monthly Salary Override */}
      <div className="card">
        <MonthSelector month={month} year={year} onPrev={goToPrev} onNext={goToNext} />

        <div className="flex items-center gap-2 mb-3">
          <DollarSign size={18} className="text-[var(--color-success)]" />
          <h3 className="font-semibold">Salário de {getMonthName(month)}</h3>
        </div>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            inputMode="decimal"
            placeholder="R$ 0,00"
            value={monthlySalary}
            onChange={(e) => setMonthlySalary(e.target.value)}
            className="input-field flex-1"
          />
          <button onClick={saveMonthlySalary} className="btn-primary px-4">
            Salvar
          </button>
        </div>

        <div className="mb-4 p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-secondary)] mb-1">Receita total do mês selecionado</p>
          <p className="text-lg font-bold text-[var(--color-success)]">{formatCurrency(totalIncomeForMonth)}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Salário + rendas mensais + fundos extras
          </p>
        </div>

        {/* Extra Funds */}
        <div className="flex items-center gap-2 mb-3">
          <PiggyBank size={18} className="text-[var(--color-warning)]" />
          <h3 className="font-semibold">Fundos Extras</h3>
        </div>

        <div className="space-y-2 mb-3">
          {extraFunds?.map((fund) => (
            <div key={fund.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
              <div>
                <p className="text-sm font-medium">{fund.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[var(--color-success)]">
                  {formatCurrency(fund.value)}
                </span>
                <button
                  onClick={() => deleteExtraFund(fund.id!)}
                  className="p-1.5 rounded-lg bg-red-500/15 text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {totalExtra > 0 && (
            <div className="flex justify-between py-2 text-sm font-bold">
              <span>Total extras</span>
              <span className="text-[var(--color-success)]">{formatCurrency(totalExtra)}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Descrição"
            value={newFundDesc}
            onChange={(e) => setNewFundDesc(e.target.value)}
            className="input-field flex-1"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="R$"
            value={newFundValue}
            onChange={(e) => setNewFundValue(e.target.value)}
            className="input-field w-24"
          />
          <button onClick={addExtraFund} className="btn-primary px-3">
            <Plus size={20} />
          </button>
        </div>
      </div>
      </div>

      {/* Backup / Restore */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Database size={18} className="text-[var(--color-primary)]" />
          <h3 className="font-semibold">Backup dos Dados</h3>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Exporte seus dados para um arquivo JSON ou restaure um backup anterior.
        </p>

        {backupMessage && (
          <div className={`flex items-center gap-2 p-3 rounded-xl mb-4 ${
            backupMessage.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
          }`}>
            {backupMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <p className="text-sm">{backupMessage.text}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={async () => {
              try {
                const json = await exportBackup();
                downloadBackup(json);
                setBackupMessage({ type: 'success', text: 'Backup exportado com sucesso!' });
                setTimeout(() => setBackupMessage(null), 4000);
              } catch {
                setBackupMessage({ type: 'error', text: 'Erro ao exportar backup.' });
              }
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
          >
            <Download size={18} />
            Exportar
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text)] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Upload size={18} />
            {importing ? 'Importando...' : 'Importar'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setImporting(true);
              const result = await importBackup(file);
              setBackupMessage({ type: result.success ? 'success' : 'error', text: result.message });
              setImporting(false);
              e.target.value = '';
              if (result.success) {
                setTimeout(() => window.location.reload(), 1500);
              } else {
                setTimeout(() => setBackupMessage(null), 5000);
              }
            }}
          />
        </div>
      </div>

      {/* Install App */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Smartphone size={18} className="text-[var(--color-primary)]" />
          <h3 className="font-semibold">Instalar App</h3>
        </div>
        {isInstalled ? (
          <div className="flex items-center gap-2 text-[var(--color-success)]">
            <CheckCircle2 size={16} />
            <p className="text-sm">App já instalado no seu dispositivo!</p>
          </div>
        ) : installPrompt ? (
          <>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">
              Instale o Paguei na tela inicial do seu dispositivo para acesso rápido, mesmo offline.
            </p>
            <button
              onClick={async () => {
                await installPrompt.prompt();
                const { outcome } = await installPrompt.userChoice;
                if (outcome === 'accepted') {
                  setIsInstalled(true);
                }
                setInstallPrompt(null);
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
            >
              <Download size={18} />
              Instalar Paguei
            </button>
          </>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)]">
            {window.matchMedia('(display-mode: standalone)').matches
              ? 'App já instalado!'
              : 'Abra este site no Chrome ou Safari e use a opção "Adicionar à tela inicial" do navegador.'}
          </p>
        )}
      </div>

      {/* Danger Zone - Delete Data */}
      <div className="card border border-red-500/30">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={18} className="text-red-500" />
          <h3 className="font-semibold text-red-500">Zona de Perigo</h3>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Exclua dados do app. Cada ação exige confirmação por digitação. Esta ação é irreversível.
        </p>

        {deleteMessage && (
          <div className={`flex items-center gap-2 p-3 rounded-xl mb-4 ${
            deleteMessage.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
          }`}>
            {deleteMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <p className="text-sm">{deleteMessage.text}</p>
          </div>
        )}

        <div className="space-y-2">
          {[
            {
              label: 'Excluir todas as contas',
              confirmText: 'excluir contas',
              action: async () => { await db.bills.clear(); },
              description: 'Remove todas as contas mensais de todos os meses.',
            },
            {
              label: 'Excluir dívidas recorrentes',
              confirmText: 'excluir dividas',
              action: async () => { await db.recurringDebts.clear(); },
              description: 'Remove todas as dívidas recorrentes e suas parcelas.',
            },
            {
              label: 'Excluir rendas e fundos',
              confirmText: 'excluir rendas',
              action: async () => {
                await db.incomeSources.clear();
                await db.extraFunds.clear();
              },
              description: 'Remove todas as fontes de renda e fundos extras.',
            },
            {
              label: 'Excluir prioridades',
              confirmText: 'excluir prioridades',
              action: async () => { await db.priorities.clear(); },
              description: 'Remove todas as prioridades. Novas serão criadas como padrão.',
            },
            {
              label: 'Excluir TUDO',
              confirmText: 'excluir tudo permanentemente',
              action: async () => {
                await db.bills.clear();
                await db.recurringDebts.clear();
                await db.extraFunds.clear();
                await db.monthlyConfigs.clear();
                await db.incomeSources.clear();
                await db.priorities.clear();
                await db.settings.clear();
              },
              description: 'Remove absolutamente todos os dados do app.',
            },
          ].map((item) => (
            <div key={item.confirmText} className="flex items-center justify-between py-2.5 border-b border-[var(--color-border)] last:border-b-0">
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{item.description}</p>
              </div>
              <button
                onClick={() => {
                  setDeleteModal({ label: item.label, confirmText: item.confirmText, action: item.action });
                  setDeleteInput('');
                }}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 text-red-500 text-xs font-semibold hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={14} />
                Excluir
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setDeleteModal(null)}>
          <div className="bg-[var(--color-surface)] rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert size={20} className="text-red-500" />
                <h3 className="font-semibold text-red-500">{deleteModal.label}</h3>
              </div>
              <button onClick={() => setDeleteModal(null)} className="p-1 rounded-lg hover:bg-[var(--color-surface-2)]">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 leading-relaxed">
                Esta ação é <strong>permanente e irreversível</strong>. Os dados excluídos não poderão ser recuperados (a menos que você tenha um backup).
              </p>
            </div>

            <div>
              <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                Para confirmar, digite <strong className="text-[var(--color-text)] select-all">{deleteModal.confirmText}</strong> abaixo:
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={deleteModal.confirmText}
                className="input-field w-full"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-surface-2)] text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                disabled={deleteInput !== deleteModal.confirmText}
                onClick={async () => {
                  try {
                    await deleteModal.action();
                    setDeleteMessage({ type: 'success', text: `${deleteModal.label} — concluído com sucesso.` });
                    setDeleteModal(null);
                    setTimeout(() => setDeleteMessage(null), 4000);
                    if (deleteModal.confirmText === 'excluir tudo permanentemente') {
                      setTimeout(() => window.location.reload(), 1500);
                    }
                  } catch {
                    setDeleteMessage({ type: 'error', text: 'Erro ao excluir dados.' });
                    setDeleteModal(null);
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
              >
                Excluir permanentemente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
