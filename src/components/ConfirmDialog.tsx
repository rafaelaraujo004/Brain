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
      className="fixed inset-0 bg-black/60 z-[70] flex items-end md:items-center justify-center"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-[var(--color-surface)] w-full max-w-sm rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              destructive ? 'bg-red-500/15 text-[var(--color-danger)]' : 'bg-blue-500/15 text-[var(--color-primary)]'
            }`}
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
            className={`flex-1 rounded-xl px-4 py-2.5 font-semibold text-white ${
              destructive ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-primary)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
