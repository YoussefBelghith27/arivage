import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrate, dumpDb, importDump, tx } from './db.js';
import { doDb } from './do-db.js';
import { ensureUsers, login } from './auth.js';
import * as store from './store.js';
import * as reseller from './reseller.js';

// The schema as it was before several resellers (commit e8a6c8c): one implicit reseller, an external flag on admin sales.
const OLD_SCHEMA = `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value REAL NOT NULL);
  CREATE TABLE articles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, supplier TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    price_eur REAL NOT NULL CHECK (price_eur >= 0), sell_price_dt REAL CHECK (sell_price_dt >= 0), stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), buy_price_dt REAL CHECK (buy_price_dt >= 0), arrival INTEGER CHECK (arrival >= 1), carrier TEXT NOT NULL DEFAULT '');
  CREATE TABLE sales (id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
    qty INTEGER NOT NULL CHECK (qty > 0), unit_price_dt REAL NOT NULL CHECK (unit_price_dt >= 0), unit_cost_dt REAL NOT NULL CHECK (unit_cost_dt >= 0),
    client TEXT NOT NULL DEFAULT '', sold_at TEXT NOT NULL DEFAULT (date('now')), external INTEGER NOT NULL DEFAULT 0 CHECK (external IN (0, 1)));
  CREATE INDEX sales_article ON sales(article_id);
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'reseller')),
    password_hash TEXT NOT NULL, email TEXT);
  CREATE UNIQUE INDEX users_email ON users(email);
  CREATE TABLE reseller_prices (article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE, sell_price_dt REAL NOT NULL CHECK (sell_price_dt >= 0));
  CREATE TABLE external_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, supplier TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', sell_price_dt REAL CHECK (sell_price_dt >= 0));
  CREATE TABLE external_purchases (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES external_items(id) ON DELETE CASCADE,
    qty INTEGER NOT NULL CHECK (qty > 0), unit_cost_dt REAL NOT NULL CHECK (unit_cost_dt >= 0), bought_at TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    price_eur REAL CHECK (price_eur >= 0), rate REAL);
  CREATE TABLE reseller_sales (id INTEGER PRIMARY KEY, article_id INTEGER REFERENCES articles(id) ON DELETE RESTRICT,
    external_id INTEGER REFERENCES external_items(id) ON DELETE RESTRICT, qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price_dt REAL NOT NULL CHECK (unit_price_dt >= 0), unit_cost_dt REAL NOT NULL CHECK (unit_cost_dt >= 0),
    client TEXT NOT NULL DEFAULT '', sold_at TEXT NOT NULL DEFAULT (date('now', 'localtime')), CHECK ((article_id IS NULL) != (external_id IS NULL)));
  INSERT INTO settings VALUES ('rate_buy', 4.5), ('rate_sell', 6.22), ('reseller_rate', 6.5);
  INSERT INTO users (id, username, name, role, password_hash) VALUES (1, 'youssef', 'Youssef Belghith', 'admin', 'hash-y'), (2, 'aziz', 'Aziz Jazi', 'reseller', 'hash-a');
  INSERT INTO articles (id, name, price_eur, stock) VALUES (1, 'Taurin', 10, 5), (2, 'Kreatin', 12, 4);
  INSERT INTO sales (id, article_id, qty, unit_price_dt, unit_cost_dt, client, sold_at, external) VALUES
    (1, 1, 2, 40, 30, '', '2026-10-01', 0), (2, 2, 1, 80, 50, 'Client X', '2026-10-02', 1);
  INSERT INTO reseller_prices VALUES (1, 55);
  INSERT INTO external_items VALUES (1, 'Whey', 'Autre', '', 90);
  INSERT INTO external_purchases (id, item_id, qty, unit_cost_dt, bought_at) VALUES (1, 1, 3, 50, '2026-10-03');
  INSERT INTO reseller_sales (id, article_id, external_id, qty, unit_price_dt, unit_cost_dt, sold_at) VALUES
    (1, 1, NULL, 1, 55, 40, '2026-10-04'), (2, NULL, 1, 1, 90, 50, '2026-10-05');
`;

const dump = (db) => Object.fromEntries(
  db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all()
    .map(({ name, sql }) => [name, { sql, rows: sql.startsWith('CREATE TABLE') ? db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() : null }]),
);

test('an old single-reseller database is migrated to aziz, and migrating again changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arivage-'));
  const file = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(OLD_SCHEMA);
    old.close();

    const db = openDb(file);
    const col = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.ok(!col('sales').includes('external'));
    assert.ok(db.prepare('SELECT reseller_id FROM articles').all().every((r) => r.reseller_id === null)); // destination: external sale
    assert.deepEqual(db.prepare('SELECT id, reseller_id, client FROM sales ORDER BY id').all().map((r) => ({ ...r })),
      [{ id: 1, reseller_id: 2, client: '' }, { id: 2, reseller_id: null, client: 'Client X' }]);
    assert.deepEqual(db.prepare('SELECT reseller_id, article_id, sell_price_dt FROM reseller_prices').all().map((r) => ({ ...r })),
      [{ reseller_id: 2, article_id: 1, sell_price_dt: 55 }]);
    assert.ok(db.prepare('SELECT reseller_id FROM external_items').all().every((r) => r.reseller_id === 2));
    assert.ok(db.prepare('SELECT reseller_id FROM reseller_sales').all().every((r) => r.reseller_id === 2));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reseller_sales').get().n, 2);
    assert.deepEqual(db.prepare('SELECT username, password_hash FROM users ORDER BY id').all().map((r) => ({ ...r })),
      [{ username: 'youssef', password_hash: 'hash-y' }, { username: 'aziz', password_hash: 'hash-a' }]);

    // Aziz sees exactly what he saw before: his supplier article with his price, his external item, his rate.
    const items = reseller.listItems(db, 2);
    assert.deepEqual(items.map((i) => [i.id, i.bought, i.sold, i.sell_dt]), [['a1', 2, 1, 55], ['x1', 3, 1, 90]]);
    assert.equal(reseller.getRate(db, 2), 6.5);
    assert.equal(reseller.getStats(db, 2).sales_count, 2);
    assert.ok(db.prepare('SELECT shipping_eur FROM articles').all().every((r) => r.shipping_eur === 0));
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'rate_shipping'").get().value, 5);

    const first = dump(db);
    db.close();
    const again = openDb(file);
    assert.deepEqual(dump(again), first);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ENV = { ADMIN_PASSWORD: 'admin-pass-123', RESELLER_PASSWORD: 'aziz-pass-123' };

test('import copies a local database (read only) into an unused one, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arivage-'));
  const file = join(dir, 'local.db');
  try {
    const local = openDb(file);
    ensureUsers(local, { ADMIN_PASSWORD: 'local-admin-123', RESELLER_PASSWORD: 'local-aziz-123' });
    const article = store.listArticles(local)[0];
    store.createSale(local, { article_id: article.id, qty: 1, client: 'C', reseller_id: 2 });
    local.close();

    const source = new DatabaseSync(file, { readOnly: true });
    assert.throws(() => source.exec('DELETE FROM sales')); // the script cannot change the local file
    const dump = JSON.parse(JSON.stringify(dumpDb(source))); // as sent over HTTP
    source.close();

    const cloud = openDb(':memory:');
    ensureUsers(cloud, ENV);
    login(cloud, 'youssef', 'admin-pass-123'); // the admin's cloud session, closed by the import
    const counts = importDump(cloud, dump);
    assert.equal(counts.sales, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(dumpDb(cloud))), dump);
    assert.equal(cloud.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal(login(cloud, 'youssef', 'local-admin-123').user.username, 'youssef'); // local passwords now
    assert.throws(() => importDump(cloud, dump), { status: 409 }); // second run: refused, nothing changed

    const fresh = openDb(':memory:');
    ensureUsers(fresh, ENV);
    assert.throws(() => importDump(fresh, { ...dump, articles: [{ id: 1, nope: 1 }] }), { status: 400 });
    assert.equal(store.listArticles(fresh).length, 18); // rolled back
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Stand-in for a Durable Object's ctx.storage over node:sqlite: exec() binds only `?`, BEGIN is refused.
function fakeStorage() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    sql: {
      exec(q, ...args) {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)/i.test(q)) throw new Error('transaction statements refused');
        if (/:\w/.test(q.replace(/'[^']*'/g, ''))) throw new Error('named parameter reached sql.exec');
        const rows = args.length || /^\s*(SELECT|PRAGMA|WITH)|RETURNING/i.test(q) ? db.prepare(q).all(...args) : (db.exec(q), []);
        return { toArray: () => rows, one: () => rows[0] };
      },
    },
    transactionSync: (fn) => tx(db, fn),
  };
}

test('the Durable Object adapter runs the same modules: named params, changes, rollback', () => {
  const db = migrate(doDb(fakeStorage()));
  ensureUsers(db, ENV);
  const article = store.listArticles(db).find((a) => a.stock >= 2);
  store.createSale(db, { article_id: article.id, qty: 2, client: '', reseller_id: 2 });
  assert.equal(store.listArticles(db).find((a) => a.id === article.id).stock, article.stock - 2);
  assert.throws(() => store.createSale(db, { article_id: article.id, qty: 1e5, client: '' }), { status: 409 });
  assert.equal(reseller.listItems(db, 2)[0].stock, 2); // :rid
  assert.equal(reseller.listItems(db, 3).length, 0);
  assert.throws(() => reseller.deleteSale(db, 2, 999), { status: 404 }); // run().changes === 0
  assert.throws(() => tx(db, () => { store.adjustStock(db, article.id, 1); throw new Error('boom'); }), /boom/);
  assert.equal(store.listArticles(db).find((a) => a.id === article.id).stock, article.stock - 2); // rolled back
});
