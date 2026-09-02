import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PrivateRoute } from './components/PrivateRoute';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { PageSpinner } from './components/PageSpinner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { useTheme } from './hooks/useTheme';

// O Dashboard e o Login entram no bundle inicial porque são as duas primeiras
// telas possíveis. O resto é carregado sob demanda — Settings e
// FinancialAdvisor sozinhos passam de 800 linhas cada.
const MonthlyBills = lazy(() =>
  import('./pages/MonthlyBills').then((m) => ({ default: m.MonthlyBills }))
);
const RecurringDebts = lazy(() =>
  import('./pages/RecurringDebts').then((m) => ({ default: m.RecurringDebts }))
);
const MonthlyAnalysis = lazy(() =>
  import('./pages/MonthlyAnalysis').then((m) => ({ default: m.MonthlyAnalysis }))
);
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage }))
);
const FinancialAdvisor = lazy(() =>
  import('./pages/FinancialAdvisor').then((m) => ({ default: m.FinancialAdvisor }))
);

export default function App() {
  const { loaded } = useTheme();

  if (!loaded) return <PageSpinner />;

  return (
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route
                path="/contas"
                element={
                  <Suspense fallback={<PageSpinner />}>
                    <MonthlyBills />
                  </Suspense>
                }
              />
              <Route
                path="/recorrentes"
                element={
                  <Suspense fallback={<PageSpinner />}>
                    <RecurringDebts />
                  </Suspense>
                }
              />
              <Route
                path="/analise"
                element={
                  <Suspense fallback={<PageSpinner />}>
                    <MonthlyAnalysis />
                  </Suspense>
                }
              />
              <Route
                path="/assistente"
                element={
                  <Suspense fallback={<PageSpinner />}>
                    <FinancialAdvisor />
                  </Suspense>
                }
              />
              <Route
                path="/config"
                element={
                  <Suspense fallback={<PageSpinner />}>
                    <SettingsPage />
                  </Suspense>
                }
              />
            </Route>
          </Routes>
        </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
