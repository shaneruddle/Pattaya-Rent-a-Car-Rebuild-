import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function list() {
  console.log('Listing marketing_pages...');
  try {
    const snapshot = await getDocs(collection(db, 'marketing_pages'));
    console.log('Found ' + snapshot.size + ' documents');
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log('ID: ' + doc.id);
      console.log('Title: ' + data.title);
      console.log('Slug: ' + data.slug);
      console.log('Full URL: ' + data.fullUrl);
      console.log('Status: ' + data.status);
      console.log('Category Path: ' + data.categoryPath);
      console.log('---');
    });
  } catch (e: any) {
    console.error('Error:', e.message || e);
    // If permission denied, try to list just IDs if possible? No.
  }
}
list();
