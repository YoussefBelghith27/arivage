import { tx } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const r3 = (n) => Math.round(n * 1000) / 1000;
export const sum = (list, f) => r3(list.reduce((t, x) => t + f(x), 0));

// Shared by the admin and reseller stats. Items need category, stock, buy_dt and sell_dt (null = unpriced).
export function byCategory(items) {
  const categories = {};
  for (const i of items) {
    const c = (categories[i.category || 'Autre'] ??= { category: i.category || 'Autre', cost: 0, value: 0, units: 0 });
    c.cost = r3(c.cost + i.stock * i.buy_dt);
    c.value = r3(c.value + i.stock * (i.sell_dt ?? 0));
    c.units += i.stock;
  }
  return Object.values(categories);
}

// Sale totals and daily curve of `table` (sales or reseller_sales, same columns; never user input),
// limited to one reseller's rows when rid is given.
export function salesStats(db, table, rid) {
  const where = rid == null ? '' : 'WHERE reseller_id = ?';
  const args = rid == null ? [] : [rid];
  const s = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(qty), 0) AS units,
      COALESCE(SUM(qty * unit_price_dt), 0) AS revenue,
      COALESCE(SUM(qty * (unit_price_dt - unit_cost_dt)), 0) AS profit FROM ${table} ${where}`).get(...args);
  return {
    sales_count: s.count,
    sold_units: s.units,
    revenue_dt: r3(s.revenue),
    profit_dt: r3(s.profit),
    by_day: db.prepare(`SELECT sold_at AS day, ROUND(SUM(qty * unit_price_dt), 3) AS revenue,
        ROUND(SUM(qty * (unit_price_dt - unit_cost_dt)), 3) AS profit
      FROM ${table} ${where} GROUP BY sold_at ORDER BY sold_at`).all(...args),
  };
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function updateSettings(db, { rate_buy, rate_sell, rate_shipping }) {
  const set = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  tx(db, () => {
    set.run(rate_buy, 'rate_buy');
    set.run(rate_sell, 'rate_sell');
    set.run(rate_shipping, 'rate_shipping');
  });
  return getSettings(db);
}

// Purchase/sale prices in DT derive from the € price and shipping unless fixed by buy_price_dt / sell_price_dt.
// Shipping costs € × rate_buy and is billed € × rate_shipping.
function priced(a, s) {
  const buy_dt = a.buy_price_dt ?? r3((a.price_eur + a.shipping_eur) * s.rate_buy);
  const sell_dt = a.sell_price_dt ?? r3(a.price_eur * s.rate_sell + a.shipping_eur * s.rate_shipping);
  return { ...a, buy_dt, sell_dt, margin_dt: r3(sell_dt - buy_dt),
    shipping_cost_dt: r3(a.shipping_eur * s.rate_buy), shipping_dt: r3(a.shipping_eur * s.rate_shipping) };
}

const ARTICLE_SQL = `SELECT a.*, COALESCE(SUM(s.qty), 0) AS sold, u.name AS reseller_name
  FROM articles a LEFT JOIN sales s ON s.article_id = a.id LEFT JOIN users u ON u.id = a.reseller_id`;

export function listArticles(db) {
  const s = getSettings(db);
  return db.prepare(`${ARTICLE_SQL} GROUP BY a.id ORDER BY a.name COLLATE NOCASE`).all().map((a) => priced(a, s));
}

function getArticle(db, id) {
  const a = db.prepare(`${ARTICLE_SQL} WHERE a.id = ? GROUP BY a.id`).get(id);
  if (!a) throw new HttpError(404, 'Article introuvable');
  return priced(a, getSettings(db));
}

const checkReseller = (db, rid) => {
  if (rid != null && !resellerName(db, rid)) throw new HttpError(404, 'Revendeur introuvable');
};

export function createArticle(db, d) {
  checkReseller(db, d.reseller_id);
  const { id } = db
    .prepare(`INSERT INTO articles (name, supplier, category, price_eur, shipping_eur, buy_price_dt, sell_price_dt, stock, arrival, carrier, reseller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(d.name, d.supplier, d.category, d.price_eur, d.shipping_eur ?? 0, d.buy_price_dt, d.sell_price_dt, d.stock, d.arrival ?? null, d.carrier ?? '', d.reseller_id ?? null);
  return getArticle(db, id);
}

export function updateArticle(db, id, d) {
  checkReseller(db, d.reseller_id);
  const { changes } = db
    .prepare(`UPDATE articles SET name = ?, supplier = ?, category = ?, price_eur = ?, shipping_eur = ?, buy_price_dt = ?, sell_price_dt = ?, stock = ?,
      arrival = ?, carrier = ?, reseller_id = ? WHERE id = ?`)
    .run(d.name, d.supplier, d.category, d.price_eur, d.shipping_eur ?? 0, d.buy_price_dt, d.sell_price_dt, d.stock, d.arrival ?? null, d.carrier ?? '', d.reseller_id ?? null, id);
  if (!changes) throw new HttpError(404, 'Article introuvable');
  return getArticle(db, id);
}

export function adjustStock(db, id, delta) {
  const a = getArticle(db, id);
  if (a.stock + delta < 0) throw new HttpError(409, 'Le stock ne peut pas être négatif');
  db.prepare('UPDATE articles SET stock = stock + ? WHERE id = ?').run(delta, id);
  return getArticle(db, id);
}

export function deleteArticle(db, id) {
  const a = getArticle(db, id);
  if (a.sold > 0) throw new HttpError(409, 'Cet article a des ventes : supprimez-les d’abord');
  db.prepare('DELETE FROM articles WHERE id = ?').run(id);
  return { ok: true };
}

export function listSales(db) {
  return db
    .prepare(`SELECT s.*, a.name AS article_name, a.category, u.name AS reseller_name,
        ROUND(s.qty * s.unit_price_dt, 3) AS total_dt,
        ROUND(s.qty * (s.unit_price_dt - s.unit_cost_dt), 3) AS profit_dt
      FROM sales s JOIN articles a ON a.id = s.article_id LEFT JOIN users u ON u.id = s.reseller_id
      ORDER BY s.sold_at DESC, s.id DESC`)
    .all();
}

const resellerName = (db, id) => db.prepare("SELECT name FROM users WHERE id = ? AND role = 'reseller'").get(id)?.name;

// reseller_id: the reseller who buys it (it becomes his stock), or null for another client.
export function createSale(db, d) {
  return tx(db, () => {
    const a = getArticle(db, d.article_id);
    const rid = d.reseller_id ?? null;
    if (rid != null && !resellerName(db, rid)) throw new HttpError(404, 'Revendeur introuvable');
    if (a.stock < d.qty) throw new HttpError(409, `Stock insuffisant (${a.stock} disponible)`);
    db.prepare('UPDATE articles SET stock = stock - ? WHERE id = ?').run(d.qty, a.id);
    const { id } = db
      .prepare(`INSERT INTO sales (article_id, qty, unit_price_dt, unit_cost_dt, client, sold_at, reseller_id)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now', 'localtime')), ?) RETURNING id`)
      .get(a.id, d.qty, d.unit_price_dt ?? a.sell_dt, a.buy_dt, d.client, d.sold_at ?? null, rid);
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  });
}

// Editing a sale (not its article): stock moves by the qty difference; the cost stays the one at sale time.
export function updateSale(db, id, d) {
  return tx(db, () => {
    const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'Vente introuvable');
    if (d.reseller_id != null && !resellerName(db, d.reseller_id)) throw new HttpError(404, 'Revendeur introuvable');
    const free = getArticle(db, s.article_id).stock + s.qty;
    if (free < d.qty) throw new HttpError(409, `Stock insuffisant (${free} disponible)`);
    // Same check as deleteSale: the old buyer must keep at least the units of this article he already resold.
    if (s.reseller_id != null) {
      const { left } = db.prepare(`SELECT
          (SELECT SUM(qty) FROM sales WHERE article_id = :a AND reseller_id = :r)
          - COALESCE((SELECT SUM(qty) FROM reseller_sales WHERE article_id = :a AND reseller_id = :r), 0) AS left`)
        .get({ a: s.article_id, r: s.reseller_id });
      const kept = d.reseller_id === s.reseller_id ? d.qty : 0;
      if (left - s.qty + kept < 0) throw new HttpError(409, `${resellerName(db, s.reseller_id)} a déjà revendu ces unités : supprimez d’abord ses ventes`);
    }
    db.prepare('UPDATE articles SET stock = stock + ? WHERE id = ?').run(s.qty - d.qty, s.article_id);
    db.prepare('UPDATE sales SET qty = ?, unit_price_dt = ?, client = ?, sold_at = ?, reseller_id = ? WHERE id = ?')
      .run(d.qty, d.unit_price_dt, d.client, d.sold_at, d.reseller_id, id);
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  });
}

// Deleting a sale puts its quantity back in stock.
export function deleteSale(db, id) {
  return tx(db, () => {
    const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'Vente introuvable');
    // A sale to a reseller is stock he bought: refuse if he already resold those units. Sales to other clients: no check.
    if (s.reseller_id != null) {
      const { left } = db.prepare(`SELECT
          (SELECT SUM(qty) FROM sales WHERE article_id = :a AND reseller_id = :r)
          - COALESCE((SELECT SUM(qty) FROM reseller_sales WHERE article_id = :a AND reseller_id = :r), 0) AS left`)
        .get({ a: s.article_id, r: s.reseller_id });
      if (left < s.qty) throw new HttpError(409, `${resellerName(db, s.reseller_id)} a déjà revendu ces unités : supprimez d’abord ses ventes`);
    }
    db.prepare('UPDATE articles SET stock = stock + ? WHERE id = ?').run(s.qty, s.article_id);
    db.prepare('DELETE FROM sales WHERE id = ?').run(id);
    return { ok: true };
  });
}

export function getStats(db) {
  const articles = listArticles(db);
  return {
    article_count: articles.length,
    stock_units: sum(articles, (a) => a.stock),
    stock_eur: sum(articles, (a) => a.stock * a.price_eur),
    stock_cost_dt: sum(articles, (a) => a.stock * a.buy_dt),
    stock_value_dt: sum(articles, (a) => a.stock * a.sell_dt),
    potential_profit_dt: sum(articles, (a) => a.stock * a.margin_dt),
    ...salesStats(db, 'sales'),
    by_category: byCategory(articles).sort((x, y) => y.value - x.value),
    top: articles.filter((a) => a.sold > 0).sort((x, y) => y.sold - x.sold).slice(0, 5)
      .map(({ id, name, sold, sell_dt }) => ({ id, name, sold, sell_dt })),
    low_stock: articles.filter((a) => a.stock <= 1).map(({ id, name, stock }) => ({ id, name, stock })),
  };
}
