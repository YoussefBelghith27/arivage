import { tx } from './db.js';
import { HttpError, byCategory, getSettings, r3, salesStats, sum } from './store.js';

// Every function takes the reseller's user id (rid, from the session) and only reads or writes that reseller's rows.
// His items come from two sources, identified by a key: 'a<id>' = bought from the supplier (every admin sale
// to him is his purchase, at the admin's sale price), 'x<id>' = bought from another supplier (recorded by him).
const SUPPLIER = 'Youssef Belghith';

const FROM_SUPPLIER = `SELECT 'a' || a.id AS id, a.name, a.category, '${SUPPLIER}' AS supplier, 'fournisseur' AS source,
    b.qty AS bought, b.paid, COALESCE(rs.qty, 0) AS sold, rp.sell_price_dt, a.price_eur
  FROM articles a
  JOIN (SELECT article_id, SUM(qty) AS qty, SUM(qty * unit_price_dt) AS paid FROM sales WHERE reseller_id = :rid GROUP BY article_id) b ON b.article_id = a.id
  LEFT JOIN (SELECT article_id, SUM(qty) AS qty FROM reseller_sales WHERE article_id IS NOT NULL AND reseller_id = :rid GROUP BY article_id) rs ON rs.article_id = a.id
  LEFT JOIN reseller_prices rp ON rp.article_id = a.id AND rp.reseller_id = :rid`;
const FROM_EXTERNAL = `SELECT 'x' || x.id AS id, x.name, x.category, x.supplier, 'externe' AS source,
    p.qty AS bought, p.paid, COALESCE(rs.qty, 0) AS sold, x.sell_price_dt, NULL AS price_eur
  FROM external_items x
  JOIN (SELECT item_id, SUM(qty) AS qty, SUM(qty * unit_cost_dt) AS paid FROM external_purchases GROUP BY item_id) p ON p.item_id = x.id
  LEFT JOIN (SELECT external_id, SUM(qty) AS qty FROM reseller_sales WHERE external_id IS NOT NULL AND reseller_id = :rid GROUP BY external_id) rs ON rs.external_id = x.id
  WHERE x.reseller_id = :rid`;
const ITEMS_SQL = `SELECT * FROM (${FROM_SUPPLIER} UNION ALL ${FROM_EXTERNAL})`;

// Stock = bought − sold; cost = average price paid. eur_rate = his rate from the supplier (€ price × rate = his cost).
const toItem = ({ paid, ...i }) => {
  const buy_dt = r3(paid / i.bought);
  const sell_dt = i.sell_price_dt ?? null;
  const eur_rate = i.price_eur ? Math.round((buy_dt / i.price_eur) * 100) / 100 : null;
  return { ...i, stock: i.bought - i.sold, buy_dt, sell_dt, eur_rate, margin_dt: sell_dt == null ? null : r3(sell_dt - buy_dt) };
};

// His own purchase rate for € prices (settings 'reseller_rate:<id>'); until he sets it, the shared 'reseller_rate'.
export function getRate(db, rid) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(`reseller_rate:${rid}`)?.value ?? getSettings(db).reseller_rate;
}

export function setRate(db, rid, rate) {
  db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(`reseller_rate:${rid}`, rate);
  return { rate, rates: eurRates(db, rid) };
}

// Rates offered for a purchase entered in €: his own rate (he can change it) and every rate he actually paid (e.g. 6).
export function eurRates(db, rid) {
  const rates = new Set([getRate(db, rid)]);
  for (const i of listItems(db, rid)) if (i.eur_rate) rates.add(i.eur_rate);
  return [...rates].sort((x, y) => y - x);
}

const parseKey = (key) => {
  const m = /^([ax])(\d+)$/.exec(key);
  if (!m) throw new HttpError(400, 'Article invalide');
  return { external: m[1] === 'x', id: Number(m[2]) };
};

export function listItems(db, rid) {
  return db.prepare(`${ITEMS_SQL} ORDER BY name COLLATE NOCASE`).all({ rid }).map(toItem);
}

// Only finds his own items: another reseller's key is "not found".
function getItem(db, rid, key) {
  parseKey(key);
  const i = db.prepare(`${ITEMS_SQL} WHERE id = :key`).get({ rid, key });
  if (!i) throw new HttpError(404, 'Article introuvable');
  return toItem(i);
}

// null clears the price (back to "à définir").
export function setPrice(db, rid, key, price) {
  getItem(db, rid, key);
  const { external, id } = parseKey(key);
  if (external) db.prepare('UPDATE external_items SET sell_price_dt = ? WHERE id = ? AND reseller_id = ?').run(price, id, rid);
  else if (price == null) db.prepare('DELETE FROM reseller_prices WHERE reseller_id = ? AND article_id = ?').run(rid, id);
  else db.prepare(`INSERT INTO reseller_prices VALUES (?, ?, ?)
    ON CONFLICT (reseller_id, article_id) DO UPDATE SET sell_price_dt = excluded.sell_price_dt`).run(rid, id, price);
  return getItem(db, rid, key);
}

// A purchase from another supplier: a new item (name…) or more units of one of his items (item_id).
export function addPurchase(db, rid, d) {
  return tx(db, () => {
    let itemId = d.item_id;
    if (itemId) {
      if (!db.prepare('SELECT 1 FROM external_items WHERE id = ? AND reseller_id = ?').get(itemId, rid)) throw new HttpError(404, 'Article introuvable');
    } else {
      if (!d.name) throw new HttpError(400, 'Nom de l’article requis');
      ({ id: itemId } = db.prepare('INSERT INTO external_items (name, supplier, category, reseller_id) VALUES (?, ?, ?, ?) RETURNING id')
        .get(d.name, d.supplier, d.category, rid));
    }
    // Price in € → DT cost with his rate (default: his own purchase rate), kept with the purchase.
    const rate = d.unit_price_eur == null ? null : d.eur_rate ?? getRate(db, rid);
    const cost = rate == null ? d.unit_cost_dt : r3(d.unit_price_eur * rate);
    db.prepare(`INSERT INTO external_purchases (item_id, qty, unit_cost_dt, price_eur, rate, bought_at)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now', 'localtime')))`)
      .run(itemId, d.qty, cost, d.unit_price_eur ?? null, rate, d.bought_at ?? null);
    return getItem(db, rid, `x${itemId}`);
  });
}

export function deletePurchase(db, rid, id) {
  return tx(db, () => {
    const p = db.prepare(`SELECT p.* FROM external_purchases p JOIN external_items x ON x.id = p.item_id
      WHERE p.id = ? AND x.reseller_id = ?`).get(id, rid);
    if (!p) throw new HttpError(404, 'Achat introuvable');
    if (getItem(db, rid, `x${p.item_id}`).stock < p.qty) throw new HttpError(409, 'Ces unités sont déjà vendues : supprimez d’abord les ventes');
    db.prepare('DELETE FROM external_purchases WHERE id = ?').run(id);
    // An item with no purchase left (and so no sale) has nothing to show.
    db.prepare('DELETE FROM external_items WHERE id = ? AND NOT EXISTS (SELECT 1 FROM external_purchases WHERE item_id = ?)').run(p.item_id, p.item_id);
    return { ok: true };
  });
}

// Every purchase, from the supplier (admin sales to him) and from other suppliers.
export function listPurchases(db, rid) {
  return db.prepare(`
    SELECT 'a' || s.id AS id, s.sold_at AS date, a.name, a.category, '${SUPPLIER}' AS supplier, 'fournisseur' AS source,
      s.qty, s.unit_price_dt AS unit_cost_dt, ROUND(s.qty * s.unit_price_dt, 3) AS total_dt, NULL AS price_eur, NULL AS rate
    FROM sales s JOIN articles a ON a.id = s.article_id WHERE s.reseller_id = :rid
    UNION ALL
    SELECT 'x' || p.id, p.bought_at, x.name, x.category, x.supplier, 'externe',
      p.qty, p.unit_cost_dt, ROUND(p.qty * p.unit_cost_dt, 3), p.price_eur, p.rate
    FROM external_purchases p JOIN external_items x ON x.id = p.item_id WHERE x.reseller_id = :rid
    ORDER BY date DESC, id DESC`).all({ rid });
}

export function listSales(db, rid) {
  return db
    .prepare(`SELECT s.*, COALESCE(a.name, x.name) AS article_name, COALESCE(a.category, x.category) AS category,
        CASE WHEN s.article_id IS NULL THEN x.supplier ELSE '${SUPPLIER}' END AS supplier,
        ROUND(s.qty * s.unit_price_dt, 3) AS total_dt,
        ROUND(s.qty * (s.unit_price_dt - s.unit_cost_dt), 3) AS profit_dt
      FROM reseller_sales s
      LEFT JOIN articles a ON a.id = s.article_id
      LEFT JOIN external_items x ON x.id = s.external_id
      WHERE s.reseller_id = ?
      ORDER BY s.sold_at DESC, s.id DESC`)
    .all(rid);
}

export function createSale(db, rid, d) {
  return tx(db, () => {
    const i = getItem(db, rid, d.article_id);
    if (i.stock < d.qty) throw new HttpError(409, `Stock insuffisant (${i.stock} disponible)`);
    const price = d.unit_price_dt ?? i.sell_dt;
    if (price == null) throw new HttpError(400, 'Saisissez un prix de vente pour cet article');
    const { external, id } = parseKey(d.article_id);
    return db
      .prepare(`INSERT INTO reseller_sales (article_id, external_id, qty, unit_price_dt, unit_cost_dt, client, sold_at, reseller_id)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now', 'localtime')), ?) RETURNING *`)
      .get(external ? null : id, external ? id : null, d.qty, price, i.buy_dt, d.client, d.sold_at ?? null, rid);
  });
}

export function deleteSale(db, rid, id) {
  const { changes } = db.prepare('DELETE FROM reseller_sales WHERE id = ? AND reseller_id = ?').run(id, rid);
  if (!changes) throw new HttpError(404, 'Vente introuvable');
  return { ok: true };
}

export function getStats(db, rid) {
  const items = listItems(db, rid);
  const priced = items.filter((i) => i.sell_dt != null);
  const bought = (source) => sum(items.filter((i) => i.source === source), (i) => i.bought * i.buy_dt);
  return {
    article_count: items.length,
    unpriced_count: items.length - priced.length,
    stock_units: sum(items, (i) => i.stock),
    stock_cost_dt: sum(items, (i) => i.stock * i.buy_dt),
    stock_value_dt: sum(priced, (i) => i.stock * i.sell_dt),
    potential_profit_dt: sum(priced, (i) => i.stock * i.margin_dt),
    priced_cost_dt: sum(priced, (i) => i.stock * i.buy_dt),
    bought_supplier_dt: bought('fournisseur'),
    bought_external_dt: bought('externe'),
    ...salesStats(db, 'reseller_sales', rid),
    by_category: byCategory(items).sort((x, y) => y.cost - x.cost),
    top: items.filter((i) => i.sold > 0).sort((x, y) => y.sold - x.sold).slice(0, 5).map(({ id, name, sold }) => ({ id, name, sold })),
    low_stock: items.filter((i) => i.stock <= 1).map(({ id, name, stock }) => ({ id, name, stock })),
  };
}
