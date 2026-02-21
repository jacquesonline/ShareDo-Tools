/**
 * Health Monitor -- periodic health checks, alert evaluation, SSE dispatch, Teams webhooks
 *
 * Extracted from server.js. Server-level singleton (Tier 1 per MULTI-USER-STATE doc).
 *
 * Exports:
 *   init(deps)                     -- wire up dependencies
 *   start()                        -- start/restart the health check interval
 *   stop()                         -- stop the health check interval
 *   pushAlert(alert)               -- dispatch alert via SSE + Teams
 *   fmtAlertTimestamp()            -- formatted timestamp for alert cards
 *   addSseClient(res)              -- register an SSE connection
 *   removeSseClient(res)           -- unregister an SSE connection
 *   buildTestAlerts(envName, envs) -- build test alert payloads
 */
"use strict";

var _deps = null;

// ─── State ───
var _sseClients = [];
var _healthTimer = null;
var _healthState = {};  // envName -> { isFirst, prev, firstSeen, clearedAt }
var CRITICAL_SERVICES_LIST = ["imanage-work", "imanage-oauth", "docusign"];


// ═══════════════════════════════════════════════════════════════════
// Initialisation
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {Object} deps
 * @param {Object}   deps.environments        - environment config map
 * @param {string[]} deps.envNames            - environment name list
 * @param {Object}   deps.cookieCache         - envName -> cookie string
 * @param {Function} deps.getToken            - (envName) -> Promise<string>
 * @param {Function} deps.sharedoGet          - (host, path, auth) -> Promise
 * @param {Function} deps.tryAuth             - (host, method, path, body, token, cookie) -> Promise
 * @param {Function} deps.log                 - (category, message)
 * @param {Object}   deps.https               - Node https module
 * @param {Object}   deps.mockState           - _mockState reference (mutated externally by mock API)
 * @param {Object}   deps.metrics             - metrics module (recordStreamStats, recordNodeStatus)
 * @param {Function} deps.getNotifySettings   - () -> { all notification setting values }
 * @param {Function} deps.getBacklogThreshold - () -> number
 * @param {Function} deps.getAutoRefreshInterval - () -> number (ms)
 * @param {Function} deps.getTeamsConfig      - () -> { enabled, webhookUrl }
 */
function init(deps) {
    _deps = deps;
}


// ═══════════════════════════════════════════════════════════════════
// Health State
// ═══════════════════════════════════════════════════════════════════

function getHealthState(envName) {
    if (!_healthState[envName]) {
        _healthState[envName] = {
            isFirst: true,
            prev: { breachedStreams: {}, downNodes: {}, criticalServices: {}, zeroConnStreams: {} },
            firstSeen: { streams: {}, nodes: {}, services: {}, connStreams: {} },
            clearedAt: { streams: {}, nodes: {}, services: {}, connStreams: {} }
        };
    }
    return _healthState[envName];
}


// ═══════════════════════════════════════════════════════════════════
// Monitor lifecycle
// ═══════════════════════════════════════════════════════════════════

function start() {
    stop();
    for (var en in _healthState) _healthState[en].isFirst = true;
    var interval = _deps.getAutoRefreshInterval();
    var ns = _deps.getNotifySettings();
    var alertMode = ns.desktopNotifications ? ("alerting" + (ns.notifyProdOnly ? " (prod only)" : " (all envs)")) : "metrics only";
    _deps.log("health", "Monitor started -- " + alertMode + " (interval: " + interval + "ms, alert duration: " + ns.alertDurationThreshold + "s)");
    _healthTimer = setInterval(runAllHealthChecks, interval);
    setTimeout(runAllHealthChecks, 2000);
}

function stop() {
    if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
}

async function runAllHealthChecks() {
    for (var i = 0; i < _deps.envNames.length; i++) {
        var envName = _deps.envNames[i];
        if (!_deps.environments[envName]) continue;
        try {
            await runHealthCheckForEnv(envName);
        } catch (err) {
            // Individual env check failed -- continue to next
        }
    }
}


// ═══════════════════════════════════════════════════════════════════
// Data gathering
// ═══════════════════════════════════════════════════════════════════

async function gatherHealthData(envName) {
    var env = _deps.environments[envName];
    if (!env) return null;

    if (env.isMock) {
        var ms = _deps.mockState;
        var streamStats = Object.entries(ms.streams).map(function (e) {
            return { groupName: e[0], backlog: e[1].backlog || 0, connectionCount: e[1].connections };
        });
        var nodeStatus = Object.entries(ms.nodes).map(function (e) {
            return Object.assign({ systemName: e[0] }, e[1]);
        });
        var linkedServices = [{ services: Object.entries(ms.services).map(function (e) {
            return { systemName: e[0], name: e[1].name, isLinked: e[1].healthy, providerIsValid: e[1].healthy, configurationIsValid: e[1].healthy };
        }) }];
        return { streamStats: streamStats, nodeStatus: nodeStatus, linkedServices: linkedServices, hasCookie: false };
    }

    var token = await _deps.getToken(envName);
    var host = env.apiHost;
    var adminCookie = _deps.cookieCache[envName] || null;
    var adminAuth = adminCookie ? { type: "cookie", value: adminCookie } : { type: "bearer", value: token };

    var results = await Promise.all([
        adminCookie ? _deps.sharedoGet(host, "/admin/diagnostics/eventengine/streamStats", adminAuth) : Promise.resolve(null),
        _deps.sharedoGet(host, "/api/_ee/monitor", { type: "bearer", value: token }),
        _deps.tryAuth(host, "GET", "/api/admin/serviceIntegrations", null, token, adminCookie)
    ]);

    return { streamStats: results[0], nodeStatus: results[1], linkedServices: results[2], hasCookie: !!adminCookie };
}


// ═══════════════════════════════════════════════════════════════════
// Process health check data, evaluate alerts, record metrics
// ═══════════════════════════════════════════════════════════════════

function processHealthCheck(envName, data) {
    var env = _deps.environments[envName];
    var hs = getHealthState(envName);
    var ns = _deps.getNotifySettings();
    var BACKLOG_THRESHOLD = _deps.getBacklogThreshold();
    var now = Date.now();
    var streamStats = data.streamStats;
    var nodeStatus = data.nodeStatus;
    var linkedServices = data.linkedServices;

    // ── Extract current conditions ──

    var currentStreams = {};
    var currentZeroConnStreams = {};

    var zeroConnSet = null;
    if (ns.zeroConnectionStreams && ns.zeroConnectionStreams.trim().length > 0) {
        zeroConnSet = {};
        var zcParts = ns.zeroConnectionStreams.split(",");
        for (var zcI = 0; zcI < zcParts.length; zcI++) {
            var zcName = zcParts[zcI].trim();
            if (zcName) zeroConnSet[zcName] = true;
        }
    }

    if (streamStats && !streamStats.error && Array.isArray(streamStats)) {
        for (var i = 0; i < streamStats.length; i++) {
            var s = streamStats[i];
            var gn = s.groupName || s.streamName || "";
            var bl = s.backlog || 0;
            if (gn && bl > BACKLOG_THRESHOLD) currentStreams[gn] = bl;
            if (gn && (zeroConnSet === null || zeroConnSet[gn]) && (s.connectionCount || s.connections || 0) === 0) {
                currentZeroConnStreams[gn] = true;
            }
        }
    }

    var currentNodes = {};
    var nodeArr = [];
    if (nodeStatus && !nodeStatus.error) {
        nodeArr = Array.isArray(nodeStatus) ? nodeStatus : (nodeStatus.nodes && Array.isArray(nodeStatus.nodes) ? nodeStatus.nodes : []);
    }
    for (var n = 0; n < nodeArr.length; n++) {
        var nd = nodeArr[n];
        var nm = nd.systemName || nd.name || "";
        var good = (nd.stopped || 0) === 0 && (nd.restarting || 0) === 0 && (nd.running || 0) > 0;
        if (nm && !good) currentNodes[nm] = true;
    }

    var currentServices = {};
    if (linkedServices && !linkedServices.error && Array.isArray(linkedServices)) {
        for (var g = 0; g < linkedServices.length; g++) {
            var grp = linkedServices[g];
            if (!grp.services) continue;
            for (var sv = 0; sv < grp.services.length; sv++) {
                var svc = grp.services[sv];
                if (CRITICAL_SERVICES_LIST.indexOf(svc.systemName) !== -1) {
                    if (!svc.isLinked || !svc.providerIsValid || !svc.configurationIsValid) {
                        currentServices[svc.systemName] = svc.name || svc.systemName;
                    }
                }
            }
        }
    }

    // ── First check: seed timers, record metrics, return early ──

    if (hs.isFirst) {
        for (var sk in currentStreams) hs.firstSeen.streams[sk] = now;
        for (var nk in currentNodes) hs.firstSeen.nodes[nk] = now;
        for (var ck in currentServices) hs.firstSeen.services[ck] = now;
        for (var zk in currentZeroConnStreams) hs.firstSeen.connStreams[zk] = now;
        hs.isFirst = false;
        _deps.metrics.recordStreamStats(envName, streamStats);
        _deps.metrics.recordNodeStatus(envName, nodeStatus);
        var firstStreamCount = (streamStats && Array.isArray(streamStats)) ? streamStats.length : null;
        _deps.log("health", "[" + envName + "] streams: " + (firstStreamCount !== null ? firstStreamCount : "-- (no cookie)") + " | nodes: " + nodeArr.length + " | first check (seeding)");
        return;
    }

    // ── Alert evaluation ──

    var shouldAlert = env.isMock ? true : (ns.desktopNotifications && (!ns.notifyProdOnly || envName === "prod"));
    var alertCount = 0;

    var thresholdMs = ns.alertDurationThreshold * 1000;
    var gracePeriodMs = ns.notifyGracePeriod * 1000;
    var recoveryLevel = BACKLOG_THRESHOLD * (1 - ns.notifyRecoveryThreshold / 100);
    var envLabel = env.label || envName;
    var key;

    // ── Streams ──
    if (ns.notifyStreams) {
        for (key in currentStreams) {
            if (!hs.firstSeen.streams[key]) {
                if (gracePeriodMs > 0 && hs.clearedAt.streams[key] && (now - hs.clearedAt.streams[key]) < gracePeriodMs) {
                    hs.firstSeen.streams[key] = hs.clearedAt.streams[key] - (ns.alertDurationThreshold * 1000);
                } else {
                    hs.firstSeen.streams[key] = now;
                }
            }
            delete hs.clearedAt.streams[key];

            var streamDuration = now - hs.firstSeen.streams[key];
            var streamReady = ns.notifyStreamsDuration ? (streamDuration >= thresholdMs) : true;
            if (!hs.prev.breachedStreams[key] && streamReady && shouldAlert) {
                pushAlert({ type: "stream", title: "[Stream] Backlog Threshold Breached -- " + envLabel, body: key + " backlog: " + currentStreams[key].toLocaleString() + " (threshold: " + BACKLOG_THRESHOLD + ")", tag: "stream-" + envName + "-" + key, facts: [
                    { name: "Stream", value: key },
                    { name: "Backlog", value: currentStreams[key].toLocaleString() },
                    { name: "Threshold", value: String(BACKLOG_THRESHOLD) },
                    { name: "Environment", value: "[" + envLabel + "](https://" + env.apiHost + "/admin)" },
                    { name: "Timestamp", value: fmtAlertTimestamp() }
                ] });
                alertCount++;
                hs.prev.breachedStreams[key] = true;
            }
        }
    }
    for (key in hs.firstSeen.streams) {
        var currentBacklog = currentStreams[key] || 0;
        if (currentBacklog <= recoveryLevel) {
            if (gracePeriodMs > 0) hs.clearedAt.streams[key] = now;
            delete hs.firstSeen.streams[key];
            delete hs.prev.breachedStreams[key];
        }
    }

    // ── Nodes ──
    if (ns.notifyNodes) {
        for (key in currentNodes) {
            if (!hs.firstSeen.nodes[key]) {
                if (gracePeriodMs > 0 && hs.clearedAt.nodes[key] && (now - hs.clearedAt.nodes[key]) < gracePeriodMs) {
                    hs.firstSeen.nodes[key] = hs.clearedAt.nodes[key] - (ns.alertDurationThreshold * 1000);
                } else {
                    hs.firstSeen.nodes[key] = now;
                }
            }
            delete hs.clearedAt.nodes[key];

            var nodeDuration = now - hs.firstSeen.nodes[key];
            var nodeReady = ns.notifyNodesDuration ? (nodeDuration >= thresholdMs) : true;
            if (!hs.prev.downNodes[key] && nodeReady && shouldAlert) {
                pushAlert({ type: "node", title: "[EE Node] Down -- " + envLabel, body: key + " has stopped or is restarting", tag: "node-" + envName + "-" + key, facts: [
                    { name: "Node", value: key },
                    { name: "Status", value: "Stopped or restarting" },
                    { name: "Environment", value: "[" + envLabel + "](https://" + env.apiHost + "/admin)" },
                    { name: "Timestamp", value: fmtAlertTimestamp() }
                ] });
                alertCount++;
                hs.prev.downNodes[key] = true;
            }
        }
    }
    for (key in hs.firstSeen.nodes) {
        if (!currentNodes[key]) {
            if (gracePeriodMs > 0) hs.clearedAt.nodes[key] = now;
            delete hs.firstSeen.nodes[key];
            delete hs.prev.downNodes[key];
        }
    }

    // ── Services ──
    if (ns.notifyServices) {
        for (key in currentServices) {
            if (!hs.firstSeen.services[key]) {
                if (gracePeriodMs > 0 && hs.clearedAt.services[key] && (now - hs.clearedAt.services[key]) < gracePeriodMs) {
                    hs.firstSeen.services[key] = hs.clearedAt.services[key] - (ns.alertDurationThreshold * 1000);
                } else {
                    hs.firstSeen.services[key] = now;
                }
            }
            delete hs.clearedAt.services[key];

            var svcDuration = now - hs.firstSeen.services[key];
            var svcReady = ns.notifyServicesDuration ? (svcDuration >= thresholdMs) : true;
            if (!hs.prev.criticalServices[key] && svcReady && shouldAlert) {
                pushAlert({ type: "service", title: "[Service] Unhealthy -- " + envLabel, body: currentServices[key] + " is unhealthy", tag: "service-" + envName + "-" + key, facts: [
                    { name: "Service", value: currentServices[key] },
                    { name: "System Name", value: key },
                    { name: "Environment", value: "[" + envLabel + "](https://" + env.apiHost + "/admin)" },
                    { name: "Timestamp", value: fmtAlertTimestamp() }
                ] });
                alertCount++;
                hs.prev.criticalServices[key] = true;
            }
        }
    }
    for (key in hs.firstSeen.services) {
        if (!currentServices[key]) {
            if (gracePeriodMs > 0) hs.clearedAt.services[key] = now;
            delete hs.firstSeen.services[key];
            delete hs.prev.criticalServices[key];
        }
    }

    // ── Zero-connection streams ──
    if (ns.notifyConnections) {
        for (key in currentZeroConnStreams) {
            if (!hs.firstSeen.connStreams[key]) {
                if (gracePeriodMs > 0 && hs.clearedAt.connStreams[key] && (now - hs.clearedAt.connStreams[key]) < gracePeriodMs) {
                    hs.firstSeen.connStreams[key] = hs.clearedAt.connStreams[key] - (ns.alertDurationThreshold * 1000);
                } else {
                    hs.firstSeen.connStreams[key] = now;
                }
            }
            delete hs.clearedAt.connStreams[key];
            var connDuration = now - hs.firstSeen.connStreams[key];
            var connReady = ns.notifyConnectionsDuration ? (connDuration >= thresholdMs) : true;
            if (!hs.prev.zeroConnStreams[key] && connReady && shouldAlert) {
                pushAlert({ type: "stream", title: "[Stream] Zero Connections -- " + envLabel, body: key + " has 0 connections", tag: "conn-" + envName + "-" + key, facts: [
                    { name: "Stream", value: key },
                    { name: "Connections", value: "0" },
                    { name: "Environment", value: "[" + envLabel + "](https://" + env.apiHost + "/admin)" },
                    { name: "Timestamp", value: fmtAlertTimestamp() }
                ] });
                alertCount++;
                hs.prev.zeroConnStreams[key] = true;
            }
        }
    }
    for (key in hs.firstSeen.connStreams) {
        if (!currentZeroConnStreams[key]) {
            if (gracePeriodMs > 0) hs.clearedAt.connStreams[key] = now;
            delete hs.firstSeen.connStreams[key];
            delete hs.prev.zeroConnStreams[key];
        }
    }

    // ── Record metrics ──
    _deps.metrics.recordStreamStats(envName, streamStats);
    _deps.metrics.recordNodeStatus(envName, nodeStatus);

    // ── Summary log ──
    var logStreamCount = (streamStats && Array.isArray(streamStats)) ? streamStats.length : null;
    var logNodeCount = nodeArr.length;
    var logSvcCount = 0;
    if (linkedServices && Array.isArray(linkedServices)) { for (var si = 0; si < linkedServices.length; si++) { if (linkedServices[si].services) logSvcCount += linkedServices[si].services.length; } }
    _deps.log("health", "[" + envName + "] streams: " + (logStreamCount !== null ? logStreamCount : "-- (no cookie)") + " | nodes: " + logNodeCount + " | services: " + logSvcCount + " | alerts: " + alertCount);
}


// ═══════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════

async function runHealthCheckForEnv(envName) {
    var env = _deps.environments[envName];
    if (!env) return;
    try {
        var data = await gatherHealthData(envName);
        if (!data) return;
        processHealthCheck(envName, data);
    } catch (err) {
        _deps.log("health", "[" + envName + "] check failed: " + err.message);
    }
}


// ═══════════════════════════════════════════════════════════════════
// Alert dispatch (SSE + Teams)
// ═══════════════════════════════════════════════════════════════════

function pushAlert(alert) {
    var data = JSON.stringify(alert);
    _deps.log("alert", alert.title + ": " + alert.body);
    for (var i = _sseClients.length - 1; i >= 0; i--) {
        try { _sseClients[i].write("event: alert\ndata: " + data + "\n\n"); }
        catch (e) { _sseClients.splice(i, 1); }
    }
    var teams = _deps.getTeamsConfig();
    if (teams.enabled && teams.webhookUrl && !alert.skipTeams) {
        sendTeamsAlert(alert, teams.webhookUrl);
    }
}

function fmtAlertTimestamp() {
    var d = new Date();
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var yyyy = d.getFullYear();
    var h = d.getHours();
    var min = String(d.getMinutes()).padStart(2, "0");
    var sec = String(d.getSeconds()).padStart(2, "0");
    var ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return dd + "/" + mm + "/" + yyyy + ", " + h + ":" + min + ":" + sec + " " + ap;
}

function sendTeamsAlert(alert, webhookUrl) {
    try {
        var urlObj = new URL(webhookUrl);
        var titleColour = alert.type === "stream" ? "attention" : alert.type === "node" ? "warning" : "accent";

        var cardBody = [
            { "type": "TextBlock", "size": "large", "weight": "bolder", "color": titleColour, "text": alert.title, "wrap": true }
        ];

        if (alert.facts && alert.facts.length) {
            cardBody.push({ "type": "TextBlock", "text": alert.body, "wrap": true, "spacing": "small" });
            cardBody.push({ "type": "FactSet", "separator": true, "spacing": "medium", "facts": alert.facts.map(function (f) { return { "title": f.name, "value": f.value }; }) });
        } else {
            cardBody.push({ "type": "TextBlock", "text": alert.body, "wrap": true, "spacing": "small" });
        }

        var payload = {
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": null,
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": cardBody
                }
            }]
        };

        var body = JSON.stringify(payload);
        var opts = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            timeout: 10000
        };
        var req = _deps.https.request(opts, function (res) {
            var responseBody = "";
            res.on("data", function (c) { responseBody += c; });
            res.on("end", function () {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    _deps.log("teams", "Delivered: " + alert.title);
                } else {
                    _deps.log("teams", "Webhook delivery failed: HTTP " + res.statusCode + (responseBody ? " | " + responseBody.substring(0, 200) : ""));
                }
            });
        });
        req.on("timeout", function () { req.destroy(); _deps.log("teams", "Webhook timeout"); });
        req.on("error", function (e) { _deps.log("teams", "Webhook error: " + e.message); });
        req.write(body);
        req.end();
    } catch (e) {
        _deps.log("teams", "Webhook send error: " + e.message);
    }
}


// ═══════════════════════════════════════════════════════════════════
// SSE client management
// ═══════════════════════════════════════════════════════════════════

function addSseClient(res) {
    _sseClients.push(res);
}

function removeSseClient(res) {
    var idx = _sseClients.indexOf(res);
    if (idx !== -1) _sseClients.splice(idx, 1);
}


// ═══════════════════════════════════════════════════════════════════
// Test alerts
// ═══════════════════════════════════════════════════════════════════

function buildTestAlerts(currentEnv, envs) {
    var env = envs[currentEnv];
    var envLabel = env ? env.label : currentEnv;
    var envHost = env ? env.apiHost : "unknown";
    var ts = fmtAlertTimestamp();
    var threshold = _deps.getBacklogThreshold();
    return [
        { type: "stream", title: "[Stream] Backlog Threshold Breached -- " + envLabel, body: "executionengine-cc backlog: 1,247 (threshold: " + threshold + ")", tag: "test-stream-1", facts: [
            { name: "Stream", value: "executionengine-cc" },
            { name: "Backlog", value: "1,247" },
            { name: "Threshold", value: String(threshold) },
            { name: "Environment", value: "[" + envLabel + "](https://" + envHost + "/admin)" },
            { name: "Timestamp", value: ts }
        ] },
        { type: "stream", title: "[Stream] Zero Connections -- " + envLabel, body: "sharedo-events-cc-executionengine has 0 connections", tag: "test-conn-1", facts: [
            { name: "Stream", value: "sharedo-events-cc-executionengine" },
            { name: "Connections", value: "0" },
            { name: "Environment", value: "[" + envLabel + "](https://" + envHost + "/admin)" },
            { name: "Timestamp", value: ts }
        ] },
        { type: "node", title: "[EE Node] Down -- " + envLabel, body: "MB-PROD-EE-03 has stopped or is restarting", tag: "test-node-1", facts: [
            { name: "Node", value: "MB-PROD-EE-03" },
            { name: "Status", value: "Stopped or restarting" },
            { name: "Environment", value: "[" + envLabel + "](https://" + envHost + "/admin)" },
            { name: "Timestamp", value: ts }
        ] }
    ];
}


// ═══════════════════════════════════════════════════════════════════
// Module exports
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    init: init,
    start: start,
    stop: stop,
    pushAlert: pushAlert,
    fmtAlertTimestamp: fmtAlertTimestamp,
    addSseClient: addSseClient,
    removeSseClient: removeSseClient,
    buildTestAlerts: buildTestAlerts
};