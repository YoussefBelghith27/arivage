import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './store.js';

const SESSION_DAYS = 30;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = stored.split('$');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'hex'), 64), Buffer.from(hash, 'hex'));
}

// Used when the username is unknown, so a wrong name takes as long as a wrong password.
// Made on first use: Workers refuse random values at startup (global scope).
let dummyHash;

export function setPassword(db, username, password) {
  const { changes } = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword(password), username);
  if (!changes) throw new Error(`Utilisateur inconnu : ${username}`);
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
}

// Creates the two accounts on first start. Passwords come from the environment, never from code.
export function ensureUsers(db, env) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const accounts = [
    ['youssef', 'Youssef Belghith', 'admin', env.ADMIN_PASSWORD],
    ['aziz', 'Aziz Jazi', 'reseller', env.RESELLER_PASSWORD],
  ];
  if (accounts.some(([, , , password]) => !password || password.length < 10)) {
    throw new Error('ADMIN_PASSWORD et RESELLER_PASSWORD (10 caractères minimum) sont requis au premier démarrage.');
  }
  const insert = db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)');
  for (const [username, name, role, password] of accounts) insert.run(username, name, role, hashPassword(password));
}

export const listResellers = (db) => db.prepare("SELECT id, name, username FROM users WHERE role = 'reseller' ORDER BY id").all();

// The admin creates a reseller account, usable at once.
export function createReseller(db, { name, username, password }) {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Identifiant déjà utilisé');
  return db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, 'reseller', ?) RETURNING id, name, username")
    .get(username, name, hashPassword(password));
}

// Returns { token, user, maxAge } or throws 401. The token goes in a cookie; only its hash is stored.
export function login(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = verifyPassword(password, user?.password_hash ?? (dummyHash ??= hashPassword(randomBytes(16).toString('hex'))));
  if (!user || !ok) throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
  return createSession(db, user);
}

// For a Google-verified email: only addresses linked to an account get in.
export function loginByEmail(db, email) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) throw new HttpError(403, 'Ce compte Google n’a pas accès à l’application');
  return createSession(db, user);
}

export function setEmail(db, username, email) {
  const { changes } = db.prepare('UPDATE users SET email = ? WHERE username = ?').run(email ? email.toLowerCase() : null, username);
  if (!changes) throw new Error(`Utilisateur inconnu : ${username}`);
}

function createSession(db, user) {
  const token = randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 86400e3;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), user.id, Date.now() + maxAge);
  return { token, user: publicUser(user), maxAge };
}

export function sessionUser(db, token) {
  if (!token) return null;
  const user = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now());
  return user ? publicUser(user) : null;
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

const publicUser = ({ id, username, name, role }) => ({ id, username, name, role });

// shortcut: in-memory, per process; move to the database if the app ever runs on several instances.
const attempts = new Map();
// A short test window (LOGIN_WINDOW_MS=10000) left in a production .env must not weaken the lockout.
const minWindow = () => (process.env.NODE_ENV === 'production' ? 15 * 60e3 : 0);
export function checkLoginRate(ip, max = 5, windowMs = Math.max(Number(process.env.LOGIN_WINDOW_MS) || 15 * 60e3, minWindow())) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) {
    if (attempts.size > 10000) attempts.clear(); // bound memory under a flood of distinct IPs
    attempts.set(ip, { count: 1, reset: now + windowMs });
    return;
  }
  if (++a.count > max) {
    const s = Math.ceil((a.reset - now) / 1e3);
    throw new HttpError(429, `Trop de tentatives. Réessayez dans ${s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`}.`);
  }
}
