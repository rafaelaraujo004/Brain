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
        className="p-2 rounded-xl hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] transition-colors"
        title="Ajuda"
      >
        <Info size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-end md:items-center justify-center" onClick={() => setOpen(false)}>
          <div
            className="bg-[var(--color-surface)] w-full max-w-lg rounded-t-3xl md:rounded-3xl p-6 pb-24 md:pb-6 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">{title}</h3>
              <button onClick={() => setOpen(false)} className="p-2 rounded-xl hover:bg-[var(--color-surface-2)]">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="flex gap-3 items-start p-3 rounded-xl bg-[var(--color-surface-2)]">
                  <span className="text-xl flex-shrink-0 mt-0.5">{item.icon}</span>
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">{item.description}</p>
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
