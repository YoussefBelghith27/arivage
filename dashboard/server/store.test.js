import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import * as store from './store.js';

const db = openDb(':memory:');
const creatine = () => store.listArticles(db).find((a) => a.name === 'OSTRO Kreatin-Monohydrat 1000 g');

test('seed loads screenshot articles with default rates', () => {
  assert.equal(store.listArticles(db).length, 18);
  const a = creatine();
  assert.equal(a.price_eur, 11.62);
  assert.equal(a.stock, 3);
  assert.equal(a.buy_dt, 52.29); // 11.62 × 4.5
  assert.equal(a.sell_dt, 72.276); // 11.62 × 6.22
  assert.equal(store.getStats(db).stock_eur, 258.72); // 132.27 + 126.45
});

test('sale decrements stock, snapshots prices; deleting it restores stock', () => {
  const sale = store.createSale(db, { article_id: creatine().id, qty: 2, client: '' });
  assert.equal(creatine().stock, 1);
  assert.equal(sale.unit_price_dt, 72.276);
  assert.equal(sale.unit_cost_dt, 52.29);
  assert.equal(store.getStats(db).profit_dt, 39.972); // 2 × (72.276 − 52.29)
  store.deleteSale(db, sale.id);
  assert.equal(creatine().stock, 3);
});

test('overselling and negative stock are rejected', () => {
  assert.throws(() => store.createSale(db, { article_id: creatine().id, qty: 4, client: '' }), { status: 409 });
  assert.throws(() => store.adjustStock(db, creatine().id, -4), { status: 409 });
  assert.equal(creatine().stock, 3);
});

test('article with sales cannot be deleted; sell price override wins', () => {
  const a = creatine();
  store.createSale(db, { article_id: a.id, qty: 1, unit_price_dt: 80, client: 'Ali' });
  assert.throws(() => store.deleteArticle(db, a.id), { status: 409 });
  store.updateArticle(db, a.id, { ...a, sell_price_dt: 75 });
  assert.equal(creatine().sell_dt, 75);
});

test('fixed purchase price wins; empty falls back to € × rate', () => {
  const a = creatine();
  store.updateArticle(db, a.id, { ...a, buy_price_dt: 50 });
  assert.equal(creatine().buy_dt, 50);
  assert.equal(creatine().margin_dt, 25); // 75 − 50
  store.updateArticle(db, a.id, { ...a, buy_price_dt: null });
  assert.equal(creatine().buy_dt, 52.29);
});

test('changing rates reprices articles', () => {
  store.updateSettings(db, { rate_buy: 5, rate_sell: 7, rate_shipping: 5 });
  const a = store.listArticles(db).find((x) => x.name === 'OSTRO Taurin 300 g');
  assert.equal(a.buy_dt, 24.35);
  assert.equal(a.sell_dt, 34.09);
});

test('arrival number and main carrier are saved with the article', () => {
  const a = store.createArticle(db, { name: 'OSTRO Creatine 634 g', supplier: 'OSTRO', category: 'Créatine', price_eur: 10, buy_price_dt: null, sell_price_dt: null, stock: 2, arrival: 3, carrier: 'QA-store' });
  assert.equal(a.arrival, 3);
  assert.equal(a.carrier, 'QA-store');
  const b = store.updateArticle(db, a.id, { ...a, arrival: null, carrier: '' });
  assert.equal(b.arrival, null);
});

test('an article keeps its destination: a reseller, or null for external sale', () => {
  const rid = db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('jazi', 'Aziz Jazi', 'reseller', 'x') RETURNING id").get().id;
  const admin = db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('boss', 'Boss', 'admin', 'x') RETURNING id").get().id;
  const base = { name: 'Dest', supplier: '', category: '', price_eur: 1, buy_price_dt: null, sell_price_dt: null, stock: 1 };
  const a = store.createArticle(db, { ...base, reseller_id: rid });
  assert.equal(a.reseller_id, rid);
  assert.equal(store.listArticles(db).find((x) => x.id === a.id).reseller_name, 'Aziz Jazi');
  assert.equal(store.updateArticle(db, a.id, { ...base, reseller_id: null }).reseller_id, null);
  assert.throws(() => store.createArticle(db, { ...base, reseller_id: admin }), { status: 404 });
  assert.throws(() => store.updateArticle(db, a.id, { ...base, reseller_id: 999 }), { status: 404 });
});

test('shipping per unit: cost at the purchase rate, billed at the shipping rate; fixed prices still win', () => {
  const db = openDb(':memory:');
  const s = store.updateSettings(db, { rate_buy: 4.5, rate_sell: 6.25, rate_shipping: 5 });
  assert.equal(s.rate_shipping, 5);
  const base = { name: 'Kreatin 1 kg', supplier: '', category: '', price_eur: 11.62, buy_price_dt: null, sell_price_dt: null, stock: 2 };
  const a = store.createArticle(db, { ...base, shipping_eur: 5 });
  assert.equal(a.shipping_eur, 5);
  assert.equal(a.buy_dt, 74.79); // (11.62 + 5) × 4.5
  assert.equal(a.sell_dt, 97.625); // 11.62 × 6.25 + 5 × 5
  assert.equal(a.shipping_dt, 25);
  assert.equal(a.shipping_cost_dt, 22.5);
  const fixed = store.updateArticle(db, a.id, { ...base, shipping_eur: 5, buy_price_dt: 60, sell_price_dt: 90 });
  assert.equal(fixed.buy_dt, 60);
  assert.equal(fixed.sell_dt, 90);
  const none = store.createArticle(db, base); // no shipping given: old prices
  assert.equal(none.shipping_eur, 0);
  assert.equal(none.buy_dt, 52.29);
  assert.equal(none.sell_dt, 72.625);
});
