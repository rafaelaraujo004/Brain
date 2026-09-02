import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { ReactNode } from 'react';

export function PrivateRoute({ children }: { children?: ReactNode }) {
  const { user, loading, isLocalMode } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[var(--color-bg)]">
        <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[var(--color-text-secondary)]">Carregando...</p>
      </div>
    );
  }

  // Sem Firebase configurado o app roda local, sem exigir conta.
  if (!user && !isLocalMode) {
    return <Navigate to="/login" replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
