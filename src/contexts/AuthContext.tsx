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

    // Processa o resultado do redirect ANTES de assinar onAuthStateChanged.
    // Isso garante que quando onAuthStateChanged disparar, o Firebase já
    // processou o token do Google e o usuário estará autenticado corretamente.
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          void initializeFirebaseSync(result.user.uid);
        }
      })
      .catch((err) => {
        console.error('Redirect login error:', err);
        setAuthError('Erro ao fazer login. Tente novamente.');
      })
      .finally(() => {
        // Só começa a ouvir mudanças de auth após o redirect ter sido processado
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

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  async function signInWithGoogle() {
    if (!auth) return;
    setAuthError(null);
    setRedirecting(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Mobile e Safari bloqueiam popups — usar redirect nesses casos
    if (isMobile()) {
      await signInWithRedirect(auth, provider);
      return; // página vai redirecionar, resultado tratado no useEffect
    }

    try {
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      // Se popup foi bloqueado pelo browser, cai para redirect
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        await signInWithRedirect(auth, provider);
        return;
      }
      setRedirecting(false);
      setAuthError((err as Error).message ?? 'Erro ao fazer login.');
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
