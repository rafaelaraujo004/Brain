import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'reset';

export function LoginPage() {
  const { user, loading, isLocalMode, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (loading) return null;
  if (user || isLocalMode) return <Navigate to="/" replace />;

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

  const subtitles: Record<Mode, string> = {
    signin: 'Entre para sincronizar suas contas entre aparelhos',
    signup: 'Crie uma conta para guardar seus dados na nuvem',
    reset: 'Enviamos um link para você criar uma nova senha',
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-rise">
        {/* Marca acima do cartão: o app se apresenta antes de pedir algo. */}
        <div className="flex flex-col items-center gap-3 mb-7">
          <div
            className="w-16 h-16 rounded-3xl flex items-center justify-center text-white font-extrabold text-2xl"
            style={{
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              boxShadow: 'var(--shadow-primary)',
            }}
          >
            P
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight">Paguei</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1.5 leading-snug max-w-[16rem]">
              {subtitles[mode]}
            </p>
          </div>
        </div>

        <div className="card !p-6 space-y-4">
          <h2 className="font-bold text-lg tracking-tight">{titles[mode]}</h2>

          {error && (
            <p
              className="text-sm rounded-2xl px-4 py-3 leading-snug animate-rise"
              style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
            >
              {error}
            </p>
          )}
          {success && (
            <p
              className="text-sm rounded-2xl px-4 py-3 leading-snug animate-rise"
              style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
            >
              {success}
            </p>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="relative">
              <Mail
                size={16}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
              />
              <input
                type="email"
                placeholder="E-mail"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-field !pl-11"
              />
            </div>

            {mode !== 'reset' && (
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Senha"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input-field !pl-11 !pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors p-1"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={formLoading}
              className="btn-primary w-full mt-1 disabled:opacity-60"
            >
              {buttons[mode]}
            </button>
          </form>

          <div className="flex flex-col items-center gap-2.5 text-sm pt-1">
            {mode === 'signin' && (
              <>
                <button
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                  className="font-semibold text-[var(--color-primary)] hover:underline"
                >
                  Não tem conta? Criar agora
                </button>
                <button
                  onClick={() => {
                    setMode('reset');
                    setError(null);
                  }}
                  className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  Esqueci minha senha
                </button>
              </>
            )}
            {(mode === 'signup' || mode === 'reset') && (
              <button
                onClick={() => {
                  setMode('signin');
                  setError(null);
                }}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
              >
                Voltar para o login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
