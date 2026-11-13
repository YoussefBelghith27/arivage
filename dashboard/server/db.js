import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED } from './seed.js';

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const RESELLER_PRICES = `CREATE TABLE IF NOT EXISTS reseller_prices (
      reseller_id INTEGER NOT NULL REFERENCES users(id),
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      sell_price_dt REAL NOT NULL CHECK (sell_price_dt >= 0),
      PRIMARY KEY (reseller_id, article_id)
    );`;

export function openDb(file = process.env.DB_PATH || fileURLToPath(new URL('./data/stock.db', import.meta.url))) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  const hasColumn = (table, name) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name);
  // An early, never-used reseller_sales (no external_id) is replaced; refuse if it ever held data.
  const old = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'reseller_sales'").get()
    && !hasColumn('reseller_sales', 'external_id');
  if (old) {
    if (db.prepare('SELECT COUNT(*) AS n FROM reseller_sales').get().n) throw new Error('reseller_sales: migration manuelle requise');
    db.exec('DROP TABLE reseller_sales');
  }
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      price_eur REAL NOT NULL CHECK (price_eur >= 0),
      sell_price_dt REAL CHECK (sell_price_dt >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL CHECK (qty > 0),
      unit_price_dt REAL NOT NULL CHECK (unit_price_dt >= 0),
      unit_cost_dt REAL NOT NULL CHECK (unit_cost_dt >= 0),
      client TEXT NOT NULL DEFAULT '',
      sold_at TEXT NOT NULL DEFAULT (date('now'))
    );
    CREATE INDEX IF NOT EXISTS sales_article ON sales(article_id);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'reseller')),
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    -- Reseller side, every row owned by one reseller (reseller_id, added below for older databases).
    -- A reseller's purchases from the admin are the admin's sales to him (sales.reseller_id).
    ${RESELLER_PRICES}
    -- Articles the reseller buys from other suppliers, and each of those purchases.
    CREATE TABLE IF NOT EXISTS external_items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      sell_price_dt REAL CHECK (sell_price_dt >= 0)
    );
    CREATE TABLE IF NOT EXISTS external_purchases (
      id INTEGER PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES external_items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL CHECK (qty > 0),
      unit_cost_dt REAL NOT NULL CHECK (unit_cost_dt >= 0),
      bought_at TEXT NOT NULL DEFAULT (date('now', 'localtime'))
    );
    -- A reseller sale is of a supplier article (article_id) or of an external item (external_id), never both.
    CREATE TABLE IF NOT EXISTS reseller_sales (
      id INTEGER PRIMARY KEY,
      article_id INTEGER REFERENCES articles(id) ON DELETE RESTRICT,
      external_id INTEGER REFERENCES external_items(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL CHECK (qty > 0),
      unit_price_dt REAL NOT NULL CHECK (unit_price_dt >= 0),
      unit_cost_dt REAL NOT NULL CHECK (unit_cost_dt >= 0),
      client TEXT NOT NULL DEFAULT '',
      sold_at TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      CHECK ((article_id IS NULL) != (external_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS reseller_sales_article ON reseller_sales(article_id);
    CREATE INDEX IF NOT EXISTS reseller_sales_external ON reseller_sales(external_id);
    CREATE INDEX IF NOT EXISTS external_purchases_item ON external_purchases(item_id);
    INSERT OR IGNORE INTO settings VALUES ('rate_buy', 4.5), ('rate_sell', 6.22), ('reseller_rate', 6.22), ('rate_shipping', 5);
  `);
  // Added after the first release: upgrade databases created before it.
  if (!hasColumn('articles', 'buy_price_dt')) {
    db.exec('ALTER TABLE articles ADD COLUMN buy_price_dt REAL CHECK (buy_price_dt >= 0)');
  }
  // Admin-only tracking: which arrival (shipment) the article came in, and its main carrier.
  if (!hasColumn('articles', 'arrival')) {
    db.exec("ALTER TABLE articles ADD COLUMN arrival INTEGER CHECK (arrival >= 1); ALTER TABLE articles ADD COLUMN carrier TEXT NOT NULL DEFAULT ''");
  }
  // A purchase entered in € keeps its € price and the rate used to get its DT cost.
  if (!hasColumn('external_purchases', 'price_eur')) {
    db.exec('ALTER TABLE external_purchases ADD COLUMN price_eur REAL CHECK (price_eur >= 0); ALTER TABLE external_purchases ADD COLUMN rate REAL');
  }
  // Gmail address allowed to sign in with Google (optional).
  if (!hasColumn('users', 'email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT; CREATE UNIQUE INDEX users_email ON users(email)');
  }
  // Stock destination: the reseller the article is meant for, NULL = external sale.
  if (!hasColumn('articles', 'reseller_id')) {
    db.exec('ALTER TABLE articles ADD COLUMN reseller_id INTEGER REFERENCES users(id)');
  }
  // Shipping paid per unit, in €: costs € × rate_buy, billed € × rate_shipping.
  if (!hasColumn('articles', 'shipping_eur')) {
    db.exec('ALTER TABLE articles ADD COLUMN shipping_eur REAL NOT NULL DEFAULT 0 CHECK (shipping_eur >= 0)');
  }
  // Several resellers: each reseller row gets its owner. Before, it all belonged to Aziz, and an admin sale went to him
  // unless flagged external; that flag becomes reseller_id NULL (another client) and is dropped.
  tx(db, () => {
    const aziz = db.prepare("SELECT id FROM users WHERE username = 'aziz' AND role = 'reseller'").get()?.id ?? null;
    const orphans = (table, where = '') => {
      if (aziz == null && db.prepare(`SELECT 1 FROM ${table} ${where} LIMIT 1`).get()) throw new Error(`${table} : compte aziz introuvable, migration manuelle requise`);
    };
    const own = (table, where = '') => {
      if (hasColumn(table, 'reseller_id')) return;
      orphans(table, where);
      db.exec(`ALTER TABLE ${table} ADD COLUMN reseller_id INTEGER REFERENCES users(id)`);
      db.prepare(`UPDATE ${table} SET reseller_id = ? ${where}`).run(aziz);
    };
    const external = hasColumn('sales', 'external');
    own('sales', external ? 'WHERE external = 0' : '');
    if (external) db.exec('ALTER TABLE sales DROP COLUMN external');
    own('external_items');
    own('reseller_sales');
    if (!hasColumn('reseller_prices', 'reseller_id')) {
      orphans('reseller_prices');
      const old = db.prepare('SELECT article_id, sell_price_dt FROM reseller_prices').all();
      db.exec(`DROP TABLE reseller_prices; ${RESELLER_PRICES}`);
      const insert = db.prepare('INSERT INTO reseller_prices VALUES (?, ?, ?)');
      for (const p of old) insert.run(aziz, p.article_id, p.sell_price_dt);
    }
  });
  db.exec(`CREATE INDEX IF NOT EXISTS sales_reseller ON sales(reseller_id);
    CREATE INDEX IF NOT EXISTS external_items_reseller ON external_items(reseller_id);
    CREATE INDEX IF NOT EXISTS reseller_sales_reseller ON reseller_sales(reseller_id);`);
  // Seed only a brand-new database: an emptied stock with existing accounts stays empty.
  if (db.prepare('SELECT (SELECT COUNT(*) FROM articles) + (SELECT COUNT(*) FROM users) AS n').get().n === 0) {
    const insert = db.prepare('INSERT INTO articles (name, supplier, category, price_eur, stock) VALUES (?, ?, ?, ?, ?)');
    tx(db, () => SEED.forEach(([name, supplier, category, qty, total]) =>
      insert.run(name, supplier, category, Math.round((total / qty) * 100) / 100, qty)));
  }
  return db;
}
