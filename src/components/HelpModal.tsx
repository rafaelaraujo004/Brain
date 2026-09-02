import { useState } from 'react';
import { Info, X } from 'lucide-react';

export interface HelpItem {
  icon: string;
  title: string;
  description: string;
}

export function HelpButton({ items, title }: { items: HelpItem[]; title: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-icon text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        title="Ajuda"
        aria-label="Ajuda"
      >
        <Info size={18} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end md:items-center justify-center animate-fade"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="animate-sheet w-full max-w-lg rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 max-h-[85vh] overflow-y-auto border border-[var(--color-border)]"
            style={{ background: 'var(--surface-elevated)', boxShadow: 'var(--shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="btn-icon hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 stagger">
              {items.map((item, i) => (
                <div
                  key={i}
                  className="flex gap-3 items-start p-3 rounded-2xl border border-[var(--color-border)]"
                  style={{ background: 'var(--color-surface-2)' }}
                >
                  <span className="text-lg flex-shrink-0 mt-0.5">{item.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{item.title}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
