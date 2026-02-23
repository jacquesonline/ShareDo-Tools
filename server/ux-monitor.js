/**
 * UX Monitor -- API Probes & Playwright Page Checks
 *
 * Extracted from server.js to reduce monolith size.
 * All shared server infrastructure is received via init(deps).
 *
 * Exports:
 *   init(deps)              -- wire up dependencies (call once at startup)
 *   getSettings()           -- returns current UX settings object
 *   applySettings(obj)      -- accepts partial settings, returns { restartNeeded }
 *   getSettingsForSave()    -- returns settings keyed for settings.json persistence
 *   startProbeMonitor()     -- start/restart the automatic probe interval
 *   stopProbeMonitor()      -- stop the automatic probe interval
 *   runProbes()             -- execute one probe cycle (manual or automatic)
 *   runPageCheck(options)   -- execute a Playwright page check
 *   getStatus()             -- returns status summary for GET /api/ux/status
 *   getLatestPageResults()  -- returns latest page check result
 *   getBannerStatus()       -- returns { text, isEnabled } for startup banner
 */
"use strict";

// ─── Dependencies (set by init) ───
var _deps = null;

// ─── UX Monitor settings ───
var _uxEnabled = false;
var _uxAutoProbes = false;
var _uxAutoPages = false;
var _uxProbeInterval = 60;         // seconds between API probe cycles
var _uxPageInterval = 300;         // seconds between Playwright page check cycles (reserved)
var _uxProbeEnv = "prod";          // environment to probe
var _uxAlerts = true;              // (legacy compat) -- replaced by granular toggles below
var _uxAlertsProbes = true;       // fire alerts on probe threshold breaches
var _uxAlertsPages = true;        // fire alerts on page check Web Vital breaches
var _uxAlertsSession = true;      // fire alerts on browser session expiry
var _uxProbeThresholdWarn = 3000;  // ms
var _uxProbeThresholdCrit = 5000;  // ms
var _uxProbeTimeout = 15000;      // ms -- request timeout for API probes
var _uxWorkItemId = "";            // GUID of a specific work item (shared by probes + page checks)
var _uxPageTargets = ["/", "/admin"];  // paths to check during page check cycles
var _uxVitalsFcpWarn = 1800;
var _uxVitalsFcpCrit = 3000;
var _uxVitalsLcpWarn = 2500;
var _uxVitalsLcpCrit = 4000;
var _uxVitalsTtiWarn = 3800;
var _uxVitalsTtiCrit = 7300;
var _uxProbes = [
    { label: "FindByQuery", method: "POST", path: "/api/v1/public/workItem/findByQuery", body: { search: { page: { page: 1, rowsPerPage: 100 }, sort: { direction: "descending", orderBy: "createdDate" }, types: { includeTypesDerivedFrom: ["task"] }, phase: { includeOpen: true, includeClosed: true, includeRemoved: false } }, enrich: [{ path: "id" }, { path: "reference" }, { path: "title" }, { path: "type.name" }, { path: "createdDate.utc.value" }, { path: "participants", includeFields: [{ path: "ods.name" }] }] }, enabled: true },
    { label: "Elasticsearch Status", method: "GET", path: "/api/elasticsearch/status", body: null, enabled: true },
    { label: "Work Type Tree", method: "GET", path: "/api/sharedoTypes/tree", body: null, enabled: true },
    { label: "User List", method: "GET", path: "/api/listview/core-admin-users-all/250/1/username/asc/?view=table&withCounts=1", body: null, enabled: true },
    { label: "Work Item Summary", method: "GET", path: "/api/sharedo/{workItemId}/summary", body: null, enabled: false, configurable: "workItemId" }
];

// ─── Runtime state ───
var _probeTimer = null;
var _pageTimer = null;
var _latestProbeResults = null;   // { ts, env, probes: [{ label, status, ms, tookMs, error }] }
var _latestPageResults = null;    // { ts, env, url, statusCode, totalLoadMs, webVitals, navTiming, ajaxCount, ajaxSlowest, ajaxTop, error }
var _pageCheckRunning = false;


// ═══════════════════════════════════════════════════════════════════
// Initialisation
// ═══════════════════════════════════════════════════════════════════

/**
 * Wire up dependencies from server.js.
 *
 * @param {Object} deps
 * @param {Object}   deps.environments      - environment config map
 * @param {Object}   deps.cookieCache       - envName -> cookie string
 * @param {Function} deps.extractApiJwt     - (cookieStr) -> jwt string | null
 * @param {Function} deps.log               - (category, message) server log function
 * @param {Object}   deps.metrics            - metrics module { ensureDir, filePath, isEnabled }
 * @param {Function} deps.pushAlert         - (alertObj) dispatch alert via SSE + Teams
 * @param {Function} deps.fmtAlertTimestamp - () -> formatted timestamp string
 * @param {Object|null} deps.playwright     - Playwright module or null
 * @param {Object}   deps.fs               - Node fs module
 * @param {Object}   deps.path             - Node path module
 * @param {Object}   deps.https            - Node https module
 * @param {string}   deps.baseDir          - __dirname of server.js (for cache paths)
 */
function init(deps) {
    _deps = deps;

    // Read .env defaults (overridden by settings.json via applySettings)
    var env = process.env;
    if (env.UX_ALERTS_PROBES != null) _uxAlertsProbes = env.UX_ALERTS_PROBES.toLowerCase() === "true";
    if (env.UX_ALERTS_PAGES != null) _uxAlertsPages = env.UX_ALERTS_PAGES.toLowerCase() === "true";
    if (env.UX_ALERTS_SESSION != null) _uxAlertsSession = env.UX_ALERTS_SESSION.toLowerCase() === "true";
    if (env.UX_PROBE_THRESHOLD_WARN) { var v = parseInt(env.UX_PROBE_THRESHOLD_WARN, 10); if (v > 0) _uxProbeThresholdWarn = v; }
    if (env.UX_PROBE_THRESHOLD_CRIT) { var v = parseInt(env.UX_PROBE_THRESHOLD_CRIT, 10); if (v > 0) _uxProbeThresholdCrit = v; }
    if (env.UX_PROBE_TIMEOUT) { var v = parseInt(env.UX_PROBE_TIMEOUT, 10); if (v >= 1000) _uxProbeTimeout = v; }
    if (env.UX_VITALS_FCP_WARN) { var v = parseInt(env.UX_VITALS_FCP_WARN, 10); if (v > 0) _uxVitalsFcpWarn = v; }
    if (env.UX_VITALS_FCP_CRIT) { var v = parseInt(env.UX_VITALS_FCP_CRIT, 10); if (v > 0) _uxVitalsFcpCrit = v; }
    if (env.UX_VITALS_LCP_WARN) { var v = parseInt(env.UX_VITALS_LCP_WARN, 10); if (v > 0) _uxVitalsLcpWarn = v; }
    if (env.UX_VITALS_LCP_CRIT) { var v = parseInt(env.UX_VITALS_LCP_CRIT, 10); if (v > 0) _uxVitalsLcpCrit = v; }
    if (env.UX_VITALS_TTI_WARN) { var v = parseInt(env.UX_VITALS_TTI_WARN, 10); if (v > 0) _uxVitalsTtiWarn = v; }
    if (env.UX_VITALS_TTI_CRIT) { var v = parseInt(env.UX_VITALS_TTI_CRIT, 10); if (v > 0) _uxVitalsTtiCrit = v; }
    if (env.UX_WORK_ITEM_ID) _uxWorkItemId = env.UX_WORK_ITEM_ID.trim();
    if (env.UX_PAGE_TARGETS) {
        var targets = env.UX_PAGE_TARGETS.split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t.length > 0 && t.charAt(0) === "/"; });
        if (targets.length > 0) _uxPageTargets = targets;
    }
}


// ═══════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns current UX settings for API responses.
 */
function getSettings() {
    return {
        uxEnabled: _uxEnabled,
        uxAutoProbes: _uxAutoProbes,
        uxAutoPages: _uxAutoPages,
        uxProbeInterval: _uxProbeInterval,
        uxPageInterval: _uxPageInterval,
        uxProbeEnv: _uxProbeEnv,
        uxAlerts: _uxAlertsProbes,
        uxAlertsProbes: _uxAlertsProbes,
        uxAlertsPages: _uxAlertsPages,
        uxAlertsSession: _uxAlertsSession,
        uxProbeThresholdWarn: _uxProbeThresholdWarn,
        uxProbeThresholdCrit: _uxProbeThresholdCrit,
        uxProbeTimeout: _uxProbeTimeout,
        uxVitalsFcpWarn: _uxVitalsFcpWarn,
        uxVitalsFcpCrit: _uxVitalsFcpCrit,
        uxVitalsLcpWarn: _uxVitalsLcpWarn,
        uxVitalsLcpCrit: _uxVitalsLcpCrit,
        uxVitalsTtiWarn: _uxVitalsTtiWarn,
        uxVitalsTtiCrit: _uxVitalsTtiCrit,
        uxWorkItemId: _uxWorkItemId,
        uxPageTargets: _uxPageTargets,
        uxProbes: _uxProbes
    };
}

/**
 * Returns settings keyed for settings.json persistence.
 * Identical keys to getSettings() -- separated for clarity of intent.
 */
function getSettingsForSave() {
    return getSettings();
}

/**
 * Apply a partial settings object (from loadSettings or POST /api/settings).
 * Returns { restartNeeded: boolean } indicating whether the probe monitor
 * needs to be restarted.
 */
function applySettings(data) {
    var restartNeeded = false;

    if (data.uxEnabled != null) {
        var prev = _uxEnabled;
        _uxEnabled = !!data.uxEnabled;
        if (prev !== _uxEnabled) restartNeeded = true;
    }
    if (data.uxAutoProbes != null) {
        var prevAuto = _uxAutoProbes;
        _uxAutoProbes = !!data.uxAutoProbes;
        if (prevAuto !== _uxAutoProbes) restartNeeded = true;
    }
    if (data.uxAutoPages != null) {
        var prevAutoPages = _uxAutoPages;
        _uxAutoPages = !!data.uxAutoPages;
        if (prevAutoPages !== _uxAutoPages) restartNeeded = true;
    }
    if (data.uxProbeInterval != null) {
        var upi = parseInt(data.uxProbeInterval, 10);
        if (!isNaN(upi) && upi >= 10) {
            if (upi !== _uxProbeInterval) restartNeeded = true;
            _uxProbeInterval = upi;
        }
    }
    if (data.uxPageInterval != null) {
        var upgi = parseInt(data.uxPageInterval, 10);
        if (!isNaN(upgi) && upgi >= 60) {
            if (upgi !== _uxPageInterval) restartNeeded = true;
            _uxPageInterval = upgi;
        }
    }
    if (data.uxProbeEnv != null && typeof data.uxProbeEnv === "string") {
        if (data.uxProbeEnv !== _uxProbeEnv) restartNeeded = true;
        _uxProbeEnv = data.uxProbeEnv;
    }
    if (data.uxAlerts != null) { _uxAlertsProbes = !!data.uxAlerts; }  // legacy compat
    if (data.uxAlertsProbes != null) _uxAlertsProbes = !!data.uxAlertsProbes;
    if (data.uxAlertsPages != null) _uxAlertsPages = !!data.uxAlertsPages;
    if (data.uxAlertsSession != null) _uxAlertsSession = !!data.uxAlertsSession;
    if (data.uxProbeThresholdWarn != null) {
        var utw = parseInt(data.uxProbeThresholdWarn, 10);
        if (!isNaN(utw) && utw > 0) _uxProbeThresholdWarn = utw;
    }
    if (data.uxProbeThresholdCrit != null) {
        var utc = parseInt(data.uxProbeThresholdCrit, 10);
        if (!isNaN(utc) && utc > 0) _uxProbeThresholdCrit = utc;
    }
    if (data.uxProbeTimeout != null) {
        var upt = parseInt(data.uxProbeTimeout, 10);
        if (!isNaN(upt) && upt >= 1000) _uxProbeTimeout = upt;
    }
    if (_uxProbeTimeout < _uxProbeThresholdCrit) _uxProbeTimeout = _uxProbeThresholdCrit;
    if (data.uxVitalsFcpWarn != null) { var v = parseInt(data.uxVitalsFcpWarn, 10); if (!isNaN(v) && v > 0) _uxVitalsFcpWarn = v; }
    if (data.uxVitalsFcpCrit != null) { var v = parseInt(data.uxVitalsFcpCrit, 10); if (!isNaN(v) && v > 0) _uxVitalsFcpCrit = v; }
    if (data.uxVitalsLcpWarn != null) { var v = parseInt(data.uxVitalsLcpWarn, 10); if (!isNaN(v) && v > 0) _uxVitalsLcpWarn = v; }
    if (data.uxVitalsLcpCrit != null) { var v = parseInt(data.uxVitalsLcpCrit, 10); if (!isNaN(v) && v > 0) _uxVitalsLcpCrit = v; }
    if (data.uxVitalsTtiWarn != null) { var v = parseInt(data.uxVitalsTtiWarn, 10); if (!isNaN(v) && v > 0) _uxVitalsTtiWarn = v; }
    if (data.uxVitalsTtiCrit != null) { var v = parseInt(data.uxVitalsTtiCrit, 10); if (!isNaN(v) && v > 0) _uxVitalsTtiCrit = v; }
    if (Array.isArray(data.uxProbes)) _uxProbes = data.uxProbes;
    if (data.uxWorkItemId != null) _uxWorkItemId = String(data.uxWorkItemId).trim();
    if (Array.isArray(data.uxPageTargets)) {
        _uxPageTargets = data.uxPageTargets.filter(function (t) {
            return typeof t === "string" && t.length > 0 && t.charAt(0) === "/";
        });
    }

    return { restartNeeded: restartNeeded };
}


// ═══════════════════════════════════════════════════════════════════
// API Probe Engine
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a single API probe request against a ShareDo environment.
 * @param {Object} env   - environment config object
 * @param {Object} probe - probe definition from _uxProbes
 * @returns {Promise<Object>} { label, status, ms, tookMs, error }
 */
function probeRequest(env, probe) {
    return new Promise(function (resolve) {
        var host = env.apiHost;
        var cookie = _deps.cookieCache[_uxProbeEnv] || "";
        var jwt = cookie ? _deps.extractApiJwt(cookie) : null;
        var isPost = probe.method === "POST";
        var probePath = probe.path;

        // Substitute configurable placeholders (e.g. {workItemId})
        if (probe.configurable === "workItemId" && _uxWorkItemId) {
            probePath = probePath.replace("{workItemId}", _uxWorkItemId);
        }
        var bodyStr = isPost && probe.body ? JSON.stringify(probe.body) : null;

        var headers = {
            "Accept": "application/json",
            "Cookie": cookie
        };
        if (jwt) headers["Authorization"] = "Bearer " + jwt;
        if (isPost) {
            headers["Content-Type"] = "application/json; charset=utf-8";
            if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
        }

        var startMs = Date.now();
        var req = _deps.https.request({
            hostname: host,
            port: 443,
            path: probePath,
            method: probe.method,
            headers: headers,
            rejectUnauthorized: false,
            timeout: _uxProbeTimeout
        }, function (res) {
            var chunks = [];
            res.on("data", function (c) { chunks.push(c); });
            res.on("end", function () {
                var elapsed = Date.now() - startMs;
                var tookMs = null;
                // Extract tookMs from findByQuery response
                try {
                    var parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    if (parsed && typeof parsed.tookMs === "number") tookMs = parsed.tookMs;
                } catch (_) {}
                resolve({ label: probe.label, status: res.statusCode, ms: elapsed, tookMs: tookMs, error: null });
            });
        });
        req.on("error", function (err) {
            resolve({ label: probe.label, status: null, ms: Date.now() - startMs, tookMs: null, error: err.message });
        });
        req.on("timeout", function () {
            req.destroy();
            resolve({ label: probe.label, status: null, ms: Date.now() - startMs, tookMs: null, error: "Timeout (" + Math.round(_uxProbeTimeout / 1000) + "s)" });
        });
        if (isPost && bodyStr) req.write(bodyStr);
        req.end();
    });
}

/**
 * Execute all enabled probes, record metrics, evaluate alerts.
 */
async function runProbes() {
    var envName = _uxProbeEnv;
    var env = _deps.environments[envName];
    if (!env) { _deps.log("ux", "Probe skipped -- environment '" + envName + "' not found"); return; }
    if (!_deps.cookieCache[envName]) { _deps.log("ux", "Probe skipped -- no cookie for " + envName); return; }

    var enabledProbes = _uxProbes.filter(function (p) {
        if (!p.enabled) return false;
        if (p.configurable === "workItemId" && !_uxWorkItemId) return false;
        return true;
    });
    if (enabledProbes.length === 0) { _deps.log("ux", "Probe skipped -- no enabled probes"); return; }

    var ts = new Date().toISOString();
    _deps.log("ux", "Running " + enabledProbes.length + " API probes against " + env.label);

    var results = [];
    for (var i = 0; i < enabledProbes.length; i++) {
        var result = await probeRequest(env, enabledProbes[i]);
        results.push(result);

        var levelTag = "";
        if (result.error) {
            levelTag = " [ERROR]";
        } else if (result.ms >= _uxProbeThresholdCrit) {
            levelTag = " [CRITICAL]";
        } else if (result.ms >= _uxProbeThresholdWarn) {
            levelTag = " [WARNING]";
        }
        var tookExtra = result.tookMs != null ? " (server: " + result.tookMs + "ms)" : "";
        _deps.log("ux", "  " + result.label + ": " + (result.status || "ERR") + " in " + result.ms + "ms" + tookExtra + levelTag);
    }

    _latestProbeResults = { ts: ts, env: envName, probes: results };

    // Record metrics
    if (_deps.metrics.isEnabled()) {
        _deps.metrics.ensureDir(envName);
        var metricFile = _deps.metrics.filePath(envName, "ux-api");
        var metricLine = JSON.stringify({ ts: ts, probes: results.map(function (r) { return { label: r.label, status: r.status, ms: r.ms, tookMs: r.tookMs, error: r.error }; }) }) + "\n";
        try { _deps.fs.appendFileSync(metricFile, metricLine); } catch (e) { _deps.log("ux", "Metric write failed: " + e.message); }
    }

    // Check thresholds and fire alerts
    if (_uxAlertsProbes) {
        var breaches = results.filter(function (r) { return r.ms >= _uxProbeThresholdWarn || r.error; });
        if (breaches.length > 0) {
            var worstMs = Math.max.apply(null, breaches.map(function (b) { return b.ms; }));
            var level = worstMs >= _uxProbeThresholdCrit || breaches.some(function (b) { return b.error; }) ? "critical" : "warning";
            var breachLines = breaches.map(function (b) {
                if (b.error) return b.label + ": ERROR -- " + b.error;
                return b.label + ": " + b.ms + "ms" + (b.ms >= _uxProbeThresholdCrit ? " (critical > " + _uxProbeThresholdCrit + "ms)" : " (warning > " + _uxProbeThresholdWarn + "ms)");
            });

            var alertTitle = "[UX] API Probe " + (level === "critical" ? "Critical" : "Warning") + " -- " + env.label;
            var alertBody = breachLines.join("\n");
            var facts = breaches.map(function (b) {
                return { title: b.label, value: b.error ? "ERROR: " + b.error : b.ms + "ms" };
            });
            facts.push({ title: "Warn Threshold", value: _uxProbeThresholdWarn + "ms" });
            facts.push({ title: "Crit Threshold", value: _uxProbeThresholdCrit + "ms" });
            facts.push({ title: "Environment", value: "[" + env.label + "](https://" + env.apiHost + "/admin)" });
            facts.push({ title: "Timestamp", value: _deps.fmtAlertTimestamp() });

            _deps.pushAlert({
                type: "ux-api",
                env: envName,
                title: alertTitle,
                body: alertBody,
                colour: level === "critical" ? "attention" : "warning",
                facts: facts
            });
        }
    }
}


// ═══════════════════════════════════════════════════════════════════
// Probe Monitor (automatic interval)
// ═══════════════════════════════════════════════════════════════════

function startProbeMonitor() {
    stopProbeMonitor();
    if (!_uxEnabled) { _deps.log("ux", "UX monitor disabled"); return; }
    if (!_uxAutoProbes) { _deps.log("ux", "UX monitor enabled (manual only -- automatic probes disabled)"); return; }
    var intervalMs = _uxProbeInterval * 1000;
    _deps.log("ux", "Automatic probe monitor started -- interval: " + _uxProbeInterval + "s, env: " + _uxProbeEnv);
    runProbes();
    _probeTimer = setInterval(runProbes, intervalMs);
}

function stopProbeMonitor() {
    if (_probeTimer) { clearInterval(_probeTimer); _probeTimer = null; }
}

function startPageMonitor() {
    stopPageMonitor();
    if (!_uxEnabled) return;
    if (!_uxAutoPages) { _deps.log("ux", "Automatic page checks disabled"); return; }
    if (!_deps.playwright) { _deps.log("ux", "Automatic page checks skipped -- Playwright not installed"); return; }
    var targets = resolvePageTargets();
    if (!targets.length) { _deps.log("ux", "Automatic page checks skipped -- no resolved targets"); return; }
    var intervalMs = _uxPageInterval * 1000;
    _deps.log("ux", "Automatic page monitor started -- interval: " + _uxPageInterval + "s, targets: " + targets.length + ", env: " + _uxProbeEnv);
    // Delay first run to avoid overlapping with probe startup
    setTimeout(function () { runAllPageChecks(); }, 5000);
    _pageTimer = setInterval(function () { runAllPageChecks(); }, intervalMs);
}

function stopPageMonitor() {
    if (_pageTimer) { clearInterval(_pageTimer); _pageTimer = null; }
}


// ═══════════════════════════════════════════════════════════════════
// Playwright Page Check
// ═══════════════════════════════════════════════════════════════════

/**
 * Run a Playwright-based page check.
 *
 * @param {Object} options
 * @param {string} [options.url] - URL or path to check (default: environment root)
 * @returns {Promise<Object>} { success, results } or { error, status, message }
 */
async function runPageCheck(options) {
    if (!_uxEnabled) return { error: true, status: 400, message: "UX monitor is disabled" };
    if (!_deps.playwright) return { error: true, status: 500, message: "Playwright is not installed" };
    if (_pageCheckRunning) return { error: true, status: 409, message: "A page check is already running" };

    var envName = _uxProbeEnv;
    var env = _deps.environments[envName];
    if (!env) return { error: true, status: 400, message: "Environment not found: " + envName };

    var targetUrl = options && options.url;
    if (!targetUrl) targetUrl = "https://" + env.apiHost + "/";

    // Ensure URL is absolute
    if (targetUrl.startsWith("/")) targetUrl = "https://" + env.apiHost + targetUrl;

    _pageCheckRunning = true;
    _deps.log("ux", "Page check starting: " + targetUrl);

    var userDataDir = _deps.path.join(_deps.baseDir, "cache", "ux-user-data", envName);
    var context = null;
    var page = null;

    try {
        context = await _deps.playwright.chromium.launchPersistentContext(userDataDir, {
            headless: true,
            viewport: { width: 1280, height: 900 },
            ignoreHTTPSErrors: true,
            args: ["--disable-blink-features=AutomationControlled"]
        });

        page = await context.newPage();
        var startMs = Date.now();

        // Navigate and wait for load
        var response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        var statusCode = response ? response.status() : null;

        // Wait additional time for SPA to settle (ShareDo loads widgets async after DOM ready)
        await page.waitForTimeout(5000);

        // Detect login redirect -- if the browser session has expired, ShareDo redirects
        // to the identity server login page. Recording metrics for the login page would
        // produce misleading data, so we detect this and return an error instead.
        var finalUrl = page.url();
        var isLoginRedirect = false;
        if (finalUrl) {
            var lowerUrl = finalUrl.toLowerCase();
            isLoginRedirect = lowerUrl.indexOf("/login") !== -1
                || lowerUrl.indexOf("/connect/authorize") !== -1
                || lowerUrl.indexOf("/account/login") !== -1
                || lowerUrl.indexOf("login.microsoftonline.com") !== -1
                || (lowerUrl.indexOf("-identity.") !== -1 && lowerUrl.indexOf(env.apiHost.toLowerCase()) === -1);
        }
        if (isLoginRedirect) {
            var redirectHost = "";
            try { redirectHost = new URL(finalUrl).hostname; } catch (e) { redirectHost = finalUrl.substring(0, 80); }
            _deps.log("ux", "Page check aborted: browser session expired -- redirected to " + redirectHost);
            if (_uxAlertsSession) {
                _deps.pushAlert({
                    type: "ux-session",
                    env: envName,
                    title: "[UX] Session Expired -- " + env.label,
                    body: "Page check redirected to login. Automatic page checks will continue to fail until the browser session is re-established.",
                    tag: "ux-session-" + envName,
                    facts: [
                        { title: "Target", value: targetUrl },
                        { title: "Redirected To", value: redirectHost },
                        { title: "Environment", value: "[" + env.label + "](https://" + env.apiHost + "/admin)" },
                        { title: "Timestamp", value: _deps.fmtAlertTimestamp() }
                    ]
                });
            }
            await page.close();
            await context.close();
            _pageCheckRunning = false;
            return { error: true, status: 401, message: "Browser session expired -- redirected to login page. Re-authenticate via Options > Authentication > Launch Browser." };
        }

        var totalLoadMs = Date.now() - startMs;

        // Extract Web Vitals via Performance API
        var webVitals = await page.evaluate(function () {
            return new Promise(function (resolve) {
                var vitals = { lcp: 0, fcp: 0, cls: 0, tti: 0 };

                try {
                    var lcpObserver = new PerformanceObserver(function (list) {
                        var entries = list.getEntries();
                        var last = entries[entries.length - 1];
                        vitals.lcp = last.renderTime || last.loadTime;
                    });
                    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
                } catch (e) {}

                try {
                    var clsValue = 0;
                    var clsObserver = new PerformanceObserver(function (list) {
                        var entries = list.getEntries();
                        for (var i = 0; i < entries.length; i++) {
                            if (!entries[i].hadRecentInput) clsValue += entries[i].value;
                        }
                        vitals.cls = clsValue;
                    });
                    clsObserver.observe({ type: "layout-shift", buffered: true });
                } catch (e) {}

                // FCP from paint entries
                try {
                    var paintEntries = performance.getEntriesByType("paint");
                    for (var i = 0; i < paintEntries.length; i++) {
                        if (paintEntries[i].name === "first-contentful-paint") {
                            vitals.fcp = paintEntries[i].startTime;
                        }
                    }
                } catch (e) {}

                // TTI approximation
                try {
                    var nav = performance.getEntriesByType("navigation")[0];
                    if (nav) vitals.tti = nav.domInteractive;
                } catch (e) {}

                setTimeout(function () { resolve(vitals); }, 200);
            });
        });

        // Extract navigation timing
        var navTiming = await page.evaluate(function () {
            try {
                var nav = performance.getEntriesByType("navigation")[0];
                if (!nav) return null;
                return {
                    dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
                    tcp: Math.round(nav.connectEnd - nav.connectStart),
                    ttfb: Math.round(nav.responseStart - nav.requestStart),
                    domInteractive: Math.round(nav.domInteractive),
                    domComplete: Math.round(nav.domComplete),
                    loadEvent: Math.round(nav.loadEventEnd - nav.fetchStart)
                };
            } catch (e) { return null; }
        });

        // Extract $ajaxClientTimer log
        var ajaxTimer = await page.evaluate(function () {
            try {
                if (typeof $ajaxClientTimer === "undefined") return null;
                var log = $ajaxClientTimer.log || [];
                var completed = log.filter(function (e) { return e.totalTime != null; });
                completed.sort(function (a, b) { return b.totalTime - a.totalTime; });
                return {
                    count: completed.length,
                    top: completed.slice(0, 20).map(function (e) { return { url: e.url, ms: e.totalTime }; })
                };
            } catch (e) { return null; }
        });

        var ajaxCount = ajaxTimer ? ajaxTimer.count : 0;
        var ajaxTop = ajaxTimer ? ajaxTimer.top : [];
        var ajaxSlowest = ajaxTop.length > 0 ? ajaxTop[0].ms : null;

        var result = {
            ts: new Date().toISOString(),
            env: envName,
            url: targetUrl,
            statusCode: statusCode,
            totalLoadMs: totalLoadMs,
            webVitals: webVitals,
            navTiming: navTiming,
            ajaxCount: ajaxCount,
            ajaxSlowest: ajaxSlowest,
            ajaxTop: ajaxTop,
            error: null
        };

        _latestPageResults = result;
        _deps.log("ux", "Page check complete: " + statusCode + " in " + totalLoadMs + "ms, " + ajaxCount + " AJAX calls" + (ajaxSlowest ? ", slowest: " + ajaxSlowest + "ms" : ""));

        // Record metric (flat structure for charting)
        if (_deps.metrics.isEnabled()) {
            _deps.metrics.ensureDir(envName);
            var metricFile = _deps.metrics.filePath(envName, "ux-pages");
            var metricEntry = {
                ts: result.ts,
                url: targetUrl,
                status: statusCode,
                totalLoadMs: totalLoadMs,
                fcp: webVitals ? Math.round(webVitals.fcp || 0) : null,
                lcp: webVitals ? Math.round(webVitals.lcp || 0) : null,
                cls: webVitals ? webVitals.cls : null,
                tti: webVitals ? Math.round(webVitals.tti || 0) : null,
                ttfb: navTiming ? navTiming.ttfb : null,
                domInteractive: navTiming ? navTiming.domInteractive : null,
                domComplete: navTiming ? navTiming.domComplete : null,
                ajaxCount: ajaxCount,
                ajaxSlowest: ajaxSlowest,
                ajaxTop: ajaxTop.slice(0, 15)
            };
            var metricLine = JSON.stringify(metricEntry) + "\n";
            try { _deps.fs.appendFileSync(metricFile, metricLine); } catch (e) { _deps.log("ux", "Page metric write failed: " + e.message); }
        }

        // Evaluate Web Vital thresholds and fire page check alerts
        if (_uxAlertsPages && webVitals) {
            var vitalsBreaches = [];
            var fcp = Math.round(webVitals.fcp || 0);
            var lcp = Math.round(webVitals.lcp || 0);
            var tti = Math.round(webVitals.tti || 0);
            if (lcp >= _uxVitalsLcpWarn) vitalsBreaches.push({ metric: "LCP", value: lcp, warn: _uxVitalsLcpWarn, crit: _uxVitalsLcpCrit });
            if (fcp >= _uxVitalsFcpWarn) vitalsBreaches.push({ metric: "FCP", value: fcp, warn: _uxVitalsFcpWarn, crit: _uxVitalsFcpCrit });
            if (tti >= _uxVitalsTtiWarn) vitalsBreaches.push({ metric: "TTI", value: tti, warn: _uxVitalsTtiWarn, crit: _uxVitalsTtiCrit });

            if (vitalsBreaches.length > 0) {
                var hasCritical = vitalsBreaches.some(function (b) { return b.value >= b.crit; });
                var pageLevel = hasCritical ? "critical" : "warning";
                var urlPath = targetUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
                var alertTitle = "[UX] Page " + (pageLevel === "critical" ? "Critical" : "Warning") + " -- " + env.label;
                var alertBody = vitalsBreaches.map(function (b) {
                    return b.metric + ": " + b.value + "ms (" + (b.value >= b.crit ? "critical > " + b.crit + "ms" : "warning > " + b.warn + "ms") + ")";
                }).join("\n");
                var pageFacts = [{ title: "Page", value: urlPath }];
                for (var bi = 0; bi < vitalsBreaches.length; bi++) {
                    pageFacts.push({ title: vitalsBreaches[bi].metric, value: vitalsBreaches[bi].value + "ms" });
                }
                pageFacts.push({ title: "Total Load", value: totalLoadMs + "ms" });
                pageFacts.push({ title: "Environment", value: "[" + env.label + "](https://" + env.apiHost + "/admin)" });
                pageFacts.push({ title: "Timestamp", value: _deps.fmtAlertTimestamp() });

                _deps.pushAlert({
                    type: "ux-page",
                    env: envName,
                    title: alertTitle,
                    body: alertBody,
                    tag: "ux-page-" + envName + "-" + urlPath.replace(/[^a-zA-Z0-9]/g, "-"),
                    facts: pageFacts
                });
            }
        }

        return { success: true, results: result };

    } catch (err) {
        var errResult = {
            ts: new Date().toISOString(),
            env: envName,
            url: targetUrl,
            statusCode: null,
            totalLoadMs: null,
            webVitals: null,
            navTiming: null,
            ajaxCount: 0,
            ajaxSlowest: null,
            ajaxTop: [],
            error: err.message
        };
        _latestPageResults = errResult;
        _deps.log("ux", "Page check failed: " + err.message);
        return { success: false, results: errResult };
    } finally {
        _pageCheckRunning = false;
        if (page) try { await page.close(); } catch (_) {}
        if (context) try { await context.close(); } catch (_) {}
    }
}


// ═══════════════════════════════════════════════════════════════════
// Multi-target page checks
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve the effective list of page check paths.
 * Substitutes {guid} with _uxWorkItemId. Paths containing {guid}
 * are dropped if _uxWorkItemId is empty.
 * @returns {string[]} resolved absolute paths (e.g. ["/", "/admin", "/sharedo/abc-123"])
 */
function resolvePageTargets() {
    var resolved = [];
    for (var i = 0; i < _uxPageTargets.length; i++) {
        var p = _uxPageTargets[i];
        if (p.indexOf("{guid}") !== -1) {
            if (_uxWorkItemId) {
                resolved.push(p.replace(/\{guid\}/g, _uxWorkItemId));
            }
            // else: skip -- no GUID configured
        } else {
            resolved.push(p);
        }
    }
    return resolved;
}

/**
 * Run page checks for all resolved targets sequentially.
 * Each target launches a separate Playwright context.
 * @returns {Promise<Object>} { success, results: [{ url, ... }], skipped: number }
 */
async function runAllPageChecks() {
    var targets = resolvePageTargets();
    if (targets.length === 0) return { success: false, error: true, status: 400, message: "No page check targets configured" };

    var results = [];
    var skipped = 0;
    for (var i = 0; i < targets.length; i++) {
        var result = await runPageCheck({ url: targets[i] });
        if (result.error) {
            // If Playwright isn't installed or UX is disabled, stop early
            if (result.status === 500 || result.status === 400) return result;
            // 409 (already running) shouldn't happen since we run sequentially, but handle it
            skipped++;
        } else {
            results.push(result.results);
        }
    }
    _deps.log("ux", "Page check cycle complete: " + results.length + " done" + (skipped ? ", " + skipped + " skipped" : "") + " of " + targets.length + " targets");
    return { success: true, results: results, skipped: skipped };
}


// ═══════════════════════════════════════════════════════════════════
// Status / Query
// ═══════════════════════════════════════════════════════════════════

function getStatus() {
    return {
        enabled: _uxEnabled,
        autoProbes: _uxAutoProbes,
        probeInterval: _uxProbeInterval,
        pageInterval: _uxPageInterval,
        probeEnv: _uxProbeEnv,
        latestProbes: _latestProbeResults,
        latestPage: _latestPageResults,
        pageTargets: _uxPageTargets,
        resolvedPageTargets: resolvePageTargets()
    };
}

function getLatestPageResults() {
    return _latestPageResults;
}

/**
 * Returns a summary for the startup banner.
 * @returns {{ text: string, isEnabled: boolean }}
 */
function getBannerStatus() {
    if (!_uxEnabled) return { text: "Off", isEnabled: false };
    var parts = [];
    if (_uxAutoProbes) parts.push("probes: " + _uxProbeInterval + "s");
    if (_uxAutoPages) parts.push("pages: " + _uxPageInterval + "s");
    if (parts.length) return { text: "On (auto: " + parts.join(", ") + ", " + _uxProbeEnv + ")", isEnabled: true };
    return { text: "On (manual only)", isEnabled: true };
}


// ═══════════════════════════════════════════════════════════════════
// Module exports
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    init: init,
    getSettings: getSettings,
    getSettingsForSave: getSettingsForSave,
    applySettings: applySettings,
    startProbeMonitor: startProbeMonitor,
    stopProbeMonitor: stopProbeMonitor,
    startPageMonitor: startPageMonitor,
    stopPageMonitor: stopPageMonitor,
    runProbes: runProbes,
    runPageCheck: runPageCheck,
    runAllPageChecks: runAllPageChecks,
    resolvePageTargets: resolvePageTargets,
    getStatus: getStatus,
    getLatestPageResults: getLatestPageResults,
    getBannerStatus: getBannerStatus
};