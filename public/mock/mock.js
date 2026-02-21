/**
 * Mock / Test Environment control page for ShareDo Tools.
 * Manages _mockState on the server for notification testing.
 */
(function () {
    "use strict";

    var _state = null;
    var _threshold = 250;
    var _alertLog = [];

    function init() {
        shared.init({ activePage: "mock" });

        document.getElementById("mckResetBtn").addEventListener("click", resetState);
        document.getElementById("mckClearLog").addEventListener("click", clearLog);
        document.getElementById("mckStatsRefreshBtn").addEventListener("click", refreshStats);

        // Force the SSE alert stream open so the log works regardless of
        // whether desktop notifications are enabled in Options.
        shared.openAlertStream();
        shared.onAlert(function (alert) {
            appendAlertLog(alert);
        });

        loadState();
        loadSettings();
    }

    // ─── State load ───

    function loadState() {
        fetch("/api/mock/state")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _state = data.state;
                _threshold = data.backlogThreshold;
                renderAll();
            })
            .catch(function () {
                showError("Failed to load mock state. Is the server running with MOCK_ENV_ENABLED=true?");
            });
    }

    function loadSettings() {
        fetch("/api/settings")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _threshold = data.backlogThreshold || 250;
                document.getElementById("mckThreshold").textContent = _threshold.toLocaleString();
                document.getElementById("mckThresholdInline").textContent = _threshold.toLocaleString();
                document.getElementById("mckAlertDuration").textContent = (data.alertDurationThreshold || 0) + "s";
                document.getElementById("mckRecovery").textContent = (data.notifyRecoveryThreshold || 0) + "%";
                document.getElementById("mckGrace").textContent = (data.notifyGracePeriod || 0) + "s";
                updateMonitorStatus(data.desktopNotifications);
            })
            .catch(function () {});
    }

    function updateMonitorStatus(enabled) {
        var pill = document.getElementById("mckMonitorStatus");
        var label = document.getElementById("mckMonitorLabel");
        var dot = pill.querySelector(".usd-status-dot");
        if (enabled) {
            dot.className = "usd-status-dot usd-status-dot--live";
            label.textContent = "Health monitor active";
        } else {
            dot.className = "usd-status-dot usd-status-dot--warn";
            label.textContent = "Health monitor inactive -- enable Desktop Notifications in Options";
        }
    }

    // ─── Render ───

    function renderAll() {
        if (!_state) return;
        renderStreams();
        renderNodes();
        renderServices();
    }

    function renderStreams() {
        var body = document.getElementById("mckStreamsBody");
        var streams = _state.streams;
        var html = "";

        for (var sn in streams) {
            var stream = streams[sn];
            var bl = stream.backlog || 0;
            var co = stream.connections;
            var isBreached = bl > _threshold;
            var isNoConn = co === 0;
            var statusClass = isBreached ? "mck-stream__status--breach" : "mck-stream__status--ok";
            var statusLabel = isBreached ? "Above threshold" : "Normal";

            html += '<div class="mck-stream" data-stream="' + esc(sn) + '">';
            html += '<div class="mck-stream__label">' + esc(sn) + '</div>';
            html += '<div class="mck-stream__controls">';
            html += '<span class="mck-stream__field-label">Backlog</span>';
            html += '<button class="usd-btn mck-quick-btn" data-stream="' + esc(sn) + '" data-field="backlog" data-val="0" title="Set backlog to 0">0</button>';
            html += '<button class="usd-btn mck-quick-btn mck-quick-btn--thresh" data-stream="' + esc(sn) + '" data-field="backlog" data-val="' + (_threshold + 1) + '" title="Set backlog to threshold + 1">T+1</button>';
            html += '<input type="number" class="mck-stream__input" data-stream="' + esc(sn) + '" data-field="backlog" value="' + bl + '" min="0" />';
            html += '<span class="mck-stream__status ' + statusClass + '">' + statusLabel + '</span>';
            html += '</div>';
            html += '<div class="mck-stream__controls">';
            html += '<span class="mck-stream__field-label">Connections</span>';
            html += '<button class="usd-btn mck-quick-btn" data-stream="' + esc(sn) + '" data-field="connections" data-val="0" title="Set connections to 0">0</button>';
            html += '<button class="usd-btn mck-quick-btn mck-quick-btn--conn" data-stream="' + esc(sn) + '" data-field="connections" data-val="1" title="Set connections to 1">1</button>';
            html += '<input type="number" class="mck-stream__input" data-stream="' + esc(sn) + '" data-field="connections" value="' + co + '" min="0" />';
            html += '<span class="mck-stream__status ' + (isNoConn ? "mck-stream__status--breach" : "mck-stream__status--ok") + '">' + (isNoConn ? "No connections" : "Connected") + '</span>';
            html += '</div>';
            html += '</div>';
        }

        body.innerHTML = html;

        var inputs = body.querySelectorAll(".mck-stream__input");
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener("change", onStreamInputChange);
        }
        var quickBtns = body.querySelectorAll(".mck-quick-btn");
        for (var j = 0; j < quickBtns.length; j++) {
            quickBtns[j].addEventListener("click", onStreamQuickSet);
        }
    }

    function renderNodes() {
        var body = document.getElementById("mckNodesBody");
        var nodes = _state.nodes;
        var html = "";

        for (var nn in nodes) {
            var nd = nodes[nn];
            var isDown = nd.stopped > 0 || nd.restarting > 0;
            html += '<div class="mck-node" data-node="' + esc(nn) + '">';
            html += '<div class="mck-node__name">' + esc(nn) + '</div>';
            html += '<div class="mck-node__btns">';
            html += '<button class="usd-btn mck-node-btn' + (!isDown ? " mck-node-btn--active" : "") + '" data-node="' + esc(nn) + '" data-preset="healthy">Healthy</button>';
            html += '<button class="usd-btn mck-node-btn' + (nd.stopped > 0 ? " mck-node-btn--stopped" : "") + '" data-node="' + esc(nn) + '" data-preset="stopped">Stopped</button>';
            html += '<button class="usd-btn mck-node-btn' + (nd.restarting > 0 ? " mck-node-btn--restarting" : "") + '" data-node="' + esc(nn) + '" data-preset="restarting">Restarting</button>';
            html += '</div>';
            html += '<div class="mck-node__detail">running: ' + nd.running + ' | stopped: ' + nd.stopped + ' | restarting: ' + nd.restarting + '</div>';
            html += '</div>';
        }

        body.innerHTML = html;

        var btns = body.querySelectorAll(".mck-node-btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener("click", onNodePreset);
        }
    }

    function renderServices() {
        var body = document.getElementById("mckServicesBody");
        var services = _state.services;
        var html = "";

        for (var sk in services) {
            var svc = services[sk];
            html += '<div class="mck-service" data-service="' + esc(sk) + '">';
            html += '<div class="mck-service__name">' + esc(svc.name) + '</div>';
            html += '<div class="mck-service__btns">';
            html += '<button class="usd-btn mck-svc-btn' + (svc.healthy ? " mck-svc-btn--healthy" : "") + '" data-service="' + esc(sk) + '" data-healthy="true">Healthy</button>';
            html += '<button class="usd-btn mck-svc-btn' + (!svc.healthy ? " mck-svc-btn--unhealthy" : "") + '" data-service="' + esc(sk) + '" data-healthy="false">Unhealthy</button>';
            html += '</div>';
            html += '</div>';
        }

        body.innerHTML = html;

        var btns = body.querySelectorAll(".mck-svc-btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener("click", onServiceToggle);
        }
    }

    // ─── Stream Stats panel ───

    function refreshStats() {
        var btn = document.getElementById("mckStatsRefreshBtn");
        btn.classList.add("usd-btn--loading");

        // Ensure the mock env is selected before fetching, since /api/refresh
        // operates on currentEnv server-side.
        fetch("/api/env/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ environment: "mock" })
        })
            .then(function () {
                return fetch("/api/refresh");
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                renderStats(data.streamStats, data.backlogAlerts, data.backlogThreshold);
                var now = new Date();
                var ts = String(now.getHours()).padStart(2, "0") + ":" +
                         String(now.getMinutes()).padStart(2, "0") + ":" +
                         String(now.getSeconds()).padStart(2, "0");
                document.getElementById("mckStatsTimestamp").textContent = "Last refreshed: " + ts;
            })
            .catch(function () {
                document.getElementById("mckStatsBody").innerHTML =
                    '<tr><td colspan="3" class="usd-table__muted">Failed to load stream stats</td></tr>';
            })
            .finally(function () {
                btn.classList.remove("usd-btn--loading");
            });
    }

    function renderStats(streamStats, alerts, threshold) {
        var body = document.getElementById("mckStatsBody");
        alerts = alerts || {};
        threshold = threshold || _threshold;

        if (!streamStats || !Array.isArray(streamStats) || !streamStats.length) {
            body.innerHTML = '<tr><td colspan="3" class="usd-table__muted">No stream data</td></tr>';
            return;
        }

        var html = "";
        for (var i = 0; i < streamStats.length; i++) {
            var s = streamStats[i];
            var name = s.groupName || s.streamName || "unknown";
            var bl = s.backlog || 0;
            var blCls = bl === 0 ? "usd-backlog--ok" : bl > threshold ? "usd-backlog--error" : "usd-backlog--warn";
            var alertInfo = alerts[name];
            var durStr = alertInfo && alertInfo.durationMs > 0 ? fmtDuration(alertInfo.durationMs) : "--";
            var durCls = alertInfo && alertInfo.durationMs > 0 ? blCls : "usd-table__muted";

            html += '<tr>';
            html += '<td class="usd-table__mono">' + esc(name) + '</td>';
            html += '<td class="usd-table__right"><span class="usd-backlog-value ' + blCls + '">' + bl.toLocaleString() + '</span></td>';
            html += '<td class="usd-table__right"><span class="usd-alert-duration ' + durCls + '">' + esc(durStr) + '</span></td>';
            html += '</tr>';
        }

        body.innerHTML = html;
    }

    function fmtDuration(ms) {
        var s = Math.floor(ms / 1000);
        if (s < 60) return s + "s";
        var m = Math.floor(s / 60); s = s % 60;
        if (m < 60) return m + "m " + String(s).padStart(2, "0") + "s";
        var h = Math.floor(m / 60); m = m % 60;
        return h + "h " + String(m).padStart(2, "0") + "m";
    }

    // ─── Event handlers ───

    function onStreamInputChange() {
        var sn = this.getAttribute("data-stream");
        var field = this.getAttribute("data-field");
        var val = parseInt(this.value, 10);
        if (isNaN(val) || val < 0) return;
        _state.streams[sn][field] = val;
        postState({ streams: makeObj(sn, makeObj(field, val)) }, function () { renderStreams(); });
    }

    function onStreamQuickSet() {
        var sn = this.getAttribute("data-stream");
        var field = this.getAttribute("data-field");
        var val = parseInt(this.getAttribute("data-val"), 10);
        _state.streams[sn][field] = val;
        postState({ streams: makeObj(sn, makeObj(field, val)) }, function () { renderStreams(); });
    }

    function onNodePreset() {
        var nn = this.getAttribute("data-node");
        var preset = this.getAttribute("data-preset");
        var nd;
        if (preset === "healthy") {
            nd = { stopped: 0, restarting: 0, running: 5 };
        } else if (preset === "stopped") {
            nd = { stopped: 1, restarting: 0, running: 0 };
        } else {
            nd = { stopped: 0, restarting: 1, running: 0 };
        }
        _state.nodes[nn] = nd;
        postState({ nodes: makeObj(nn, nd) }, function () { renderNodes(); });
    }

    function onServiceToggle() {
        var sk = this.getAttribute("data-service");
        var healthy = this.getAttribute("data-healthy") === "true";
        _state.services[sk].healthy = healthy;
        postState({ services: makeObj(sk, { healthy: healthy }) }, function () { renderServices(); });
    }

    function resetState() {
        var defaults = { streams: {}, nodes: {}, services: {} };
        for (var sn in _state.streams) defaults.streams[sn] = { backlog: 0, connections: 1 };
        for (var nn in _state.nodes) defaults.nodes[nn] = { stopped: 0, restarting: 0, running: 5 };
        for (var sk in _state.services) defaults.services[sk] = { healthy: true };
        postState(defaults, function () { loadState(); });
    }

    // ─── State POST ───

    function postState(partial, callback) {
        fetch("/api/mock/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(partial)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.state) _state = data.state;
                if (callback) callback();
            })
            .catch(function () {
                showError("Failed to update mock state.");
            });
    }

    // ─── Alert log ───

    function appendAlertLog(alert) {
        var now = new Date();
        var time = String(now.getHours()).padStart(2, "0") + ":" +
                   String(now.getMinutes()).padStart(2, "0") + ":" +
                   String(now.getSeconds()).padStart(2, "0");

        _alertLog.unshift({ time: time, alert: alert });

        var logEl = document.getElementById("mckAlertLog");
        var emptyEl = logEl.querySelector(".mck-alert-log__empty");
        if (emptyEl) emptyEl.style.display = "none";

        var typeClass = alert.type === "stream" ? "mck-log-entry--stream" :
                        alert.type === "node"   ? "mck-log-entry--node"   : "mck-log-entry--service";

        var entry = document.createElement("div");
        entry.className = "mck-log-entry " + typeClass;
        entry.innerHTML =
            '<span class="mck-log-entry__time">' + esc(time) + '</span>' +
            '<span class="mck-log-entry__title">' + esc(alert.title) + '</span>' +
            '<span class="mck-log-entry__body">' + esc(alert.body) + '</span>';

        logEl.insertBefore(entry, logEl.firstChild);
    }

    function clearLog() {
        _alertLog = [];
        var logEl = document.getElementById("mckAlertLog");
        logEl.innerHTML = '<div class="mck-alert-log__empty">No alerts fired yet. Adjust the mock state above to trigger conditions.</div>';
    }

    // ─── Utilities ───

    function makeObj(key, val) {
        var o = {};
        o[key] = val;
        return o;
    }

    function esc(t) {
        if (t == null) return "";
        var d = document.createElement("div");
        d.appendChild(document.createTextNode(String(t)));
        return d.innerHTML;
    }

    function showError(msg) {
        var el = document.getElementById("globalError");
        el.textContent = msg;
        el.style.display = "";
        setTimeout(function () { el.style.display = "none"; }, 8000);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();