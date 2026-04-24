import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
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

    try {
      // Força localStorage para evitar erro de sessionStorage inacessível no Safari iOS
      await setPersistence(auth, browserLocalPersistence);
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
