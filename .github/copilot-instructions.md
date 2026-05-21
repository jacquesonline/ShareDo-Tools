# ShareDo Tools Copilot Instructions

## Build, test, and lint commands

| Task | Command | Notes |
|---|---|---|
| Install dependencies | `npm install` | Required before running the app. |
| Install Playwright browser | `npx playwright install` | Needed for browser-based cookie capture and UX page checks. |
| Run the server | `npm start` | Starts `node server.js` on `http://localhost:3000`. |
| Run with an initial environment | `npm start -- prod` | Replace `prod` with any configured environment name. |
| Build | Not configured | The app runs directly from `node server.js`. |
| Lint | Not configured | No linter is configured. |
| Test | Not configured | No automated test framework is configured. |
| Run a single test | Not available | There is no test runner in this repo. |

## High-level architecture

- This is a Node.js + Express monitoring dashboard for ShareDo environments. `server.js` is the composition root for startup, environment discovery, runtime settings, API routes, monitoring loops, and module wiring.
- Server modules in `server/` are not peers that import each other. They are initialised from `server.js` via `module.init(deps)`, then long-lived services such as metrics migration, cache restore, health monitoring, and UX monitoring are started from there.
- The main server-side domains are:
  - `auth.js`: service-account tokens, admin-cookie acquisition, cookie refresh, OIDC flow, browser cookie capture, and the auth fallback cascade
  - `session.js`: signed multi-user session cookies and admin gating
  - `health-monitor.js`: periodic health checks, alert timing/grace logic, SSE alerts, and Teams notifications
  - `ux-monitor.js`: API probes, Playwright page checks, Web Vitals capture, and persistent browser contexts
  - `waila-service.js` and `worktype-service.js`: on-demand indexes restored from disk-backed caches
  - `metrics-service.js`: append-only JSONL metrics under `cache/metrics/{env}/`
- The client is plain static HTML/CSS/JS under `public/`. Each page is a self-contained folder and calls `shared.init({ activePage })`; shared navigation, environment switching, session state, alert SSE wiring, and env-scoped API calls live in `public/shared/shared.js`.
- Environments are auto-discovered from `.env` using `*_CLIENT_ID` / `*_CLIENT_SECRET` patterns. The browser stores the selected environment per tab and sends it on each env-scoped request through `X-Sharedo-Env`.

## Key conventions

- Do not add cross-imports between files in `server/`. If one module needs another module's behaviour, thread it through `server.js` dependency injection instead.
- Use `shared.apiFetch()` for requests that operate on the selected ShareDo environment so the `X-Sharedo-Env` header is preserved. Use plain `fetch()` only for control-plane calls that should stay environment-agnostic.
- New UI pages should follow the existing page pattern: add `public/{page}/{page}.html`, `{page}.js`, and `{page}-style.css`, call `shared.init({ activePage: "<page>" })`, and register the page in `NAV_ITEMS` inside `public/shared/shared.js`.
- Runtime settings are layered `.env` -> `cache/settings.json` -> in-memory state. In multi-user mode, user preferences are overlaid separately from `cache/user-settings/{slug}.json`.
- Persistent operational state belongs under `cache/` or `data/`, not in tracked source files. Preserve JSONL metrics, disk-backed indexes, and per-environment Playwright user-data folders.
- The auth model is intentionally layered. Reuse the shared auth helpers instead of hard-coding a single auth style because different ShareDo endpoints may require bearer token auth, an extracted `_api` JWT, or the full admin cookie.
- Health and alerting logic is transition-based, not simple threshold polling. Preserve the first-pass seeding, duration thresholds, grace periods, and recovery logic when changing monitor code.
- Playwright browser contexts are intentionally long-lived and per-environment. Avoid changes that would repeatedly recreate them and trigger extra auth churn.
