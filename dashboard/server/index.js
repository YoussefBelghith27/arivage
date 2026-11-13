import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { openDb } from './db.js';
import * as store from './store.js';
import * as reseller from './reseller.js';
import * as auth from './auth.js';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3001;
// Locally only this PC can connect; in production the host's proxy (HTTPS) sits in front.
const HOST = process.env.HOST || (PROD ? '0.0.0.0' : '127.0.0.1');
const db = openDb();
// "Se connecter avec Google" is on only when a Google OAuth Client ID is configured.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const google = GOOGLE_CLIENT_ID && new OAuth2Client(GOOGLE_CLIENT_ID);
try {
  auth.ensureUsers(db, process.env);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const id = z.coerce.number().int().positive();
const text = (max) => z.string().trim().max(max).default('');
const money = z.number().finite().min(0).max(1e6);
const qty = z.number().int().min(1).max(1e5);
const rate = z.number().positive().max(100); // 1 € in DT

const articleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  supplier: text(80),
  category: text(40),
  price_eur: money,
  shipping_eur: money.default(0), // shipping paid per unit
  arrival: z.number().int().min(1).max(1e5).nullable().default(null), // arrival (shipment) number
  carrier: text(60), // main carrier, e.g. QA-store
  buy_price_dt: money.nullable().default(null),
  sell_price_dt: money.nullable().default(null),
  stock: z.number().int().min(0).max(1e6),
  reseller_id: id.nullable().default(null), // destination: a reseller, null = external sale
}).strict();
const saleSchema = z.object({
  article_id: id,
  qty,
  unit_price_dt: money.optional(),
  client: text(80),
  sold_at: z.iso.date().optional(),
}).strict();
const settingsSchema = z.object({
  rate_buy: rate,
  rate_sell: rate,
  rate_shipping: rate,
}).strict();
const stockSchema = z.object({ delta: z.number().int().min(-1e5).max(1e5) }).strict();
const priceSchema = z.object({ sell_price_dt: money.nullable() }).strict();
const itemKey = z.string().regex(/^[ax]\d+$/);
const resellerSaleSchema = saleSchema.extend({ article_id: itemKey });
const purchaseSchema = z.object({
  item_id: id.optional(), // more units of an item he already buys elsewhere; otherwise a new item
  name: z.string().trim().max(120).optional(),
  supplier: text(80),
  category: text(40),
  qty,
  unit_cost_dt: money.optional(),
  unit_price_eur: money.optional(), // converted with eur_rate (default: his own purchase rate)
  eur_rate: rate.optional(),
  bought_at: z.iso.date().optional(),
}).strict().refine((d) => (d.unit_cost_dt == null) !== (d.unit_price_eur == null), { message: 'Prix en DT ou en €, un seul' });
const resellerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  username: z.string().regex(/^[a-z0-9._-]{3,30}$/),
  password: z.string().min(10).max(200), // login accepts up to 200
}).strict();
const loginSchema =z.object({ username: z.string().trim().toLowerCase().max(40), password: z.string().max(200) }).strict();

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', PROD ? 1 : false);
// Google's sign-in button loads from accounts.google.com and needs popups and the page origin as referrer.
// HSTS and https upgrades only where the app is really served over https.
const GSI = 'https://accounts.google.com/gsi/';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", `${GSI}client`],
      frameSrc: [GSI],
      connectSrc: ["'self'", GSI],
      ...(PROD ? {} : { upgradeInsecureRequests: null }),
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  ...(PROD ? {} : { strictTransportSecurity: false }),
}));
app.use(express.json({ limit: '10kb' }));

// Writes must come from this site's own pages (the session cookie is also SameSite=Strict).
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || !req.headers.origin) return next();
  let host = '';
  try { host = new URL(req.headers.origin).host; } catch {}
  return host === req.headers.host ? next() : next(new store.HttpError(403, 'Origine refusée'));
});

const COOKIE = 'sid';
const readToken = (req) => (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('='))
  .find(([k]) => k === COOKIE)?.[1];
app.use('/api', (req, res, next) => {
  req.user = auth.sessionUser(db, readToken(req));
  next();
});

const handle = (fn) => (req, res, next) => {
  try {
    res.json(fn(req, res));
  } catch (e) {
    next(e);
  }
};
const requireRole = (role) => (req, res, next) => {
  if (!req.user) return next(new store.HttpError(401, 'Connexion requise'));
  if (req.user.role !== role) return next(new store.HttpError(403, 'Accès refusé'));
  next();
};

const startSession = (res, { token, user, maxAge }) => {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge, path: '/' });
  return user;
};

app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));
app.post('/api/login', handle((req, res) => {
  auth.checkLoginRate(req.ip);
  const { username, password } = loginSchema.parse(req.body);
  return startSession(res, auth.login(db, username, password));
}));
// The browser gets a signed ID token from Google; we check its signature, audience and expiry with Google's library.
app.post('/api/login/google', async (req, res, next) => {
  try {
    if (!google) throw new store.HttpError(404, 'Connexion Google non configurée');
    auth.checkLoginRate(req.ip);
    const { credential } = z.object({ credential: z.string().min(1).max(4096) }).strict().parse(req.body);
    const payload = await google.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID })
      .then((t) => t.getPayload(), () => null);
    if (!payload?.email || !payload.email_verified) throw new store.HttpError(401, 'Connexion Google invalide');
    res.json(startSession(res, auth.loginByEmail(db, payload.email)));
  } catch (e) {
    next(e);
  }
});
app.post('/api/logout', handle((req, res) => {
  auth.logout(db, readToken(req));
  res.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
}));
app.get('/api/me', handle((req) => {
  if (!req.user) throw new store.HttpError(401, 'Connexion requise');
  return req.user;
}));

// Reseller: stock from the admin's sales to him plus his purchases elsewhere; he sets his own sale prices.
// Every call is scoped to the logged-in reseller (req.user.id), never to an id sent by the client.
const r = express.Router();
r.use(requireRole('reseller'));
r.get('/items', handle((req) => reseller.listItems(db, req.user.id)));
r.put('/items/:key/price', handle((req) => reseller.setPrice(db, req.user.id, itemKey.parse(req.params.key), priceSchema.parse(req.body).sell_price_dt)));
// His own rates (the supplier's sale rates). The supplier's purchase rate is never sent to him.
r.get('/rate', handle((req) => ({ rate: reseller.getRate(db, req.user.id), rates: reseller.eurRates(db, req.user.id) })));
r.put('/rate', handle((req) => reseller.setRate(db, req.user.id, z.object({ rate }).strict().parse(req.body).rate)));
r.get('/purchases', handle((req) => reseller.listPurchases(db, req.user.id)));
r.post('/purchases', handle((req) => reseller.addPurchase(db, req.user.id, purchaseSchema.parse(req.body))));
r.delete('/purchases/:id', handle((req) => reseller.deletePurchase(db, req.user.id, id.parse(req.params.id))));
r.get('/sales', handle((req) => reseller.listSales(db, req.user.id)));
r.post('/sales', handle((req) => reseller.createSale(db, req.user.id, resellerSaleSchema.parse(req.body))));
r.delete('/sales/:id', handle((req) => reseller.deleteSale(db, req.user.id, id.parse(req.params.id))));
r.get('/stats', handle((req) => reseller.getStats(db, req.user.id)));
app.use('/api/reseller', r);

// Admin (Youssef, supplier): articles, stock, his sales (to resellers or other clients), exchange rates, resellers.
const a = express.Router();
a.use(requireRole('admin'));
a.get('/settings', handle(() => store.getSettings(db)));
a.put('/settings', handle((req) => store.updateSettings(db, settingsSchema.parse(req.body))));
a.get('/articles', handle(() => store.listArticles(db)));
a.post('/articles', handle((req) => store.createArticle(db, articleSchema.parse(req.body))));
a.put('/articles/:id', handle((req) => store.updateArticle(db, id.parse(req.params.id), articleSchema.parse(req.body))));
a.patch('/articles/:id/stock', handle((req) => store.adjustStock(db, id.parse(req.params.id), stockSchema.parse(req.body).delta)));
a.delete('/articles/:id', handle((req) => store.deleteArticle(db, id.parse(req.params.id))));
a.get('/sales', handle(() => store.listSales(db)));
// reseller_id: the reseller who buys (his stock), null = another client.
const adminSaleSchema = saleSchema.extend({ reseller_id: z.number().int().positive().nullable().default(null) });
a.post('/sales', handle((req) => store.createSale(db, adminSaleSchema.parse(req.body))));
// Edit: every field but the article, all required.
const saleEditSchema = adminSaleSchema.omit({ article_id: true }).required();
a.put('/sales/:id', handle((req) => store.updateSale(db, id.parse(req.params.id), saleEditSchema.parse(req.body))));
a.delete('/sales/:id', handle((req) => store.deleteSale(db, id.parse(req.params.id))));
a.get('/stats', handle(() => store.getStats(db)));
a.get('/resellers', handle(() => auth.listResellers(db)));
a.post('/resellers', handle((req) => auth.createReseller(db, resellerSchema.parse(req.body))));
// Read-only follow-up of one reseller: all his purchases (from the admin and elsewhere), sales and totals.
a.get('/resellers/:id/follow', handle((req) => {
  const rid = id.parse(req.params.id);
  if (!auth.listResellers(db).some((u) => u.id === rid)) throw new store.HttpError(404, 'Revendeur introuvable');
  return { stats: reseller.getStats(db, rid), purchases: reseller.listPurchases(db, rid), sales: reseller.listSales(db, rid) };
}));
app.use('/api', a);

const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(`${dist}/index.html`));
}

app.use((err, req, res, next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Données invalides', fields: err.issues.map((i) => i.path.join('.')) });
  if (err instanceof store.HttpError) {
    // Failed logins, lockouts, refused access and calls without a session. Never the body: it may hold a password.
    // /api/me is skipped: every logged-out page load asks it.
    if (err.status === 403 || err.status === 429 || (err.status === 401 && req.originalUrl !== '/api/me')) {
      console.warn(`[security] ${new Date().toISOString()} ${err.status} ${req.method} ${req.originalUrl} ip=${req.ip} user=${req.user?.username ?? '-'}`);
    }
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Requête invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, HOST, () => console.log(`API prête sur http://${HOST}:${PORT}`));
}
