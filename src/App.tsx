import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PrivateRoute } from './components/PrivateRoute';
import { AuthProvider } from './contexts/AuthContext';
import { Dashboard } from './pages/Dashboard';
import { MonthlyBills } from './pages/MonthlyBills';
import { RecurringDebts } from './pages/RecurringDebts';
import { MonthlyAnalysis } from './pages/MonthlyAnalysis';
import { SettingsPage } from './pages/Settings';
import { FinancialAdvisor } from './pages/FinancialAdvisor';
import { LoginPage } from './pages/Login';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const { loaded } = useTheme();

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
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
            <Route path="/contas" element={<MonthlyBills />} />
            <Route path="/recorrentes" element={<RecurringDebts />} />
            <Route path="/analise" element={<MonthlyAnalysis />} />
            <Route path="/assistente" element={<FinancialAdvisor />} />
            <Route path="/config" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
