# ShareDo Tools

```
+-----------------------------------------------------------+
|  ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗  ██████╗ |
|  ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗|
|  ███████╗███████║███████║██████╔╝█████╗  ██║  ██║██║   ██║|
|  ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║██║   ██║|
|  ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝╚██████╔╝|
|  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ |
|                                                           |
|  ████████╗ ██████╗  ██████╗ ██╗     ███████╗              |
|  ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝              |
|     ██║   ██║   ██║██║   ██║██║     ███████╗              |
|     ██║   ██║   ██║██║   ██║██║     ╚════██║              |
|     ██║   ╚██████╔╝╚██████╔╝███████╗███████║              |
|     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝              |
+-----------------------------------------------------------+
```

A Node.js monitoring and analysis application for ShareDo legal case management environments. Provides system health monitoring, operational issue triage, historical metrics, work item search, workflow analysis, work type configuration visualisation, and UX performance tracking -- all from a single dashboard supporting multiple ShareDo environments. Built as an internal tool for the Maurice Blackburn LSP team.

---

## Table of Contents

- [Pages](#pages)
- [Setup](#setup)
- [Usage](#usage)
- [Environment Configuration](#environment-configuration)
- [Multi-User Mode](#multi-user-mode)
- [Authentication](#authentication)
- [File Structure](#file-structure)
- [Logging](#logging)
- [Dependencies](#dependencies)
- [Further Reading](#further-reading)

---

## Pages

### Monitor (`/`)

System health dashboard covering the ShareDo daily checklist. Displays Event Engine stream stats with backlog alert duration tracking, EE node status with console logs, search index health, Elasticsearch cluster status, SQL Agent jobs, system diagnostics configuration, maintenance plans, and linked services. Auto-refreshes at a configurable interval. Each section header links to the corresponding ShareDo admin page.

### Issues (`/issues`)

Operational issue triage consolidating errored EE processes, failed outbound emails, failed outbound SMS, and SYSADMIN tasks (production only). All sections support date filtering and configurable row counts. Process rows open a detail modal showing the execution plan with step states and expandable log entries.

### Metrics (`/metrics`)

Historical metrics dashboard with interactive Chart.js charts. Displays stream backlog trends, EE node status over time, stop/restart events, and stream connections. Features include summary cards, zoom/pan, dataset visibility persistence, data point sync lines across charts, backup file loading, and configurable time ranges.

### UX Monitor (`/ux`)

API probe and Playwright-based page load performance monitoring. Displays per-URL summary cards with Web Vitals (FCP, LCP, TTI), a comparative chart across page targets, individual vitals and probe response time charts, and AJAX detail drilldown. Supports manual and automatic probe/page check cycles.

### Search (`/search`)

Work item query tool using the ShareDo `findByQuery` API. Two-column layout with a sticky sidebar supporting multi-select work types, phase filters, text search, ID and FormBuilder attribute filters, date ranges, ancestor search, configurable enrichment paths, pagination, CSV export, and saved presets.

### WAILA (`/waila`)

Workflow Analyser ("What Am I Looking At"). Indexes all visual workflows from the Execution Engine and provides search across system names, steps, blocks, action configuration content, and variables. Features include advanced filters, script preview with syntax highlighting, environment diff, and CSV export.

### Work Types (`/worktype`)

Work type configuration visualiser and cross-environment comparison tool. Sidebar supports tree browsing and a WAILA-pattern config search index. Detail view presents configuration across six tabs: Aspects, Phase Plan (SVG visualisation), Roles, Key Dates, Relationships, and Compare.

### Options (`/options`)

Runtime settings page with a left-nav layout. Sections for Appearance, Monitor, Notifications, Metrics, UX Monitor, WAILA, Work Types, Authentication, and Admin (multi-user mode). Changes take effect immediately and persist to `cache/settings.json`.

### UX Page (`/ux`)

Dedicated page for viewing UX monitoring results with charts, manual check controls, and AJAX breakdown modals.

### Theme Builder (`/theme-builder`)

Development tool for creating custom CSS themes. Provides colour pickers grouped by category, a live preview, WCAG contrast ratio report, and CSS/manifest export.

### Test Environment (`/debug/mock`)

Notification testing page available when `MOCK_ENV_ENABLED=true`. Provides controls for simulating stream backlogs, node failures, and service outages to test alert delivery without affecting real environments.

---

## Setup

```
npm install
cp .env.example .env
```

Edit `.env` and add credentials for each environment. Only environments with both `CLIENT_ID` and `CLIENT_SECRET` will appear in the dashboard.

See `.env.example` for the full list of configurable variables with inline documentation.

---

## Usage

```
npm start [-- <initial-environment>]
```

Examples:

```
npm start
npm start -- vnext
npm start -- prod
```

Open `http://localhost:3000`. Environments can be switched at any time via the dropdown in the header. Each browser tab tracks its own selected environment independently.

---

## Environment Configuration

Environments are discovered automatically from `.env` variables following the pattern `{ENV}_CLIENT_ID` and `{ENV}_CLIENT_SECRET`. For each environment, optional fields can be set:

| Variable                  | Purpose                                    |
|---------------------------|--------------------------------------------|
| `{ENV}_CLIENT_ID`         | OAuth client ID (required)                 |
| `{ENV}_CLIENT_SECRET`     | OAuth client secret (required)             |
| `{ENV}_LABEL`             | Display name in the dropdown               |
| `{ENV}_API_HOST`          | Override the derived API hostname           |
| `{ENV}_IDENTITY_HOST`     | Override the derived identity hostname      |
| `{ENV}_COOKIE_USERNAME`   | Auto-auth: local forms-based username       |
| `{ENV}_COOKIE_PASSWORD`   | Auto-auth: local forms-based password       |

Default host derivation follows the pattern `mb-{env}.sharedo.tech` for the API and `mb-{env}-identity.sharedo.tech` for identity, with special handling for `prod`.

---

## Multi-User Mode

When hosting ShareDo Tools for a team, enable multi-user mode by setting `MULTI_USER=true` and `ADMIN_KEY=<passphrase>` in `.env`. This activates:

- User registration with `@mauriceblackburn.com.au` email validation
- Session management via signed cookies (no external dependencies)
- Per-user preferences (theme, high contrast, desktop notifications)
- Admin-gated server settings and cookie management
- User identity display in the header

When `MULTI_USER` is absent or `false`, the application behaves as a single-user local tool with no login required. All existing behaviour is preserved.

See [USAGE.md](USAGE.md) for the registration and admin access walkthrough.

---

## Authentication

The application uses three authentication methods to communicate with ShareDo, cascading automatically depending on endpoint requirements:

| Method           | Used for                                           |
|------------------|----------------------------------------------------|
| Bearer token     | Standard API endpoints (service account OAuth)     |
| Admin cookie     | Admin endpoints (`/admin/*`, modeller, listviews)  |
| Extracted JWT    | Specialised endpoints (indexer status)             |

Cookies can be provided manually (paste in Options), acquired programmatically via OIDC (auto-auth credentials in `.env`), or captured from a Playwright browser login session. Cookies are auto-refreshed on a configurable interval.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full authentication cascade and cookie lifecycle.

---

## File Structure

```
sharedo-monitor/
  server.js                              Express server, API routes, settings, middleware
  package.json
  .env.example                           Configuration template
  .gitignore
  README.md
  ARCHITECTURE.md                        Technical architecture reference
  USAGE.md                               User guide and page instructions
  server/
    auth.js                              Token acquisition, cookie management, HTTP helpers, OIDC flow
    session.js                           Multi-user sessions, registration, admin gating
    health-monitor.js                    Periodic health checks, alert evaluation, SSE, Teams webhooks
    ux-monitor.js                        API probes, Playwright page checks, Web Vitals
    waila-service.js                     Workflow index, search, diff, cache
    worktype-service.js                  Work type config index, search, cache
    metrics-service.js                   JSONL metrics recording, deduplication, pruning
  public/
    shared/
      shared.js                          Header, navigation, env switching, apiFetch, SSE, theme, tooltips
      style.css                          Shared structural CSS, components, high contrast
      themes.css                         Theme aggregator (imports theme files)
      chartTheme.js                      Chart.js theme bridge (reads CSS variables)
      themes/
        manifest.json                    Theme registry
        dark.css                         Dark theme (default)
        light.css                        Light theme
        mb-brand.css                     Maurice Blackburn brand theme
    monitor/
      monitor.html, app.js, monitor-style.css
    issues/
      issues.html, issues.js, issues-style.css
    metrics/
      metrics.html, metrics.js, metrics-style.css
    ux/
      ux.html, ux.js, ux-style.css
    search/
      search.html, search.js, search-style.css
    waila/
      waila.html, waila.js, waila-style.css
    worktype/
      worktype.html, worktype.js, worktype-style.css
    options/
      options.html, options.js, options-style.css
    theme-builder/
      theme-builder.html, theme-builder.js, theme-builder-style.css
    mock/
      mock.html, mock.js, mock-style.css
    register/
      register.html, register.js, register-style.css
  cache/                                 Auto-created, gitignored
    settings.json                        Runtime settings (persisted from Options page)
    metrics/
      {env}/
        streamstats.jsonl                Stream backlog history
        nodestatus.jsonl                 Node status history
    waila-indexes/
      waila-{env}.json                   Cached WAILA workflow index
    worktype-indexes/
      worktype-config-{env}.json         Cached work type config index
    search-presets/
      work-item-query-presets.json       Shared search presets
    user-settings/                       Per-user preferences (multi-user mode)
      {email-slug}.json
    ux-user-data/                        Playwright persistent browser sessions
      {env}/
```

---

## Logging

Log output is grouped by category, each independently toggleable via `.env`:

| Variable        | Category    | Content                                     |
|-----------------|-------------|---------------------------------------------|
| `LOG_ENV`       | Env         | Environment switch events                   |
| `LOG_SETTINGS`  | Settings    | Settings load/save/update                   |
| `LOG_HEALTH`    | Health      | Health monitor lifecycle and check summaries |
| `LOG_ALERT`     | Alert       | Alert dispatch (desktop + Teams)            |
| `LOG_TEAMS`     | Teams       | Teams webhook delivery details              |
| `LOG_COOKIE`    | Cookie      | Cookie set/clear/refresh, acquisition       |
| `LOG_AUTOAUTH`  | AutoAuth    | OIDC acquisition step-by-step detail        |
| `LOG_API`       | API         | ShareDo API errors (4xx/5xx)                |
| `LOG_METRICS`   | Metrics     | Metrics file pruning                        |
| `LOG_WAILA`     | WAILA       | WAILA index build progress                  |
| `LOG_WTINDEX`   | WT-Index    | Work type config index build progress       |
| `LOG_UX`        | UX          | UX monitor probe and page check results     |

All categories default to `true`. Set to `false` to suppress. `LOG_401=false` by default as a sub-filter under `LOG_API` to suppress frequent 401 responses during auth cascade.

When stdout is a TTY, log output is colour-coded per category using ANSI 256-colour codes.

---

## Dependencies

| Package      | Purpose                                                 |
|--------------|---------------------------------------------------------|
| `express`    | HTTP server and routing                                 |
| `dotenv`     | `.env` file loading                                     |
| `playwright` | Browser-based cookie capture, UX page checks (optional) |

Playwright is loaded opportunistically -- if not installed, browser login and UX page checks are disabled. API probes and all other functionality remain available.

Client-side libraries loaded from CDN: Font Awesome 4.7, Chart.js 4.4, chartjs-plugin-zoom, chartjs-plugin-annotation, date-fns, Hammer.js, Prism.js.

---

## Further Reading

- **[ARCHITECTURE.md](ARCHITECTURE.md)** -- Module graph, middleware chain, authentication system, multi-user infrastructure, health/alert pipeline, metrics recording, index services, client-side architecture, theme system, and API route reference.

- **[USAGE.md](USAGE.md)** -- Per-page instructional guide, authentication walkthrough, multi-user setup, Options page reference, theme builder tutorial, and `.env` configuration examples.