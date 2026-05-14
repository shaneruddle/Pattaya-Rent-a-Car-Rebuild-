const projectId = 'pattaya-rent-a-car-rebuild';
const apiKey = 'AIzaSyBwNBOrxwnyg-X-PGUlAYL2tnv9qvckp2I';
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/faqs?key=${apiKey}`;

async function test() {
  const response = await fetch(url);
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

test();
