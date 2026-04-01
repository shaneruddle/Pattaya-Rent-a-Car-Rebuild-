
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkCars() {
  const snapshot = await getDocs(collection(db, 'cars'));
  const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log('Cars:', JSON.stringify(cars, null, 2));
}

checkCars();
