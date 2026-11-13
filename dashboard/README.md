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

## Online on Cloudflare (Workers + Durable Object)

The `cloudflare` branch runs the same app on Cloudflare: the React build is served as static assets, and `/api/*`
goes to one SQLite-backed Durable Object that runs the same Express routes (`server/worker.js`, `wrangler.jsonc`).
The data lives in that Durable Object (no disk to manage). The free Workers plan (100,000 requests a day) should be enough for this app.

### 1. Put the code in a private GitHub repo

The repo root is the folder above `dashboard/`. On github.com: **New repository**, choose **Private**, no README.
This repo already has an `origin` remote: if that repo is private, just push to it. Otherwise:

```
git remote add cloud https://github.com/<you>/<new-private-repo>.git
git push cloud cloudflare
```

### 2. First deploy from this PC

```
cd dashboard
npm install
npx wrangler login                     # opens the browser, log in to Cloudflare
npx wrangler secret put ADMIN_PASSWORD     # 10+ characters, typed at the prompt
npx wrangler secret put RESELLER_PASSWORD  # 10+ characters
npm run deploy                         # vite build && wrangler deploy; prints https://arivage-stock.<you>.workers.dev
```

On the first deploy, `wrangler secret put` may offer to create the Worker first: answer yes.
The secrets are only used to create the two accounts on the very first request, like `.env` locally.
Never put them in `wrangler.jsonc` or in git. Optional "Se connecter avec Google": `npx wrangler secret put GOOGLE_CLIENT_ID`
and add the workers.dev URL to the Client ID's authorized JavaScript origins (see the limits below).

### 3. Copy the local data, once

Do this right after the first deploy, before using the online app (the import is refused once a sale, a purchase,
a price or a new reseller exists online, and after the first import). It replaces the online articles and accounts
with the local ones, so afterwards **your local passwords apply** online.

```
cd dashboard
CLOUD_ADMIN_PASSWORD='<the ADMIN_PASSWORD secret>' npm run import-to-cloud -- https://arivage-stock.<you>.workers.dev
```

(PowerShell: `$env:CLOUD_ADMIN_PASSWORD='...'; npm run import-to-cloud -- https://...`.)
It opens `server/data/stock.db` read-only (another path can follow the URL) and prints the number of rows copied.

### 4. Optional: deploy on every push (Workers Builds)

Cloudflare dashboard → **Workers & Pages** → `arivage-stock` → **Settings** → **Builds** → **Connect**, pick the GitHub
repo, then set: branch `cloudflare`, root directory `dashboard`, build command `npm install && npx vite build`,
deploy command `npx wrangler deploy`. The Worker name must stay `arivage-stock` (the `name` in `wrangler.jsonc`).

### Run the Cloudflare version locally

Create `dashboard/.dev.vars` (gitignored, never commit it) with test passwords:

```
ADMIN_PASSWORD=some-test-password
RESELLER_PASSWORD=another-test-password
```

then `npm run dev:cf` (http://localhost:8787; local data in `.wrangler/`, gitignored). `npm run dev` (Node) still works.

### Limits

- Backups: the data is in the Durable Object, not in a file. Cloudflare can restore a SQLite Durable Object to any point
  in the last 30 days (point-in-time recovery), but that needs a small code change to trigger; there is no export route yet.
- The login lockout (5 tries / 15 min) is kept in the Durable Object's memory: it resets if Cloudflare restarts it.
- Google sign-in (`google-auth-library`) is bundled but was not tested on Workers (no Client ID here). Without
  `GOOGLE_CLIENT_ID` the button is hidden and `/api/login/google` answers 404, as before.
- The security headers of the static files come from `public/_headers`; keep it in sync with helmet in `server/index.js`.
