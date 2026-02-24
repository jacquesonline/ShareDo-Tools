/**
 * ShareDo System Monitor - Server
 * Supports multiple environments configured in .env.
 * Usage: node server.js [initial-environment]
 */
require("dotenv").config();
const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");
const querystring = require("querystring");
var playwright = null;
try { playwright = require("playwright"); } catch (e) { /* Playwright not installed -- browser login disabled */ }

const uxMonitor = require("./server/ux-monitor");
const healthMonitor = require("./server/health-monitor");
const wailaService = require("./server/waila-service");
const worktypeService = require("./server/worktype-service");
const metrics = require("./server/metrics-service");
const auth = require("./server/auth");
const session = require("./server/session");
// ─── Logging ───
// TODO: Add log levels (debug/info/warn/error) if granularity beyond category filtering is needed.
var LOG_CATEGORIES = {
    env:      (process.env.LOG_ENV || "true").toLowerCase() === "true",
    settings: (process.env.LOG_SETTINGS || "true").toLowerCase() === "true",
    health:   (process.env.LOG_HEALTH || "true").toLowerCase() === "true",
    alert:    (process.env.LOG_ALERT || "true").toLowerCase() === "true",
    teams:    (process.env.LOG_TEAMS || "true").toLowerCase() === "true",
    cookie:   (process.env.LOG_COOKIE || "true").toLowerCase() === "true",
    autoauth: (process.env.LOG_AUTOAUTH || "true").toLowerCase() === "true",
    api:      (process.env.LOG_API || "true").toLowerCase() === "true",
    metrics:  (process.env.LOG_METRICS || "true").toLowerCase() === "true",
    waila:    (process.env.LOG_WAILA || "true").toLowerCase() === "true",
    wtindex:  (process.env.LOG_WTINDEX || "true").toLowerCase() === "true",
    ux:       (process.env.LOG_UX || "true").toLowerCase() === "true"
};
var LOG_TAG_MAP = {
    env: "Env", settings: "Settings", health: "Health",
    alert: "Alert", teams: "Teams", cookie: "Cookie",
    autoauth: "AutoAuth", api: "API", metrics: "Metrics",
    waila: "WAILA", wtindex: "WT-Index", ux: "UX"
};

// ANSI 256-colour codes per category (only applied when stdout is a TTY)
var LOG_COLOUR_MAP = {
    env: 245, settings: 245, health: 78,
    alert: 203, teams: 61, cookie: 80,
    autoauth: 80, api: 214, metrics: 75,
    waila: 198, wtindex: 198, ux: 141
};
var _isTTY = !!(process.stdout && process.stdout.isTTY);
var _ansiReset = "\x1b[0m";

function _ansi256(code) { return "\x1b[38;5;" + code + "m"; }

function log(category, message) {
    if (!LOG_CATEGORIES[category]) return;
    var now = new Date();
    var ts = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + " " +
        String(now.getHours()).padStart(2, "0") + ":" +
        String(now.getMinutes()).padStart(2, "0") + ":" +
        String(now.getSeconds()).padStart(2, "0");
    var tag = (LOG_TAG_MAP[category] || category).padEnd(8);

    if (_isTTY) {
        var tagColour = _ansi256(LOG_COLOUR_MAP[category] || 245);
        var dimGrey = _ansi256(240);
        console.log(dimGrey + ts + _ansiReset + "  [" + tagColour + tag + _ansiReset + "]  " + message);
    } else {
        console.log(ts + "  [" + tag + "]  " + message);
    }
}

// ─── Environment discovery ───
function discoverEnvironments() {
    const envs = {}; const suffix = "_CLIENT_ID";
    for (const key of Object.keys(process.env)) {
        if (!key.endsWith(suffix)) continue;
        const envKey = key.slice(0, -suffix.length);
        const clientId = process.env[key]; const clientSecret = process.env[`${envKey}_CLIENT_SECRET`];
        if (!clientId || !clientSecret) continue;
        const envName = envKey.toLowerCase(); const label = process.env[`${envKey}_LABEL`] || envName.toUpperCase();
        const defaultApiHost = envName === "prod" ? "mauriceblackburn.sharedo.tech" : `mb-${envName}.sharedo.tech`;
        const defaultIdentityHost = envName === "prod" ? "mb-prod-identity.sharedo.tech" : `mb-${envName}-identity.sharedo.tech`;
        const cookieUsername = process.env[`${envKey}_COOKIE_USERNAME`] || null;
        const cookiePassword = process.env[`${envKey}_COOKIE_PASSWORD`] || null;
        envs[envName] = { name: envName, label, clientId, clientSecret, apiHost: process.env[`${envKey}_API_HOST`] || defaultApiHost, identityHost: process.env[`${envKey}_IDENTITY_HOST`] || defaultIdentityHost, cookieUsername, cookiePassword };
    }
    return envs;
}
const environments = discoverEnvironments(); const envNames = Object.keys(environments);
if (envNames.length === 0) { console.error("\n  No environments configured. See .env.example\n"); process.exit(1); }

// ─── Mock / Test environment (optional, for notification testing) ───
const MOCK_ENV_ENABLED = (process.env.MOCK_ENV_ENABLED || "false").toLowerCase() === "true";
if (MOCK_ENV_ENABLED) {
    environments["mock"] = {
        name: "mock",
        label: "Test Env",
        clientId: "mock",
        clientSecret: "mock",
        apiHost: "mock.local",
        identityHost: "mock.local",
        cookieUsername: null,
        cookiePassword: null,
        isMock: true
    };
    envNames.push("mock");
}
const startupArg = process.argv[2] ? process.argv[2].toLowerCase() : null;
let currentEnv = startupArg && environments[startupArg] ? startupArg : envNames[0];
if (startupArg && !environments[startupArg]) console.warn(`  Warning: "${startupArg}" not configured. Defaulting to: ${currentEnv}`);
const PORT = parseInt(process.env.PORT, 10) || 3000;
let BACKLOG_THRESHOLD = parseInt(process.env.BACKLOG_THRESHOLD, 10) || 250;
const LOG_401 = (process.env.LOG_401 || "false").toLowerCase() === "true";
const SETTINGS_PATH = path.join(__dirname, "cache", "settings.json");

// Load valid theme IDs from manifest
var _validThemes = new Set(["dark", "light"]); // fallback
try {
    var manifestPath = path.join(__dirname, "public", "shared", "themes", "manifest.json");
    var manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    _validThemes = new Set(manifest.map(function (t) { return t.id; }));
} catch (e) { console.warn("Could not load theme manifest, using defaults"); }

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            var data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
            if (data.backlogThreshold != null) BACKLOG_THRESHOLD = parseInt(data.backlogThreshold, 10) || BACKLOG_THRESHOLD;
            if (data.wailaFetchDelay != null) wailaService.setFetchDelay(parseInt(data.wailaFetchDelay, 10) || wailaService.getFetchDelay());
            if (data.wtIndexFetchDelay != null) worktypeService.setFetchDelay(parseInt(data.wtIndexFetchDelay, 10) || worktypeService.getFetchDelay());
            if (data.cookieRefreshInterval != null) auth.setCookieRefreshInterval(parseInt(data.cookieRefreshInterval, 10) || auth.getCookieRefreshInterval());
            if (data.autoRefreshInterval != null) _autoRefreshInterval = parseInt(data.autoRefreshInterval, 10) || _autoRefreshInterval;
            if (data.alertDurationThreshold != null) _alertDurationThreshold = parseInt(data.alertDurationThreshold, 10) || _alertDurationThreshold;
            if (data.theme) _theme = data.theme;
            if (data.desktopAlertMonitoring != null) _desktopAlertMonitoring = !!data.desktopAlertMonitoring;
            else if (data.desktopNotifications != null) _desktopAlertMonitoring = !!data.desktopNotifications;
            if (data.notifyStreams != null) _notifyStreams = !!data.notifyStreams;
            if (data.notifyStreamsDuration != null) _notifyStreamsDuration = !!data.notifyStreamsDuration;
            if (data.notifyConnections != null) _notifyConnections = !!data.notifyConnections;
            if (data.notifyConnectionsDuration != null) _notifyConnectionsDuration = !!data.notifyConnectionsDuration;
            if (data.zeroConnectionStreams != null) _zeroConnectionStreams = String(data.zeroConnectionStreams);
            if (data.notifyNodes != null) _notifyNodes = !!data.notifyNodes;
            if (data.notifyNodesDuration != null) _notifyNodesDuration = !!data.notifyNodesDuration;
            if (data.notifyServices != null) _notifyServices = !!data.notifyServices;
            if (data.notifyServicesDuration != null) _notifyServicesDuration = !!data.notifyServicesDuration;
            if (data.notifyProdOnly != null) _notifyProdOnly = !!data.notifyProdOnly;
            if (data.notifyRecoveryThreshold != null) _notifyRecoveryThreshold = parseInt(data.notifyRecoveryThreshold, 10) || 0;
            if (data.notifyGracePeriod != null) _notifyGracePeriod = parseInt(data.notifyGracePeriod, 10) || 0;
            if (data.highContrast != null) _highContrast = !!data.highContrast;
            if (data.metricsEnabled != null) _metricsEnabled = !!data.metricsEnabled;
            if (data.metricsInterval != null) { var mi = parseInt(data.metricsInterval, 10); if (!isNaN(mi) && mi >= 5) _metricsInterval = mi; }
            if (data.chartBackgrounds != null) _chartBackgrounds = !!data.chartBackgrounds;
            // Office Hours
            if (data.officeHoursEnabled != null) _officeHoursEnabled = !!data.officeHoursEnabled;
            if (data.officeHoursStart != null && typeof data.officeHoursStart === "string") _officeHoursStart = data.officeHoursStart;
            if (data.officeHoursEnd != null && typeof data.officeHoursEnd === "string") _officeHoursEnd = data.officeHoursEnd;
            // UX Monitor
            uxMonitor.applySettings(data);
            log("settings", "Loaded from cache/settings.json");
        }
    } catch (e) { log("settings", "Load failed: " + e.message); }
}

function saveSettings() {
    try {
        var dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(Object.assign({
            backlogThreshold: BACKLOG_THRESHOLD,
            wailaFetchDelay: wailaService.getFetchDelay(),
            wtIndexFetchDelay: worktypeService.getFetchDelay(),
            cookieRefreshInterval: auth.getCookieRefreshInterval(),
            autoRefreshInterval: _autoRefreshInterval,
            alertDurationThreshold: _alertDurationThreshold,
            theme: _theme,
            desktopAlertMonitoring: _desktopAlertMonitoring,
            notifyStreams: _notifyStreams,
            notifyStreamsDuration: _notifyStreamsDuration,
            notifyConnections: _notifyConnections,
            notifyConnectionsDuration: _notifyConnectionsDuration,
            zeroConnectionStreams: _zeroConnectionStreams,
            notifyNodes: _notifyNodes,
            notifyNodesDuration: _notifyNodesDuration,
            notifyServices: _notifyServices,
            notifyServicesDuration: _notifyServicesDuration,
            notifyProdOnly: _notifyProdOnly,
            notifyRecoveryThreshold: _notifyRecoveryThreshold,
            notifyGracePeriod: _notifyGracePeriod,
            highContrast: _highContrast,
            metricsEnabled: _metricsEnabled,
            metricsInterval: _metricsInterval,
            chartBackgrounds: _chartBackgrounds,
            officeHoursEnabled: _officeHoursEnabled,
            officeHoursStart: _officeHoursStart,
            officeHoursEnd: _officeHoursEnd
        }, uxMonitor.getSettingsForSave()), null, 2));
    } catch (e) { log("settings", "Save failed: " + e.message); }
}
var _autoRefreshInterval = 60000;
var _alertDurationThreshold = parseInt(process.env.ALERT_DURATION_THRESHOLD, 10) || 60; // seconds
var _theme = "dark";
var _desktopAlertMonitoring = false;
var _notifyStreams = true;
var _notifyStreamsDuration = true;
var _notifyConnections = true;          // alert when a stream drops to zero connections
var _notifyConnectionsDuration = true;  // whether alert duration threshold applies
var _zeroConnectionStreams = "";        // comma-separated stream names to monitor; empty = all streams
var _notifyNodes = true;
var _notifyNodesDuration = true;
var _notifyServices = true;
var _notifyServicesDuration = true;
var _notifyProdOnly = false;
var _notifyRecoveryThreshold = 0;  // % below BACKLOG_THRESHOLD before breach clears (0 = disabled)
var _notifyGracePeriod = 0;        // seconds -- if condition re-triggers within this window, duration timer is not reset (0 = disabled)
var _highContrast = false;
var _metricsEnabled = true;
var _metricsInterval = 30; // seconds between metric writes per env+metric (minimum 5s)
var _chartBackgrounds = false; // fill chart canvas background for image export

// ─── Office Hours ───
var _officeHoursEnabled = (process.env.OFFICE_HOURS_ENABLED || "false").toLowerCase() === "true";
var _officeHoursStart = process.env.OFFICE_HOURS_START || "09:00";
var _officeHoursEnd = process.env.OFFICE_HOURS_END || "17:00";

/**
 * Check whether the current server-local time falls within the configured office hours window.
 * Returns true if office hours are disabled (i.e. always within hours).
 * Handles overnight spans (e.g. start=22:00, end=06:00).
 */
function isWithinOfficeHours() {
    if (!_officeHoursEnabled) return true;
    var now = new Date();
    var currentMins = now.getHours() * 60 + now.getMinutes();
    var startParts = _officeHoursStart.split(":");
    var endParts = _officeHoursEnd.split(":");
    var startMins = (parseInt(startParts[0], 10) || 0) * 60 + (parseInt(startParts[1], 10) || 0);
    var endMins = (parseInt(endParts[0], 10) || 0) * 60 + (parseInt(endParts[1], 10) || 0);
    if (startMins <= endMins) {
        // Normal span: e.g. 08:00 - 18:00
        return currentMins >= startMins && currentMins < endMins;
    } else {
        // Overnight span: e.g. 22:00 - 06:00
        return currentMins >= startMins || currentMins < endMins;
    }
}

// UX Monitor settings are owned by server/ux-monitor.js
// ─── Teams webhook (server-level, controlled via .env) ───
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL || null;
var _teamsEnabled = (process.env.TEAMS_WEBHOOK_ENABLED || "false").toLowerCase() === "true";

// Health monitor, SSE, alert dispatch, and Teams webhook are in server/health-monitor.js

// ─── Mock environment state (stays in server.js -- mutated by mock control API) ───
var _mockState = {
    streams: {
        "executionengine-cc":              { backlog: 0, connections: 1 },
        "sharedo-events-cc-executionengine": { backlog: 0, connections: 1 }
    },
    nodes: {
        "MB-EE-01": { stopped: 0, restarting: 0, running: 5 }
    },
    services: {
        "imanage-work":  { name: "iManage Work",  healthy: true },
        "imanage-oauth": { name: "iManage OAuth", healthy: true },
        "docusign":      { name: "DocuSign",       healthy: true }
    }
};
// ─── Startup banner ───
function printStartupBanner() {
    var c = _isTTY ? _ansi256 : function () { return ""; };
    var r = _isTTY ? _ansiReset : "";
    var blue = c(75);
    var dim = c(240);
    var label = c(245);
    var val = c(255);
    var green = c(78);
    var red = c(203);

    var art = [
        "  ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗  ██████╗ ",
        "  ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗",
        "  ███████╗███████║███████║██████╔╝█████╗  ██║  ██║██║   ██║",
        "  ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║██║   ██║",
        "  ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝╚██████╔╝",
        "  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ",
        "  ████████╗ ██████╗  ██████╗ ██╗     ███████╗",
        "  ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝",
        "     ██║   ██║   ██║██║   ██║██║     ███████╗",
        "     ██║   ██║   ██║██║   ██║██║     ╚════██║",
        "     ██║   ╚██████╔╝╚██████╔╝███████╗███████║",
        "     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝"
    ];

    console.log("");
    for (var i = 0; i < art.length; i++) {
        console.log(blue + art[i] + r);
    }
    console.log("");

    var notifyStatus = _desktopAlertMonitoring ? (_notifyProdOnly ? "On (prod only)" : "On (all envs)") : "Off";
    var notifyColour = _desktopAlertMonitoring ? green : dim;
    var teamsStatus = _teamsEnabled ? "Enabled" : "Disabled";
    var teamsColour = _teamsEnabled ? green : dim;
    var metricsStatus = _metricsEnabled ? "On (" + _metricsInterval + "s interval)" : "Off";
    var metricsColour = _metricsEnabled ? green : dim;
    var mockStatus = MOCK_ENV_ENABLED ? "Enabled" : "Disabled";
    var mockColour = MOCK_ENV_ENABLED ? green : dim;

    console.log("  Callum A | 2026");

    var line = dim + "  ─────────────────────────────────────────────────────────" + r;
    console.log(line);
    console.log(label + "  Environments       " + r + val + envNames.map(function (e) { return environments[e].label; }).join(", ") + r);
    console.log(label + "  Active             " + r + val + environments[currentEnv].label + " (" + environments[currentEnv].apiHost + ")" + r);
    console.log(label + "  Backlog threshold  " + r + val + BACKLOG_THRESHOLD + r);
    console.log(label + "  Alert duration     " + r + val + _alertDurationThreshold + "s" + r);
    console.log(label + "  Notifications      " + r + notifyColour + notifyStatus + r);
    console.log(label + "  Teams webhook      " + r + teamsColour + teamsStatus + r);

    var ohStatus = _officeHoursEnabled ? "On (" + _officeHoursStart + " - " + _officeHoursEnd + ")" : "Off";
    var ohColour = _officeHoursEnabled ? green : dim;
    console.log(label + "  Office hours       " + r + ohColour + ohStatus + r);

    console.log(label + "  Metrics            " + r + metricsColour + metricsStatus + r);
    console.log(label + "  Health interval    " + r + val + _autoRefreshInterval + "ms" + r);

    var uxBanner = uxMonitor.getBannerStatus();
    var uxStatus = uxBanner.text;
    var uxColour = uxBanner.isEnabled ? green : dim;
    console.log(label + "  UX monitor         " + r + uxColour + uxStatus + r);
    console.log(label + "  Mock env           " + r + mockColour + mockStatus + r);

    var isMulti = (process.env.MULTI_USER || "false").toLowerCase() === "true";
    var multiStatus = isMulti ? "Enabled" : "Disabled";
    var multiColour = isMulti ? green : dim;
    console.log(label + "  Multi-user         " + r + multiColour + multiStatus + r);
}

// ─── State ───
const backlogAlerts = {};
// ─── Express ───
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Environment resolution middleware ───
// Reads X-Sharedo-Env header from the client to determine which environment
// this request targets. Falls back to the server-level currentEnv default.
// Phase 1 of multi-user support: decouples per-request env from server global.
app.use("/api", function (req, _res, next) {
    var envHeader = req.headers["x-sharedo-env"];
    if (envHeader && environments[envHeader]) {
        req.envName = envHeader;
        req.envConfig = environments[envHeader];
    } else {
        req.envName = currentEnv;
        req.envConfig = environments[currentEnv];
    }
    next();
});

// ─── Session middleware (multi-user mode) ───
// Validates session cookie on API routes. No-op in single-user mode.
// Exempt paths: GET /api/session, POST /api/session/register, GET /api/settings
app.use("/api", session.middleware);

// ─── Clean URL routes ───
app.get("/register", (_req, res) => {
    if (!session.isMultiUser()) return res.redirect("/");
    res.sendFile(path.join(__dirname, "public", "register", "register.html"));
});
app.get("/", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "monitor", "monitor.html")); });
app.get("/search", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "search", "search.html")); });
app.get("/waila", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "waila", "waila.html")); });
app.get("/options", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "options", "options.html")); });
app.get("/issues", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "issues", "issues.html")); });
app.get("/metrics", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "metrics", "metrics.html")); });
app.get("/worktype", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "worktype", "worktype.html")); });
app.get("/ux", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "ux", "ux.html")); });
app.get("/theme-builder", session.pageGate, (_req, res) => { res.sendFile(path.join(__dirname, "public", "theme-builder", "theme-builder.html")); });

app.get("/api/env", (req, res) => {
    const env = environments[req.envName];
    res.json({ current: req.envName, environment: env.label, apiHost: env.apiHost, hasCookie: !!auth.cookieCache[req.envName],
        environments: envNames.map(n => ({ name: n, label: environments[n].label, apiHost: environments[n].apiHost, hasCookie: !!auth.cookieCache[n] })) });
});
app.post("/api/env/select", (req, res) => {
    const t = req.body && req.body.environment; if (!t || !environments[t]) return res.status(400).json({ error: true, message: "Unknown env" });
    currentEnv = t; const env = environments[currentEnv]; log("env", `Switched to: ${env.label} (${env.apiHost})`);
    res.json({ current: currentEnv, environment: env.label, apiHost: env.apiHost, hasCookie: !!auth.cookieCache[currentEnv] });
});
app.post("/api/cookie", session.requireAdmin, (req, res) => {
    const c = req.body && req.body.cookie;
    if (c && typeof c === "string" && c.trim().length > 0) { auth.setCookie(req.envName, c.trim(), "manual"); res.json({ success: true, hasCookie: true }); }
    else { auth.clearCookie(req.envName); res.json({ success: true, hasCookie: false }); }
});
app.post("/api/cookie/:env", session.requireAdmin, (req, res) => {
    const envName = req.params.env;
    if (!environments[envName]) return res.status(400).json({ error: true, message: "Unknown environment" });
    const c = req.body && req.body.cookie;
    if (c && typeof c === "string" && c.trim().length > 0) {
        auth.setCookie(envName, c.trim(), "manual");
        res.json({ success: true, hasCookie: true });
    } else {
        auth.clearCookie(envName);
        res.json({ success: true, hasCookie: false });
    }
});
app.post("/api/auth/reacquire/:env", session.requireAdmin, async (req, res) => {
    const envName = req.params.env;
    const env = environments[envName];
    if (!env) return res.status(400).json({ error: true, message: "Unknown environment" });
    if (!env.cookieUsername || !env.cookiePassword) return res.status(400).json({ error: true, message: "No auto-auth credentials configured for " + env.label });
    auth.clearCookie(envName);
    await auth.acquireCookieForEnv(envName);
    res.json({ success: true, hasCookie: !!auth.cookieCache[envName] });
});
app.get("/api/cookie/status", (req, res) => {
    const c = auth.cookieCache[req.envName]; let expiresAt = null, expiresInMin = null;
    if (c) { const jwt = auth.extractApiJwt(c); if (jwt) { const exp = auth.getJwtExpiry(jwt); if (exp) { expiresAt = new Date(exp).toISOString(); expiresInMin = Math.round((exp - Date.now())/1000/60); } } }
    res.json({ hasCookie: !!c, autoRefreshing: auth.isRefreshing(req.envName), expiresAt, expiresInMin });
});

// ─── Auto-auth status (for Options page Authentication section) ───
app.get("/api/auth/status", (_req, res) => {
    const result = [];
    for (const envName of envNames) {
        const env = environments[envName];
        if (env.isMock) continue;
        const c = auth.cookieCache[envName];
        let expiresInMin = null;
        let identity = null;
        if (c) {
            const jwt = auth.extractApiJwt(c);
            if (jwt) {
                const exp = auth.getJwtExpiry(jwt);
                if (exp) expiresInMin = Math.round((exp - Date.now()) / 1000 / 60);
                identity = auth.getJwtIdentity(jwt);
            }
        }
        var hasAutoAuth = !!(env.cookieUsername && env.cookiePassword);
        var hasBrowserData = fs.existsSync(path.join(__dirname, "cache", "ux-user-data", envName));
        var source = auth.cookieSource[envName] || (c ? "unknown" : "none");
        result.push({
            envName, label: env.label, username: env.cookieUsername || null,
            hasAutoAuth, hasBrowserData, cookieSource: source, hasCookie: !!c,
            autoRefreshing: auth.isRefreshing(envName), expiresInMin, identity
        });
    }
    res.json(result);
});

// ─── Browser-based authentication (Playwright) ───
var _browserLoginActive = {};

app.post("/api/auth/launch-browser", session.requireAdmin, async (req, res) => {
    var envName = req.body && req.body.environment;
    if (!envName || !environments[envName]) return res.status(400).json({ error: true, message: "Unknown environment" });
    if (environments[envName].isMock) return res.status(400).json({ error: true, message: "Not applicable for mock environment" });
    if (!playwright) return res.status(500).json({ error: true, message: "Playwright is not installed. Run: npm install playwright && npx playwright install chromium" });
    if (_browserLoginActive[envName]) return res.status(409).json({ error: true, message: "A login browser is already open for " + environments[envName].label });

    var env = environments[envName];
    var userDataDir = path.join(__dirname, "cache", "ux-user-data", envName);

    _browserLoginActive[envName] = true;
    log("cookie", "[" + envName + "] Launching browser for manual login...");
    res.json({ success: true, message: "Browser launched. Please log in." });

    // Close UX monitor's persistent context to release the user data dir lock.
    // The context will relaunch with updated cookies on the next page check cycle.
    await uxMonitor.closeContext();

    var context = null;
    try {
        fs.mkdirSync(userDataDir, { recursive: true });
        context = await playwright.chromium.launchPersistentContext(userDataDir, {
            headless: false, viewport: { width: 400, height: 488 },
            args: ["--disable-blink-features=AutomationControlled", "--app=https://" + env.apiHost + "/admin"]
        });
        var page = context.pages()[0] || await context.newPage();
        var maxWaitMs = 180000, pollIntervalMs = 2000, elapsed = 0, captured = false;

        while (elapsed < maxWaitMs) {
            var cookies = await context.cookies("https://" + env.apiHost);
            var cookieMap = {};
            for (var ci = 0; ci < cookies.length; ci++) cookieMap[cookies[ci].name] = cookies[ci].value;
            var hasSession = Object.keys(cookieMap).some(function (k) { return k.toLowerCase().startsWith("sharedo."); });
            var hasApiJwt = !!cookieMap["_api"];
            if (hasSession && hasApiJwt) {
                var cookieHeader = cookies.map(function (ck) { return ck.name + "=" + ck.value; }).join("; ");
                auth.setCookie(envName, cookieHeader, "browser");
                var jwt = auth.extractApiJwt(cookieHeader);
                var identity = jwt ? auth.getJwtIdentity(jwt) : null;
                log("cookie", "[" + envName + "] Browser login captured session" + (identity ? " for " + identity : "") + " (cookie: " + cookieHeader.length + " chars)");
                captured = true;
                break;
            }
            await new Promise(function (r) { setTimeout(r, pollIntervalMs); });
            elapsed += pollIntervalMs;
        }
        if (!captured) log("cookie", "[" + envName + "] Browser login timed out (3 min) -- no session captured");
        await context.close();
    } catch (err) {
        log("cookie", "[" + envName + "] Browser login error: " + err.message);
        if (context) { try { await context.close(); } catch (e) {} }
    } finally {
        delete _browserLoginActive[envName];
    }
});

// ─── Settings ───
app.get("/api/settings", (req, res) => {
    var serverSettings = Object.assign({
        backlogThreshold: BACKLOG_THRESHOLD,
        wailaFetchDelay: wailaService.getFetchDelay(),
        wtIndexFetchDelay: worktypeService.getFetchDelay(),
        cookieRefreshInterval: auth.getCookieRefreshInterval(),
        autoRefreshInterval: _autoRefreshInterval,
        alertDurationThreshold: _alertDurationThreshold,
        desktopAlertMonitoring: _desktopAlertMonitoring,
        notifyStreams: _notifyStreams,
        notifyStreamsDuration: _notifyStreamsDuration,
        notifyConnections: _notifyConnections,
        notifyConnectionsDuration: _notifyConnectionsDuration,
        zeroConnectionStreams: _zeroConnectionStreams,
        notifyNodes: _notifyNodes,
        notifyNodesDuration: _notifyNodesDuration,
        notifyServices: _notifyServices,
        notifyServicesDuration: _notifyServicesDuration,
        notifyProdOnly: _notifyProdOnly,
        notifyRecoveryThreshold: _notifyRecoveryThreshold,
        notifyGracePeriod: _notifyGracePeriod,
        metricsEnabled: _metricsEnabled,
        metricsInterval: _metricsInterval,
        teamsEnabled: _teamsEnabled,
        officeHoursEnabled: _officeHoursEnabled,
        officeHoursStart: _officeHoursStart,
        officeHoursEnd: _officeHoursEnd,
        multiUser: session.isMultiUser()
    }, uxMonitor.getSettings());

    if (session.isMultiUser()) {
        var s = session.getSessionFromReq(req);
        serverSettings.isAdmin = !!(s && s.isAdmin);
        // Overlay per-user settings from user file (theme, highContrast, chartBackgrounds, desktopNotifications)
        if (s && s.slug) {
            var userSettings = session.loadUserSettings(s.slug);
            if (userSettings) {
                if (userSettings.theme != null) serverSettings.theme = userSettings.theme;
                if (userSettings.highContrast != null) serverSettings.highContrast = !!userSettings.highContrast;
                if (userSettings.chartBackgrounds != null) serverSettings.chartBackgrounds = !!userSettings.chartBackgrounds;
                if (userSettings.desktopNotifications != null) serverSettings.desktopNotifications = !!userSettings.desktopNotifications;
                else serverSettings.desktopNotifications = false;
            } else {
                serverSettings.desktopNotifications = false;
            }
        } else {
            serverSettings.desktopNotifications = false;
        }
    } else {
        // Single-user: appearance settings from server, desktopNotifications mirrors desktopAlertMonitoring
        serverSettings.theme = _theme;
        serverSettings.highContrast = _highContrast;
        serverSettings.chartBackgrounds = _chartBackgrounds;
        serverSettings.desktopNotifications = _desktopAlertMonitoring;
        serverSettings.isAdmin = true;
    }

    res.json(serverSettings);
});
app.post("/api/settings", (req, res) => {
    const s = req.body;
    if (!s) return res.status(400).json({ error: true, message: "Missing body" });

    // ─── Per-user settings (saved to user file in multi-user, settings.json in single-user) ───
    if (session.isMultiUser()) {
        var userSession = session.getSessionFromReq(req);
        if (userSession && userSession.slug) {
            var userSettings = session.loadUserSettings(userSession.slug) || {};
            if (s.theme && _validThemes.has(s.theme)) userSettings.theme = s.theme;
            if (s.highContrast != null) userSettings.highContrast = !!s.highContrast;
            if (s.chartBackgrounds != null) userSettings.chartBackgrounds = !!s.chartBackgrounds;
            if (s.desktopNotifications != null) userSettings.desktopNotifications = !!s.desktopNotifications;
            session.saveUserSettings(userSession.slug, userSettings);
        }
    } else {
        // Single-user: appearance settings go to server state (saved to settings.json)
        if (s.theme && _validThemes.has(s.theme)) _theme = s.theme;
        if (s.highContrast != null) _highContrast = !!s.highContrast;
        if (s.chartBackgrounds != null) _chartBackgrounds = !!s.chartBackgrounds;
    }

    // ─── Server settings (admin-only in multi-user) ───
    var isAdmin = !session.isMultiUser() || (req.user && req.user.isAdmin);

    if (!isAdmin) {
        // Non-admin in multi-user: user settings saved above, skip server settings
        res.json({ success: true });
        return;
    }

    var restartHealth = false;

    if (s.backlogThreshold != null) {
        var bt = parseInt(s.backlogThreshold, 10);
        if (!isNaN(bt) && bt > 0) BACKLOG_THRESHOLD = bt;
    }
    if (s.wailaFetchDelay != null) {
        var wd = parseInt(s.wailaFetchDelay, 10);
        if (!isNaN(wd) && wd >= 0) wailaService.setFetchDelay(wd);
    }
    if (s.wtIndexFetchDelay != null) {
        var wtd = parseInt(s.wtIndexFetchDelay, 10);
        if (!isNaN(wtd) && wtd >= 0) worktypeService.setFetchDelay(wtd);
    }
    if (s.cookieRefreshInterval != null) {
        var ci = parseInt(s.cookieRefreshInterval, 10);
        if (!isNaN(ci) && ci >= 60000) {
            auth.setCookieRefreshInterval(ci);
        }
    }
    if (s.autoRefreshInterval != null) {
        var ar = parseInt(s.autoRefreshInterval, 10);
        if (!isNaN(ar) && ar >= 5000) { _autoRefreshInterval = ar; restartHealth = true; }
    }
    if (s.alertDurationThreshold != null) {
        var ad = parseInt(s.alertDurationThreshold, 10);
        if (!isNaN(ad) && ad >= 0) _alertDurationThreshold = ad;
    }
    if (s.desktopAlertMonitoring != null) {
        var wasEnabled = _desktopAlertMonitoring;
        _desktopAlertMonitoring = !!s.desktopAlertMonitoring;
        if (_desktopAlertMonitoring !== wasEnabled) restartHealth = true;
    }
    // Backward compat: accept desktopNotifications as server gate until options.js is updated
    if (s.desktopNotifications != null && s.desktopAlertMonitoring == null) {
        var wasEnabled2 = _desktopAlertMonitoring;
        _desktopAlertMonitoring = !!s.desktopNotifications;
        if (_desktopAlertMonitoring !== wasEnabled2) restartHealth = true;
    }
    if (s.notifyStreams != null) _notifyStreams = !!s.notifyStreams;
    if (s.notifyStreamsDuration != null) _notifyStreamsDuration = !!s.notifyStreamsDuration;
    if (s.notifyConnections != null) _notifyConnections = !!s.notifyConnections;
    if (s.notifyConnectionsDuration != null) _notifyConnectionsDuration = !!s.notifyConnectionsDuration;
    if (s.zeroConnectionStreams != null) _zeroConnectionStreams = String(s.zeroConnectionStreams);
    if (s.notifyNodes != null) _notifyNodes = !!s.notifyNodes;
    if (s.notifyNodesDuration != null) _notifyNodesDuration = !!s.notifyNodesDuration;
    if (s.notifyServices != null) _notifyServices = !!s.notifyServices;
    if (s.notifyServicesDuration != null) _notifyServicesDuration = !!s.notifyServicesDuration;
    if (s.notifyProdOnly != null) _notifyProdOnly = !!s.notifyProdOnly;
    if (s.notifyRecoveryThreshold != null) {
        var rt = parseInt(s.notifyRecoveryThreshold, 10);
        if (!isNaN(rt) && rt >= 0 && rt <= 100) _notifyRecoveryThreshold = rt;
    }
    if (s.notifyGracePeriod != null) {
        var gp = parseInt(s.notifyGracePeriod, 10);
        if (!isNaN(gp) && gp >= 0) _notifyGracePeriod = gp;
    }
    if (s.metricsEnabled != null) {
        _metricsEnabled = !!s.metricsEnabled;
    }
    if (s.metricsInterval != null) {
        var mi = parseInt(s.metricsInterval, 10);
        if (!isNaN(mi) && mi >= 5) _metricsInterval = mi;
    }

    // Office Hours
    if (s.officeHoursEnabled != null) _officeHoursEnabled = !!s.officeHoursEnabled;
    if (s.officeHoursStart != null && typeof s.officeHoursStart === "string") {
        var ohsParts = s.officeHoursStart.match(/^(\d{1,2}):(\d{2})$/);
        if (ohsParts) _officeHoursStart = s.officeHoursStart;
    }
    if (s.officeHoursEnd != null && typeof s.officeHoursEnd === "string") {
        var oheParts = s.officeHoursEnd.match(/^(\d{1,2}):(\d{2})$/);
        if (oheParts) _officeHoursEnd = s.officeHoursEnd;
    }

    // UX Monitor settings
    var uxResult = uxMonitor.applySettings(s);
    var restartUx = uxResult.restartNeeded;

    saveSettings();
    if (restartHealth) { healthMonitor.start(); }
    if (restartUx) { uxMonitor.startProbeMonitor(); uxMonitor.startPageMonitor(); }
    log("settings", `Updated -- backlog: ${BACKLOG_THRESHOLD}, alertDuration: ${_alertDurationThreshold}s, alertMonitoring: ${_desktopAlertMonitoring}`);
    res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// Metrics Recording -- implementation in server/metrics.js
// ═══════════════════════════════════════════════════════════════════

app.get("/api/metrics/status", (_req, res) => {
    res.json(metrics.getStatus());
});

app.get("/api/metrics/:env/:metric/export", (req, res) => {
    var envName = req.params.env;
    var metric = req.params.metric;
    if (!environments[envName]) return res.status(400).json({ error: true, message: "Unknown environment" });
    var fp = metrics.filePath(envName, metric);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: true, message: "No data for " + metric + " in " + envName });
    var now = new Date();
    var dateSuffix = String(now.getDate()).padStart(2, "0") + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + now.getFullYear();
    var filename = metric + "-backup-" + envName + "-" + dateSuffix + ".jsonl";
    res.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
    res.setHeader("Content-Type", "application/x-ndjson");
    fs.createReadStream(fp).pipe(res);
});

app.get("/api/metrics/:env/:metric", (req, res) => {
    var envName = req.params.env;
    var metric = req.params.metric;
    if (!environments[envName]) return res.status(400).json({ error: true, message: "Unknown environment" });
    try {
        res.json(metrics.readMetric(envName, metric, req.query));
    } catch (err) {
        res.status(500).json({ error: true, message: err.message });
    }
});

// ─── SSE alert stream ───
app.get("/api/alerts/stream", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.write("event: connected\ndata: {}\n\n");
    healthMonitor.addSseClient(res);
    req.on("close", function () { healthMonitor.removeSseClient(res); });
});

// ─── Test notifications ───
app.post("/api/alerts/test", (req, res) => {
    var alerts = healthMonitor.buildTestAlerts(req.envName, environments);
    for (var i = 0; i < alerts.length; i++) { alerts[i].skipTeams = true; healthMonitor.pushAlert(alerts[i]); }
    res.json({ success: true, sent: alerts.length });
});

app.post("/api/alerts/test-teams", (req, res) => {
    if (!_teamsEnabled || !TEAMS_WEBHOOK_URL) return res.status(400).json({ error: true, message: "Teams webhook not enabled" });
    var alerts = healthMonitor.buildTestAlerts(req.envName, environments);
    for (var i = 0; i < alerts.length; i++) { healthMonitor.pushAlert(alerts[i]); }
    res.json({ success: true, sent: alerts.length });
});
// ─── Main refresh ───
app.get("/api/refresh", async (req, res) => {
    try {
        const reqEnv = req.envName;
        const env = environments[reqEnv];

        // Mock environment: return synthetic data from _mockState
        if (env && env.isMock) {
            var mockStreams = Object.entries(_mockState.streams).map(function(e) {
                return { groupName: e[0], streamName: e[0], backlog: e[1].backlog || 0, connectionCount: e[1].connections, connections: e[1].connections };
            });
            var mockNodes = Object.entries(_mockState.nodes).map(function(e) {
                return Object.assign({ systemName: e[0], name: e[0] }, e[1]);
            });
            var mockLinked = [{ services: Object.entries(_mockState.services).map(function(e) {
                return { systemName: e[0], name: e[1].name, isLinked: e[1].healthy, providerIsValid: e[1].healthy, configurationIsValid: e[1].healthy };
            }) }];
            var mockNow = Date.now();
            if (!backlogAlerts[reqEnv]) backlogAlerts[reqEnv] = {};
            var mockAlerts = backlogAlerts[reqEnv];
            var mockActive = new Set();
            for (var ms of mockStreams) {
                var mgn = ms.groupName;
                if ((ms.backlog || 0) > BACKLOG_THRESHOLD && mgn) {
                    mockActive.add(mgn);
                    if (!mockAlerts[mgn]) mockAlerts[mgn] = { firstSeenAt: mockNow, backlog: ms.backlog };
                    else mockAlerts[mgn].backlog = ms.backlog;
                }
            }
            for (var mgn of Object.keys(mockAlerts)) { if (!mockActive.has(mgn)) delete mockAlerts[mgn]; }
            var mockAlertDurations = {};
            for (var [mgn, minfo] of Object.entries(mockAlerts)) { mockAlertDurations[mgn] = { firstSeenAt: minfo.firstSeenAt, durationMs: mockNow - minfo.firstSeenAt }; }
            return res.json({
                timestamp: new Date().toISOString(),
                environment: reqEnv,
                environmentLabel: env.label,
                hasCookie: false,
                streamStats: mockStreams,
                nodeStatus: mockNodes,
                nodeConsoles: {},
                indexerStatus: { error: true, message: "Not available for Test Env" },
                esClusterStatus: { error: true, message: "Not available for Test Env" },
                diagConfig: { error: true, message: "Not available for Test Env" },
                sqlJobs: { error: true, message: "Not available for Test Env" },
                sqlChecks: { error: true, message: "Not available for Test Env" },
                linkedServices: mockLinked,
                maintenancePlans: { error: true, message: "Not available for Test Env" },
                backlogAlerts: mockAlertDurations,
                backlogThreshold: BACKLOG_THRESHOLD
            });
        }

        const host = env.apiHost; const token = await auth.getToken(reqEnv);
        const adminCookie = auth.cookieCache[reqEnv] || null;
        const adminAuth = adminCookie ? { type: "cookie", value: adminCookie } : { type: "bearer", value: token };
        const indexerAuth = adminCookie ? (function(){ const j = auth.extractApiJwt(adminCookie); return j ? { type: "bearer", value: j } : adminAuth; })() : { type: "bearer", value: token };

        const [streamStats, nodeStatus, indexerStatus, esClusterStatus, diagConfig, sqlJobs, sqlChecks, linkedServices, maintenancePlans] = await Promise.all([
            auth.sharedoGet(host, "/admin/diagnostics/eventengine/streamStats", adminAuth),
            auth.sharedoGet(host, "/api/_ee/monitor", { type: "bearer", value: token }),
            auth.sharedoGet(host, "/api/indexer/status?_=" + Date.now(), indexerAuth),
            auth.sharedoGet(host, "/api/elasticsearch/status", { type: "bearer", value: token }),
            auth.sharedoGet(host, "/api/admin/diagnostics/config", { type: "bearer", value: token }),
            auth.sharedoGet(host, "/api/reports/agent/jobs", { type: "bearer", value: token }),
            auth.sharedoGet(host, "/api/reports/agent/checks", { type: "bearer", value: token }),
            auth.tryAuth(host, "GET", "/api/admin/serviceIntegrations", null, token, adminCookie),
            auth.tryAuth(host, "GET", "/api/listview/core-admin-maintenance-plans/30/1/nextRun/asc/?view=table&withCounts=1", null, token, adminCookie)
        ]);

        // Node consoles
        let nodeArray = [];
        if (nodeStatus && !nodeStatus.error) { nodeArray = Array.isArray(nodeStatus) ? nodeStatus : (nodeStatus.nodes && Array.isArray(nodeStatus.nodes) ? nodeStatus.nodes : []); }
        let nodeConsoles = {};
        if (nodeArray.length > 0) {
            const results = await Promise.all(nodeArray.map(node => {
                const name = node.systemName || node.name || ""; if (!name) return Promise.resolve({ name: "", lines: [] });
                return auth.sharedoGet(host, `/api/_ee/monitor/${encodeURIComponent(name)}/console/stdout`, { type: "bearer", value: token })
                    .then(d => ({ name, lines: Array.isArray(d) ? d.slice(-8) : typeof d === "string" ? d.split("\n").slice(-8) : [] })).catch(() => ({ name, lines: ["[Failed]"] }));
            }));
            for (const c of results) { if (c.name) nodeConsoles[c.name] = c.lines; }
        }

        // Backlog alerts
        if (!backlogAlerts[reqEnv]) backlogAlerts[reqEnv] = {};
        const alerts = backlogAlerts[reqEnv]; const now = Date.now();
        if (streamStats && !streamStats.error && Array.isArray(streamStats)) {
            const active = new Set();
            for (const s of streamStats) { const gn = s.groupName || s.streamName || ""; if ((s.backlog || 0) > BACKLOG_THRESHOLD && gn) { active.add(gn); if (!alerts[gn]) alerts[gn] = { firstSeenAt: now, backlog: s.backlog }; else alerts[gn].backlog = s.backlog; } }
            for (const gn of Object.keys(alerts)) { if (!active.has(gn)) delete alerts[gn]; }
        }
        const alertDurations = {}; for (const [gn, info] of Object.entries(alerts)) { alertDurations[gn] = { firstSeenAt: info.firstSeenAt, durationMs: now - info.firstSeenAt }; }

        // Record metrics from monitor refresh
        metrics.recordStreamStats(reqEnv, streamStats);
        metrics.recordNodeStatus(reqEnv, nodeStatus);

        res.json({ timestamp: new Date().toISOString(), environment: reqEnv, environmentLabel: env.label, hasCookie: !!adminCookie,
            streamStats, nodeStatus, nodeConsoles, indexerStatus, esClusterStatus, diagConfig, sqlJobs, sqlChecks, linkedServices, maintenancePlans, backlogAlerts: alertDurations, backlogThreshold: BACKLOG_THRESHOLD });
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Processes (errored / running, dynamic filters) ───
app.post("/api/processes", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        if (!adminCookie) return res.json({ error: true, status: 401, message: "Admin cookie required." });
        const apiJwt = auth.extractApiJwt(adminCookie);
        if (!apiJwt) return res.json({ error: true, status: 401, message: "Could not extract _api JWT." });

        const rpp = parseInt(req.body.rowsPerPage, 10) || 20;
        const page = parseInt(req.body.page, 10) || 1;
        const states = req.body.states || ["ERRORED"];  // array of uppercase state values
        const fromDate = req.body.fromDate || null;     // null means no date filter

        const url = `/api/listview/core-admin-active-processes/${rpp}/${page}/started/desc/?view=table&withCounts=1`;
        const filters = [];

        // Date filter (only if fromDate is provided)
        if (fromDate) {
            filters.push({ fieldId: "started", filterId: "clv-filter-date-range", config: "{}", parameters: JSON.stringify({ from: fromDate, to: null }) });
        }

        // State filter
        if (states.length > 0) {
            filters.push({ fieldId: "state", filterId: "clv-filter-lov", config: "{}", parameters: JSON.stringify({ selectedValues: states }) });
        }

        const payload = { additionalParameters: {}, filters, viewId: "1542ad84-d907-4902-93a8-837d5d4421b2" };

        const start = Date.now();
        const result = await auth.sharedoPost(host, url, payload, { type: "bearer", value: apiJwt });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (result && !result.error) log("api", `Processes page ${page} in ${elapsed}s (${result.resultCount || 0} total, states: ${states.join(",")})`);

        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Process detail (execution plan with steps) ───
app.get("/api/processes/:processId", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const url = `/api/executionengine/plans/executing/${encodeURIComponent(req.params.processId)}`;
        const result = await auth.tryAuth(host, "GET", url, null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Step execution log ───
app.get("/api/processes/:processId/steps/:stepId/log", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const url = `/api/executionengine/plans/executing/${encodeURIComponent(req.params.processId)}/steps/${encodeURIComponent(req.params.stepId)}/log`;
        const result = await auth.tryAuth(host, "GET", url, null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Failed Outbound Emails ───
app.post("/api/issues/emails", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const rpp = parseInt(req.body.rowsPerPage, 10) || 10;
        const page = parseInt(req.body.page, 10) || 1;
        const fromDate = req.body.fromDate || null;
        const url = `/api/listview/custom-admin-failed-outbound-emails/${rpp}/${page}/createdDate/desc/?view=table&withCounts=1`;
        const filters = [];
        if (fromDate) filters.push({ fieldId: "createdDate", filterId: "clv-filter-date-range", config: "{}", parameters: JSON.stringify({ from: fromDate, to: null }) });
        const payload = { additionalParameters: {}, filters, viewId: "da0347ff-88cc-4dce-ba9c-9ca78d20c106" };
        const result = await auth.tryAuth(host, "POST", url, payload, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Failed Outbound SMS ───
app.post("/api/issues/sms", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const rpp = parseInt(req.body.rowsPerPage, 10) || 10;
        const page = parseInt(req.body.page, 10) || 1;
        const fromDate = req.body.fromDate || null;
        const url = `/api/listview/custom-admin-failed-outbound-sms/${rpp}/${page}/createdDate/desc/?view=table&withCounts=1`;
        const filters = [];
        if (fromDate) filters.push({ fieldId: "createdDate", filterId: "clv-filter-date-range", config: "{}", parameters: JSON.stringify({ from: fromDate, to: null }) });
        const payload = { additionalParameters: {}, filters, viewId: "26b074f2-0a62-4161-9d06-96b36d212828" };
        const result = await auth.tryAuth(host, "POST", url, payload, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── SYSADMIN Tasks (production only) ───
app.post("/api/issues/sysadmin", async (req, res) => {
    if (req.envName !== "prod") return res.json({ resultCount: 0, rows: [] });
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const rpp = parseInt(req.body.rowsPerPage, 10) || 100;
        const page = parseInt(req.body.page, 10) || 1;
        const fromDate = req.body.fromDate || null;
        const url = `/api/listview/custom-mb-worklist-all-short/${rpp}/${page}/dueDate/asc/?view=table&withCounts=1&contextId=e027def1-8b7e-4842-a8a6-b211001e25c1`;
        const filters = [];
        if (fromDate) filters.push({ fieldId: "createdDate", filterId: "clv-filter-date-range", config: "{}", parameters: JSON.stringify({ from: fromDate, to: null }) });
        const payload = { additionalParameters: {}, filters, viewId: "582b5f9f-066d-424a-b9da-670b214f8e52" };
        const result = await auth.tryAuth(host, "POST", url, payload, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Work type tree ───
app.get("/api/types/tree", async (req, res) => {
    try {
        const env = req.envConfig; const token = await auth.getToken(req.envName);
        const adminCookie = auth.cookieCache[req.envName] || null;
        let result = await auth.sharedoGet(env.apiHost, "/api/sharedoTypes/tree", { type: "bearer", value: token });
        if (result && result.error && result.status === 401 && adminCookie) { const j = auth.extractApiJwt(adminCookie); if (j) result = await auth.sharedoGet(env.apiHost, "/api/sharedoTypes/tree", { type: "bearer", value: j }); }
        if (result && result.error && result.status === 401) result = await auth.sharedoGet(env.apiHost, "/api/v2/public/types/tree", { type: "bearer", value: token });
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Work item search ───
app.post("/api/search", async (req, res) => {
    try {
        const env = req.envConfig; const token = await auth.getToken(req.envName);
        const qm = req.body; if (!qm || !qm.search) return res.status(400).json({ error: true, message: "Missing search model" });
        res.json(await auth.sharedoPost(env.apiHost, "/api/v1/public/workItem/findByQuery", qm, { type: "bearer", value: token }));
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Search presets (shared file) ───
const SEARCH_PRESETS_PATH = path.join(__dirname, "cache", "search-presets", "work-item-query-presets.json");

function readPresets() {
    try { if (fs.existsSync(SEARCH_PRESETS_PATH)) return JSON.parse(fs.readFileSync(SEARCH_PRESETS_PATH, "utf8")); } catch (e) {}
    return [];
}

function writePresets(presets) {
    try {
        const dir = path.dirname(SEARCH_PRESETS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SEARCH_PRESETS_PATH, JSON.stringify(presets, null, 2));
    } catch (e) { log("api", "Presets write failed: " + e.message); }
}

app.get("/api/search/presets", (_req, res) => { res.json(readPresets()); });

app.post("/api/search/presets", (req, res) => {
    const presets = req.body;
    if (!Array.isArray(presets)) return res.status(400).json({ error: true, message: "Expected an array" });
    writePresets(presets);
    res.json({ success: true, count: presets.length });
});

// ═══════════════════════════════════════════════════════════════════
// Work Type Visualiser
// ═══════════════════════════════════════════════════════════════════

// ─── Work type tree (modeller endpoint, includes isCoreType/hasPortals) ───
app.get("/api/worktype/tree", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const result = await auth.tryAuth(host, "GET", "/api/modeller/sharedoTypes", null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Aspects (admin cookie required) ───
app.get("/api/worktype/aspects/:typeSystemName", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const url = `/api/admin/aspects/sharedoTypes/${encodeURIComponent(req.params.typeSystemName)}`;
        const result = await auth.tryAuth(host, "GET", url, null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Form builder detail ───
app.get("/api/worktype/form/:formId", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const url = `/api/formbuilder/forms/${encodeURIComponent(req.params.formId)}`;
        const result = await auth.tryAuth(host, "GET", url, null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Phase plan (admin cookie required) ───
app.get("/api/worktype/phaseplan/:typeSystemName", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const url = `/api/modeller/sharedoTypes/${encodeURIComponent(req.params.typeSystemName)}/phasePlan`;
        const result = await auth.tryAuth(host, "GET", url, null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Participant roles (listview, admin cookie required) ───
app.post("/api/worktype/roles/:typeSystemName", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const rpp = parseInt(req.body.rowsPerPage, 10) || 100;
        const page = parseInt(req.body.page, 10) || 1;
        const url = `/api/listview/core-modeller-sharedo-roles/${rpp}/${page}/name/asc/?view=table&withCounts=1&contextId=${encodeURIComponent(req.params.typeSystemName)}`;
        const payload = { additionalParameters: {}, filters: [] };
        const result = await auth.tryAuth(host, "POST", url, payload, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Key dates (admin cookie required) ───
app.get("/api/worktype/keydates/:typeSystemName", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const url = `/api/admin/keyDates/definitionForType/${encodeURIComponent(req.params.typeSystemName)}`;
        const result = await auth.tryAuth(host, "GET", url, null, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Type relationships (listview, admin cookie required) ───
app.post("/api/worktype/relationships/:typeSystemName", async (req, res) => {
    try {
        const env = req.envConfig; const host = env.apiHost;
        const adminCookie = auth.cookieCache[req.envName] || null;
        const token = await auth.getToken(req.envName);
        const rpp = parseInt(req.body.rowsPerPage, 10) || 100;
        const page = parseInt(req.body.page, 10) || 1;
        const url = `/api/listview/core-admin-sharedo-type-relationships/${rpp}/${page}/relationshipType/asc/?view=table&withCounts=1&contextId=${encodeURIComponent(req.params.typeSystemName)}`;
        const payload = { additionalParameters: {}, filters: [] };
        const result = await auth.tryAuth(host, "POST", url, payload, token, adminCookie);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

// ─── Compare: fetch type config from a different environment ───
app.post("/api/worktype/compare/:typeSystemName", async (req, res) => {
    try {
        const targetEnvName = req.body && req.body.targetEnv;
        if (!targetEnvName || !environments[targetEnvName]) {
            return res.status(400).json({ error: true, message: "Invalid target environment" });
        }
        const targetEnv = environments[targetEnvName];
        const host = targetEnv.apiHost;
        const token = await auth.getToken(targetEnvName);
        const adminCookie = auth.cookieCache[targetEnvName] || null;
        const sn = req.params.typeSystemName;

        // Fetch all three in parallel from target env
        const [aspects, keyDates, roles] = await Promise.all([
            auth.tryAuth(host, "GET", `/api/admin/aspects/sharedoTypes/${encodeURIComponent(sn)}`, null, token, adminCookie),
            auth.tryAuth(host, "GET", `/api/admin/keyDates/definitionForType/${encodeURIComponent(sn)}`, null, token, adminCookie),
            auth.tryAuth(host, "POST",
                `/api/listview/core-modeller-sharedo-roles/100/1/name/asc/?view=table&withCounts=1&contextId=${encodeURIComponent(sn)}`,
                { additionalParameters: {}, filters: [] }, token, adminCookie)
        ]);

        res.json({
            environment: targetEnvName,
            label: targetEnv.label,
            typeSystemName: sn,
            aspects: (aspects && !aspects.error) ? aspects : { error: true, message: (aspects && aspects.message) || "Failed" },
            keyDates: (keyDates && !keyDates.error) ? keyDates : { error: true, message: (keyDates && keyDates.message) || "Failed" },
            roles: (roles && !roles.error) ? roles : { error: true, message: (roles && roles.message) || "Failed" }
        });
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});


// ─── Work Type Config Index: routes (implementation in server/worktype-service.js) ───
app.get("/api/worktype/index/status", (req, res) => {
    var state = worktypeService.getState(req.envName);
    res.json({ environment: req.envName, status: state.status, count: state.types.length, builtAt: state.builtAt, error: state.error, progress: state.progress });
});

app.post("/api/worktype/index/build", async (req, res) => {
    var result = await worktypeService.buildIndex(req.envName);
    res.json(result);
});

app.post("/api/worktype/index/search", (req, res) => {
    res.json(worktypeService.search(req.envName, req.body || {}));
});

// WAILA and Work Type Config state/cache now owned by their respective modules in server/
loadSettings();
printStartupBanner();
session.init({
    log: log, fs: fs, path: path, baseDir: __dirname
});
auth.init({
    environments: environments, envNames: envNames, log: log,
    https: https, querystring: querystring, fs: fs, path: path,
    playwright: playwright, baseDir: __dirname,
    isLog401: function () { return LOG_401; }
});
metrics.init({
    log: log, isEnabled: function () { return _metricsEnabled; },
    getInterval: function () { return _metricsInterval; },
    fs: fs, path: path, baseDir: __dirname,
    maxMB: parseInt(process.env.METRICS_MAX_MB, 10) || 50
});
metrics.migrate();
wailaService.init({
    environments: environments, auth: auth, log: log,
    fs: fs, path: path, baseDir: __dirname,
    initialFetchDelay: process.env.WAILA_FETCH_DELAY || 100
});
wailaService.loadCaches();
worktypeService.init({
    environments: environments, auth: auth, log: log,
    fs: fs, path: path, baseDir: __dirname,
    initialFetchDelay: process.env.WT_INDEX_FETCH_DELAY || 100
});
worktypeService.loadCaches();
healthMonitor.init({
    environments: environments, envNames: envNames,
    cookieCache: auth.cookieCache, getToken: auth.getToken,
    sharedoGet: auth.sharedoGet, tryAuth: auth.tryAuth,
    log: log, https: https, mockState: _mockState, metrics: metrics,
    getNotifySettings: function () {
        return {
            desktopAlertMonitoring: _desktopAlertMonitoring, notifyStreams: _notifyStreams,
            notifyStreamsDuration: _notifyStreamsDuration, notifyConnections: _notifyConnections,
            notifyConnectionsDuration: _notifyConnectionsDuration, zeroConnectionStreams: _zeroConnectionStreams,
            notifyNodes: _notifyNodes, notifyNodesDuration: _notifyNodesDuration,
            notifyServices: _notifyServices, notifyServicesDuration: _notifyServicesDuration,
            notifyProdOnly: _notifyProdOnly, notifyRecoveryThreshold: _notifyRecoveryThreshold,
            notifyGracePeriod: _notifyGracePeriod, alertDurationThreshold: _alertDurationThreshold
        };
    },
    getBacklogThreshold: function () { return BACKLOG_THRESHOLD; },
    getAutoRefreshInterval: function () { return _autoRefreshInterval; },
    getTeamsConfig: function () { return { enabled: _teamsEnabled, webhookUrl: TEAMS_WEBHOOK_URL }; },
    isWithinOfficeHours: isWithinOfficeHours
});
healthMonitor.start();
uxMonitor.init({
    environments: environments, cookieCache: auth.cookieCache,
    extractApiJwt: auth.extractApiJwt, log: log, metrics: metrics,
    pushAlert: healthMonitor.pushAlert, fmtAlertTimestamp: healthMonitor.fmtAlertTimestamp,
    playwright: playwright, fs: fs, path: path, https: https, baseDir: __dirname,
    isWithinOfficeHours: isWithinOfficeHours
});
uxMonitor.startProbeMonitor();
uxMonitor.startPageMonitor();


// ─── WAILA routes (implementation in server/waila-service.js) ───
app.get("/api/waila/index/status", (req, res) => {
    var state = wailaService.getState(req.envName);
    res.json({ environment: req.envName, status: state.status, count: state.workflows.length, builtAt: state.builtAt, error: state.error, progress: state.progress });
});

app.post("/api/waila/index/build", async (req, res) => {
    var result = await wailaService.buildIndex(req.envName);
    res.json(result);
});

app.post("/api/waila/search", (req, res) => {
    res.json(wailaService.search(req.envName, req.body || {}));
});

app.get("/api/waila/workflow/:systemName", (req, res) => {
    var wf = wailaService.getWorkflow(req.envName, req.params.systemName);
    if (!wf) return res.status(404).json({ error: true, message: "Workflow not in index: " + req.params.systemName });
    res.json(wf);
});

app.post("/api/waila/workflow/:systemName/preview", async (req, res) => {
    try {
        var result = await wailaService.fetchPreview(req.envName, req.params.systemName);
        if (result.error) return res.json(result);
        res.json(result);
    } catch (err) { res.status(500).json({ error: true, message: err.message }); }
});

app.post("/api/waila/diff", (req, res) => {
    var envB = req.body && req.body.targetEnv;
    if (!envB || !environments[envB]) return res.status(400).json({ error: true, message: "Invalid target environment" });
    if (req.envName === envB) return res.status(400).json({ error: true, message: "Cannot diff an environment against itself" });
    res.json(wailaService.diff(req.envName, envB));
});
// ─── Mock environment API ───
app.get("/api/mock/state", (_req, res) => {
    if (!MOCK_ENV_ENABLED) return res.status(404).json({ error: true, message: "Mock environment not enabled" });
    res.json({
        enabled: true,
        backlogThreshold: BACKLOG_THRESHOLD,
        state: _mockState
    });
});

app.post("/api/mock/state", (req, res) => {
    if (!MOCK_ENV_ENABLED) return res.status(404).json({ error: true, message: "Mock environment not enabled" });
    var body = req.body;
    if (!body) return res.status(400).json({ error: true, message: "Missing body" });

    // Merge stream state (backlog and connections)
    if (body.streams && typeof body.streams === "object") {
        for (var sn in body.streams) {
            if (Object.prototype.hasOwnProperty.call(_mockState.streams, sn)) {
                var streamUpdate = body.streams[sn];
                if (streamUpdate && typeof streamUpdate === "object") {
                    if (streamUpdate.backlog != null) {
                        var bl = parseInt(streamUpdate.backlog, 10);
                        if (!isNaN(bl) && bl >= 0) _mockState.streams[sn].backlog = bl;
                    }
                    if (streamUpdate.connections != null) {
                        var co = parseInt(streamUpdate.connections, 10);
                        if (!isNaN(co) && co >= 0) _mockState.streams[sn].connections = co;
                    }
                }
            }
        }
    }

    // Merge node states
    if (body.nodes && typeof body.nodes === "object") {
        for (var nn in body.nodes) {
            if (Object.prototype.hasOwnProperty.call(_mockState.nodes, nn)) {
                var nd = body.nodes[nn];
                if (nd && typeof nd === "object") {
                    if (nd.stopped != null) _mockState.nodes[nn].stopped = Math.max(0, parseInt(nd.stopped, 10) || 0);
                    if (nd.restarting != null) _mockState.nodes[nn].restarting = Math.max(0, parseInt(nd.restarting, 10) || 0);
                    if (nd.running != null) _mockState.nodes[nn].running = Math.max(0, parseInt(nd.running, 10) || 0);
                }
            }
        }
    }

    // Merge service health
    if (body.services && typeof body.services === "object") {
        for (var sk in body.services) {
            if (Object.prototype.hasOwnProperty.call(_mockState.services, sk)) {
                _mockState.services[sk].healthy = !!body.services[sk].healthy;
            }
        }
    }

    res.json({ success: true, state: _mockState });
});

// ─── Mock environment control page ───
app.get("/debug/mock", (_req, res) => {
    if (!MOCK_ENV_ENABLED) return res.status(404).send("Mock environment not enabled. Set MOCK_ENV_ENABLED=true in .env to enable.");
    res.sendFile(path.join(__dirname, "public", "mock", "mock.html"));
});

// ═══════════════════════════════════════════════════════════════════
// Session routes (multi-user mode)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/session", (req, res) => {
    if (!session.isMultiUser()) return res.json({ multiUser: false });
    var s = session.getSessionFromReq(req);
    if (!s) return res.json({ multiUser: true, authenticated: false });
    res.json({ multiUser: true, authenticated: true, user: { firstName: s.firstName, lastName: s.lastName, email: s.email, isAdmin: !!s.isAdmin } });
});

app.post("/api/session/register", (req, res) => {
    if (!session.isMultiUser()) return res.status(400).json({ error: true, message: "Multi-user mode is not enabled" });
    var result = session.register(req.body);
    if (result.error) return res.status(400).json(result);
    res.cookie(result.cookieName, result.cookieValue, { httpOnly: true, maxAge: result.cookieMaxAge, sameSite: "lax", path: "/" });
    res.json({ success: true, user: { firstName: result.session.firstName, lastName: result.session.lastName, email: result.session.email, isAdmin: result.session.isAdmin } });
});

app.post("/api/session/admin", (req, res) => {
    if (!session.isMultiUser()) return res.status(400).json({ error: true, message: "Multi-user mode is not enabled" });
    var key = req.body && req.body.key;
    if (!session.verifyAdminKey(key)) return res.status(403).json({ error: true, message: "Invalid admin key" });
    var result = session.upgradeToAdmin(req.user);
    res.cookie(result.cookieName, result.cookieValue, { httpOnly: true, maxAge: result.cookieMaxAge, sameSite: "lax", path: "/" });
    res.json({ success: true, isAdmin: true });
});

app.post("/api/session/logout", (_req, res) => {
    res.clearCookie(session.COOKIE_NAME, { path: "/" });
    res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// UX Monitor -- Routes (implementation in server/ux-monitor.js)
// ═══════════════════════════════════════════════════════════════════

app.get("/api/ux/status", (_req, res) => {
    res.json(uxMonitor.getStatus());
});

app.post("/api/ux/probe/run", async (_req, res) => {
    var settings = uxMonitor.getSettings();
    if (!settings.uxEnabled) return res.status(400).json({ error: true, message: "UX monitor is disabled" });
    try {
        await uxMonitor.runProbes();
        res.json({ success: true, results: uxMonitor.getStatus().latestProbes });
    } catch (err) {
        res.status(500).json({ error: true, message: err.message });
    }
});

app.post("/api/ux/page/run", async (req, res) => {
    var targetUrl = req.body && req.body.url;
    var result = await uxMonitor.runPageCheck({ url: targetUrl });
    if (result.error) return res.status(result.status).json({ error: true, message: result.message });
    res.json(result);
});

app.post("/api/ux/page/run-all", async (_req, res) => {
    var result = await uxMonitor.runAllPageChecks();
    if (result.error) return res.status(result.status).json({ error: true, message: result.message });
    res.json(result);
});

app.get("/api/ux/page/latest", (_req, res) => {
    res.json({ results: uxMonitor.getLatestPageResults() });
});

app.post("/api/ux/context/close", session.requireAdmin, async (_req, res) => {
    await uxMonitor.closeContext();
    res.json({ success: true });
});

app.listen(PORT, () => {
    var c = _isTTY ? _ansi256 : function () { return ""; };
    var r = _isTTY ? _ansiReset : "";
    console.log(c(245) + "  Dashboard          " + r + c(75) + "http://localhost:" + PORT + r);
    console.log(c(240) + "  ─────────────────────────────────────────────────────────" + r);
    console.log("");
    auth.startupCookieAcquisition().then(function () {
        auth.extractCookiesFromBrowserSessions();
    });
});

// ─── Shutdown: close persistent browser context to prevent orphaned Chromium ───
var _shuttingDown = false;
async function shutdown() {
    if (_shuttingDown) return;  // guard against second Ctrl+C re-entering
    _shuttingDown = true;
    log("ux", "Server shutting down -- closing browser context");
    // Safety timeout: if ctx.close() hangs, force exit after 5 seconds
    var forceTimer = setTimeout(function () {
        log("ux", "Shutdown timeout -- forcing exit");
        process.exit(1);
    }, 5000);
    // Do NOT unref: we need the event loop alive for await to resolve
    try {
        await uxMonitor.closeContext();
    } catch (e) {
        log("ux", "Shutdown context close error: " + e.message);
    }
    clearTimeout(forceTimer);
    log("ux", "Shutdown complete");
    // Allow one event loop tick for stdout to flush before exit
    setTimeout(function () { process.exit(0); }, 50);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);