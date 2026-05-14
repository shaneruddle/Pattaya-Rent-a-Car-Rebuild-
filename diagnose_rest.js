const projectId = 'pattaya-rent-a-car-rebuild';
const apiKey = 'AIzaSyBwNBOrxwnyg-X-PGUlAYL2tnv9qvckp2I';
// We use structuredQuery to search for the slug
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;

const body = {
  structuredQuery: {
    from: [{ collectionId: 'marketing_pages' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'slug' },
        op: 'EQUAL',
        value: { stringValue: 'car-delivery-services-pattaya' }
      }
    }
  }
};

async function diagnose() {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

diagnose();
