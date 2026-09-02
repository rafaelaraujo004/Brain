import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Info, Undo2, X, AlertTriangle } from 'lucide-react';

type ToastTone = 'success' | 'info' | 'warning';

interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Rótulo da ação inline, ex.: "Desfazer" */
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  /** Tempo até sumir sozinho. 0 mantém o toast até o usuário fechar. */
  durationMs?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Check; color: string; soft: string }> = {
  success: { icon: Check, color: 'var(--color-success)', soft: 'var(--color-success-soft)' },
  info: { icon: Info, color: 'var(--color-primary)', soft: 'var(--color-primary-soft)' },
  warning: { icon: AlertTriangle, color: 'var(--color-warning)', soft: 'var(--color-warning-soft)' },
};

const DEFAULT_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (options: ToastOptions) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { ...options, id }]);

      const duration = options.durationMs ?? DEFAULT_DURATION_MS;
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Acima do BottomNav no mobile, canto inferior no desktop */}
      <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[80] w-full max-w-md px-4 space-y-2 pointer-events-none">
        {toasts.map((toast) => {
          const tone = TONE_STYLES[toast.tone ?? 'success'];
          const Icon = tone.icon;
          return (
            <div
              key={toast.id}
              role="status"
              className="glass animate-sheet pointer-events-auto flex items-center gap-3 rounded-2xl border border-[var(--color-border)] px-3.5 py-3"
              style={{ boxShadow: 'var(--shadow-lg)' }}
            >
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: tone.soft, color: tone.color }}
              >
                <Icon size={16} strokeWidth={2.5} />
              </span>
              <p className="flex-1 text-[13px] font-medium leading-snug">{toast.message}</p>
              {toast.actionLabel && toast.onAction && (
                <button
                  onClick={async () => {
                    dismiss(toast.id);
                    await toast.onAction?.();
                  }}
                  className="flex items-center gap-1.5 flex-shrink-0 text-[13px] font-bold px-3 py-1.5 rounded-xl transition-transform active:scale-95"
                  style={{
                    color: 'var(--color-primary)',
                    background: 'var(--color-primary-soft)',
                  }}
                >
                  <Undo2 size={13} />
                  {toast.actionLabel}
                </button>
              )}
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Fechar aviso"
                className="flex-shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return context;
}
