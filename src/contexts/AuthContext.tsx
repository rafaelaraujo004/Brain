import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '../db/firebase';
import { initializeFirebaseSync, resetFirebaseSync } from '../db/database';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(!auth);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!isMounted) return;
      setUser(firebaseUser);
      setLoading(false);
      setInitialized(true);
      if (firebaseUser) {
        void initializeFirebaseSync(firebaseUser.uid);
      } else {
        resetFirebaseSync();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    if (!auth) return;
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      setAuthError(friendlyError(err));
      throw err;
    }
  }

  async function signUp(email: string, password: string) {
    if (!auth) return;
    setAuthError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      setAuthError(friendlyError(err));
      throw err;
    }
  }

  async function resetPassword(email: string) {
    if (!auth) return;
    setAuthError(null);
    await sendPasswordResetEmail(auth, email);
  }

  async function updateUserProfile(displayName: string) {
    if (!auth?.currentUser) return;
    await updateProfile(auth.currentUser, { displayName });
    // Força atualização do estado React (updateProfile muta o objeto mas não dispara onAuthStateChanged)
    setUser(Object.assign(Object.create(Object.getPrototypeOf(auth.currentUser)), auth.currentUser));
  }

  async function logout() {
    if (!auth) return;
    await signOut(auth);
  }

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, authError, signIn, signUp, resetPassword, updateUserProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
  };
  return map[code] ?? (err as Error).message ?? 'Erro ao fazer login.';
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
