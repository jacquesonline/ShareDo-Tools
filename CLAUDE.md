# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                        # Install dependencies
npx playwright install             # Install Chromium for UX page checks (required once)
npm start                          # Start the server at http://localhost:3000
npm start -- prod                  # Start with a specific initial environment
```

There are no tests, no build step, and no linter. The application runs directly via `node server.js`.

## Architecture Overview

A Node.js/Express monitoring dashboard for ShareDo legal case management environments. No framework beyond Express — all server logic is plain JavaScript modules, all client-side logic is vanilla JS loaded as static files.

### Composition Root Pattern

`server.js` is the composition root (~1800 lines). It owns all API routes, all settings state, and all cross-cutting concerns (logging, office hours, environment list). Server modules in `server/` are never imported by each other — they are initialised at startup via `module.init(deps)` where `deps` is an object of injected dependencies passed from `server.js`. This means adding a new cross-module dependency requires updating `server.js`, not the individual modules.

### Server Modules (`server/`)

| Module | Responsibility |
|---|---|
| `auth.js` | OAuth token acquisition and caching, admin cookie storage, cookie refresh, OIDC 6-step flow, Playwright browser capture, `tryAuth()` cascade |
| `session.js` | Multi-user sessions via signed `sdt-session` cookie (HMAC-SHA256, no external deps) |
| `health-monitor.js` | Periodic health checks, alert duration/grace/recovery evaluation, SSE push, Teams Adaptive Card webhooks |
| `ux-monitor.js` | API probes (lightweight HTTP), Playwright page checks, Web Vitals extraction, persistent browser context lifecycle |
| `waila-service.js` | Workflow index — builds by paginating EE admin API, supports text search and env diff |
| `worktype-service.js` | Work type config index — walks type tree, fetches aspects/forms/roles/dates |
| `metrics-service.js` | Append-only JSONL files in `cache/metrics/{env}/{metric}.jsonl`, write cooldown deduplication, size-based pruning |

### Client-Side Pattern

Every page is a self-contained HTML file in `public/{page}/` with a paired `.js` and `-style.css`. All pages call `shared.init({ activePage })` at load which builds the nav, handles env switching, manages session state, and starts the SSE alert stream. API calls use `apiFetch()` (a wrapper around `fetch` that injects the `X-Sharedo-Env` header). Charts use Chart.js with `chartTheme.js` as a bridge to read CSS custom properties at call time so they adapt to theme changes.

### Authentication Cascade

Three auth methods cascade automatically in `auth.tryAuth()`: service account bearer token → JWT extracted from admin cookie → full cookie header. Callers don't need to know which method a given ShareDo endpoint requires.

### Settings

Runtime settings have a three-layer load order: `.env` → `cache/settings.json` (persisted overrides) → in-memory state. `POST /api/settings` updates memory and writes `cache/settings.json`. In multi-user mode, per-user preferences (theme, high contrast, notifications) are stored in `cache/user-settings/{slug}.json` and overlaid at read time.

### Data Storage

All persistent data is in `cache/` (gitignored) or `data/` (gitignored):
- `cache/metrics/{env}/*.jsonl` — time-series health snapshots (streamstats, nodestatus, ux-api, ux-pages)
- `cache/settings.json` — runtime settings
- `cache/waila-indexes/`, `cache/worktype-indexes/` — build-on-demand indexes restored at startup
- `cache/ux-user-data/{env}/` — Playwright persistent browser contexts (holds SSO session)
- `data/activity-events.jsonl` — user behaviour events pushed from within ShareDo via `POST /track/event`

### Environment Discovery

Environments are auto-discovered from `.env` by scanning for `{ENV}_CLIENT_ID` patterns. Each tab tracks its own selected environment via `localStorage` and sends it as `X-Sharedo-Env` on every API request. Two tabs can query different environments simultaneously.

### Key Architectural Notes

- **Playwright persistent context**: Page checks reuse a single long-lived Chromium context per environment stored in `cache/ux-user-data/{env}/`. It is NOT closed between check cycles to avoid Azure AD smart lockout from repeated logins and cookie flush race conditions.
- **No module cross-imports**: If module A needs something from module B, it must be threaded through `server.js` as a dep injection.
- **Mock environment**: When `MOCK_ENV_ENABLED=true`, a synthetic "Test Env" entry uses `_mockState` in `server.js` instead of real API calls. The health monitor treats it identically to real environments.
- **ARCHITECTURE.md** in the repo root is the authoritative deep-reference for the auth cascade, alert pipeline, index build processes, and full API route table.
