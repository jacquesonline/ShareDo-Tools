# ShareDo Tools

```
╔═════════════════════════════════════════════════════════╗
║███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗  ██████╗ ║
║██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗║
║███████╗███████║███████║██████╔╝█████╗  ██║  ██║██║   ██║║
║╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║██║   ██║║
║███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝╚██████╔╝║
║╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ║
║                                                         ║
║████████╗ ██████╗  ██████╗ ██╗     ███████╗              ║
║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝              ║
║   ██║   ██║   ██║██║   ██║██║     ███████╗              ║
║   ██║   ██║   ██║██║   ██║██║     ╚════██║              ║
║   ██║   ╚██████╔╝╚██████╔╝███████╗███████║              ║
║   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝              ║
╚═════════════════════════════════════════════════════════╝
```

A Node.js application for monitoring ShareDo system health, tracking operational metrics, triaging operational issues, querying work items, analysing visual workflows, and inspecting work type configuration across multiple environments. Built as an internal tool for the Maurice Blackburn LSP team.

## Pages

### Monitor (`/`)
System health dashboard covering the ShareDo daily checklist. Displays Event Engine stream stats with backlog alert duration tracking, EE node status with console logs, search index health, Elasticsearch cluster health, SQL Agent jobs, system diagnostics configuration, maintenance plans, linked services, and external reference links. Auto-refreshes at a configurable interval. Each section header includes a direct link to the corresponding ShareDo admin page.

### Metrics (`/metrics`)
Historical metrics dashboard with interactive charts. Displays stream backlog trends and EE node status over time, recorded opportunistically from health checks and monitor refreshes across all environments. Features include summary cards (avg velocity, peak backlog, streams above threshold, time above threshold, node uptime), stop/restart event bar chart, gap detection for connectivity losses, data point sync lines across charts, zoom (Ctrl+scroll, Shift+drag region select), pan (Alt+drag), dataset visibility persistence, and configurable time ranges with quick buttons, date pickers, and navigation arrows. Data stored as per-environment per-metric JSONL files with a 50MB cap and automatic pruning.

### Issues (`/issues`)
Operational issue triage page consolidating items that require investigation or action. Four collapsible sections: EE Processes (errored/running, with drill-down into step-level execution logs), Failed Outbound Emails, Failed Outbound SMS, and SYSADMIN Tasks (production only). All sections support date filtering (Today, 7 Days, custom) and configurable row counts. Process rows are clickable -- opening a modal that shows the full execution plan with step states and expandable log entries per step. Each section header links to the corresponding ShareDo page.

### Search (`/search`)
Work item query tool using the ShareDo `findByQuery` API. Two-column layout with a sticky sidebar. Supports multi-select work types (derived/exact), phase filters, text search, ID and FormBuilder attribute filters, date ranges, ancestor search, configurable enrichment paths, server-side pagination, CSV export, and saved presets shared across the team.

### WAILA (`/waila`)
Workflow Analyser ("What Am I Looking At"). Indexes all visual workflows from the Execution Engine and provides comprehensive search across system names, steps, blocks (by type or display name), action configuration content, and variables. Features include script preview with syntax highlighting and line numbers, environment diff with collapsible result sections, CSV export, and console command copy for opening workflows in ShareDo.

### Work Types (`/worktype`)
Work type configuration visualiser and cross-environment comparison tool. Loads work types from the ShareDo modeller API and presents configuration across six tabs: Aspects (with form builder detail), Phase Plan (SVG workflow visualisation), Roles (permission matrix), Key Dates, Relationships, and Compare (per-type environment diff). Includes a WAILA-pattern config search index that enables cross-cutting queries like "which types use form X" or "which types have aspect Y in zone Z". The sidebar supports tree browsing and full-text search with advanced filters.

### Options (`/options`)
Runtime settings page accessible via the gear icon in the header. Collapsible sections for Appearance (theme, high contrast), Monitor (backlog threshold, auto-refresh, cookie refresh), Notifications (per-condition toggles with duration thresholds, production-only mode), Metrics (recording toggle), WAILA (fetch delay), and Work Types (config index fetch delay). Changes take effect immediately and persist to `cache/settings.json`.

## Setup

```
npm install
cp .env.example .env
```

Edit `.env` and add credentials for each environment. Only environments with both `CLIENT_ID` and `CLIENT_SECRET` will appear in the dashboard.

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

Open `http://localhost:3000`. Environments can be switched at any time via the dropdown in the header.

## File Structure

```
sharedo-monitor/
  server.js                   Express server, API proxy, token management, WAILA index,
                              work type config index, metrics recording, presets,
                              health monitor, SSE alerts
  package.json
  .env.example                Configuration template
  .gitignore
  README.md
  cache/                      Auto-created, gitignored
    settings.json             Runtime settings (Options page overrides)
    metrics/                  Historical metrics data (JSONL per env per metric)
      streamstats-{env}.jsonl
      nodestatus-{env}.jsonl
    waila-indexes/            Cached WAILA workflow index per environment
      waila-{env}.json
    worktype-indexes/         Cached work type config index per environment
      worktype-config-{env}.json
    search-presets/           Shared search presets
      work-item-query-presets.json
  public/
    shared/
      style.css               Shared styles with CSS custom properties (dark/light/high-contrast)
      shared.js               Header, env switching, cookie management, theme, SSE alerts
    monitor/
      monitor.html            Monitor page
      app.js                  Monitor page logic
    metrics/
      metrics.html            Metrics page
      metrics.js              Metrics page logic (Chart.js)
      metrics-style.css       Metrics page styles
    issues/
      issues.html             Issues page
      issues.js               Issues page logic
      issues-style.css        Issues page styles
    search/
      search.html             Search page
      search.js               Search page logic
      search-style.css        Search page styles
    waila/
      waila.html              WAILA page
      waila.js                WAILA page logic
      waila-style.css         WAILA page styles
    worktype/
      worktype.html           Work Types page
      worktype.js             Work Types page logic
      worktype-style.css      Work Types page styles
    options/
      options.html            Options page
      options.js              Options page logic
      options-style.css       Options page styles
```

## Authentication

The application uses three authentication methods depending on the endpoint:

| Method | How obtained | Used for |
|--------|-------------|----------|
| Service bearer token | Automatic via `client_credentials` grant | EE node status, diagnostics config, SQL Agent, ES cluster, search queries, work type tree, work type config (aspects, key dates, roles, forms), WAILA workflow plans |
| Admin cookie (session) | Manual paste from browser, auto-refreshed at configurable interval | Stream stats, list views (processes, outbound comms, SYSADMIN) |
| `_api` JWT | Extracted from admin cookie automatically | Indexer status, EE processes, maintenance plans |

Many endpoints use a cascading auth strategy (`tryAuth`): bearer token first, then `_api` JWT, then cookie. This maximises the chance of success without requiring the user to set a cookie for every endpoint.

### Setting the Admin Cookie

1. Log into ShareDo in your browser
2. Open Dev Tools > Network tab
3. Find any request to an admin endpoint (e.g. stream stats)
4. Copy the full `Cookie` header value
5. Paste into the cookie input bar on the dashboard
6. Click "Set Cookie"

Once set, the server calls `/security/refreshTokens` at the configured interval (default 10 minutes) to keep the session alive. The cookie bar shows auto-refresh status and time until expiry. Cookies are stored in memory per environment -- setting a cookie on one environment doesn't affect others. All environments with cookies refresh independently. Cookies are lost on server restart.

## Monitor Sections

| # | Section | Data Source | Auth | ShareDo Link |
|---|---------|------------|------|--------------|
| 1 | Event Engine -- Stream Stats | `/admin/diagnostics/eventengine/streamStats`, `/api/_ee/monitor`, `/api/_ee/monitor/{node}/console/stdout` | Cookie, Bearer, Bearer | `/admin/event-engine-config-service` |
| 2 | Search Index Health | `/api/elasticsearch/status`, `/api/indexer/status` | Bearer, _api JWT | `/admin/search-indexes` |
| 3 | SQL Agent & Reporting Jobs | `/api/reports/agent/jobs`, `/api/reports/agent/checks` | Bearer | `/admin/reports-jobs` |
| 4 | System Diagnostics Config | `/api/admin/diagnostics/config` | Bearer | `/admin/diagnostics-config` |
| 5 | Maintenance Plans | `/api/listview/core-admin-maintenance-plans/...` | tryAuth cascade | `/admin/maintenance-plans` |
| 6 | Linked Services | `/api/admin/serviceIntegrations` | tryAuth cascade | `/admin/oauth` |
| 7 | External Links | Static links (no API) | N/A | -- |

### Header Summary Pills

EE Streams, EE Nodes, Search Indexes, ES Cluster, SQL Agent, Diagnostic Config, Maintenance, Linked Services.

### Daily Checklist Coverage

| Checklist Item | Coverage | Location |
|---|---|---|
| iManage SPM health | External link | Monitor |
| EE errored processes | Full data section with drill-down | Issues |
| EE running workflows | Full data section | Issues |
| EE stream stats / backlogs | Data section with alert duration | Monitor |
| EE node status + console logs | Data section | Monitor |
| Search indexes | Data section | Monitor |
| SQL Agent reporting jobs | Data section | Monitor |
| Maintenance plans | Data section | Monitor |
| Outbound Email failures | Full data section with parent matter links | Issues |
| Outbound SMS failures | Full data section with parent matter links | Issues |
| SYSADMIN list view | Full data section (production only) | Issues |
| Linked services (iManage, DocuSign) | Data section | Monitor |
| System diagnostics config | Data section | Monitor |
| Freshservice tickets | External link | Monitor |

### Backlog Threshold

All streams use a single configurable threshold for red/critical colouring and alert duration tracking. Set `BACKLOG_THRESHOLD` in `.env` (default: 250) or override via the Options page. The alert duration timer starts when a stream's backlog exceeds this threshold and clears when it drops back below.

## Issues Page

### EE Processes

Displays errored and/or running EE processes from the `core-admin-active-processes` list view. State filter checkboxes (Errored, Running), date filter (Today, 7 Days, custom, clear), configurable rows per page (default 10), and pagination.

Clicking a process row opens a detail modal that fetches the execution plan (`GET /api/executionengine/plans/executing/{processId}`). The modal shows all workflow steps with colour-coded state badges (COMPLETE, ERRORED, RUNNING, NONE). Clicking a step fetches and displays its execution log (`GET /api/executionengine/plans/executing/{processId}/steps/{stepId}/log`). Log entries are colour-coded by level (System grey, Information blue, Warning amber, Error red). Errored steps auto-expand on modal open.

The modal header includes the plan title, system name, and a link to the associated work item in ShareDo.

### Failed Outbound Emails / SMS

Displays failed email and SMS tasks from custom list views (`custom-admin-failed-outbound-emails`, `custom-admin-failed-outbound-sms`). Shows reference, title, created date, and parent matter (as a clickable link to the matter in ShareDo). Date filtering and pagination supported.

### SYSADMIN Tasks

Displays tasks from the SYSADMIN work item list view (`custom-mb-worklist-all-short` with the SYSADMIN context ID). Only visible when the current environment is production. Shows reference, title, description (truncated with hover expand), created date, tags, and owner. Date filtering supported.

## Search Page Features

### Filter Sections

| Section | Fields |
|---------|--------|
| Presets | Save/load named filter configurations shared across the team via server-side storage |
| Types & Phase | Work type multi-select with searchable tree dropdown (derived from / exact match modes), phase checkboxes (open, closed, removed) |
| Text Search | Title, reference, free text with wildcard start/end toggles |
| ID Filters | Work item IDs (chip input), external reference, FormBuilder attribute search (contains or exact match modes with comma-separated multi-value support) |
| Dates | Created from/to, updated from/to (inclusive of full day) |
| Ancestor Search | Ancestor IDs (chip input), max distance, include related toggle |
| Sort & Enrichment | Sort field/direction, configurable enrich paths (add/remove, drives table columns) |

### Enrichment

Enrich paths control which columns appear in the results table. Default paths are `id`, `reference`, `title`, `parent.id`, `parent.reference`, `parent.title`. Custom paths can be added (e.g. `parent.urls.view`, `keyDates.kd-limitation-limitation-date.taskDueDate.date.local.value`).

Paths ending with `urls.view`, `urls.open`, `urls.edit`, or `urls.portal` (including prefixed paths like `parent.urls.view` or `ancestors!q?path=matter!1.urls.view`) are automatically rendered as clickable hyperlinks in the results table. The CSV export always uses the raw value regardless of display formatting.

### Attribute Search

FormBuilder attributes can be searched in two modes:

| Mode | Behaviour | Example |
|------|-----------|---------|
| Contains | Partial text match on the attribute value | Key: `ud-injury-type`, Value: `shoulder` |
| Exact | Value must exactly match one of the provided values (comma-separated) | Key: `ud-status`, Value: `approved, pending` |

Omitting the value field checks for the attribute's presence regardless of its value.

### Presets

Search filter presets are stored server-side in `cache/work-item-query-presets.json` and shared across all users. Saving with an existing name overwrites the previous preset. Presets capture all filter state including types, phases, text fields, dates, IDs, ancestors, attributes, sort, and enrich paths. Presets are cross-environment -- the same presets appear regardless of which ShareDo environment is selected. Presets are forward-compatible: loading a preset saved before a new filter was added gracefully defaults the missing field.

### CSV Export

Exports up to 10,000 results across multiple pages. The export fetches each page sequentially and combines them into a single CSV file. CSV injection protection is applied to all cell values.

## WAILA Page Features

### Workflow Index

WAILA builds a searchable index of all visual workflows by fetching each workflow plan from the Execution Engine API (`GET /api/executionengine/visualmodeller/plans/{systemName}`). The index stores workflow metadata, steps, actions (with block types and configuration), and variables.

The index is built on demand via the "Build Index" button and cached both in server memory and on disk (`cache/waila-{env}.json`). The disk cache survives server restarts -- on startup, any existing cache files are loaded automatically. The index status bar shows the workflow count and build timestamp so users can see when the cache was last refreshed.

### Search

| Field | What it searches |
|-------|-----------------|
| Unified search | All fields simultaneously (multi-term AND logic) |
| System Name / Workflow Name | Workflow `systemName` and `name` |
| Step Name / System Name | Step display names and system names |
| Block Type (actionSystemName) | The system name of workflow blocks (e.g. `createTask`, `script`, `ifBlock`, `SetAttribute`) |
| Block Display Name | The display name of workflow blocks |
| Config Content | Free text within the JSON configuration of every block action |
| Variable | Variable names, system names, and types |

### Advanced Search Options

| Toggle | Behaviour |
|--------|-----------|
| Exact Match | Requires the full search string to match exactly (no substring matching for field-level searches, no word splitting for unified search) |
| Case Sensitive | Available when Exact Match is on. Matches case exactly. |

### Result Cards

Each result card shows the workflow name, system name, step count, and action count. Cards expand to show match context: which steps, blocks, config excerpts, and variables matched the search term. Match terms are highlighted in amber.

Each card has three action buttons:

| Button | Icon | Action |
|--------|------|--------|
| Script preview | `</>` | Opens a modal with the full compiled JavaScript source (syntax highlighted via Prism.js). Includes a Copy button. |
| Copy system name | Clipboard | Copies the workflow system name to clipboard |
| Copy open command | Terminal | Copies a `$ui.nav.openPanelCommand(...)` console command that opens the workflow blade in ShareDo |

### Script Preview

The script preview fetches the compiled JavaScript via `POST /api/executionengine/visualmodeller/plans/{systemName}/preview`. This is an on-demand call (not cached) as the compiled output can be large. The modal provides syntax highlighting with line numbers (Prism.js Tomorrow Night theme, with light theme overrides), scrollable viewing, and a Copy button that copies the raw script text.

### Environment Diff

Compares the WAILA index of the current environment against another. Both environments must have their index built. The diff shows:

| Category | Colour | Meaning |
|----------|--------|---------|
| Only in current env | Red | Workflows that exist here but not in the target |
| Only in target env | Green | Workflows that exist in the target but not here |
| Changed | Amber | Workflows present in both but with differences |

Changed workflows show a summary line (step count and action count differences). Clicking a changed workflow expands step-level detail showing which steps were added, removed, renamed, or had their block count changed, plus variable additions and removals.

### CSV Export

Exports all matching workflow names and system names to a CSV file named `WAILA-export-{dd-mm-yy}-{searchterm}.csv`.

## Work Types Page Features

### Work Type Visualiser

Loads the work type tree from the ShareDo modeller API and displays configuration across six tabs per type:

| Tab | Content |
|-----|---------|
| Aspects | Aspect list grouped by zone with inherited/hidden/rules/FormBuilder indicators. Click an aspect for detail panel showing configuration, form builder info, and permissions |
| Phase Plan | SVG workflow visualisation of the phase configuration |
| Roles | Role permission matrix showing granted, partial, and by-phase permissions |
| Key Dates | Key date configuration with mandatory, allow-multiple, date-only, always-on-form, and category fields |
| Relationships | Relationship type configuration |
| Compare | Per-type environment diff for aspects (side-by-side), key dates, and roles (unified diff tables) |

The info bar shows the work type name, system name, and badges for abstract, core, portals, and derived-from status.

### Config Search Index

A WAILA-pattern searchable index of work type configuration across all types in the current environment. Built on demand via the "Build Index" button. Indexes aspects (including form builder details), key dates, and roles per type.

The sidebar supports two modes:
- **Tree mode** -- browse the work type hierarchy with expand/collapse
- **Search mode** -- full-text search across indexed configuration with advanced filters (type, zone, exclude terms)

Search enables cross-cutting queries like "which types use form X", "which types have aspect Y in zone Z", or "which types don't have a specific key date".

### Compare Tab

Compares a work type's configuration between the current environment and a selected target environment. Three comparison views:

| View | Layout | Matching |
|------|--------|----------|
| Aspects | Side-by-side columns grouped by zone | Matched by zone + aspect system name + form ID |
| Key Dates | Unified table with status badges | Matched by key date type |
| Roles | Unified table with permission pills | Matched by role system name |

Diff states are colour-coded: green (only in target), red (only in current), amber (changed with inline detail), grey (same).

## Metrics Page Features

### Charts

| Chart | Type | Data |
|-------|------|------|
| Stream Backlogs | Line (time series) | Backlog count per stream over time |
| EE Node Status | Line (time series) | Running process count per node over time |
| Stop/Restart Events | Horizontal bar | Aggregate stopped and restarting counts per node |

Charts use Chart.js with the date-fns adapter for time scales. Gap detection automatically breaks line connections when data collection was interrupted (e.g. connectivity loss, server restart). Gaps are identified when the interval between consecutive points exceeds 3x the median interval.

### Chart Interactions

| Action | Behaviour |
|--------|-----------|
| Shift+Drag | Region select zoom |
| Alt+Drag | Pan |
| Ctrl+Scroll | Wheel zoom in/out |
| Click data point | Sync line across both time charts |
| Click empty area | Clear sync line |
| Ctrl/Shift/Cmd + click legend | Solo -- hide all other datasets |
| Click legend | Toggle single dataset |
| Eye/eye-slash buttons | Show/hide all datasets |
| Reset zoom button | Return to full view (appears when zoomed) |

Dataset visibility is persisted across data reloads.

### Summary Cards

| Card | Calculation |
|------|-------------|
| Avg Velocity | Mean of consecutive interval deltas (events/min). Green if draining, red if accumulating |
| Peak Backlog | Highest single stream backlog in range, with stream name and time |
| Streams Above Threshold | Count of distinct streams that exceeded the backlog threshold |
| Time Above Threshold | Percentage of data points with at least one stream in breach, shown as duration |
| Node Uptime | Percentage of data points where all nodes were healthy, shown as duration |

### Time Range Controls

| Control | Purpose |
|---------|---------|
| Quick buttons (1h, 6h, 24h, 3d, 7d, All, Today) | Preset relative ranges |
| From/To date pickers | Arbitrary date range (either or both) |
| Navigation arrows | Step backward/forward by current range width |
| Today slider | Hour-level range within the current day (shown when Today is selected) |

### Data Recording

Metrics are recorded opportunistically during health checks (all environments) and monitor page refreshes (current environment). A 30-second minimum interval between writes per environment per metric prevents duplicates. Recording can be disabled via Options. Files are stored as JSONL in `cache/metrics/` with a 50MB per-file cap.

## Environment Configuration

Each environment is defined by keys in `.env`:

| Key | Required | Description |
|-----|----------|-------------|
| `{ENV}_CLIENT_ID` | Yes | OAuth client ID |
| `{ENV}_CLIENT_SECRET` | Yes | OAuth client secret |
| `{ENV}_LABEL` | No | Display name (defaults to ENV uppercase) |
| `{ENV}_API_HOST` | No | Override API host |
| `{ENV}_IDENTITY_HOST` | No | Override identity host |

Host derivation defaults:
- API: `mb-{env}.sharedo.tech` (prod: `mauriceblackburn.sharedo.tech`)
- Identity: `mb-{env}-identity.sharedo.tech`

## Server Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `PORT` | 3000 | Server port |
| `BACKLOG_THRESHOLD` | 250 | Stream backlog threshold for red status and alert timer (Options overrideable) |
| `ALERT_DURATION_THRESHOLD` | 60 | Seconds a condition must persist before a desktop notification fires (Options overrideable) |
| `WAILA_FETCH_DELAY` | 100 | Milliseconds between individual workflow plan fetches during WAILA index build (Options overrideable) |
| `WT_INDEX_FETCH_DELAY` | 100 | Milliseconds between API calls during work type config index build (Options overrideable) |
| `LOG_401` | false | Log API 401 errors to console (noisy during auth cascade) |

All outbound HTTPS requests to ShareDo have a 15-second timeout. If a request hangs, it resolves with an error and the auth cascade moves to the next method. This prevents slow or unresponsive ShareDo endpoints from blocking the server's event loop.

## Caching

The `cache/` directory is created automatically and is gitignored. Subdirectories are created on demand.

| Path | Purpose | Created by |
|------|---------|------------|
| `settings.json` | Runtime settings overrides from Options page | Options page save |
| `metrics/streamstats-{env}.jsonl` | Stream backlog history per environment | Health checks, monitor refreshes |
| `metrics/nodestatus-{env}.jsonl` | Node status history per environment | Health checks, monitor refreshes |
| `waila-indexes/waila-{env}.json` | WAILA workflow index per environment | Index build (automatic on completion) |
| `worktype-indexes/worktype-config-{env}.json` | Work type config index per environment | Config index build |
| `search-presets/work-item-query-presets.json` | Shared search presets | Preset save (any user) |

Cache files are plain JSON/JSONL and can be safely deleted to force a rebuild. WAILA indexes, work type config indexes, and settings are loaded on server startup if present. Metrics files are append-only with a 50MB per-file cap; when exceeded, the oldest 20% of entries are pruned automatically. A minimum 30-second interval between recordings per environment per metric prevents duplicate writes from overlapping health checks and monitor refreshes.

## Options Page (`/options`)

Centrally aligned settings page accessible via the gear icon in the header. Changes take effect immediately and are saved to `cache/settings.json`.

| Setting | Section | Description |
|---------|---------|-------------|
| Theme | Appearance | Dark / Light mode toggle, applied across all pages |
| High Contrast | Appearance | Solid-background badges/pills/chips for improved readability. Dark mode uses black text, light mode uses white text |
| Backlog Threshold | Monitor | Stream backlog threshold for red/critical status |
| Auto-refresh Interval | Monitor | How often the Monitor page auto-refreshes (seconds) |
| Cookie Refresh Interval | Monitor | How often admin session cookies are refreshed (minutes) |
| Desktop Notifications | Notifications | Master toggle for browser notifications |
| Production Only | Notifications | Suppress non-production alerts (all environments still monitored) |
| Stream Backlog | Notifications | Per-condition toggle for stream backlog alerts |
| EE Node Down | Notifications | Per-condition toggle for node failure alerts |
| Linked Services | Notifications | Per-condition toggle for service health alerts |
| Use Alert Duration Threshold | Notifications | Per-condition toggle: apply duration delay or alert immediately |
| Alert Duration Threshold | Notifications | Seconds a condition must persist before notifying |
| Record Metrics | Metrics | Enable/disable recording stream and node data to disk |
| Fetch Delay | WAILA | Delay between workflow plan fetches during index build (ms) |
| Config Index Fetch Delay | Work Types | Delay between API calls during work type config index build (ms) |

## Desktop Notifications

When enabled via the Options page, the server runs an independent health monitor that checks all configured environments at the configured auto-refresh interval. This runs regardless of which page is open or which environment is selected in the browser.

Each condition type can be individually toggled:
- **Stream Backlog** -- a stream backlog exceeds the configured threshold
- **EE Node Down** -- a node has stopped or restarting processes
- **Linked Services** -- a critical service (iManage, DocuSign) becomes unhealthy

Each condition type has an independent "Use Alert Duration Threshold" toggle. When enabled, the condition must persist for the configured duration before alerting. When disabled, the alert fires immediately on detection. This allows, for example, immediate node-down alerts while still delaying backlog alerts to filter transient spikes.

The **Production Only** toggle suppresses alerts for non-production environments. All environments are still monitored (state tracked, duration timers running) so disabling this toggle immediately surfaces any active conditions without restarting timers.

Notifications use a **first-check suppression** -- the first health check after enabling notifications or restarting the server populates state only, without firing alerts. This prevents notifications for pre-existing conditions.

Alerts are delivered via Server-Sent Events (SSE) from the server (`GET /api/alerts/stream`). The SSE connection is only opened if notifications are enabled and browser permission is granted. The connection is cleanly closed on page navigation to avoid consuming browser connection slots.

The Options page includes a Test button that sends mock alerts through the SSE pipeline to verify the full chain (server push, SSE delivery, desktop notification).

## Theming

The application supports dark and light modes, with an optional high contrast mode. Theme and contrast preferences are toggled on the Options page and applied across all pages immediately. Preferences are stored both server-side (in `settings.json`, shared across users) and in `localStorage` (for instant application on page load to avoid a flash of the wrong theme).

All colour values use CSS custom properties defined on `:root` (dark) and `.light-theme` (light). High contrast mode (`.high-contrast`) overrides badge, pill, chip, and status indicator styles to use solid accent-colour backgrounds with standardised text colours: black text in dark mode, white text in light mode. Page-specific stylesheets reference the same variables, ensuring consistent theming across all pages.

## URL Routing

| URL | Page |
|-----|------|
| `/` | Monitor |
| `/metrics` | Metrics |
| `/issues` | Issues |
| `/search` | Search |
| `/waila` | WAILA |
| `/worktype` | Work Types |
| `/options` | Options |

Clean URLs are handled by explicit Express routes that serve the corresponding HTML files from the `public/` subdirectories. Static assets (CSS, JS) are served by Express's static middleware from the same directory structure.