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
    // Sem isso, onAuthStateChanged dispara null antes do token ser processado
    // e o PrivateRoute redireciona o usuário de volta para /login.
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
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

    return () => {
      unsubscribe?.();
    };
  }, []);

  async function signInWithGoogle() {
    if (!auth) return;
    setAuthError(null);
    setRedirecting(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Mobile usa redirect — mais confiável que popup em iOS/Android.
    // O estado OAuth é salvo em localStorage (configurado em firebase.ts via
    // initializeAuth + browserLocalPersistence), evitando o erro de sessionStorage.
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
      setAuthError((err as Error).message ?? 'Erro ao fazer login.');
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
