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

const TONE_STYLES: Record<ToastTone, { icon: typeof Check; className: string }> = {
  success: { icon: Check, className: 'text-[var(--color-success)]' },
  info: { icon: Info, className: 'text-[var(--color-primary)]' },
  warning: { icon: AlertTriangle, className: 'text-[var(--color-warning)]' },
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
              className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-lg"
            >
              <Icon size={18} className={`flex-shrink-0 ${tone.className}`} />
              <p className="flex-1 text-sm leading-snug">{toast.message}</p>
              {toast.actionLabel && toast.onAction && (
                <button
                  onClick={async () => {
                    dismiss(toast.id);
                    await toast.onAction?.();
                  }}
                  className="flex items-center gap-1 flex-shrink-0 text-sm font-semibold text-[var(--color-primary)]"
                >
                  <Undo2 size={14} />
                  {toast.actionLabel}
                </button>
              )}
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Fechar aviso"
                className="flex-shrink-0 text-[var(--color-text-secondary)]"
              >
                <X size={16} />
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
