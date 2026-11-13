# Plan: several resellers, admin nav reorder

Spec: user request (2026-11-08) + answers:
- "ranger la barre de navigation : vue d'ensemble, stocks, ventes externes, ventes pour Jazi, suivi Jazi, et un bouton pour une nouvelle fonctionnalité : ajouter un revendeur : lorsque l'admin valide le revendeur et sa création, il reçoit un accès comme Jazi avec sa page et son compte indépendant."
- Creation: the admin creates the account (name, username, password); active immediately. No public sign-up.
- Admin menu: one tab + reseller selector: Vue d'ensemble · Stock · Ventes externes · Ventes revendeurs · Suivi revendeurs, plus an "Ajouter un revendeur" button.
- Admin sale form: a "Vendu à" list (Client externe / each reseller) replaces the "Vente externe" checkbox.

Baseline: commit e8a6c8c, `cd dashboard && npm test` 22/22, `npx vite build` OK.

## Global Constraints

- Each reseller is fully isolated: a reseller sees and changes only their own items, prices, purchases, sales, rate and stats. Every reseller query is scoped by the logged-in user's id taken from the session (`req.user.id`), never from the request body/URL. Acting on another reseller's row id returns 404 (same as not found).
- Existing data is preserved: an idempotent migration (runs in openDb, inside a transaction) assigns every existing reseller row and every existing admin sale with `external = 0` to the existing reseller account `aziz`; admin sales with `external = 1` become external (no reseller). Running openDb twice changes nothing. Existing users/passwords untouched.
- One source of truth for "who bought an admin sale": `sales.reseller_id` (NULL = external client). Remove the `external` column after migrating (SQLite `ALTER TABLE … DROP COLUMN`; if a constraint blocks it, rebuild the table) — no two flags that can disagree.
- Admin-only endpoints: create/list resellers, per-reseller follow-up. Reseller cannot reach them (existing `requireRole`).
- Validation at the boundary with zod like the existing schemas: reseller creation `{ name: 1..60 chars, username: /^[a-z0-9._-]{3,30}$/, password: min 10 }`, `.strict()`; duplicate username → 409 "Identifiant déjà utilisé"; admin sale `reseller_id`: positive int or null, must be an existing user with role 'reseller' (else 400/404).
- Passwords hashed with the existing `hashPassword`; never returned or logged. Keep the login rate limiter, security logging and all existing security code exactly as is.
- Behaviour for the existing single-reseller case stays the same for Aziz (his pages, numbers, texts).
- No new dependencies. Keep accessibility (labels, aria, keyboard). French UI text. Least code that works; reuse existing components (Sales, SalesTable, SalesChips, AzizView, Modal, form patterns).
- `npm test` green (existing tests may be adapted only where the API shape legitimately changed, e.g. `external` → `reseller_id`; never weakened) + new tests below; `npx vite build` OK.
- Only touch `dashboard/`. Commit with: git -c user.name=youssef -c user.email=youssefbelghith752@gmail.com commit.

## Task 1: Multi-reseller data model, API, UI

Server:
- Schema/migration: `reseller_id INTEGER REFERENCES users(id)` on `reseller_sales`, `external_items` (purchases inherit through their item), and `reseller_prices` (primary key becomes `(reseller_id, article_id)` — table rebuild in the migration). `sales.reseller_id` (nullable). Per-reseller EUR rate: store per reseller (e.g. settings key `reseller_rate:<id>` defaulting to the current `reseller_rate` value, or a column on users — pick the smallest).
- `reseller.js`: every function takes the reseller id and scopes all reads/writes; supplier stock for a reseller = admin sales with `reseller_id = that id`. Ownership checks on delete/update by id.
- `store.js`: `createSale` stores `reseller_id`; `listSales` returns `reseller_id` and the reseller `name` (null for external); `deleteSale` refuses only if that sale's reseller already resold those units (per-reseller count); external sales always deletable.
- Routes: reseller routes pass `req.user.id`. Admin: `GET /api/resellers` (id, name, username), `POST /api/resellers` (create), `GET /api/resellers/:id/follow` (stats, purchases, sales of that reseller — replaces `GET /api/aziz`). Admin `POST /api/sales` body: `reseller_id` (number|null, default null) instead of `external`.
- Hardcoded "Aziz" in server messages → the reseller's name.

Front:
- Admin nav order: Vue d'ensemble · Stock · Ventes externes · Ventes revendeurs · Suivi revendeurs. An "Ajouter un revendeur" button (sidebar, below the nav) opens a Modal with name / identifiant / mot de passe (min 10) → POST, success toast, reseller list refreshed.
- "Ventes revendeurs" and "Suivi revendeurs": a reseller `<select>` (labelled) at the top, defaulting to the first reseller; content filtered to that reseller (follow-up reuses AzizView with the selected reseller's data). Empty state when no reseller exists.
- Sale form (admin, incl. the Stock "Vendre" modal): "Vendu à" `<select>`: "Client externe" + each reseller by name; default = page context (external page → Client externe; reseller sales page → selected reseller; stock modal → Client externe or first reseller, your call, say which). Client name required when "Client externe".
- Reseller UI texts that name the supplier/reseller stay correct for any reseller (no hardcoded "Aziz" shown to another reseller).

Tests (server, node:test, follow existing style):
- Two resellers A (aziz) and B: admin sale to B appears only in B's items/purchases; B's items, sales, purchases, prices and stats never include A's rows and vice versa; B deleting/updating A's sale/purchase/price by id → 404 and A's row intact.
- Admin creates a reseller: can log in with its password; duplicate username → 409; short password / bad username → 400; reseller role cannot call `POST /api/resellers` (403).
- Migration: a database created with the old schema (external flag, no reseller_id) and data is migrated to aziz; running openDb again is a no-op.
- Existing tests keep passing (adapted only for `external` → `reseller_id`).
