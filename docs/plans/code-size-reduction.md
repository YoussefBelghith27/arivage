# Plan: dashboard code-size reduction

Goal: less code and a smaller bundle for `dashboard/`, with identical behaviour. Optimality over quantity.
Spec: the user request ("réduire le volume de code pour être plus optimal… réduction de la taille des fichiers"). No separate spec file.

Baseline (commit b5d2413): 19/19 tests pass (`npm test`), `npx vite build` OK, bundle JS 719 662 B, CSS 16 359 B, sources ~2 900 lines.

## Global Constraints

- Behaviour identical for the user: same screens, same data, same French UI text, same API routes and responses.
- `cd dashboard && npm test` stays 19/19 green after every task. Do not delete or weaken tests.
- `cd dashboard && npx vite build` succeeds after every task.
- No new dependencies. Removing dependencies is the goal.
- Keep accessibility: roles, aria-labels, focus handling, keyboard use.
- Motion: every CSS animation must be disabled under `@media (prefers-reduced-motion: reduce)` (App.jsx currently uses `MotionConfig reducedMotion="user"`; keep that guarantee).
- Keep security and validation code (auth, zod schemas, helmet, password hashing) intact.
- Only touch files inside `dashboard/`. Commit each task with a clear message.

## Task 1: Replace framer-motion with CSS animations

Files: `src/ui.jsx`, `src/App.jsx`, `src/Login.jsx`, `src/Overview.jsx`, `src/Sales.jsx`, `src/Stock.jsx`, `src/Purchases.jsx`, `src/ResellerStock.jsx`, `src/styles.css`, `package.json`, `package-lock.json`.

- Replace every `motion.*` element with the plain element plus a CSS class driving a `@keyframes` entry animation (fade/slide-in, matching current direction and roughly current duration).
- Exit animations (AnimatePresence) and `layout`/`layoutId` animations may be dropped; the nav pill may become a static active style.
- `animate()` imported in ui.jsx (number count-up): replace with a small `requestAnimationFrame` helper or render the final number directly; keep displayed final values identical.
- The ring in Overview (`motion.circle`): use a CSS transition / keyframe on `stroke-dashoffset`.
- Remove `MotionConfig`; add the reduced-motion media query in styles.css.
- `npm uninstall framer-motion` (updates package.json and package-lock.json).
- Acceptance: no `framer-motion` string left in `src/` or package.json; tests green; build OK; report new bundle size.

## Task 2: Replace recharts with inline SVG charts

Files: `src/Overview.jsx`, `src/styles.css`, `package.json`, `package-lock.json`.

- Replace the AreaChart (`stats.by_day`) and BarChart (`stats.by_category`) with small hand-written responsive SVG components inside Overview.jsx (viewBox + `width="100%"`, height 260).
- Keep: the same data series and colours, axis labels readable (x labels, a few y gridlines), and a value readout per point/bar via SVG `<title>` (native tooltip). Handle empty data (render the existing empty state or nothing, never crash) and all-zero values (no division by zero).
- `npm uninstall recharts`.
- Acceptance: no `recharts` string left; tests green; build OK; report new bundle size.

## Task 3: Remove duplication in server and front-end code

Files: any in `dashboard/server/*.js` (non-test) and `dashboard/src/*.jsx|js`.

- Find real duplication (repeated helpers, near-identical components/table rows, repeated validation/formatting, dead exports or unused functions) and merge it into the existing shared modules (`src/ui.jsx`, `src/api.js`, `server/db.js`, `server/store.js`). Do not create new layers or abstractions for a single use.
- Delete unused code (unreferenced functions, exports, props, imports).
- Keep every error handling and validation path when merging.
- Acceptance: tests green; build OK; report lines before/after per file touched.

## Task 4: Purge dead CSS

Files: `src/styles.css`.

- Remove selectors and keyframes that no JSX/HTML uses any more (check class names against `src/` and `index.html`, including classes built in template strings).
- Merge duplicate declarations where a shared rule already exists. Keep visuals identical.
- Acceptance: build OK; report CSS bytes before/after.
