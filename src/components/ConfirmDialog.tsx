import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Confirmação para ações destrutivas. Excluir uma conta apagava o registro
 * direto no clique, sem aviso e sem volta — num app que roda no celular, com
 * os botões de ação a poucos pixels um do outro, isso é fácil demais de fazer
 * sem querer.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Excluir',
  cancelLabel = 'Cancelar',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end md:items-center justify-center animate-fade"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="animate-sheet w-full max-w-sm rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 space-y-5 border border-[var(--color-border)]"
        style={{ background: 'var(--surface-elevated)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              background: destructive ? 'var(--color-danger-soft)' : 'var(--color-primary-soft)',
              color: destructive ? 'var(--color-danger)' : 'var(--color-primary)',
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold">{title}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 leading-snug">{message}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-secondary flex-1">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="flex-1 rounded-2xl px-4 py-3 font-semibold text-white transition-transform active:scale-97"
            style={{
              background: destructive
                ? 'var(--color-danger)'
                : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
