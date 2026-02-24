# ShareDo Tools: Architecture

Technical reference for anyone modifying, debugging, or extending the codebase. Assumes familiarity with the [README](README.md).

---

## Table of Contents

- [Module Dependency Graph](#module-dependency-graph)
- [Server Startup Sequence](#server-startup-sequence)
- [Express Middleware Chain](#express-middleware-chain)
- [Authentication System](#authentication-system)
- [Multi-User System](#multi-user-system)
- [Health Monitor Pipeline](#health-monitor-pipeline)
- [Notification System](#notification-system)
- [Metrics Recording](#metrics-recording)
- [Index Services](#index-services)
- [UX Monitoring](#ux-monitoring)
- [Settings System](#settings-system)
- [Client-Side Architecture](#client-side-architecture)
- [Theme System](#theme-system)
- [Mock Environment](#mock-environment)
- [API Route Reference](#api-route-reference)

---

## Module Dependency Graph

All server modules receive their dependencies via an `init(deps)` call at startup rather than importing each other directly. `server.js` acts as the composition root.

```
server.js (composition root)
  |
  +-- auth.js              Token, cookie, HTTP helpers
  +-- session.js           Multi-user sessions (depends on: crypto)
  +-- health-monitor.js    Health checks, SSE, Teams (depends on: auth, metrics, isWithinOfficeHours)
  +-- ux-monitor.js        Probes, page checks (depends on: auth, metrics, health-monitor.pushAlert, playwright, isWithinOfficeHours)
  +-- waila-service.js     Workflow index (depends on: auth)
  +-- worktype-service.js  Type config index (depends on: auth)
  +-- metrics-service.js   JSONL recording (depends on: fs, path)
```

No server module imports another server module. All cross-module communication flows through dependency injection from `server.js`. The `isWithinOfficeHours` function is defined in `server.js` and injected into both `health-monitor.js` (to gate alert delivery) and `ux-monitor.js` (to gate browser context lifecycle).

---

## Server Startup Sequence

1. `dotenv` loads `.env`
2. Logging system initialised (category map, ANSI colour detection)
3. `discoverEnvironments()` scans `process.env` for `*_CLIENT_ID` patterns
4. Mock environment appended if `MOCK_ENV_ENABLED=true`
5. Startup argument parsed for initial environment selection
6. `loadSettings()` reads `cache/settings.json` (overrides `.env` defaults)
7. Startup banner printed to console
8. Modules initialised in order: `session` -> `auth` -> `metrics` -> `waila-service` -> `worktype-service` -> `health-monitor` -> `ux-monitor`
9. `metrics.migrate()` runs flat-to-env JSONL file migration
10. `waila-service.loadCaches()` and `worktype-service.loadCaches()` restore index state from disk
11. `healthMonitor.start()` begins the periodic health check interval
12. `uxMonitor.startProbeMonitor()` and `startPageMonitor()` begin UX monitoring cycles
13. Express starts listening; `auth.startupCookieAcquisition()` then `auth.extractCookiesFromBrowserSessions()` run sequentially

---

## Express Middleware Chain

Requests to `/api/*` pass through middleware in this order:

1. **`express.json()`** -- body parsing
2. **`express.static`** -- serves `public/` files
3. **Environment resolution** (`app.use("/api", ...)`) -- reads `X-Sharedo-Env` header, sets `req.envName` and `req.envConfig`. Falls back to server-level `currentEnv` if header is absent.
4. **Session middleware** (`session.middleware`) -- in multi-user mode, validates the `sdt-session` cookie on non-exempt API paths. Returns 401 with `needsRegistration: true` if no valid session. No-op in single-user mode. Exempt paths: `GET /api/session`, `POST /api/session/register`, `GET /api/settings`.

Page routes use `session.pageGate` per-route, which redirects to `/register` in multi-user mode when no session is present.

Admin-gated routes additionally use `session.requireAdmin` which returns 403 if the user is not an admin. In single-user mode this passes through (all users are effectively admin).

---

## Authentication System

### Three Auth Methods

| Method                  | Header                                   | Source                   | Used For                           |
|-------------------------|------------------------------------------|--------------------------|------------------------------------|
| **Service account token** | `Authorization: Bearer <token>`         | OAuth client credentials | Standard API endpoints             |
| **Admin cookie**          | `Cookie: <full cookie string>` + `X-Requested-With` + `X-Passive-Request` | Manual paste, OIDC flow, or browser capture | Admin endpoints (`/admin/*`, modeller, listviews) |
| **Extracted JWT**         | `Authorization: Bearer <_api JWT>`      | Parsed from cookie string | Specialised endpoints (indexer status, some listviews) |

### Auth Cascade (`tryAuth`)

The `auth.tryAuth(host, method, path, body, token, adminCookie)` function implements a three-step cascade:

1. Try with service account bearer token
2. If 401 and admin cookie available: extract the `_api` JWT from the cookie, retry with that as a bearer token
3. If still 401 and admin cookie available: retry with full cookie header (cookie auth mode)

This handles the different authentication requirements of various ShareDo API endpoints without requiring callers to know which method a specific endpoint needs.

### Token Management

Service account tokens are cached per-environment with a 60-second pre-expiry buffer. Acquired via OAuth `client_credentials` grant against the environment's identity host.

### Cookie Lifecycle

1. **Acquisition**: Three sources -- manual paste via Options page, programmatic OIDC flow (6-step process in `auth.js`), or Playwright browser capture
2. **Storage**: In-memory `cookieCache[envName]` with source tracking (`cookieSource[envName]`)
3. **Refresh**: Automatic interval (default 10 minutes) calls `/security/refreshTokens` and merges `Set-Cookie` headers back into the stored cookie string
4. **Expiry detection**: If refresh returns 401, auto-refresh stops and the cookie is considered expired
5. **Startup restoration**: On startup, `extractCookiesFromBrowserSessions()` attempts to read valid sessions from Playwright persistent browser data directories

### OIDC Flow (Programmatic)

The `acquireCookieForEnv` function executes a 6-step OIDC authorization code flow:

1. `GET /` on API host -- obtain authorize redirect URL
2. `GET /connect/authorize` on identity host -- obtain login URL
3. `GET /account/login` -- obtain anti-forgery token from modelJson
4. `POST /account/login` -- submit credentials, obtain `idsrv` session
5. `GET /connect/authorize` (with session) -- obtain authorization code + id_token from form
6. `POST /` on API host -- exchange code for session cookies (`Sharedo.*` + `_api` JWT)

### Browser Login (Playwright)

When triggered via the Options page, launches a visible Chromium window pointed at the environment's admin URL. Polls browser cookies every 2 seconds for up to 3 minutes. Captures the full cookie header once both a `Sharedo.*` session cookie and `_api` JWT are present. Uses persistent browser contexts stored in `cache/ux-user-data/{env}/` for SSO session reuse.

---

## Multi-User System

### Session Mechanism

- Signed cookie (`sdt-session`) using HMAC-SHA256 via Node `crypto`
- Signing key derived from `ADMIN_KEY` (SHA-256 hash)
- Payload: `{ email, firstName, lastName, slug, isAdmin, exp }`
- No external dependencies (no `express-session`, no `cookie-parser`, no Redis)
- Changing `ADMIN_KEY` invalidates all existing sessions

### Settings Stratification

| Setting Category | Single-User Storage  | Multi-User Storage               | Who Can Change (Multi-User) |
|------------------|----------------------|----------------------------------|-----------------------------|
| Server settings  | `cache/settings.json` | `cache/settings.json`           | Admin only                  |
| User preferences | `cache/settings.json` | `cache/user-settings/{slug}.json` | Each user (own prefs)      |

User preferences: `theme`, `highContrast`, `chartBackgrounds`, `desktopNotifications`. Server settings: everything else (thresholds, intervals, notification rules, UX config).

### Admin Gating

In multi-user mode, admin access is required for: changing server-level settings, cookie management (paste, clear, reacquire, browser login), and all Options page server setting controls.

Available to all authenticated users: page access, data viewing, index builds, per-user preferences, logout.

### Two-Tier Desktop Notifications

| Setting                  | Scope      | Purpose                                                    |
|--------------------------|------------|------------------------------------------------------------|
| Desktop Alert Monitoring | Server     | Whether the health monitor evaluates and pushes alerts via SSE |
| Desktop Notifications    | Per-user   | Whether this user's browser shows `Notification` popups    |

In single-user mode, the `desktopNotifications` toggle controls both tiers.

### Cookie Architecture (Current and Future)

- **Server cookies** (`cookieCache`): Shared service-account/admin cookies for all read operations, health monitoring, index builds, UX probes. Managed by admin. Server-level singleton.
- **User cookies** (reserved, not yet implemented): Session schema includes a `userCookies` slot for future per-user ShareDo authentication for write operations where the ShareDo audit trail must reflect the actual person.

---

## Health Monitor Pipeline

### Flow

```
healthMonitor.start()
  |
  +-- runAllHealthChecks()  [interval timer]
        |
        +-- For each environment:
              |
              +-- gatherHealthData(envName)
              |     Fetches streamStats, nodeStatus, linkedServices
              |     (mock env returns synthetic data from _mockState)
              |
              +-- processHealthCheck(envName, data)
                    |
                    +-- Extract current conditions (breached streams, down nodes, unhealthy services, zero-connection streams)
                    +-- First check: seed timers, record metrics, return
                    +-- Subsequent checks:
                          +-- Evaluate alert conditions against notification settings
                          +-- Apply duration thresholds, grace periods, recovery thresholds
                          +-- Fire alerts via pushAlert() for new conditions meeting criteria
                          +-- Record metrics
```

### Alert Evaluation

Each condition type (streams, nodes, services, connections) has:

- **Duration threshold**: Condition must persist for N seconds before alerting
- **Grace period**: If a condition re-triggers within N seconds of clearing, the duration timer is not reset (prevents alert storms)
- **Recovery threshold**: For streams, the backlog must drop N% below the threshold before the condition is considered cleared

The health monitor only alerts on transitions (first breach after clear), not on every poll cycle.

---

## Notification System

### Dispatch

`pushAlert(alert)` dispatches to two channels:

1. **SSE**: Writes to all connected `/api/alerts/stream` clients. The client-side `shared.js` displays browser `Notification` popups if the user has opted in.
2. **Teams**: If Teams webhook is enabled and the alert does not have `skipTeams: true`, sends an Adaptive Card via the configured webhook URL.

### Office Hours Gate

When office hours are enabled, `pushAlert()` checks `isWithinOfficeHours()` before dispatching. Alerts generated outside the configured window are suppressed with a log entry (`[Suppressed -- outside office hours]`). This is a hard gate on all alert delivery -- both SSE and Teams.

Health monitor state tracking (duration timers, firstSeen, prev state) continues unaffected outside office hours. The limitation is that conditions that develop overnight and persist into office hours will not auto-alert unless they clear and re-trigger. UX monitor alerts (probes, page checks, session expiry) are also suppressed outside hours via the same gate.

### Teams Adaptive Cards

Alerts are formatted as Adaptive Card v1.4 payloads with colour-coded titles (attention for streams, warning for nodes, accent for services) and a FactSet containing structured details (stream name, backlog value, threshold, environment link, timestamp).

### Test Alerts

`POST /api/alerts/test` sends test alerts via SSE only (skips Teams). `POST /api/alerts/test-teams` sends via both SSE and Teams.

---

## Metrics Recording

### Storage Format

Per-environment, per-metric JSONL files stored in `cache/metrics/{env}/{metric}.jsonl`. Each line is a JSON object with a `ts` (ISO timestamp), `env`, and metric-specific payload.

Current metrics: `streamstats` (stream backlogs and connections), `nodestatus` (node running/stopped/restarting counts).

### Deduplication

Each `metric-env` pair has a write cooldown (`_metricsInterval`, default 30 seconds). Writes within the cooldown are skipped to prevent duplicate entries when multiple code paths trigger recording.

### Pruning

When a file exceeds the configured cap (`METRICS_MAX_MB`, default 50MB), the oldest 20% of entries are dropped.

### Migration

On startup, `metrics.migrate()` converts any flat-layout files (`{metric}-{env}.jsonl`) to the current env-based directory layout (`{env}/{metric}.jsonl`).

---

## Index Services

### WAILA (Workflow Analyser)

**Build process**: Lists all visual workflow plans via the admin plan list endpoint (paginated at 500), then fetches each plan's full definition individually with a configurable delay between fetches (`WAILA_FETCH_DELAY`). Each workflow entry stores system name, name, description, variables, steps with actions, and a pre-computed lowercase search blob for fast text search.

**Search**: Supports unified text search (matches against the search blob) and field-specific filters (system name, step name, block type, block display name, config content, variable). Filters use AND logic. Exact match and case-sensitive modes available.

**Diff**: Compares two environment indexes by system name. Reports workflows only in A, only in B, changed (step/action/variable differences), and identical count.

**Cache**: Indexes persist to `cache/waila-indexes/waila-{env}.json` and are restored on startup.

### Work Type Config Index

**Build process**: Fetches the type tree from the modeller API, walks it to produce a flat type list, then for each type fetches aspects (including FormBuilder form details), key dates, and participant roles. A form cache avoids redundant form lookups across types.

**Search**: Supports text search across all indexed fields plus field-specific filters (aspect name, form title, key date name, role name). Supports exclude mode (returns types that do NOT match). All filters use AND logic.

**Cache**: Indexes persist to `cache/worktype-indexes/worktype-config-{env}.json` and are restored on startup.

Both services run builds asynchronously. The build endpoint returns immediately with `{ status: "building" }` and the client polls for completion via the status endpoint.

---

## UX Monitoring

### API Probes

A set of predefined API requests (`_uxProbes` array) executed against a configurable environment. Each probe measures total round-trip time and extracts the server-reported `tookMs`. Results are compared against warn/crit thresholds and can trigger alerts. The request timeout is configurable (`uxProbeTimeout`, default 15000ms) and is enforced to be at least as large as the critical threshold to prevent probes timing out before threshold evaluation. Probes are lightweight HTTP requests and do not require Playwright.

### Playwright Page Checks

Loads configured page targets (`_uxPageTargets`) in a headless Chromium browser with the environment's session cookies injected. Extracts:

- Web Vitals (FCP, LCP, TTI) via `PerformanceObserver`
- Navigation timing breakdown (TTFB, DOM processing, render)
- AJAX requests captured via `$ajaxClientTimer` (ShareDo's built-in client timer)
- Total load time, status code

Results are recorded as metrics and can trigger alerts based on configurable Web Vital thresholds.

### Persistent Browser Context

Page checks use a long-lived Playwright persistent context that survives across check cycles. This replaces the earlier architecture of launching and closing Chromium for every target on every cycle.

**Why**: Repeated Chromium launches trigger Azure AD smart lockout (the pattern resembles credential stuffing), cause cookie flush race conditions (cookies not written to disk before process exits), and allow session idle expiry between cycles (no browser process to hold cookies in memory).

**How**: `ensureContext()` is called at the start of each page check. On first call it launches a persistent context into `cache/ux-user-data/{env}/` and stores references in module-level state (`_persistentContext`, `_contextEnv`, `_contextLaunchedAt`). Subsequent calls return the existing context after a health check (`_persistentContext.pages()`). Individual page checks open and close pages (tabs) within the context. The context itself is only closed on:

- Environment change (detected by `ensureContext()` comparing `_contextEnv` against `_uxProbeEnv`)
- Max age exceeded (`uxContextMaxAgeMins`, default 1440 minutes / 24 hours)
- Login redirect detected (session expired)
- Manual browser login via Options (releases user data dir lock)
- Office hours boundary (if bypass is disabled)
- Admin-triggered restart via `POST /api/ux/context/close`
- Server shutdown (`SIGTERM`/`SIGINT` handlers)

**Shutdown handling**: During `SIGINT`, Chromium receives the signal from the terminal's process group and may already be dying. `closeContext()` races `ctx.close()` against a 3-second timeout to prevent hanging. The `server.js` shutdown handler has an additional 5-second safety timeout. References are nulled synchronously before the async close to prevent `ensureContext()` from returning a closing context.

### Session Expiry Deduplication

When a page check detects a login redirect, it sets `_sessionExpired = true` and closes the context. The `runAllPageChecks()` loop checks this flag before each target -- remaining targets in the cycle are skipped without relaunching Chromium, producing exactly one session alert per cycle instead of one per target. The flag is reset at the start of each new cycle (`runAllPageChecks()`), allowing the next cycle to retry. Manual `runPageCheck()` calls bypass the flag entirely.

### Office Hours Interaction

When office hours are enabled and the bypass toggle (`uxContextIgnoreOfficeHours`) is off, `ensureContext()` returns null outside the configured window. If a context is already alive, it is closed. Page checks receive a descriptive "paused -- outside office hours" response. When the bypass is on, the context stays alive and page checks continue recording metrics, but alerts are still suppressed by the `pushAlert()` gate in `health-monitor.js`. Probes always run regardless of office hours (they are lightweight and don't require Chromium).

### Context Status

`GET /api/ux/status` includes a `context` property: `{ alive, env, launchedAt, uptimeMs, maxAgeMins }`. The Options page displays this as a live status indicator in the UX Monitor panel with an admin-gated Restart button.

---

## Settings System

### Load Order

1. `.env` values are read at startup for initial state
2. `loadSettings()` reads `cache/settings.json` and overrides any matching values
3. Runtime changes via `POST /api/settings` update in-memory state and call `saveSettings()`

### Persistence

`saveSettings()` writes all server-level settings to `cache/settings.json` as a single JSON object. UX monitor settings are merged in via `uxMonitor.getSettingsForSave()`.

### Settings Response

`GET /api/settings` returns the merged view:
- Server settings (always included)
- In multi-user mode: user preferences overlaid from the user's settings file, `isAdmin` flag included
- In single-user mode: appearance settings from server state, `isAdmin: true`

### Restart Triggers

Certain setting changes trigger subsystem restarts:
- `autoRefreshInterval` or `desktopAlertMonitoring` change: `healthMonitor.start()` restarts the health check interval
- UX-related settings (`uxEnabled`, `uxAutoProbes`, `uxProbeInterval`, `uxProbeEnv`, etc.): probe and page monitors restart. Environment change also triggers persistent browser context closure and relaunch.

### Office Hours Settings

Office hours settings (`officeHoursEnabled`, `officeHoursStart`, `officeHoursEnd`) are server-level settings in `server.js`. They are read from `.env` at startup, overridden by `cache/settings.json`, and modifiable at runtime via `POST /api/settings` (admin-gated). The `isWithinOfficeHours()` function is a live check against current state -- it is not stored as a result but evaluated on each call. The browser context bypass (`uxContextIgnoreOfficeHours`) is a UX monitor setting owned by `ux-monitor.js`.

---

## Client-Side Architecture

### `shared.js` as the Spine

Every page calls `shared.init({ activePage: "pageName" })` on load. This:

1. Builds the navigation bar from the `NAV_ITEMS` array (single source of truth for all pages)
2. Fetches `/api/env` to populate the environment dropdown, restoring the last-selected environment from `localStorage`
3. Fetches `/api/session` to determine multi-user state and render user identity
4. Applies the theme from `localStorage` (instant, avoids flash) then syncs with server settings
5. Initialises the SSE alert stream if notifications are enabled
6. Sets up guidance dismissal persistence and JS-positioned tooltips (all tooltips use `data-tooltip` + `usd-help` with a 400ms show delay matching native browser behaviour)

### `apiFetch`

Drop-in replacement for `fetch()` that injects the `X-Sharedo-Env` header from the tab's locally-tracked environment. Handles 401 responses in multi-user mode by redirecting to `/register`. Used by all page scripts for environment-scoped API calls.

### Environment Independence

Each browser tab tracks its own environment selection via `localStorage` and the `X-Sharedo-Env` header. Two tabs can operate against different environments simultaneously. `POST /api/env/select` still updates the server-level default for logging context and health monitor, but does not affect other tabs' API calls.

### SSE Alert Stream

Opened by `shared.js` when the server is pushing alerts (determined by `desktopAlertMonitoring` or `desktopNotifications` in settings). The mock page force-opens the stream via `shared.openAlertStream()` regardless of settings. Pages can register alert callbacks via `shared.onAlert(cb)`.

### `chartTheme.js`

Bridge between CSS custom properties and Chart.js configuration. Reads computed CSS variable values at call time so charts automatically adapt to theme changes. Provides:

- Semantic colour accessors (`accentBlue()`, `textMuted()`, etc.)
- Pre-built config builders for time axes, value axes, legends, tooltips, threshold annotations
- A cycling colour palette that pulls the first 6 colours from `--chart-*` CSS variables (falling back to `--accent-*`)

---

## Theme System

### Architecture

Themes are CSS files that define CSS custom properties under a `[data-theme="id"]` selector. The active theme is applied by setting `document.body.dataset.theme`.

### Manifest-Driven

`public/shared/themes/manifest.json` is the registry. Each entry has `id`, `label`, `icon`, and `lightBased` (determines whether to add the `.light-theme` class for high-contrast text colour selection).

### Adding a Theme

1. Create a CSS file in `public/shared/themes/` following the pattern of `dark.css` or `light.css`
2. Add an `@import` line to `themes.css`
3. Add an entry to `manifest.json`

The Theme Builder page automates CSS generation and provides the manifest entry to copy.

### Chart Palette

Themes can optionally define `--chart-blue` through `--chart-cyan` variables for chart line and bar colours. `chartTheme.js` reads these first, falling back to the corresponding `--accent-*` values if undefined. This allows themes like MB Brand to use dark, WCAG-compliant accents for text while providing brighter, more saturated chart palette colours for visibility on white panel backgrounds. Dark and light themes do not define chart variables (their accents are already suitable for charts).

### High Contrast

High contrast mode adds the `.high-contrast` class to `body`. This replaces tinted accent backgrounds with solid accent colours and switches text to dark-tint (dark themes) or white (light themes) colours defined via `--hc-pill-text-*` variables. All HC overrides are centralised in `style.css`.

---

## Mock Environment

When `MOCK_ENV_ENABLED=true`, a synthetic "Test Env" entry is added to the environment list with a `mock.local` host. The mock state (`_mockState` in `server.js`) contains streams, nodes, and services with adjustable values.

The health monitor treats the mock environment like any other, gathering data from `_mockState` instead of making API calls. The mock control page (`/debug/mock`) provides sliders and buttons to adjust backlog values, node states, and service health, plus a real-time alert log showing fired notifications.

The mock page also displays current notification settings (backlog threshold, alert duration, recovery threshold, grace period) with links to the Options page for adjustment.

---

## API Route Reference

### Environment

| Method | Path                 | Auth    | Purpose                        |
|--------|----------------------|---------|--------------------------------|
| GET    | `/api/env`           | Session | List environments, current env |
| POST   | `/api/env/select`    | Session | Set server-level active env    |

### Authentication & Cookies

| Method | Path                          | Auth    | Purpose                            |
|--------|-------------------------------|---------|------------------------------------|
| POST   | `/api/cookie`                 | Admin   | Set/clear cookie for current env   |
| POST   | `/api/cookie/:env`            | Admin   | Set/clear cookie for specific env  |
| GET    | `/api/cookie/status`          | Session | Cookie expiry and refresh status   |
| GET    | `/api/auth/status`            | Session | All env auth status (for Options)  |
| POST   | `/api/auth/reacquire/:env`    | Admin   | Re-run OIDC acquisition for env    |
| POST   | `/api/auth/launch-browser`    | Admin   | Launch Playwright login browser    |

### Settings

| Method | Path             | Auth    | Purpose                              |
|--------|------------------|---------|--------------------------------------|
| GET    | `/api/settings`  | Exempt  | Read merged settings (server + user) |
| POST   | `/api/settings`  | Session | Update settings (admin-gated for server settings) |

### Health & Alerts

| Method | Path                    | Auth    | Purpose                          |
|--------|-------------------------|---------|----------------------------------|
| GET    | `/api/refresh`          | Session | Full dashboard data refresh      |
| GET    | `/api/alerts/stream`    | Session | SSE alert stream                 |
| POST   | `/api/alerts/test`      | Session | Send test alerts (SSE only)      |
| POST   | `/api/alerts/test-teams`| Session | Send test alerts (SSE + Teams)   |

### Metrics

| Method | Path                           | Auth    | Purpose                    |
|--------|--------------------------------|---------|----------------------------|
| GET    | `/api/metrics/status`          | Session | File listing and sizes     |
| GET    | `/api/metrics/:env/:metric`    | Session | Read metric entries (with time filters) |
| GET    | `/api/metrics/:env/:metric/export` | Session | Download raw JSONL file as backup |

### Issues

| Method | Path                       | Auth    | Purpose                                  |
|--------|----------------------------|---------|------------------------------------------|
| POST   | `/api/processes`           | Session | EE processes (errored/running, paginated) |
| GET    | `/api/processes/:id`       | Session | Process execution plan detail            |
| GET    | `/api/processes/:id/steps/:stepId/log` | Session | Step execution log       |
| POST   | `/api/issues/emails`       | Session | Failed outbound emails                   |
| POST   | `/api/issues/sms`          | Session | Failed outbound SMS                      |
| POST   | `/api/issues/sysadmin`     | Session | SYSADMIN tasks (prod only)               |

### Search

| Method | Path                    | Auth    | Purpose                      |
|--------|-------------------------|---------|------------------------------|
| GET    | `/api/types/tree`       | Session | Work type tree for dropdowns |
| POST   | `/api/search`           | Session | Work item findByQuery        |
| GET    | `/api/search/presets`   | Session | Read saved presets           |
| POST   | `/api/search/presets`   | Session | Save presets                 |

### WAILA

| Method | Path                                  | Auth    | Purpose                       |
|--------|---------------------------------------|---------|-------------------------------|
| GET    | `/api/waila/index/status`             | Session | Index build status            |
| POST   | `/api/waila/index/build`              | Session | Start index build             |
| POST   | `/api/waila/search`                   | Session | Search the workflow index     |
| GET    | `/api/waila/workflow/:systemName`     | Session | Single workflow from index    |
| POST   | `/api/waila/workflow/:systemName/preview` | Session | Generate script preview   |
| POST   | `/api/waila/diff`                     | Session | Diff two environment indexes  |

### Work Types

| Method | Path                                        | Auth    | Purpose                          |
|--------|---------------------------------------------|---------|----------------------------------|
| GET    | `/api/worktype/tree`                        | Session | Type tree from modeller          |
| GET    | `/api/worktype/aspects/:typeSystemName`     | Session | Aspects for a type               |
| GET    | `/api/worktype/form/:formId`                | Session | Form builder detail              |
| GET    | `/api/worktype/phaseplan/:typeSystemName`   | Session | Phase plan for a type            |
| POST   | `/api/worktype/roles/:typeSystemName`       | Session | Participant roles for a type     |
| GET    | `/api/worktype/keydates/:typeSystemName`    | Session | Key dates for a type             |
| POST   | `/api/worktype/relationships/:typeSystemName` | Session | Type relationships             |
| POST   | `/api/worktype/compare/:typeSystemName`     | Session | Cross-env type comparison        |
| GET    | `/api/worktype/index/status`                | Session | Config index build status        |
| POST   | `/api/worktype/index/build`                 | Session | Start config index build         |
| POST   | `/api/worktype/index/search`                | Session | Search the config index          |

### UX Monitor

| Method | Path                      | Auth    | Purpose                                    |
|--------|---------------------------|---------|--------------------------------------------|
| GET    | `/api/ux/status`          | Session | UX monitor status, results, context state  |
| POST   | `/api/ux/probe/run`       | Session | Run API probe cycle manually               |
| POST   | `/api/ux/page/run`        | Session | Run page check (single URL)               |
| POST   | `/api/ux/page/run-all`    | Session | Run all page check targets                |
| GET    | `/api/ux/page/latest`     | Session | Latest page check results                 |
| POST   | `/api/ux/context/close`   | Admin   | Close persistent browser context (restart) |

### Session (Multi-User)

| Method | Path                      | Auth    | Purpose                       |
|--------|---------------------------|---------|-------------------------------|
| GET    | `/api/session`            | Exempt  | Session state and user info   |
| POST   | `/api/session/register`   | Exempt  | Create session (registration) |
| POST   | `/api/session/admin`      | Session | Verify admin key, upgrade     |
| POST   | `/api/session/logout`     | None    | Clear session cookie          |

### Mock Environment

| Method | Path              | Auth    | Purpose                      |
|--------|-------------------|---------|------------------------------|
| GET    | `/api/mock/state` | Session | Current mock state           |
| POST   | `/api/mock/state` | Session | Update mock state            |

**Auth column key**: "Session" = requires session in multi-user mode (no-op in single-user). "Admin" = requires admin session in multi-user (no-op in single-user). "Exempt" = no session required. "None" = no authentication at all.

## File Structure

```
sharedo-monitor/
├── server.js
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── ARCHITECTURE.md
├── USAGE.md
├── server/
│   ├── auth.js
│   ├── session.js
│   ├── health-monitor.js
│   ├── ux-monitor.js
│   ├── waila-service.js
│   ├── worktype-service.js
│   └── metrics-service.js
├── public/
│   ├── shared/
│   │   ├── shared.js
│   │   ├── style.css
│   │   ├── themes.css
│   │   ├── chartTheme.js
│   │   └── themes/
│   │       ├── manifest.json
│   │       ├── dark.css
│   │       ├── light.css
│   │       └── mb-brand.css
│   ├── monitor/
│   │   └── monitor.html, app.js, monitor-style.css
│   ├── issues/
│   │   └── issues.html, issues.js, issues-style.css
│   ├── metrics/
│   │   └── metrics.html, metrics.js, metrics-style.css
│   ├── ux/
│   │   └── ux.html, ux.js, ux-style.css
│   ├── search/
│   │   └── search.html, search.js, search-style.css
│   ├── waila/
│   │   └── waila.html, waila.js, waila-style.css
│   ├── worktype/
│   │   └── worktype.html, worktype.js, worktype-style.css
│   ├── options/
│   │   └── options.html, options.js, options-style.css
│   ├── theme-builder/
│   │   └── theme-builder.html, theme-builder.js, theme-builder-style.css
│   ├── mock/
│   │   └── mock.html, mock.js, mock-style.css
│   └── register/
│       └── register.html, register.js, register-style.css
└── cache/
    ├── settings.json
    ├── metrics/
    │   └── {env}/
    │       ├── streamstats.jsonl
    │       └── nodestatus.jsonl
    ├── waila-indexes/
    │   └── waila-{env}.json
    ├── worktype-indexes/
    │   └── worktype-config-{env}.json
    ├── search-presets/
    │   └── work-item-query-presets.json
    ├── user-settings/
    │   └── {email-slug}.json
    └── ux-user-data/
        └── {env}/
```