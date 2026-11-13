import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import * as store from './store.js';
import * as reseller from './reseller.js';
import * as auth from './auth.js';

const db = openDb(':memory:');
auth.ensureUsers(db, { ADMIN_PASSWORD: 'admin-pass-123', RESELLER_PASSWORD: 'aziz-pass-123' });
const A = db.prepare("SELECT id FROM users WHERE username = 'aziz'").get().id;
const taurin = () => store.listArticles(db).find((a) => a.name === 'OSTRO Taurin 300 g');
const item = (id) => reseller.listItems(db, A).find((i) => i.id === `a${id}`);

test('admin sales become reseller stock at the admin sale price', () => {
  assert.equal(reseller.listItems(db, A).length, 0);
  const a = taurin();
  store.createSale(db, { article_id: a.id, qty: 1, unit_price_dt: 40, client: '', reseller_id: A });
  const i = item(a.id);
  assert.equal(i.stock, 1);
  assert.equal(i.buy_dt, 40);
  assert.equal(i.sell_dt, null); // reseller sets it himself
});

test('reseller cannot sell without a price or beyond stock', () => {
  const { id } = taurin();
  assert.throws(() => reseller.createSale(db, A, { article_id: `a${id}`, qty: 1, client: '' }), { status: 400 });
  reseller.setPrice(db, A, `a${id}`, 55);
  assert.throws(() => reseller.createSale(db, A, { article_id: `a${id}`, qty: 2, client: '' }), { status: 409 });
  const s = reseller.createSale(db, A, { article_id: `a${id}`, qty: 1, client: '' });
  assert.equal(s.unit_price_dt, 55);
  assert.equal(s.unit_cost_dt, 40);
  assert.equal(reseller.getStats(db, A).profit_dt, 15);
  assert.equal(item(id).stock, 0);
});

test('admin cannot delete a sale the reseller already resold', () => {
  const sale = store.listSales(db).find((s) => s.article_id === taurin().id);
  assert.throws(() => store.deleteSale(db, sale.id), { status: 409 });
});

test('passwords are hashed and checked', () => {
  assert.throws(() => auth.login(db, 'aziz', 'wrong-password'), { status: 401 });
  const { token, user } = auth.login(db, 'aziz', 'aziz-pass-123');
  assert.equal(user.role, 'reseller');
  assert.equal(auth.sessionUser(db, token).name, 'Aziz Jazi');
  assert.ok(!db.prepare('SELECT password_hash FROM users').all().some((u) => u.password_hash.includes('aziz-pass')));
  auth.logout(db, token);
  assert.equal(auth.sessionUser(db, token), null);
});

test('purchases from other suppliers join stock, sales and the purchase history', () => {
  const x = reseller.addPurchase(db, A, { name: 'Whey 2 kg', supplier: 'Autre', category: 'Protéine', qty: 3, unit_cost_dt: 100 });
  assert.equal(x.id.startsWith('x'), true);
  reseller.addPurchase(db, A, { item_id: Number(x.id.slice(1)), supplier: '', category: '', qty: 1, unit_cost_dt: 140 });
  const item = reseller.listItems(db, A).find((i) => i.id === x.id);
  assert.equal(item.stock, 4);
  assert.equal(item.buy_dt, 110); // (3×100 + 140) / 4
  reseller.setPrice(db, A, x.id, 150);
  reseller.createSale(db, A, { article_id: x.id, qty: 3, client: '' });
  const first = reseller.listPurchases(db, A).find((p) => p.source === 'externe' && p.qty === 3);
  assert.throws(() => reseller.deletePurchase(db, A, Number(first.id.slice(1))), { status: 409 }); // would leave stock below 0
  assert.equal(reseller.getStats(db, A).bought_external_dt, 440);
  assert.equal(reseller.listSales(db, A).find((s) => s.external_id).supplier, 'Autre');
});

test('Google sign-in only lets in a linked email', () => {
  assert.throws(() => auth.loginByEmail(db, 'someone@gmail.com'), { status: 403 });
  auth.setEmail(db, 'aziz', 'Aziz.Jazi@Gmail.com');
  assert.equal(auth.loginByEmail(db, 'aziz.jazi@gmail.com').user.username, 'aziz');
});

test('a purchase in € uses his own editable rate, never the supplier purchase rate', () => {
  assert.equal(reseller.setRate(db, A, 6.22).rate, 6.22);
  const x = reseller.addPurchase(db, A, { name: 'BCAA', supplier: 'Shop', category: '', qty: 2, unit_price_eur: 10 });
  assert.equal(x.buy_dt, 62.2);
  const y = reseller.addPurchase(db, A, { name: 'EAA', supplier: 'Shop', category: '', qty: 1, unit_price_eur: 10, eur_rate: 6 });
  assert.equal(y.buy_dt, 60);
  reseller.setRate(db, A, 6.5);
  const p = reseller.listPurchases(db, A).find((q) => q.name === 'BCAA');
  assert.equal(p.unit_cost_dt, 62.2); // past purchases keep their rate
  assert.equal(p.rate, 6.22);
  assert.ok(!reseller.eurRates(db, A).includes(store.getSettings(db).rate_buy));
});

test('external admin sales stay out of the reseller stock and purchases', () => {
  const a = taurin();
  const before = { items: reseller.listItems(db, A).length, purchases: reseller.listPurchases(db, A).length, stock: item(a.id).stock };
  store.adjustStock(db, a.id, 1); // one unit to sell externally
  store.createSale(db, { article_id: a.id, qty: 1, unit_price_dt: 50, client: 'Client X', reseller_id: null });
  assert.equal(reseller.listItems(db, A).length, before.items);
  assert.equal(reseller.listPurchases(db, A).length, before.purchases);
  assert.equal(item(a.id).stock, before.stock);
  const ext = store.listSales(db).find((s) => s.reseller_id === null);
  assert.equal(ext.client, 'Client X');
  // Aziz resold his Taurin unit: his own purchase stays undeletable even with an external sale on the same article.
  const toAziz = store.listSales(db).find((s) => s.article_id === a.id && s.reseller_id === A);
  assert.throws(() => store.deleteSale(db, toAziz.id), { status: 409 });
  store.deleteSale(db, ext.id); // external sale: no reseller check
});

test('two resellers never see or change each other’s rows', () => {
  const B = auth.createReseller(db, { name: 'Bilel Ben', username: 'bilel', password: 'bilel-pass-123' }).id;
  const kreatin = store.listArticles(db).find((a) => a.name === 'OSTRO Kreatin-Monohydrat 1000 g');
  const before = { items: reseller.listItems(db, A), purchases: reseller.listPurchases(db, A), sales: reseller.listSales(db, A), stats: reseller.getStats(db, A), rate: reseller.getRate(db, A) };
  const toB = store.createSale(db, { article_id: kreatin.id, qty: 1, unit_price_dt: 70, client: '', reseller_id: B });
  assert.equal(toB.reseller_id, B);
  assert.equal(store.listSales(db).find((s) => s.id === toB.id).reseller_name, 'Bilel Ben');

  // B's stock is only the admin sale to B.
  assert.deepEqual(reseller.listItems(db, B).map((i) => i.id), [`a${kreatin.id}`]);
  assert.deepEqual(reseller.listPurchases(db, B).map((p) => p.id), [`a${toB.id}`]);
  reseller.setPrice(db, B, `a${kreatin.id}`, 90);
  const bx = reseller.addPurchase(db, B, { name: 'Whey B', supplier: 'Autre', category: '', qty: 2, unit_cost_dt: 10 });
  reseller.setPrice(db, B, bx.id, 20);
  const bSale = reseller.createSale(db, B, { article_id: `a${kreatin.id}`, qty: 1, client: '' });
  reseller.setRate(db, B, 7);
  assert.equal(reseller.getStats(db, B).sales_count, 1);
  assert.equal(reseller.getStats(db, B).profit_dt, 20);
  assert.equal(reseller.getRate(db, B), 7);

  // A is untouched by everything B did.
  assert.deepEqual(reseller.listItems(db, A), before.items);
  assert.deepEqual(reseller.listPurchases(db, A), before.purchases);
  assert.deepEqual(reseller.listSales(db, A), before.sales);
  assert.deepEqual(reseller.getStats(db, A), before.stats);
  assert.equal(reseller.getRate(db, A), before.rate);
  assert.ok(reseller.listSales(db, B).every((s) => s.id === bSale.id));

  // B acting on A's rows by id: 404, A's rows intact.
  const aSale = before.sales[0];
  const aItem = before.items.find((i) => i.source === 'externe');
  const aPurchase = before.purchases.find((p) => p.source === 'externe');
  assert.throws(() => reseller.deleteSale(db, B, aSale.id), { status: 404 });
  assert.throws(() => reseller.deletePurchase(db, B, Number(aPurchase.id.slice(1))), { status: 404 });
  assert.throws(() => reseller.setPrice(db, B, aItem.id, 1), { status: 404 });
  assert.throws(() => reseller.setPrice(db, B, `a${taurin().id}`, 1), { status: 404 });
  assert.throws(() => reseller.addPurchase(db, B, { item_id: Number(aItem.id.slice(1)), supplier: '', category: '', qty: 1, unit_cost_dt: 1 }), { status: 404 });
  assert.throws(() => reseller.createSale(db, B, { article_id: aItem.id, qty: 1, client: '' }), { status: 404 });
  assert.throws(() => reseller.deleteSale(db, A, bSale.id), { status: 404 });
  assert.deepEqual(reseller.listItems(db, A), before.items);
  assert.deepEqual(reseller.listSales(db, A), before.sales);
  assert.deepEqual(reseller.listPurchases(db, A), before.purchases);

  // The admin cannot take back units B resold; the message names B.
  assert.throws(() => store.deleteSale(db, toB.id), { status: 409, message: /Bilel Ben/ });
  // An admin sale must go to an existing reseller.
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
  assert.throws(() => store.createSale(db, { article_id: kreatin.id, qty: 1, client: '', reseller_id: admin }), { status: 404 });
  assert.throws(() => store.createSale(db, { article_id: kreatin.id, qty: 1, client: '', reseller_id: 9999 }), { status: 404 });
});

test('editing an admin sale adjusts stock, the buyer and guards resold units', () => {
  const B = db.prepare("SELECT id FROM users WHERE username = 'bilel'").get().id;
  const art = store.createArticle(db, { name: 'Edit Test', supplier: '', category: '', price_eur: 10, buy_price_dt: 20, sell_price_dt: 30, stock: 5 });
  const stock = () => store.listArticles(db).find((x) => x.id === art.id).stock;
  const edit = (s, d) => store.updateSale(db, s.id, { qty: s.qty, unit_price_dt: s.unit_price_dt, client: s.client, sold_at: s.sold_at, reseller_id: s.reseller_id, ...d });

  // Quantity both ways; the cost stays the one at sale time.
  const s = store.createSale(db, { article_id: art.id, qty: 2, client: 'Ali', reseller_id: null });
  assert.equal(stock(), 3);
  store.updateArticle(db, art.id, { ...art, buy_price_dt: 99, stock: 3 });
  const up = edit(s, { qty: 4, unit_price_dt: 35, client: 'Ali B', sold_at: '2026-01-02' });
  assert.deepEqual([up.qty, up.unit_price_dt, up.client, up.sold_at, up.unit_cost_dt], [4, 35, 'Ali B', '2026-01-02', 20]);
  assert.equal(stock(), 1);
  edit(up, { qty: 1 });
  assert.equal(stock(), 4);
  assert.throws(() => edit(up, { qty: 6 }), { status: 409, message: 'Stock insuffisant (5 disponible)' });
  assert.equal(stock(), 4);
  assert.throws(() => store.updateSale(db, 9999, { qty: 1, unit_price_dt: 1, client: '', sold_at: '2026-01-01', reseller_id: null }), { status: 404 });
  assert.throws(() => edit(up, { reseller_id: 9999 }), { status: 404 });

  // Moving an un-resold sale: A → B → external moves the item between their stocks.
  const toA = store.createSale(db, { article_id: art.id, qty: 2, client: '', reseller_id: A });
  assert.equal(item(art.id).stock, 2);
  edit(toA, { reseller_id: B });
  assert.equal(item(art.id), undefined);
  assert.equal(reseller.listItems(db, B).find((i) => i.id === `a${art.id}`).stock, 2);
  edit(toA, { reseller_id: null, client: 'Client Y' });
  assert.equal(reseller.listItems(db, B).find((i) => i.id === `a${art.id}`), undefined);

  // Once A resold both units: no reducing below them, no moving away.
  const back = edit(toA, { reseller_id: A });
  reseller.setPrice(db, A, `a${art.id}`, 50);
  reseller.createSale(db, A, { article_id: `a${art.id}`, qty: 2, client: '' });
  assert.throws(() => edit(back, { qty: 1 }), { status: 409, message: /Aziz Jazi a déjà revendu/ });
  assert.throws(() => edit(back, { reseller_id: B }), { status: 409 });
  assert.throws(() => edit(back, { reseller_id: null, client: 'Z' }), { status: 409 });
  assert.equal(edit(back, { unit_price_dt: 31 }).unit_price_dt, 31); // same buyer and qty: fine
  assert.equal(item(art.id).stock, 0);
});
