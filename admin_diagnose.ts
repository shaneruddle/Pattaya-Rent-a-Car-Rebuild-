import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  projectId: firebaseConfig.projectId
});

const db = getFirestore();

async function diagnose() {
  console.log('Querying marketing_pages via Admin SDK...');
  try {
    const snapshot = await db.collection('marketing_pages')
      .where('slug', '==', 'car-delivery-services-pattaya')
      .get();

    if (snapshot.empty) {
      console.log('Not found by slug. Listing all pages to find closest match...');
      const all = await db.collection('marketing_pages').get();
      console.log('Total marketing pages: ' + all.size);
      all.forEach(doc => {
        const data = doc.data();
        console.log('---');
        console.log('ID: ' + doc.id);
        console.log('Slug: ' + data.slug);
        console.log('Category Path: ' + (data.categoryPath || 'undefined'));
        console.log('Full URL: ' + (data.fullUrl || 'undefined'));
        console.log('Status: ' + (data.status || 'undefined'));
        // Check for the field user mentioned
        if (data.nestedCategoryPath) console.log('Nested Category Path: ' + data.nestedCategoryPath);
      });
    } else {
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log('Found Document:');
        console.log('ID: ' + doc.id);
        console.log('Slug: ' + data.slug);
        console.log('Category Path: ' + data.categoryPath);
        console.log('Full URL: ' + data.fullUrl);
        console.log('Status: ' + data.status);
        if (data.nestedCategoryPath) console.log('Nested Category Path: ' + data.nestedCategoryPath);
        console.log('--- Full Data ---');
        console.log(JSON.stringify(data, null, 2));
      });
    }
  } catch (err: any) {
    console.error('Admin SDK Error:', err.message);
  }
}

diagnose();
