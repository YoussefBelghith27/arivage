// Usage: npm run set-password -- <youssef|aziz> <new password>
import { openDb } from './db.js';
import { setPassword } from './auth.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 10) {
  console.error('Usage : npm run set-password -- <youssef|aziz> <mot de passe de 10 caractères minimum>');
  process.exit(1);
}
const db = openDb();
setPassword(db, username, password);
console.log(`Mot de passe de ${username} changé. Ses sessions ouvertes sont fermées.`);
