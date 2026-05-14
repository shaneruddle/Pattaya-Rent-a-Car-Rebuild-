import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  setPersistence, 
  browserLocalPersistence,
  onAuthStateChanged
} from 'firebase/auth';
import { 
  initializeFirestore, 
  collection, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  setDoc,
  deleteDoc, 
  writeBatch, 
  getDocs, 
  getDoc,
  doc,
  onSnapshot,
  Timestamp,
  where,
  limit,
  increment
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

import firebaseConfig from '../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true
}, firebaseConfig.firestoreDatabaseId || '(default)');

export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence);

export { 
  collection, query, orderBy, addDoc, updateDoc, setDoc,
  deleteDoc, writeBatch, getDocs, getDoc, doc, onSnapshot,
  onAuthStateChanged, Timestamp, where, limit, increment
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous
    },
    operationType,
    path,
    projectId: firebaseConfig.projectId
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- HELPER TO STOP THE 8 ERRORS ---
// Use this in components to fetch data only when logged in
export const safeGetDocs = async (queryRef: any) => {
  if (!auth.currentUser) {
    console.warn("Blocking fetch: User not logged in");
    return { docs: [] }; 
  }
  return await getDocs(queryRef);
};

export const signIn = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error('Auth Error:', error);
    throw error;
  }
};

export const signInRedirect = async () => {
  try {
    const { signInWithRedirect } = await import('firebase/auth');
    return await signInWithRedirect(auth, googleProvider);
  } catch (error) {
    console.error('Redirect Auth Error:', error);
    throw error;
  }
};

export const logOut = () => signOut(auth);

export async function logSystemActivity(action: string, description: string, category: string, metadata?: any) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    await addDoc(collection(db, 'system_logs'), {
      action,
      description,
      category,
      user: user.email || 'Unknown',
      timestamp: new Date().toISOString(),
      metadata: metadata || {}
    });
  } catch (e) {
    // Silent fail to keep UI clean
  }
}
