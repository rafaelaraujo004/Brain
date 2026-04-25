import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'reset';

export function LoginPage() {
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setFormLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else if (mode === 'signup') {
        await signUp(email, password);
      } else {
        await resetPassword(email);
        setSuccess('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
        setMode('signin');
      }
    } catch {
      // erro já setado pelo AuthContext via authError, mas vamos capturar aqui também
    } finally {
      setFormLoading(false);
    }
  }

  const titles: Record<Mode, string> = {
    signin: 'Entrar',
    signup: 'Criar conta',
    reset: 'Recuperar senha',
  };

  const buttons: Record<Mode, string> = {
    signin: formLoading ? 'Entrando...' : 'Entrar',
    signup: formLoading ? 'Criando conta...' : 'Criar conta',
    reset: formLoading ? 'Enviando...' : 'Enviar e-mail',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-xl p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Paguei</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{titles[mode]}</p>
        </div>

        {error && (
          <p className="text-center text-sm text-red-500 bg-red-500/10 rounded-xl px-4 py-2">{error}</p>
        )}
        {success && (
          <p className="text-center text-sm text-green-500 bg-green-500/10 rounded-xl px-4 py-2">{success}</p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              type="email"
              placeholder="E-mail"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full pl-9 pr-4 py-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
            />
          </div>

          {mode !== 'reset' && (
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Senha"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full pl-9 pr-10 py-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={formLoading}
            className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {buttons[mode]}
          </button>
        </form>

        <div className="flex flex-col items-center gap-2 text-sm">
          {mode === 'signin' && (
            <>
              <button onClick={() => { setMode('signup'); setError(null); }} className="text-[var(--color-primary)] hover:underline">
                Não tem conta? Criar agora
              </button>
              <button onClick={() => { setMode('reset'); setError(null); }} className="text-[var(--color-text-secondary)] hover:underline">
                Esqueci minha senha
              </button>
            </>
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <button onClick={() => { setMode('signin'); setError(null); }} className="text-[var(--color-text-secondary)] hover:underline">
              Voltar para login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
