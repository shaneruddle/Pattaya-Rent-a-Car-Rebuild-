import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { initializeFirestore, collection, doc, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, getDocFromServer, writeBatch, getDocs, getDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

if (!firebaseConfig || !firebaseConfig.projectId) {
  console.error('Firebase: CRITICAL - firebase-applet-config.json is missing or invalid!');
  throw new Error('Firebase configuration is missing. Please check firebase-applet-config.json');
}

// Initialize Firebase SDK
console.log('firebase.ts: Initializing Firebase SDK');
const config = firebaseConfig as any;
console.log('firebase.ts: Config Project ID:', config.projectId);
console.log('firebase.ts: Config Database ID:', config.firestoreDatabaseId);

const app = initializeApp(config);

// Use initializeFirestore with settings to improve connectivity in restricted environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  // If firestoreDatabaseId is provided, use it, otherwise it defaults to '(default)'
}, config.firestoreDatabaseId);

export const auth = getAuth(app);

// Set persistence explicitly to ensure it works across domain redirects/popups
import { setPersistence, browserLocalPersistence } from 'firebase/auth';
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.error('Firebase: Failed to set persistence:', err);
});

// Initialize storage with a more robust fallback for the bucket name
const getStorageInstance = () => {
  try {
    const primaryBucket = firebaseConfig.storageBucket;
    const fallbackBucket = `${firebaseConfig.projectId}.appspot.com`;
    const fallbackBucket2 = `${firebaseConfig.projectId}.firebasestorage.app`;
    
    if (!primaryBucket) {
      console.warn('Firebase: No storageBucket in config, using fallback:', fallbackBucket);
      return getStorage(app, fallbackBucket);
    }
    
    console.log('Firebase: Using storageBucket:', primaryBucket);
    return getStorage(app, primaryBucket);
  } catch (e) {
    console.error('Firebase: Storage initialization failed:', e);
    // Return a dummy object that will fail gracefully when used
    return null as any;
  }
};

export const storage = getStorageInstance();
export const googleProvider = new GoogleAuthProvider();

// Add custom parameters to help with domain issues
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export { writeBatch, getDocs };

export const signIn = async () => {
  try {
    console.log('firebase.ts: Attempting signInWithPopup...');
    const result = await signInWithPopup(auth, googleProvider);
    console.log('firebase.ts: signInWithPopup successful for:', result.user.email);
    return result;
  } catch (error: any) {
    console.error('firebase.ts: signInWithPopup error:', error);
    // Specific handling for common custom domain errors
    if (error.code === 'auth/unauthorized-domain') {
      console.error('firebase.ts: Domain not authorized. Current domain:', window.location.hostname);
    }
    throw error;
  }
};

export const signInRedirect = async () => {
  try {
    console.log('firebase.ts: Attempting signInWithRedirect...');
    return await signInWithRedirect(auth, googleProvider);
  } catch (error: any) {
    console.error('firebase.ts: signInWithRedirect error:', error);
    throw error;
  }
};
export const logOut = () => signOut(auth);

// Test connection to Firestore
export async function testConnection() {
  try {
    console.log('firebase.ts: Testing Firestore connection...');
    // Use getDocFromServer to bypass local cache and test real connectivity
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('firebase.ts: Firestore connection test completed (document might not exist, but connection is OK)');
  } catch (error: any) {
    if (error.message && error.message.includes('the client is offline')) {
      console.error("Firebase: CRITICAL - The client is offline. This usually means the Firestore configuration is incorrect or the database is not provisioned.");
    } else if (error.message && error.message.includes('timeout')) {
      console.error("Firebase: Firestore connection timed out. Check your network or project region.");
    } else {
      // Skip logging for other errors, as this is simply a connection test.
      console.log('firebase.ts: Connection test finished with expected non-critical error:', error.message);
    }
  }
}

// Call testConnection on initialization
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
