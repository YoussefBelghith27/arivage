// Usage: npm run set-email -- <youssef|aziz> <adresse@gmail.com>   (or "none" to unlink)
import { openDb } from './db.js';
import { setEmail } from './auth.js';

const [username, email] = process.argv.slice(2);
if (!username || !email || (email !== 'none' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  console.error('Usage : npm run set-email -- <youssef|aziz> <adresse@gmail.com | none>');
  process.exit(1);
}
const db = openDb();
setEmail(db, username, email === 'none' ? null : email);
console.log(email === 'none' ? `Connexion Google retirée pour ${username}.` : `${username} peut se connecter avec Google : ${email}`);
