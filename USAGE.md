# ShareDo Tools: Usage Guide

Instructional guide for day-to-day use and team onboarding. For technical internals, see [ARCHITECTURE.md](ARCHITECTURE.md). For setup and configuration, see [README.md](README.md).

---

## Table of Contents

- [Getting Started](#getting-started)
- [Environment Switching](#environment-switching)
- [Authentication](#authentication)
- [Monitor Page](#monitor-page)
- [Issues Page](#issues-page)
- [Metrics Page](#metrics-page)
- [UX Monitor Page](#ux-monitor-page)
- [Search Page](#search-page)
- [WAILA Page](#waila-page)
- [Work Types Page](#work-types-page)
- [Options Page](#options-page)
- [Theme Builder](#theme-builder)
- [Test Environment](#test-environment)
- [Multi-User Mode](#multi-user-mode)
- [Environment Configuration Examples](#environment-configuration-examples)

---

## Getting Started

After completing the [setup steps in the README](README.md#setup):

1. Run `npm start` (optionally append `-- vnext` or another environment name to set the initial selection)
2. Open `http://localhost:3000`
3. If you have auto-auth credentials configured in `.env`, cookies are acquired automatically on startup
4. If not, navigate to Options > Authentication to provide a session cookie (see [Authentication](#authentication))

The Monitor page loads as the landing page and begins auto-refreshing immediately.

---

## Environment Switching

The environment dropdown in the header controls which ShareDo instance all pages operate against. Switching environments:

- Updates the host label and cookie status indicator
- Triggers a data refresh on the current page
- Persists the selection to `localStorage` so it survives page refreshes

Each browser tab tracks its own environment independently. Two tabs can be open against different environments simultaneously without interference.

---

## Authentication

Many ShareDo admin endpoints require a browser session cookie beyond the service account bearer token. Without a cookie, some Monitor sections (stream stats, linked services), the Issues page, WAILA index builds, and Work Type detail views will return limited data.

### Three Ways to Provide a Cookie

**Option 1: Auto-Auth (Recommended for Non-Production)**

Set `{ENV}_COOKIE_USERNAME` and `{ENV}_COOKIE_PASSWORD` in `.env` for each environment that has a local forms-based account. On startup, the application runs the full OIDC flow automatically and acquires a session cookie. This is the simplest approach for environments where an admin service account with form-based credentials exists.

Not available for environments using Azure AD SSO exclusively (e.g. Production).

**Option 2: Browser Login**

In Options > Authentication, click the browser icon next to an environment. A Chromium window opens pointed at the ShareDo admin page. Log in as you normally would (including SSO). The application captures the session cookies automatically once login completes. The window can be closed after capture.

Requires Playwright to be installed: `npm install playwright && npx playwright install chromium`.

If a previous browser login was performed, the session may be restored from the persistent browser data automatically on next startup (no manual login needed until the session expires).

**Option 3: Manual Cookie Paste**

In Options > Authentication, click the paste icon next to an environment. Paste the full cookie string from your browser's developer tools (Application > Cookies, or from a network request's `Cookie` header). This is the fallback option when neither auto-auth nor browser login is available.

To extract the cookie from your browser: open ShareDo admin in your browser, open DevTools (F12), go to the Network tab, find any request to the ShareDo host, right-click the `Cookie` request header, and copy the value.

### Cookie Lifecycle

Once a cookie is set (by any method), the application automatically refreshes it every 10 minutes (configurable in Options > Monitor > Cookie Refresh Interval). The cookie status indicator in the header shows the expiry time and whether auto-refresh is active. If a refresh fails with 401, auto-refresh stops and the cookie is marked as expired.

---

## Monitor Page

The landing page provides a system health overview organised into collapsible sections.

### Summary Bar

The coloured pills at the top aggregate status across all sections: green = healthy, amber = warnings, red = errors. Each pill links to its corresponding section.

### Event Engine Section

Displays all Event Engine streams with their backlog and connection counts. Streams are sorted by importance (critical streams like `executionengine-cc` appear first). The Alert Duration column shows how long a stream has been in breach of the backlog threshold.

Below the stream table, EE Node cards show each node's status with a compact console log preview (last 8 lines of stdout).

### Other Sections

- **Search Index Health**: Elasticsearch cluster health, index state cards with backlog/event counts, and event store stream details
- **SQL Agent & Reporting Jobs**: Job execution history and health check results
- **System Diagnostics Config**: ShareDo configuration key/value pairs
- **Maintenance Plans**: Scheduled maintenance tasks with next run times
- **Linked Services**: Integration health for services like iManage and DocuSign (critical services are highlighted)
- **External**: Quick links to frequently used external pages (Outbound Comms Failures, SYSADMIN, iManage SPM, Freshservice)

### Controls

- **Auto Refresh**: Toggle on/off with the switch. Default interval is 30 seconds, configurable in Options.
- **Expand/Collapse All**: Buttons in the page header to expand or collapse all sections at once.
- **External Links**: Each section header includes an icon that opens the corresponding ShareDo admin page.

---

## Issues Page

Consolidates operational items that require investigation or action.

### Sections

1. **EE Processes**: Errored and optionally running processes. Rows are clickable -- opening a modal with the full execution plan. Each step shows its state (complete, errored, running, pending) and is expandable to reveal the step-level log with timestamped entries colour-coded by level (System, Information, Warning, Error).
2. **Failed Outbound Emails**: Failed email communications with reference, title, created date, and parent matter.
3. **Failed Outbound SMS**: Same structure as emails.
4. **SYSADMIN Tasks**: Production only. Shows tasks assigned to the SYSADMIN user with reference, title, description, created date, tags, and owner.

### Filtering

Each section has date quick filters (Today, 7 Days), a custom date picker, and a clear button. The Processes section additionally has state checkboxes (Errored, Running) and a configurable rows-per-page input.

Date filters persist within the session. Use "Refresh All" to reload all sections simultaneously.

---

## Metrics Page

Historical charts for stream backlogs, node status, and connections over time.

### Loading Data

1. Select an environment from the dropdown
2. Click **Load** to fetch metric data from the server
3. Alternatively, click the folder icon to load data from local JSONL backup files

### Time Range Controls

- **Quick buttons**: 1h, 6h, 24h, 3d, 7d, All, Today
- **Navigation arrows**: Step backward/forward by the current range width
- **Date pickers**: Set custom From/To range
- **Today mode**: Enables a dual-handle slider to narrow the time window within the current day

### Chart Interaction

- **Zoom**: Ctrl+Scroll to zoom, or Shift+Drag to select a region
- **Pan**: Alt+Drag to pan the visible range
- **Reset Zoom**: Click the magnifying glass icon in the chart header
- **Legend**: Click to toggle dataset visibility. Ctrl/Shift/Cmd + click to solo a single dataset.
- **Sync line**: Hovering a data point on one chart draws a vertical line across all charts at the same timestamp
- **Threshold line**: Toggle the backlog threshold reference line via the bar chart icon on the Stream Backlogs chart

### Summary Cards

Displayed above the charts when data is loaded: average velocity, peak backlog, streams above threshold, time above threshold, node uptime, and connection drops.

### Backup Files

The folder icon accepts `.jsonl` files with names matching the pattern `streamstats.jsonl` or `nodestatus.jsonl` (with optional environment suffix). Loaded files appear as chips below the controls and replace server data until cleared.

---

## UX Monitor Page

Displays API probe and page load performance data with interactive charts.

### Loading Data

Select the monitoring environment from the dropdown (typically `prod`) and click **Load**. Data can also be loaded from local JSONL backup files.

### Summary Cards

Per-URL cards show the latest LCP (hero metric), FCP, TTI, total load time, and check count. Cards are colour-coded (green/amber/red) based on Web Vital thresholds. Click a card to filter the detail charts to that specific URL.

### Charts

- **Page Performance Comparison**: Overlays a selected metric (LCP, FCP, TTI, Total Load, Slowest AJAX) across all page targets
- **Web Vitals Over Time**: FCP, LCP, TTI trend lines for the selected URL filter
- **API Probe Response Times**: Per-probe response time trend lines

Charts support the same zoom/pan/legend interactions as the Metrics page.

### AJAX Detail Modal

Click a data point on a page check chart to open a modal showing the navigation timing breakdown (TTFB, DOM processing, render), Web Vitals snapshot, and a ranked table of AJAX requests captured during that page load.

### Manual Checks

At the bottom of the page, controls allow running API probes, all page targets, or a single ad-hoc URL check on demand.

---

## Search Page

Work item query builder using the ShareDo `findByQuery` API.

### Building a Query

The left sidebar provides collapsible sections for each query parameter:

- **Work Types**: Filter by type from the tree dropdown. Toggle between "Derived" (includes child types) and "Exact" (only the selected type). Multiple types can be selected (shown as chips).
- **Phase**: Checkboxes for Open, Closed, Removed
- **Text Search**: Full-text search field and search mode selector
- **Work Item IDs**: Comma-separated IDs or GUIDs
- **Ancestor**: Search within children of a specific work item
- **FormBuilder Attributes**: Key/value pairs with search/exact mode per attribute
- **Date Range**: Created date From/To
- **Enrichment**: Configurable paths that determine which fields are returned. Default paths include id, reference, title, and parent fields. Custom paths can be added.
- **Pagination**: Rows per page and page number

### Running a Search

Click **Search** or press Enter. Results appear in a table with columns matching the enrichment paths. The result count and pagination controls appear above the table.

### Presets

Save the current query configuration as a named preset. Presets are shared across all users (stored server-side in `cache/search-presets/`). Load a preset to restore all query parameters. Delete presets with the trash icon.

### CSV Export

Click the download icon in the results header to export the current result set as a CSV file.

---

## WAILA Page

Workflow Analyser for searching across all visual workflow definitions.

### Building the Index

1. Ensure a cookie is set for the current environment (index builds require admin-level API access)
2. Click **Build Index** in the sidebar
3. The progress indicator shows the current workflow being fetched and the overall count
4. Once complete, the index status shows "Ready" with the workflow count and build timestamp

The index is cached to disk and restored automatically on server restart. Rebuild to pick up changes.

### Searching

**Unified Search**: Enter any text in the search box. Searches across workflow system names, step names, block types, display names, action configuration content, and variables.

**Advanced Filters** (toggle with the Filters button):

- System Name / Workflow Name
- Step Name / System Name
- Block Type (the `actionSystemName`, e.g. `createTask`, `script`, `ifBlock`)
- Block Display Name (the user-visible label)
- Config Content (searches within action configuration JSON)
- Variable (name, system name, or type)
- Exact Match / Case Sensitive toggles

Filters use AND logic between fields. Leave a field blank to skip it.

### Results

Each result card shows the workflow name, system name, step/action counts, and match highlights. Cards are expandable to show matched steps, actions, config excerpts, and variables. Click a result to open the full workflow detail.

### Script Preview

Click the code icon on a result card to generate and display the workflow's compiled script with syntax highlighting and line numbers (via Prism.js). The script can be copied to clipboard.

### Environment Diff

Select a target environment from the dropdown and click **Compare** (both environments must have a built index). The diff shows workflows only in the current env, only in the target, changed workflows (with step/action/variable differences), and the identical count.

### Console Command

Hovering a result card reveals a terminal icon. Clicking it copies a console command that opens the workflow directly in the ShareDo visual modeller.

---

## Work Types Page

Work type configuration visualiser with two sidebar modes.

### Tree Mode (Default)

The sidebar displays the full work type hierarchy. Use the filter input to narrow the tree. Click a type to load its configuration in the detail panel.

### Config Search Mode

Toggle to "Config Search" in the sidebar header to switch to index-based search.

1. Click **Build** to index all work type configurations (requires cookie)
2. Enter a search term or use the advanced filters (Aspect Name, Form Title, Key Date Name, Role Name)
3. Results appear as cards. Click a card to load that type's full detail.
4. The **Exclude** checkbox inverts the search -- returns types that do NOT match (useful for "which types are missing aspect X?")

### Detail Tabs

**Aspects**: Two-panel layout. The left panel lists all aspects grouped by zone (e.g. summary, detail, sidebar). Click an aspect to view its configuration in the right panel, including inherited-from source, form builder details, visibility rules, and rule set names.

**Phase Plan**: SVG visualisation of the type's workflow phases with transitions. Click a phase to view its configuration.

**Roles**: Participant roles with permissions displayed as a matrix. Each role shows its source (direct, inherited), active state, and permission set.

**Key Dates**: Key date definitions with mandatory/optional, allow-multiple, date-only flags, and owning type information.

**Relationships**: Type relationships showing related types, relationship type, and configuration flags.

**Compare**: Cross-environment comparison. Select a target environment from the dropdown and click Compare. Shows a merged view of aspects, key dates, and roles with diff highlighting (added, removed, changed).

---

## Options Page

Runtime settings organised into a left-nav layout with a Save button. Changes take effect immediately on save and persist to `cache/settings.json`.

### Appearance

- **Theme**: Select from available themes (Dark, Light, MB Brand, or any custom themes)
- **High Contrast**: WCAG-compliant high contrast mode that replaces tinted backgrounds with solid accent colours
- **Chart Backgrounds**: Fill chart canvas backgrounds (useful for right-click > Save Image)

### Monitor

- **Backlog Threshold**: Streams above this value display as critical
- **Auto-Refresh Interval**: Health check polling interval in milliseconds
- **Cookie Refresh Interval**: How often session cookies are refreshed

### Notifications

- **Desktop Alert Monitoring** (server-level): Master switch for whether the health monitor evaluates alert conditions. In multi-user mode, only admins can toggle this.
- **Desktop Notifications** (per-user): Whether this browser shows notification popups from the alert stream
- **Sub-toggles**: Individual enable/disable for Streams, Connections, Nodes, and Services, each with a "Use Alert Duration" option
- **Alert Duration Threshold**: Seconds a condition must persist before triggering
- **Recovery Threshold**: Percentage below backlog threshold before a stream breach clears
- **Grace Period**: Seconds before a re-trigger resets the duration timer
- **Production Only**: Restrict alerts to the production environment
- **Zero Connection Streams**: Comma-separated list of streams to monitor for zero connections (empty = all)
- **Teams Webhook**: Read-only status indicator showing whether Teams integration is enabled (configured via `.env`)
- **Test buttons**: Send test alerts via desktop and/or Teams

### Metrics

- **Metrics Recording**: Enable/disable JSONL metric file recording
- **Recording Interval**: Minimum seconds between writes per metric per environment

### UX Monitor

- **UX Monitor Enabled**: Master toggle
- **Auto Probes / Auto Pages**: Enable automatic probe and page check cycles
- **Probe/Page Intervals**: Cycle frequency in seconds
- **Probe Environment**: Which environment to probe
- **Alert toggles**: Enable/disable alerts for probes, pages, and session expiry
- **Probe/Vital Thresholds**: Warn and critical thresholds for API response times and Web Vitals (FCP, LCP, TTI)
- **Work Item ID**: GUID for work item-specific probes and page checks
- **Page Targets**: Comma-separated URL paths for page check cycles
- **Probe table**: Enable/disable individual probes, run manually, view latest results

### WAILA

- **Fetch Delay**: Milliseconds between individual workflow plan fetches during index build (lower = faster build, higher = less API load)

### Work Types

- **Config Index Fetch Delay**: Same concept as WAILA fetch delay but for type config index builds

### Authentication

Displays each environment's auth status: cookie source (autoauth, browser, manual), identity, expiry, and auto-refresh state. Controls for paste, clear, reacquire (re-run OIDC), and browser login.

### Admin (Multi-User Mode Only)

Visible only when multi-user mode is enabled. Provides:

- **Admin Key**: Enter the admin passphrase to gain admin access
- **Logout**: End the current session

---

## Theme Builder

Development tool for creating custom CSS themes.

### Workflow

1. Select a starting base (Dark or Light) and click **Load**
2. Adjust colours using the colour pickers and hex inputs, grouped by category: Surfaces, Borders, Text, Accents, Navigation, Guidance, Scrollbar/Phase
3. View the live preview panel to see changes in real time
4. Check the Contrast Report for WCAG compliance (AAA, AA, AA Large, Fail ratings)
5. Set metadata: theme ID (used as the CSS selector and file name), display label, icon class, and light-based flag
6. Export: copy the generated CSS, copy the manifest JSON entry, or download the CSS file

### Installation

1. Save the downloaded CSS file to `public/shared/themes/`
2. Add an `@import` line to `public/shared/themes.css` (e.g. `@import url("themes/my-theme.css");`)
3. Add the manifest entry to `public/shared/themes/manifest.json`
4. Restart the server (or refresh the page if only CSS changed)

The new theme will appear in the Options > Appearance theme dropdown.

---

## Test Environment

Available when `MOCK_ENV_ENABLED=true` in `.env`. Accessed at `/debug/mock` or by selecting "Test Env" from the environment dropdown.

### Purpose

Test notification delivery, alert duration thresholds, recovery behaviour, and grace period logic without affecting real ShareDo environments.

### Controls

- **Stream Backlogs**: Adjust backlog values and connection counts for each mock stream. Quick buttons set values relative to the configured threshold.
- **EE Nodes**: Toggle nodes between running, stopped, and restarting states.
- **Linked Services**: Toggle services between healthy and unhealthy.

### Stream Stats Panel

Shows the current mock state as seen by the health monitor, including backlog values and alert duration timers. Click Refresh to poll the latest data from the server.

### Alert Log

Real-time log of alerts fired during the session. Each entry shows the timestamp, alert type, title, and body. The log is populated from the SSE alert stream and clears on page refresh.

### Settings Bar

Displays the current notification settings (backlog threshold, alert duration, recovery threshold, grace period) with a link to Options > Notifications for adjustment.

---

## Multi-User Mode

### Enabling

Set in `.env`:

```
MULTI_USER=true
ADMIN_KEY=your-secret-passphrase
SESSION_EXPIRY_DAYS=30
```

The server validates on startup that `ADMIN_KEY` is set when `MULTI_USER=true` and exits with an error if missing.

### Registration

When multi-user mode is active, visiting any page without a session redirects to `/register`. Enter your first name, last name, and Maurice Blackburn email address (only the part before `@`). After registration, you are redirected to the page you originally requested.

Re-registering with the same email restores your existing preferences.

### Admin Access

After registering, navigate to Options > Admin. Enter the admin key (shared by the designated administrator). On success, your session is upgraded to admin and the "Admin" badge appears next to your name in the header. Admin access persists for the session lifetime.

### What Requires Admin

- Changing server-level settings (thresholds, intervals, notification rules, UX config)
- Cookie management (paste, clear, reacquire, browser login)
- The Authentication section in Options

### What All Users Can Do

- View all pages and data
- Build WAILA and Work Type Config indexes
- Change personal preferences (theme, high contrast, chart backgrounds, desktop notifications)
- Logout

---

## Environment Configuration Examples

The `.env.example` file contains full inline documentation. Here are common hosting scenarios:

### Local Solo Use

```env
VNEXT_CLIENT_ID=your-client-id
VNEXT_CLIENT_SECRET=your-client-secret
VNEXT_LABEL=vNext
VNEXT_COOKIE_USERNAME=admin@local
VNEXT_COOKIE_PASSWORD=password

PROD_CLIENT_ID=your-client-id
PROD_CLIENT_SECRET=your-client-secret
PROD_LABEL=Production

PORT=3000
BACKLOG_THRESHOLD=250
```

No `MULTI_USER` needed. Auto-auth runs for vNext on startup. For Production, use browser login or manual cookie paste since Azure AD SSO does not support forms-based credentials.

### Team-Hosted

```env
VNEXT_CLIENT_ID=your-client-id
VNEXT_CLIENT_SECRET=your-client-secret
VNEXT_COOKIE_USERNAME=admin@local
VNEXT_COOKIE_PASSWORD=password

UAT_CLIENT_ID=your-client-id
UAT_CLIENT_SECRET=your-client-secret

PROD_CLIENT_ID=your-client-id
PROD_CLIENT_SECRET=your-client-secret

PORT=3000
MULTI_USER=true
ADMIN_KEY=a-secure-passphrase
SESSION_EXPIRY_DAYS=30
BACKLOG_THRESHOLD=250
TEAMS_WEBHOOK_ENABLED=true
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
```

All team members register on first visit. The admin enters the admin key to manage cookies and server settings. Only one running instance should have `TEAMS_WEBHOOK_ENABLED=true` to avoid duplicate Teams notifications.

### With UX Monitoring

Add to either scenario:

```env
UX_WORK_ITEM_ID=a-valid-guid
UX_PAGE_TARGETS=/,/admin,/sharedo/{guid}
```

Enable UX monitoring and configure thresholds in Options > UX Monitor after startup.

### With Test Environment

```env
MOCK_ENV_ENABLED=true
```

A "Test Env" entry appears in the environment dropdown. Access the control page at `/debug/mock`.