import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, getDocFromServer, writeBatch, getDocs } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
console.log('firebase.ts: Initializing Firebase SDK');
console.log('firebase.ts: Config Project ID:', firebaseConfig.projectId);
console.log('firebase.ts: Config Database ID:', firebaseConfig.firestoreDatabaseId);

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
    // Use 'system_config' which is also publicly readable for debugging
    await getDocFromServer(doc(db, 'system_config', 'test_connection'));
    console.log("Firebase: Connection test successful.");
  } catch (error: any) {
    console.error("Firebase: Connection test failed:", error);
    if (error.message && (error.message.includes('NOT_FOUND') || error.message.includes('not-found'))) {
      console.warn("Firebase: Database not found. This app might need to be re-provisioned or the project ID is incorrect.");
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
