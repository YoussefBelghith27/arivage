# Arivage · Stock & Ventes

Accounts:
- **youssef**: supplier (admin). Stock, prices €/DT, sales to resellers or other clients, a read-only follow-up of each reseller, and "Ajouter un revendeur" to create reseller accounts.
- **resellers** (first one: **aziz**): each one's stock is Youssef's sales to him (cost = Youssef's sale price) plus his own purchases from other suppliers. He sets his own sale prices and records his sales. Each reseller sees only his own data.

Needs Node.js 22.9 or newer (built-in SQLite).

## Local

```
npm install
cp .env.example .env      # then set ADMIN_PASSWORD and RESELLER_PASSWORD (10+ characters)
npm run dev               # http://localhost:5173
npm test
```

The passwords in `.env` are only used to create the accounts on the first start.
Change a password later with `npm run set-password -- aziz <new password>`.
The data lives in `server/data/stock.db`. Copy that file to back it up.

## Online (so Aziz can connect from anywhere)

Any Node host with a **persistent disk** works (for example Render with a Disk, or Railway with a Volume):

- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Environment variables:
  - `NODE_ENV=production` (secure cookie, HTTPS headers, listens on 0.0.0.0)
  - `ADMIN_PASSWORD`, `RESELLER_PASSWORD` (first start only)
  - `DB_PATH=/data/stock.db` (a path on the persistent disk, or the data is lost on each deploy)
- Serve it over **HTTPS** only (the hosts above do it by default).
- To keep your current data, upload your local `server/data/stock.db` to the disk before the first start.
