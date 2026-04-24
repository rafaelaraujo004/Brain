import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, getAuth } from 'firebase/auth';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const hasRequiredFirebaseConfig =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.appId;

export const app = hasRequiredFirebaseConfig
  ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firestore = app ? getFirestore(app) : null;

// initializeAuth com:
// - indexedDBLocalPersistence: usa IndexedDB (não sessionStorage) para o estado OAuth
//   — corrige o erro "sessionStorage is inaccessible" no Safari iOS
// - browserLocalPersistence: fallback para localStorage
// - browserPopupRedirectResolver: gerencia o fluxo popup usando o melhor storage disponível
function createAuth() {
  if (!app) return null;
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Já inicializado (HMR em dev ou módulo reutilizado)
    return getAuth(app);
  }
}

export const auth = createAuth();

if (!hasRequiredFirebaseConfig && import.meta.env.DEV) {
  console.warn('Firebase não configurado. Defina as variáveis VITE_FIREBASE_* para habilitar sync com Firestore.');
}
