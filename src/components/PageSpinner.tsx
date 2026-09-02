/** Estado de carregamento de tela inteira (troca de rota). */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="min-h-[45vh] flex flex-col items-center justify-center gap-4 animate-fade">
      <div className="relative w-10 h-10">
        <div
          className="absolute inset-0 rounded-full border-[3px] border-[var(--color-border)]"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 rounded-full border-[3px] border-transparent animate-spin"
          style={{ borderTopColor: 'var(--color-primary)', animationDuration: '720ms' }}
        />
      </div>
      {label && <p className="text-sm text-[var(--color-text-secondary)]">{label}</p>}
    </div>
  );
}

/**
 * Placeholder no formato de lista de cartões, com brilho percorrendo.
 *
 * Antes as telas renderizavam o estado vazio ("Nenhuma conta cadastrada")
 * enquanto o Dexie ainda respondia, o que fazia a lista piscar em toda
 * navegação de mês.
 */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-2.5 md:grid-cols-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card !p-3.5 flex items-center gap-3">
          <div className="skeleton w-11 h-11 rounded-2xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/2 rounded-full" />
            <div className="skeleton h-2.5 w-1/3 rounded-full" />
          </div>
          <div className="space-y-2 flex flex-col items-end">
            <div className="skeleton h-3.5 w-16 rounded-full" />
            <div className="skeleton h-4 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
