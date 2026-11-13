import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.RESELLER_PASSWORD = 'aziz-pass-123';
const { app } = await import('./index.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => server.close());

const call = async (method, path, body, cookie) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
};
// One login per account: the API allows only 5 login attempts per 15 minutes.
const sessions = {};
const loginAs = async (username, password) => (sessions[username] ??= (await call('POST', '/login', { username, password })).cookie);

test('routes are closed without login and by role', async () => {
  assert.equal((await call('GET', '/articles')).status, 401);
  const aziz = await loginAs('aziz', 'aziz-pass-123');
  assert.equal((await call('GET', '/articles', null, aziz)).status, 403); // reseller cannot see admin costs
  assert.equal((await call('GET', '/reseller/items', null, aziz)).status, 200);
  const youssef = await loginAs('youssef', 'admin-pass-123');
  assert.equal((await call('GET', '/reseller/items', null, youssef)).status, 403);
});

test('input is validated before it reaches the database', async () => {
  const youssef = await loginAs('youssef', 'admin-pass-123');
  const bad = await call('POST', '/articles', { name: 'X', price_eur: -1, stock: 1 }, youssef);
  assert.equal(bad.status, 400);
  const extra = await call('POST', '/articles', { name: 'X', price_eur: 1, stock: 1, role: 'admin' }, youssef);
  assert.equal(extra.status, 400);
  assert.equal((await call('POST', '/articles', { name: 'X', price_eur: 1, stock: 1, reseller_id: 'aziz' }, youssef)).status, 400);
  assert.equal((await call('POST', '/articles', { name: 'X', price_eur: 1, stock: 1, reseller_id: 1 }, youssef)).status, 404); // admin, not a reseller
  const ok = await call('POST', '/articles', { name: 'X', price_eur: 1, stock: 1 }, youssef);
  assert.equal(ok.status, 200);
});

test('Google login is off without a Client ID', async () => {
  assert.equal((await call('GET', '/config')).body.googleClientId, null);
  assert.equal((await call('POST', '/login/google', { credential: 'x' })).status, 404);
});

test('a purchase needs exactly one price: in DT or in €', async () => {
  const aziz = await loginAs('aziz', 'aziz-pass-123');
  const both = await call('POST', '/reseller/purchases', { name: 'Y', qty: 1, unit_cost_dt: 5, unit_price_eur: 1 }, aziz);
  assert.equal(both.status, 400);
  const eur = await call('POST', '/reseller/purchases', { name: 'Y', qty: 1, unit_price_eur: 2 }, aziz);
  assert.equal(eur.status, 200);
  const rate = (await call('GET', '/reseller/rate', null, aziz)).body;
  assert.equal(rate.rate, 6.22);
  assert.equal('rate_buy' in rate, false); // the supplier purchase rate is never sent to the reseller
  assert.equal((await call('PUT', '/reseller/rate', { rate: 6 }, aziz)).status, 200);
});

test('security headers, strict session cookie, foreign origins refused and logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const res = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'aziz', password: 'aziz-pass-123' }),
  });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-powered-by'), null);

  const evil = await fetch(`${base}/logout`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const bad = await call('POST', '/login', { username: 'youssef', password: 'wrong-secret-xyz' });
  assert.equal(bad.status, 401);
  const logs = warn.mock.calls.map((c) => c.arguments.join(' '));
  assert.ok(logs.some((l) => l.includes('403 POST /api/logout')));
  assert.ok(logs.some((l) => l.includes('401 POST /api/login')));
  assert.ok(logs.every((l) => !l.includes('wrong-secret-xyz'))); // passwords never logged
});

test('a short LOGIN_WINDOW_MS cannot weaken the lockout in production', async () => {
  const auth = await import('./auth.js');
  const env = { NODE_ENV: process.env.NODE_ENV, LOGIN_WINDOW_MS: process.env.LOGIN_WINDOW_MS };
  Object.assign(process.env, { NODE_ENV: 'production', LOGIN_WINDOW_MS: '10000' });
  try {
    for (let i = 0; i < 5; i++) auth.checkLoginRate('clamp-test');
    assert.throws(() => auth.checkLoginRate('clamp-test'), /15 min/);
  } finally {
    for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test('the reseller never receives the arrival or the carrier', async () => {
  const aziz = await loginAs('aziz', 'aziz-pass-123');
  const items = (await call('GET', '/reseller/items', null, aziz)).body;
  assert.ok(items.every((i) => !('carrier' in i) && !('arrival' in i)));
  const youssef = await loginAs('youssef', 'admin-pass-123');
  const bad = await call('POST', '/articles', { name: 'Z', price_eur: 1, stock: 1, arrival: 0 }, youssef);
  assert.equal(bad.status, 400);
});

test('the admin creates resellers who log in to their own isolated account', async () => {
  const youssef = await loginAs('youssef', 'admin-pass-123');
  const aziz = await loginAs('aziz', 'aziz-pass-123');
  const body = { name: 'Sami Trabelsi', username: 'sami', password: 'sami-pass-123' };
  assert.equal((await call('POST', '/resellers', body, aziz)).status, 403);
  assert.equal((await call('GET', '/resellers', null, aziz)).status, 403);
  assert.equal((await call('POST', '/resellers', { ...body, password: 'short' }, youssef)).status, 400);
  assert.equal((await call('POST', '/resellers', { ...body, username: 'Bad Name' }, youssef)).status, 400);
  assert.equal((await call('POST', '/resellers', { ...body, role: 'admin' }, youssef)).status, 400);
  const created = await call('POST', '/resellers', body, youssef);
  assert.equal(created.status, 200);
  assert.deepEqual(Object.keys(created.body).sort(), ['id', 'name', 'username']); // never the password hash
  const dup = await call('POST', '/resellers', { ...body, name: 'Autre' }, youssef);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'Identifiant déjà utilisé');
  const list = (await call('GET', '/resellers', null, youssef)).body;
  assert.deepEqual(list.map((u) => u.username), ['aziz', 'sami']);

  const sami = await loginAs('sami', 'sami-pass-123');
  assert.ok(sami);
  assert.deepEqual((await call('GET', '/reseller/items', null, sami)).body, []);

  // An admin sale to Sami is his stock only; its follow-up is per reseller.
  const article = (await call('GET', '/articles', null, youssef)).body.find((a) => a.stock > 1);
  const sale = await call('POST', '/sales', { article_id: article.id, qty: 1, client: '', reseller_id: created.body.id }, youssef);
  assert.equal(sale.status, 200);
  assert.equal((await call('GET', '/reseller/items', null, sami)).body.length, 1);
  assert.ok((await call('GET', '/reseller/items', null, aziz)).body.every((i) => i.id !== `a${article.id}`));
  const follow = (await call('GET', `/resellers/${created.body.id}/follow`, null, youssef)).body;
  assert.equal(follow.purchases.length, 1);
  assert.equal((await call('GET', '/resellers/9999/follow', null, youssef)).status, 404);
  assert.equal((await call('GET', `/resellers/${created.body.id}/follow`, null, sami)).status, 403);
  assert.equal((await call('POST', '/sales', { article_id: article.id, qty: 1, client: 'X', reseller_id: 'abc' }, youssef)).status, 400);

  // Sami cannot delete Aziz's sale by id.
  const azizId = list.find((u) => u.username === 'aziz').id;
  assert.equal((await call('POST', '/sales', { article_id: article.id, qty: 1, client: '', reseller_id: azizId }, youssef)).status, 200);
  const azizSale = await call('POST', '/reseller/sales', { article_id: `a${article.id}`, qty: 1, unit_price_dt: 99, client: '' }, aziz);
  assert.equal(azizSale.status, 200);
  assert.equal((await call('DELETE', `/reseller/sales/${azizSale.body.id}`, null, sami)).status, 404);
  assert.equal((await call('GET', '/reseller/sales', null, aziz)).body.length, 1);
});

test('calls without a session are logged, except the logged-out /api/me probe', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal((await call('GET', '/reseller/sales')).status, 401);
  assert.equal((await call('GET', '/me')).status, 401);
  const logs = warn.mock.calls.map((c) => c.arguments.join(' '));
  assert.ok(logs.some((l) => l.includes('401 GET /api/reseller/sales')));
  assert.ok(logs.every((l) => !l.includes('/api/me')));
});

test('a reseller cannot assign rows to another reseller through the body', async () => {
  const aziz = await loginAs('aziz', 'aziz-pass-123');
  const sale = await call('POST', '/reseller/sales', { article_id: 'x1', qty: 1, client: '', reseller_id: 1 }, aziz);
  assert.equal(sale.status, 400);
  const purchase = await call('POST', '/reseller/purchases', { name: 'Q', qty: 1, unit_cost_dt: 1, reseller_id: 1 }, aziz);
  assert.equal(purchase.status, 400);
  assert.equal((await call('PUT', '/reseller/rate', { rate: 6, reseller_id: 1 }, aziz)).status, 400);
});

test('oversized bodies are refused and server files are never served', async () => {
  const youssef = await loginAs('youssef', 'admin-pass-123');
  assert.equal((await call('POST', '/articles', { name: 'x'.repeat(20000), price_eur: 1, stock: 1 }, youssef)).status, 400);
  const root = base.slice(0, -4);
  for (const path of ['/.env', '/server/db.js', '/server/data/stock.db', '/package.json', '/%2e%2e/.env', '/.git/config']) {
    const body = await (await fetch(root + path)).text();
    assert.ok(!/ADMIN_PASSWORD|SQLite format|openDb|"dependencies"|\[core\]/.test(body), path);
  }
});

test('only the admin edits a sale, with a complete strict body', async () => {
  const youssef = await loginAs('youssef', 'admin-pass-123');
  const aziz = await loginAs('aziz', 'aziz-pass-123');
  const article = (await call('GET', '/articles', null, youssef)).body.find((a) => a.stock > 1);
  const sale = (await call('POST', '/sales', { article_id: article.id, qty: 1, client: 'C' }, youssef)).body;
  const body = { qty: 2, unit_price_dt: 10, client: 'C', sold_at: '2026-01-01', reseller_id: null };
  assert.equal((await call('PUT', `/sales/${sale.id}`, body, aziz)).status, 403);
  assert.equal((await call('PUT', `/sales/${sale.id}`, { ...body, article_id: 1 }, youssef)).status, 400);
  assert.equal((await call('PUT', `/sales/${sale.id}`, { qty: 2 }, youssef)).status, 400);
  const ok = await call('PUT', `/sales/${sale.id}`, body, youssef);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.qty, 2);
});

test('settings take the shipping rate; articles take a shipping price', async () => {
  const youssef = await loginAs('youssef', 'admin-pass-123');
  assert.equal((await call('PUT', '/settings', { rate_buy: 4.5, rate_sell: 6.22 }, youssef)).status, 400);
  const s = await call('PUT', '/settings', { rate_buy: 4.5, rate_sell: 6.22, rate_shipping: 5 }, youssef);
  assert.equal(s.status, 200);
  assert.equal(s.body.rate_shipping, 5);
  assert.equal((await call('POST', '/articles', { name: 'S', price_eur: 1, stock: 1, shipping_eur: -1 }, youssef)).status, 400);
  const a = await call('POST', '/articles', { name: 'S', price_eur: 1, stock: 1, shipping_eur: 2.5 }, youssef);
  assert.equal(a.body.shipping_dt, 12.5);
});
