// Simulates a player replying to an email.
// Usage: node simulate_reply.js <email> "<reply body>"
// Example: node simulate_reply.js player@example.com "ACCEPT"
//          node simulate_reply.js player@example.com "TAX: 15 GRAIN: 30000"

const http = require('http');

const from = process.argv[2];
const text = process.argv[3];

if (!from || !text) {
  console.log('Usage: node simulate_reply.js <email> "<reply body>"');
  process.exit(1);
}

const payload = JSON.stringify({ from, text });

const req = http.request(
  { hostname: 'localhost', port: 3000, path: '/inbound', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
  (res) => {
    let body = '';
    res.on('data', c => { body += c; });
    res.on('end', () => {
      console.log(`[${res.statusCode}] ${body}`);
    });
  }
);
req.on('error', (e) => console.error('Error:', e.message));
req.write(payload);
req.end();
