
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkSettings() {
  const docRef = doc(db, 'settings', 'pricing');
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    console.log('Settings:', JSON.stringify(docSnap.data(), null, 2));
  } else {
    console.log('No settings found.');
  }
}

checkSettings();
