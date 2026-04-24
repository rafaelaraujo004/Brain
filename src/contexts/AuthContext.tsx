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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../db/firebase';
import { initializeFirebaseSync, resetFirebaseSync } from '../db/database';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (displayName: string, photoFile?: File | null) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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

  async function updateUserProfile(displayName: string, photoFile?: File | null) {
    if (!auth?.currentUser) return;
    let photoURL = auth.currentUser.photoURL ?? undefined;

    if (photoFile && storage) {
      const storageRef = ref(storage, `avatars/${auth.currentUser.uid}/${photoFile.name}`);
      await uploadBytes(storageRef, photoFile);
      photoURL = await getDownloadURL(storageRef);
    }

    await updateProfile(auth.currentUser, { displayName, photoURL });
    // Força atualização do estado React (updateProfile muta o objeto mas não dispara onAuthStateChanged)
    setUser(Object.assign(Object.create(Object.getPrototypeOf(auth.currentUser)), auth.currentUser));
  }

  async function logout() {
    if (!auth) return;
    await signOut(auth);
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
