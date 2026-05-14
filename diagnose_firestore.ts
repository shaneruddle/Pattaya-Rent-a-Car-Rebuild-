import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));

const app = initializeApp(config);
const db = getFirestore(app);

async function diagnose() {
  console.log('Searching for page with slug: car-delivery-services-pattaya');
  const q = query(collection(db, 'marketing_pages'), where('slug', '==', 'car-delivery-services-pattaya'));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    console.log('No document found with that slug.');
    // Try listing all marketing pages to see what we have
    const allQ = query(collection(db, 'marketing_pages'));
    const allSnapshot = await getDocs(allQ);
    console.log('Total marketing pages found:', allSnapshot.size);
    allSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`- ID: ${doc.id}, Title: ${data.title}, Slug: ${data.slug}, fullUrl: ${data.fullUrl}, status: ${data.status}`);
    });
  } else {
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log('--- Document Found ---');
      console.log('ID:', doc.id);
      console.log('Title:', data.title);
      console.log('Slug:', data.slug);
      console.log('nestedCategoryPath:', data.categoryPath);
      console.log('fullUrl:', data.fullUrl);
      console.log('status:', data.status);
      console.log('---');
    });
  }
}

diagnose().catch(console.error);
