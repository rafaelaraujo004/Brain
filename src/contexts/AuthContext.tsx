import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth } from '../db/firebase';
import { initializeFirebaseSync, resetFirebaseSync } from '../db/database';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  redirecting: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function isMobile() {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    // No mobile, getRedirectResult() processa o token do Google que voltou
    // do redirect. Setamos o usuário IMEDIATAMENTE quando receber o resultado
    // para evitar o estado de loading longo que aparece como "tela preta".
    getRedirectResult(auth!)
      .then((result) => {
        if (result?.user) {
          // Seta o usuário imediatamente — não espera pelo onAuthStateChanged
          setUser(result.user);
          setLoading(false);
          setRedirecting(false);
          void initializeFirebaseSync(result.user.uid);
        }
      })
      .catch((err: unknown) => {
        console.error('[auth] getRedirectResult error:', err);
      })
      .finally(() => {
        unsubscribe = onAuthStateChanged(auth!, (firebaseUser) => {
          setUser(firebaseUser);
          setLoading(false);
          setRedirecting(false);
          if (firebaseUser) {
            void initializeFirebaseSync(firebaseUser.uid);
          } else {
            resetFirebaseSync();
          }
        });
      });

    return () => { unsubscribe?.(); };
  }, []);

  async function signInWithGoogle() {
    if (!auth) return;
    setAuthError(null);
    setRedirecting(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Mobile: redirect (popups são bloqueados por browsers mobile)
    // Desktop: popup
    if (isMobile()) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (err: unknown) {
        setRedirecting(false);
        setAuthError((err as Error).message ?? 'Erro ao fazer login.');
      }
      return;
    }

    try {
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (
        code !== 'auth/popup-closed-by-user' &&
        code !== 'auth/cancelled-popup-request'
      ) {
        setAuthError((err as Error).message ?? 'Erro ao fazer login.');
      }
    } finally {
      setRedirecting(false);
    }
  }

  async function logout() {
    if (!auth) return;
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, redirecting, authError, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
