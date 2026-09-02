/**
 * Stub do SDK do Firebase para os testes.
 *
 * database.ts importa firebase/firestore no topo do módulo, e transformar o
 * SDK inteiro custava ~40s por execução — o suficiente para desestimular
 * rodar os testes. Nenhum teste exercita o sync: sem as variáveis
 * VITE_FIREBASE_*, db/firebase.ts já resolve `firestore`/`auth`/`storage`
 * para null e todo o caminho de nuvem fica desligado. O stub só precisa
 * existir para as importações resolverem.
 */

function unavailable(name: string) {
  return () => {
    throw new Error(`Firebase indisponível nos testes: ${name}() foi chamado.`);
  };
}

// firebase/app
export const getApps = () => [];
export const getApp = unavailable('getApp');
export const initializeApp = unavailable('initializeApp');

// firebase/firestore
export const getFirestore = unavailable('getFirestore');
export const collection = unavailable('collection');
export const doc = unavailable('doc');
export const getDoc = unavailable('getDoc');
export const getDocs = unavailable('getDocs');
export const limit = unavailable('limit');
export const onSnapshot = unavailable('onSnapshot');
export const query = unavailable('query');
export const setDoc = unavailable('setDoc');
export const where = unavailable('where');

// firebase/auth
export const getAuth = unavailable('getAuth');
export const signInWithEmailAndPassword = unavailable('signInWithEmailAndPassword');
export const createUserWithEmailAndPassword = unavailable('createUserWithEmailAndPassword');
export const signOut = unavailable('signOut');
export const onAuthStateChanged = unavailable('onAuthStateChanged');
export const sendPasswordResetEmail = unavailable('sendPasswordResetEmail');
export const updateProfile = unavailable('updateProfile');

// firebase/storage
export const getStorage = unavailable('getStorage');
export const ref = unavailable('ref');
export const uploadBytes = unavailable('uploadBytes');
export const getDownloadURL = unavailable('getDownloadURL');
export const deleteObject = unavailable('deleteObject');
