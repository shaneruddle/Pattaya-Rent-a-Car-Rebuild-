import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, getDocFromServer, writeBatch, getDocs } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
console.log('firebase.ts: Initializing Firebase SDK');
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export { writeBatch, getDocs };

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

// Test connection
async function testConnection() {
  try {
    console.log("Firebase: Testing connection to database:", firebaseConfig.firestoreDatabaseId);
    // Use 'cars' collection which is publicly readable in rules
    await getDocFromServer(doc(db, 'cars', 'connection_test'));
    console.log("Firebase: Connection test successful.");
  } catch (error) {
    console.error("Firebase: Connection test failed:", error);
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. This often means the database ID or project ID is incorrect.");
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  
  if (errInfo.error.includes('Rate exceeded') || errInfo.error.includes('RESOURCE_EXHAUSTED')) {
    console.warn('Firestore Rate Limit Exceeded:', errInfo);
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  
  throw new Error(JSON.stringify(errInfo));
}

export async function logSystemActivity(
  action: string,
  description: string,
  category: 'Bookings' | 'Fleet' | 'Website' | 'CRM' | 'Finance' | 'Pricing' | 'System',
  metadata?: any
) {
  try {
    const user = auth.currentUser?.email || 'Anonymous';
    await addDoc(collection(db, 'system_logs'), {
      action,
      description,
      user,
      timestamp: new Date().toISOString(),
      category,
      metadata: metadata || {}
    });
  } catch (error) {
    console.error('Error logging system activity:', error);
  }
}
