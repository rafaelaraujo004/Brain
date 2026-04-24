import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
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

    // Fluxo simples: apenas onAuthStateChanged.
    // Não há redirect — signInWithPopup é usado em todos os dispositivos.
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      if (firebaseUser) {
        void initializeFirebaseSync(firebaseUser.uid);
      } else {
        resetFirebaseSync();
      }
    });

    return () => unsubscribe();
  }, []);

  async function signInWithGoogle() {
    if (!auth) return;
    setAuthError(null);
    setRedirecting(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // signInWithPopup em todos os devices.
    // IMPORTANTE: sem nenhum `await` antes desta chamada — qualquer await
    // quebra a cadeia de gesto do usuário e o Safari iOS bloqueia o window.open().
    // A persistência (indexedDB) e o popupRedirectResolver já estão configurados
    // em initializeAuth() no firebase.ts.
    try {
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      // Erros esperados que não precisam de mensagem (usuário cancelou)
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
