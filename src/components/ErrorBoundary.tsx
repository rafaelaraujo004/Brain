import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Sem isto, qualquer erro de renderização derruba a árvore inteira e o
 * usuário fica com a tela em branco, sem nenhuma pista do que aconteceu —
 * num app instalado como PWA, nem o console fica à mão.
 *
 * Os dados vivem no IndexedDB e não são perdidos: recarregar resolve na
 * maioria dos casos, então é isso que a tela oferece.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro não tratado na interface:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <div className="card max-w-md w-full space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 text-[var(--color-danger)] flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold">Algo deu errado</h1>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1 leading-snug">
                Seus dados continuam salvos no aparelho. Recarregar a página costuma
                resolver.
              </p>
            </div>
          </div>

          <pre className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-2)] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {error.message}
          </pre>

          <button onClick={() => window.location.reload()} className="btn-primary w-full">
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
