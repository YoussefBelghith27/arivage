// One-off: copies the local database (opened read-only) into the deployed app, which must still be unused.
// Usage: CLOUD_ADMIN_PASSWORD=... npm run import-to-cloud -- https://<worker>.workers.dev [server/data/stock.db]
// CLOUD_ADMIN_PASSWORD is the ADMIN_PASSWORD secret set on Cloudflare. Afterwards the local passwords apply.
import { DatabaseSync } from 'node:sqlite';
import { dumpDb } from './db.js';

const [url, file = 'server/data/stock.db'] = process.argv.slice(2);
const password = process.env.CLOUD_ADMIN_PASSWORD;
if (!url?.startsWith('http') || !password) {
  console.error('Usage : CLOUD_ADMIN_PASSWORD=... npm run import-to-cloud -- https://<app>.workers.dev [chemin/stock.db]');
  process.exit(1);
}
const dump = dumpDb(new DatabaseSync(file, { readOnly: true }));
const post = (path, body, cookie) => fetch(new URL(path, url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) },
  body: JSON.stringify(body),
});
const login = await post('/api/login', { username: process.env.CLOUD_ADMIN_USERNAME || 'youssef', password });
if (!login.ok) {
  console.error('Connexion refusée :', login.status, await login.text());
  process.exit(1);
}
const res = await post('/api/import', dump, login.headers.get('set-cookie').split(';')[0]);
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
