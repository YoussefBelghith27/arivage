# Security report — 2026-11-08 (second pass, after multi-reseller)

Scope: `dashboard/` (Express + node:sqlite API, React 18/Vite front) and `azlabs-site/` (one static `index.html`, no backend). Re-verified every item after commit 92420f9 (several isolated resellers, admin creates reseller accounts). Baseline tests: 25 passing.

## Summary
Fixed 1 · Already OK 23 · Open for you 4 · N/A 3 (dashboard, 27 items). Tests: 28 passing.
No secret was ever committed; the real database was never opened (tests use `openDb(':memory:')`).

## Fixed
| # | Item | Change (file) | Verified by |
|---|------|---------------|-------------|
| 8 | Log suspicious activity | `server/index.js` error handler: 401s on protected routes are now logged too (before: only 401 on `/api/login*`). `GET /api/me` is skipped, it is the logged-out page-load probe. Still never the body. Commit d597ea3. | Test *calls without a session are logged, except the logged-out /api/me probe* (fails without the change). |

## Already OK
| # | Item | Evidence |
|---|------|----------|
| 1 | Authentication | `index.js:121-125` `requireRole` on both routers; only `config`, `login`, `login/google`, `logout`, `me` are outside. Sessions expire after 30 days (`auth.js` `expires_at > ?`), logout deletes the row. One generic login error. Tests *routes are closed without login and by role*, *passwords are hashed and checked*. |
| 2 | Hide API keys | `src/` reads no env (`grep import.meta.env\|VITE_` → none). Fresh build (`vite build --outDir <temp>`): 0 matches for passwords/Google id/private keys. `GOOGLE_CLIENT_ID` is public by design. |
| 3 | Lock the database | SQLite file in `server/data/` (outside `dist/`, gitignored with its backups), server binds `127.0.0.1` outside production. Every reseller query takes `rid` from the session (`index.js:166-177`). Store test *two resellers never see or change each other’s rows*. |
| 4 | Enforce HTTPS | Production: HSTS (helmet), `secure` cookie, `trust proxy 1` (`index.js:79,94,128`). The proxy itself is yours (Open). |
| 5 | Hash passwords | scrypt + random salt, `timingSafeEqual`, dummy hash for unknown users (`auth.js`). Minimum 10 chars on every path that sets one: `ensureUsers`, `set-password.js`, `resellerSchema` (`index.js:73`). Test *passwords are hashed and checked*; reseller creation with a short password → 400. |
| 6 | Server-side validation | zod `.strict()` on every body and param (verified `.extend()`/`.refine()` keep strictness: unknown keys → fail). Tests *input is validated…*, *a reseller cannot assign rows to another reseller through the body*. |
| 7 | Block XSS | No `innerHTML`/`dangerouslySetInnerHTML`/`eval` in `dashboard/src`; helmet CSP (`script-src 'self'` + Google GSI). |
| 9 | Lock admin routes | `a.use(requireRole('admin'))` covers the new `GET/POST /api/resellers` and `/resellers/:id/follow`. Test: a reseller gets 403 on all three. |
| 10 | Parameterized queries | All values bound with `?`/`:name`. Template values are constants only: table names in `salesStats`/migrations, `SUPPLIER`, `reseller_rate:${rid}` is a bound parameter. |
| 11 | Env variables | `.env*` gitignored (`dashboard/.gitignore`), `.env.example` has placeholders only, startup exits if the first-start passwords are missing or < 10 chars. |
| 12 | Rate limiting | Login + Google login: 5 tries / 15 min per IP, 15-min floor in production. Test *a short LOGIN_WINDOW_MS cannot weaken the lockout in production*. Reseller creation is admin-only. |
| 13 | Restrict CORS | No CORS headers sent; same-origin only. |
| 14 | Security headers | helmet: CSP, `nosniff`, frame/referrer policy, HSTS in prod, no `x-powered-by`. Test *security headers, strict session cookie…*. |
| 15 | Secure cookies | `HttpOnly`, `SameSite=Strict`, `Secure` in prod, Max-Age 30 days, only `sha256(token)` stored. Same test. |
| 16 | CSRF protection | SameSite=Strict + Origin check on every non-GET (`index.js:99-104`). Foreign Origin → 403 (test). No GET changes state. |
| 19 | Verify prices | Admin sale cost and reseller sale cost come from the database (`store.createSale`, `reseller.createSale`); stock checked server-side per reseller. Sale prices are typed by the seller on purpose (business rule). |
| 20 | Debug mode off | 500 → `Erreur serveur`; no debug routes; build has 0 `.map` files; no `console.log` in `src/`. |
| 21 | Update dependencies | `npm audit` → 0 vulnerabilities. Majors only in `npm outdated` (Open). |
| 22 | Remove unused packages | All 9 used: express/helmet/zod/google-auth-library in `server/index.js`, react/react-dom in `src/`, vite + plugin in `vite.config.js`, concurrently in the `dev` script. |
| 23 | Exposed files | Only `dist/` is served. Test *oversized bodies are refused and server files are never served* probes `/.env`, `/server/db.js`, `/server/data/stock.db`, `/package.json`, `/%2e%2e/.env`, `/.git/config`. |
| 24 | Scan Git history | 14 commits: no `.env`/`.db`/key file ever committed; secret-pattern grep of `git log --all -p` finds only test passwords; the real `.env` password values appear 0 times in history or in `src/`/site. |
| 26 | Full security review | Re-read every route end to end, with the new multi-reseller code: reseller routes take `rid` only from `req.user.id`; `getItem` only finds his own items (admin sales to *him*, his external items), so `setPrice`, `createSale`, `addPurchase(item_id)`, `deletePurchase`, `deleteSale` on another reseller’s id → 404 (store test covers each one); external purchases are reached only through `external_items.reseller_id`. Admin `POST /sales` accepts `reseller_id` only for an existing reseller-role user (admin id / unknown → 404); `/resellers/:id/follow` 404s for non-resellers; `createReseller` hard-codes `role='reseller'`, rejects extra keys (`role: 'admin'` → 400), returns no hash, 409 on duplicates. Role is re-read from the DB on every request. Body `reseller_id` on reseller routes → 400 (new test). No hole found. |
| 27 | Test + report | `npm test` → 28/28. |

## Open — for you
| # | Item | Why it needs you | Exact steps |
|---|------|------------------|-------------|
| 4 / 14 | HTTPS + headers at the host (both apps) | Hosting | Run the dashboard behind an HTTPS proxy with `NODE_ENV=production`; the proxy must keep the browser’s `Host` header (the Origin check compares to it). For azlabs-site pick a host serving HTTPS and set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`. |
| 12 | Local `.env` still has `LOGIN_WINDOW_MS` | Your file | Delete the `LOGIN_WINDOW_MS` line from `dashboard/.env` (production is protected by the floor anyway). |
| 21 | Major upgrades | Can break things | express 4→5, react/react-dom 18→19, vite 6→8, @vitejs/plugin-react 4→6, concurrently 9→10. None fixes a known vulnerability; do them as a separate change. |
| 23 | `azlabs-site/azlabs-brand.zip` | Deployment | It is gitignored, but uploading the folder as-is makes it public. Move it out of `azlabs-site/` before deploying. |

## Not applicable
| # | Item | Why |
|---|------|-----|
| 17 | Expiring reset links | No reset or invite links: passwords are set by the admin (reseller creation) or `npm run set-password`, which ends that user’s sessions. |
| 18 | Upload limits | No file uploads. JSON body limit 10 kB is checked (oversized → 400, test above). |
| 25 | Revoke leaked keys | Nothing leaked (item 24). |

azlabs-site: 1, 3, 5, 6, 8–10, 12, 13, 15–19, 25 N/A (no backend, accounts, cookies, DB, uploads or prices). Already OK: 2/11 (no keys), 7 (`innerHTML` only gets hard-coded constants and computed numbers; visitor text goes through `.value`/`textContent`), 20, 21/22 (no dependencies), 24.

## Notes (low risk, unchanged)
- The login lockout counter is in memory (per process, reset on restart); marked as a shortcut in `auth.js`.
- A malformed `password_hash` row would give a 500 instead of a 401; only possible by editing the DB by hand.
- There is no route to disable or delete a reseller account or reset his password from the UI; use `npm run set-password` to lock someone out (it also ends his sessions).

## History
- 2026-11-08, first pass: fixed security logging (403/429/failed logins) and the production lockout floor; 22 tests.
- 2026-11-08, second pass (this report): re-verified all items after multi-reseller; 401 logging extended (d597ea3); evidence tests for body-level `reseller_id` injection, body size and exposed files (bbbaa10); 28 tests.

## Verification log
```
npm test                      → 28 tests, 28 pass, 0 fail
npm audit                     → found 0 vulnerabilities
npm outdated --prefer-online  → majors only (listed above)
vite build --outDir <temp>    → 0 *.map, 0 secret matches
git log --all --name-only     → no .env / .db / key files
git log --all -p | patterns   → only test passwords; real .env values: 0 hits
```
