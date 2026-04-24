import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, type User } from 'firebase/auth';
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

    // Handle redirect result after Google login
    getRedirectResult(auth).catch((err: unknown) => {
      if (err instanceof Error) {
        setAuthError(err.message);
      }
      setRedirecting(false);
    });

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      setRedirecting(false);
      if (firebaseUser) {
        void initializeFirebaseSync(firebaseUser.uid);
      } else {
        resetFirebaseSync();
      }
    });
    return unsubscribe;
  }, []);

  async function signInWithGoogle() {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    setAuthError(null);
    setRedirecting(true);
    await signInWithRedirect(auth, provider);
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
