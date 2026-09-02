/** Estado de carregamento padrão das telas. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      {label && <p className="text-sm text-[var(--color-text-secondary)]">{label}</p>}
    </div>
  );
}

/**
 * Placeholder no formato de lista de cards. Antes as telas renderizavam o
 * estado vazio ("Nenhuma conta cadastrada") enquanto o Dexie ainda respondia,
 * o que fazia a lista piscar em toda navegação de mês.
 */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-surface-2)] flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 rounded bg-[var(--color-surface-2)]" />
            <div className="h-2.5 w-1/3 rounded bg-[var(--color-surface-2)]" />
          </div>
          <div className="h-3 w-16 rounded bg-[var(--color-surface-2)]" />
        </div>
      ))}
    </div>
  );
}
