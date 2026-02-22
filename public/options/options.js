/**
 * Options page for ShareDo Tools.
 * Reads/writes runtime settings via /api/settings.
 */
(function () {
    "use strict";

    var _notifyOn = false;
    var _notifyStreams = true;
    var _notifyStreamsDuration = true;
    var _notifyConnections = true;
    var _notifyConnectionsDuration = true;
    var _notifyNodes = true;
    var _notifyNodesDuration = true;
    var _notifyServices = true;
    var _notifyServicesDuration = true;
    var _notifyProdOnly = false;
    var _metricsEnabled = true;
    var _chartBackgrounds = false;
    var _uxEnabled = false;
    var _uxAutoProbes = false;
    var _uxAutoPages = false;
    var _uxAlerts = true;
    var _uxProbes = [];
    var _uxWorkItemId = "";
    var _uxPageTargets = [];

    var NAV_KEY = "sharedo-tools-options-nav";
    var DEFAULT_NAV = "appearance";

    function init() {
        shared.init({ activePage: "options" });

        initNav();

        document.getElementById("optThemeSelect").addEventListener("change", onThemeChange);
        document.getElementById("optHcBtn").addEventListener("click", toggleHighContrast);
        document.getElementById("optNotifyBtn").addEventListener("click", toggleNotifications);
        document.getElementById("optTestNotifyBtn").addEventListener("click", sendTestNotification);
        document.getElementById("optTestTeamsBtn").addEventListener("click", sendTestTeamsNotification);
        document.getElementById("optProdOnlyBtn").addEventListener("click", toggleProdOnly);
        document.getElementById("optNotifyStreamsBtn").addEventListener("click", function () { toggleSubNotify("Streams"); });
        document.getElementById("optStreamsDurToggle").addEventListener("click", function () { toggleSubDuration("Streams"); });
        document.getElementById("optNotifyConnectionsBtn").addEventListener("click", function () { toggleSubNotify("Connections"); });
        document.getElementById("optConnectionsDurToggle").addEventListener("click", function () { toggleSubDuration("Connections"); });
        document.getElementById("optNotifyNodesBtn").addEventListener("click", function () { toggleSubNotify("Nodes"); });
        document.getElementById("optNodesDurToggle").addEventListener("click", function () { toggleSubDuration("Nodes"); });
        document.getElementById("optNotifyServicesBtn").addEventListener("click", function () { toggleSubNotify("Services"); });
        document.getElementById("optServicesDurToggle").addEventListener("click", function () { toggleSubDuration("Services"); });
        document.getElementById("optMetricsBtn").addEventListener("click", toggleMetrics);
        document.getElementById("optChartBgBtn").addEventListener("click", toggleChartBackgrounds);
        document.getElementById("optUxEnabledBtn").addEventListener("click", toggleUxEnabled);
        document.getElementById("optUxAutoProbesBtn").addEventListener("click", toggleUxAutoProbes);
        document.getElementById("optUxAutoPagesBtn").addEventListener("click", toggleUxAutoPages);
        document.getElementById("optUxAlertsBtn").addEventListener("click", toggleUxAlerts);
        document.getElementById("optUxRunProbesBtn").addEventListener("click", runUxProbesNow);
        document.getElementById("optUxPageTargetAddBtn").addEventListener("click", addPageTarget);
        document.getElementById("optUxPageTargetInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addPageTarget(); } });
        document.getElementById("optSaveBtn").addEventListener("click", saveSettings);

        loadSettings();
        loadAuthStatus();
    }

    // ─── Left nav ───

    function initNav() {
        var items = document.querySelectorAll("[data-opt-nav]");
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener("click", function () {
                showPanel(this.getAttribute("data-opt-nav"));
            });
        }

        var saved = null;
        try { saved = localStorage.getItem(NAV_KEY); } catch (e) {}
        showPanel(saved || DEFAULT_NAV);
    }

    function showPanel(key) {
        var items = document.querySelectorAll("[data-opt-nav]");
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle("opt-nav__item--active", items[i].getAttribute("data-opt-nav") === key);
        }

        var panels = document.querySelectorAll("[data-opt-panel]");
        for (var j = 0; j < panels.length; j++) {
            panels[j].style.display = panels[j].getAttribute("data-opt-panel") === key ? "block" : "none";
        }

        try { localStorage.setItem(NAV_KEY, key); } catch (e) {}
    }

    // ─── Settings load / save ───

    function loadSettings() {
        fetch("/api/settings").then(function (r) { return r.json(); }).then(function (data) {
            document.getElementById("optBacklogThreshold").value = data.backlogThreshold || 250;
            document.getElementById("optAutoRefresh").value = Math.round((data.autoRefreshInterval || 60000) / 1000);
            document.getElementById("optCookieRefresh").value = Math.round((data.cookieRefreshInterval || 600000) / 60000);
            document.getElementById("optWailaDelay").value = data.wailaFetchDelay != null ? data.wailaFetchDelay : 100;
            document.getElementById("optWtIndexDelay").value = data.wtIndexFetchDelay != null ? data.wtIndexFetchDelay : 100;
            document.getElementById("optAlertDuration").value = data.alertDurationThreshold != null ? data.alertDurationThreshold : 60;
            document.getElementById("optRecoveryThreshold").value = data.notifyRecoveryThreshold != null ? data.notifyRecoveryThreshold : 0;
            document.getElementById("optGracePeriod").value = data.notifyGracePeriod != null ? data.notifyGracePeriod : 0;

            // Theme & High Contrast -- sync display with current state.
            // DOM application is handled by shared.js > initTheme().
            var sel = document.getElementById("optThemeSelect");
            if (sel) sel.value = document.body.dataset.theme || "dark";
            updateHcDisplay();

            // Notifications
            _notifyOn = !!data.desktopNotifications;
            if (data.notifyStreams != null) _notifyStreams = !!data.notifyStreams;
            if (data.notifyStreamsDuration != null) _notifyStreamsDuration = !!data.notifyStreamsDuration;
            if (data.notifyConnections != null) _notifyConnections = !!data.notifyConnections;
            if (data.notifyConnectionsDuration != null) _notifyConnectionsDuration = !!data.notifyConnectionsDuration;
            if (data.zeroConnectionStreams != null) document.getElementById("optZeroConnectionStreams").value = data.zeroConnectionStreams;
            if (data.notifyNodes != null) _notifyNodes = !!data.notifyNodes;
            if (data.notifyNodesDuration != null) _notifyNodesDuration = !!data.notifyNodesDuration;
            if (data.notifyServices != null) _notifyServices = !!data.notifyServices;
            if (data.notifyServicesDuration != null) _notifyServicesDuration = !!data.notifyServicesDuration;
            if (data.notifyProdOnly != null) _notifyProdOnly = !!data.notifyProdOnly;
            updateNotifyDisplay();

            // Teams status (readonly -- controlled via .env)
            updateTeamsDisplay(!!data.teamsEnabled);

            // Metrics
            _metricsEnabled = data.metricsEnabled != null ? !!data.metricsEnabled : true;
            updateMetricsDisplay();
            document.getElementById("optMetricsInterval").value = data.metricsInterval != null ? data.metricsInterval : 30;
            _chartBackgrounds = !!data.chartBackgrounds;
            updateChartBgDisplay();

            // UX Monitor
            _uxEnabled = !!data.uxEnabled;
            _uxAutoProbes = !!data.uxAutoProbes;
            _uxAutoPages = !!data.uxAutoPages;
            _uxAlerts = data.uxAlerts != null ? !!data.uxAlerts : true;
            _uxProbes = Array.isArray(data.uxProbes) ? data.uxProbes : [];
            _uxWorkItemId = data.uxWorkItemId || "";
            document.getElementById("optUxWorkItemId").value = _uxWorkItemId;
            _uxPageTargets = Array.isArray(data.uxPageTargets) ? data.uxPageTargets : [];
            renderPageTargetChips();
            updateUxEnabledDisplay();
            updateUxAutoProbesDisplay();
            updateUxAutoPagesDisplay();
            updateUxAlertsDisplay();
            document.getElementById("optUxProbeInterval").value = data.uxProbeInterval != null ? data.uxProbeInterval : 60;
            document.getElementById("optUxPageInterval").value = data.uxPageInterval != null ? data.uxPageInterval : 300;
            document.getElementById("optUxThresholdWarn").value = data.uxProbeThresholdWarn != null ? data.uxProbeThresholdWarn : 3000;
            document.getElementById("optUxThresholdCrit").value = data.uxProbeThresholdCrit != null ? data.uxProbeThresholdCrit : 5000;
            populateUxEnvSelect(data.uxProbeEnv || "prod");
            renderUxProbeList();
            loadUxLatestResults();
        }).catch(function () {});
    }

    function saveSettings() {
        var autoRefreshSec = parseInt(document.getElementById("optAutoRefresh").value, 10);
        var cookieRefreshMin = parseInt(document.getElementById("optCookieRefresh").value, 10);
        var recoveryThreshold = parseInt(document.getElementById("optRecoveryThreshold").value, 10);
        var gracePeriod = parseInt(document.getElementById("optGracePeriod").value, 10);

        var body = {
            backlogThreshold: parseInt(document.getElementById("optBacklogThreshold").value, 10),
            wailaFetchDelay: parseInt(document.getElementById("optWailaDelay").value, 10),
            wtIndexFetchDelay: parseInt(document.getElementById("optWtIndexDelay").value, 10),
            autoRefreshInterval: (isNaN(autoRefreshSec) ? 60 : autoRefreshSec) * 1000,
            cookieRefreshInterval: (isNaN(cookieRefreshMin) ? 10 : cookieRefreshMin) * 60000,
            alertDurationThreshold: parseInt(document.getElementById("optAlertDuration").value, 10) || 0,
            notifyRecoveryThreshold: isNaN(recoveryThreshold) ? 0 : Math.min(100, Math.max(0, recoveryThreshold)),
            notifyGracePeriod: isNaN(gracePeriod) ? 0 : Math.max(0, gracePeriod),
            theme: document.body.dataset.theme || "dark",
            desktopNotifications: _notifyOn,
            notifyStreams: _notifyStreams,
            notifyStreamsDuration: _notifyStreamsDuration,
            notifyConnections: _notifyConnections,
            notifyConnectionsDuration: _notifyConnectionsDuration,
            zeroConnectionStreams: document.getElementById("optZeroConnectionStreams").value.trim(),
            notifyNodes: _notifyNodes,
            notifyNodesDuration: _notifyNodesDuration,
            notifyServices: _notifyServices,
            notifyServicesDuration: _notifyServicesDuration,
            notifyProdOnly: _notifyProdOnly,
            highContrast: document.body.classList.contains("high-contrast"),
            metricsEnabled: _metricsEnabled,
            metricsInterval: Math.max(5, parseInt(document.getElementById("optMetricsInterval").value, 10) || 30),
            chartBackgrounds: _chartBackgrounds,
            uxEnabled: _uxEnabled,
            uxAutoProbes: _uxAutoProbes,
            uxAutoPages: _uxAutoPages,
            uxProbeInterval: Math.max(10, parseInt(document.getElementById("optUxProbeInterval").value, 10) || 60),
            uxPageInterval: Math.max(60, parseInt(document.getElementById("optUxPageInterval").value, 10) || 300),
            uxProbeEnv: document.getElementById("optUxEnv").value || "prod",
            uxAlerts: _uxAlerts,
            uxProbeThresholdWarn: Math.max(100, parseInt(document.getElementById("optUxThresholdWarn").value, 10) || 3000),
            uxProbeThresholdCrit: Math.max(100, parseInt(document.getElementById("optUxThresholdCrit").value, 10) || 5000),
            uxProbes: _uxProbes,
            uxWorkItemId: document.getElementById("optUxWorkItemId").value.trim(),
            uxPageTargets: _uxPageTargets
        };

        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data.success) {
                showSaveStatus("Saved");
            }
        }).catch(function () {
            showSaveStatus("Save failed");
        });
    }

    // ─── Theme ───

    var _themeMeta = {};

    // Populate theme select from manifest
    shared.themeManifest().then(function (manifest) {
        if (!manifest || !manifest.length) return;
        var sel = document.getElementById("optThemeSelect");
        var current = document.body.dataset.theme || "dark";
        sel.innerHTML = "";
        for (var i = 0; i < manifest.length; i++) {
            var t = manifest[i];
            _themeMeta[t.id] = { icon: t.icon, label: t.label, lightBased: t.lightBased };
            var o = document.createElement("option");
            o.value = t.id;
            o.textContent = t.label;
            if (t.id === current) o.selected = true;
            sel.appendChild(o);
        }
    });

    function onThemeChange() {
        var sel = document.getElementById("optThemeSelect");
        var themeId = sel.value;
        var meta = _themeMeta[themeId];
        document.body.dataset.theme = themeId;
        if (meta && meta.lightBased) document.body.classList.add("light-theme");
        else document.body.classList.remove("light-theme");
        try { localStorage.setItem("sharedo-tools-theme", themeId); } catch (e) {}
    }

    // ─── High contrast ───

    function toggleHighContrast() {
        document.body.classList.toggle("high-contrast");
        var isHc = document.body.classList.contains("high-contrast");
        try { localStorage.setItem("sharedo-tools-high-contrast", isHc ? "true" : "false"); } catch (e) {}
        updateHcDisplay();
    }

    function updateHcDisplay() {
        var isHc = document.body.classList.contains("high-contrast");
        var btn = document.getElementById("optHcBtn");
        var label = document.getElementById("optHcLabel");
        if (isHc) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    // ─── Save status ───

    function showSaveStatus(msg) {
        var el = document.getElementById("optSaveStatus");
        el.textContent = msg;
        el.classList.add("opt-save-status--visible");
        setTimeout(function () { el.classList.remove("opt-save-status--visible"); }, 2000);
    }

    // ─── Notifications ───

    function toggleNotifications() {
        if (typeof Notification === "undefined") {
            showNotifyStatus("Browser does not support notifications");
            return;
        }

        if (!_notifyOn) {
            if (Notification.permission === "granted") {
                _notifyOn = true;
                updateNotifyDisplay();
            } else if (Notification.permission === "denied") {
                showNotifyStatus("Notifications blocked by browser. Reset in browser site settings.");
            } else {
                Notification.requestPermission().then(function (result) {
                    if (result === "granted") {
                        _notifyOn = true;
                        updateNotifyDisplay();
                        new Notification("ShareDo Tools", { body: "Desktop notifications enabled", tag: "test" });
                    } else {
                        showNotifyStatus("Permission denied. Notifications will not appear.");
                    }
                });
            }
        } else {
            _notifyOn = false;
            updateNotifyDisplay();
        }
    }

    function updateNotifyDisplay() {
        var btn = document.getElementById("optNotifyBtn");
        var label = document.getElementById("optNotifyLabel");
        var testBtn = document.getElementById("optTestNotifyBtn");
        var subsPanel = document.getElementById("optNotifySubs");

        if (_notifyOn) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
            testBtn.style.display = "";
            subsPanel.style.display = "";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
            testBtn.style.display = "none";
            subsPanel.style.display = "none";
        }

        updateSubToggle("Streams", _notifyStreams);
        updateSubToggle("Connections", _notifyConnections);
        updateSubToggle("Nodes", _notifyNodes);
        updateSubToggle("Services", _notifyServices);
        updateProdOnlyDisplay();
        updateSubDuration("Streams", _notifyStreams, _notifyStreamsDuration);
        updateSubDuration("Connections", _notifyConnections, _notifyConnectionsDuration);
        updateSubDuration("Nodes", _notifyNodes, _notifyNodesDuration);
        updateSubDuration("Services", _notifyServices, _notifyServicesDuration);

        if (typeof Notification !== "undefined" && Notification.permission === "denied") {
            showNotifyStatus("Notifications blocked by browser. Reset in browser site settings.");
        } else {
            hideNotifyStatus();
        }
    }

    function updateSubToggle(name, isOn) {
        var btn = document.getElementById("optNotify" + name + "Btn");
        var label = document.getElementById("optNotify" + name + "Label");
        if (isOn) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    function updateSubDuration(name, parentOn, durOn) {
        var row = document.getElementById("opt" + name + "DurRow");
        var track = document.getElementById("opt" + name + "DurTrack");
        row.style.display = parentOn ? "" : "none";
        if (durOn) {
            track.classList.add("usd-toggle-track--active");
        } else {
            track.classList.remove("usd-toggle-track--active");
        }
    }

    function toggleSubNotify(name) {
        if (name === "Streams") _notifyStreams = !_notifyStreams;
        else if (name === "Connections") _notifyConnections = !_notifyConnections;
        else if (name === "Nodes") _notifyNodes = !_notifyNodes;
        else if (name === "Services") _notifyServices = !_notifyServices;
        updateNotifyDisplay();
    }

    function toggleSubDuration(name) {
        if (name === "Streams") _notifyStreamsDuration = !_notifyStreamsDuration;
        else if (name === "Connections") _notifyConnectionsDuration = !_notifyConnectionsDuration;
        else if (name === "Nodes") _notifyNodesDuration = !_notifyNodesDuration;
        else if (name === "Services") _notifyServicesDuration = !_notifyServicesDuration;
        updateNotifyDisplay();
    }

    function toggleProdOnly() {
        _notifyProdOnly = !_notifyProdOnly;
        updateProdOnlyDisplay();
    }

    function updateProdOnlyDisplay() {
        var btn = document.getElementById("optProdOnlyBtn");
        var label = document.getElementById("optProdOnlyLabel");
        if (_notifyProdOnly) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    // ─── Teams status (readonly) ───

    function updateTeamsDisplay(enabled) {
        var dot = document.querySelector("#optTeamsStatus .usd-status-dot");
        var label = document.getElementById("optTeamsStatusLabel");
        if (enabled) {
            dot.className = "usd-status-dot usd-status-dot--live";
            label.textContent = "Enabled";
        } else {
            dot.className = "usd-status-dot usd-status-dot--warn";
            label.textContent = "Disabled";
        }
    }

    // ─── Metrics ───

    function toggleMetrics() {
        _metricsEnabled = !_metricsEnabled;
        updateMetricsDisplay();
    }

    function updateMetricsDisplay() {
        var btn = document.getElementById("optMetricsBtn");
        var label = document.getElementById("optMetricsLabel");
        if (_metricsEnabled) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    function toggleChartBackgrounds() {
        _chartBackgrounds = !_chartBackgrounds;
        updateChartBgDisplay();
    }

    function updateChartBgDisplay() {
        var btn = document.getElementById("optChartBgBtn");
        var label = document.getElementById("optChartBgLabel");
        if (_chartBackgrounds) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    // ─── UX Monitor ───

    function toggleUxEnabled() {
        _uxEnabled = !_uxEnabled;
        updateUxEnabledDisplay();
    }

    function updateUxEnabledDisplay() {
        var btn = document.getElementById("optUxEnabledBtn");
        var label = document.getElementById("optUxEnabledLabel");
        if (_uxEnabled) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    function toggleUxAutoProbes() {
        _uxAutoProbes = !_uxAutoProbes;
        updateUxAutoProbesDisplay();
    }

    function updateUxAutoProbesDisplay() {
        var btn = document.getElementById("optUxAutoProbesBtn");
        var label = document.getElementById("optUxAutoProbesLabel");
        if (_uxAutoProbes) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    function toggleUxAutoPages() {
        _uxAutoPages = !_uxAutoPages;
        updateUxAutoPagesDisplay();
    }

    function updateUxAutoPagesDisplay() {
        var btn = document.getElementById("optUxAutoPagesBtn");
        var label = document.getElementById("optUxAutoPagesLabel");
        if (_uxAutoPages) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    function toggleUxAlerts() {
        _uxAlerts = !_uxAlerts;
        updateUxAlertsDisplay();
    }

    function updateUxAlertsDisplay() {
        var btn = document.getElementById("optUxAlertsBtn");
        var label = document.getElementById("optUxAlertsLabel");
        if (_uxAlerts) {
            btn.classList.add("opt-toggle-btn--on");
            label.textContent = "On";
        } else {
            btn.classList.remove("opt-toggle-btn--on");
            label.textContent = "Off";
        }
    }

    function populateUxEnvSelect(selectedEnv) {
        var select = document.getElementById("optUxEnv");
        select.innerHTML = "";
        fetch("/api/auth/status").then(function (r) { return r.json(); }).then(function (envs) {
            for (var i = 0; i < envs.length; i++) {
                var opt = document.createElement("option");
                opt.value = envs[i].envName;
                opt.textContent = envs[i].label;
                if (envs[i].envName === selectedEnv) opt.selected = true;
                select.appendChild(opt);
            }
        }).catch(function () {});
    }

    // ─── Page Check Target chips ───

    function addPageTarget() {
        var input = document.getElementById("optUxPageTargetInput");
        var val = input.value.trim();
        if (!val) return;
        if (val.charAt(0) !== "/") {
            showUxTargetError("Path must start with /");
            return;
        }
        for (var i = 0; i < _uxPageTargets.length; i++) {
            if (_uxPageTargets[i] === val) {
                showUxTargetError("Duplicate path");
                return;
            }
        }
        _uxPageTargets.push(val);
        input.value = "";
        renderPageTargetChips();
    }

    function removePageTarget(idx) {
        _uxPageTargets.splice(idx, 1);
        renderPageTargetChips();
    }

    function renderPageTargetChips() {
        var container = document.getElementById("optUxPageTargetChips");
        if (!_uxPageTargets.length) { container.innerHTML = ""; return; }
        var html = "";
        for (var i = 0; i < _uxPageTargets.length; i++) {
            var hasGuid = _uxPageTargets[i].indexOf("{guid}") !== -1;
            html += '<span class="usd-chip' + (hasGuid ? ' usd-chip--cyan' : ' usd-chip--blue') + '">';
            html += '<span class="usd-chip__text">' + shared.esc(_uxPageTargets[i]) + '</span>';
            html += '<span class="usd-chip__remove" data-idx="' + i + '">&times;</span>';
            html += '</span>';
        }
        container.innerHTML = html;
        var removeBtns = container.querySelectorAll(".usd-chip__remove");
        for (var ri = 0; ri < removeBtns.length; ri++) {
            removeBtns[ri].addEventListener("click", function () {
                removePageTarget(parseInt(this.getAttribute("data-idx"), 10));
            });
        }
    }

    function showUxTargetError(msg) {
        var input = document.getElementById("optUxPageTargetInput");
        input.style.borderColor = "var(--accent-red, #e74c3c)";
        input.placeholder = msg;
        setTimeout(function () { input.style.borderColor = ""; input.placeholder = "e.g. /admin or /sharedo/{guid}"; }, 2000);
    }

    function renderUxProbeList() {
        var container = document.getElementById("optUxProbeList");
        var html = "";
        for (var i = 0; i < _uxProbes.length; i++) {
            var p = _uxProbes[i];
            if (i > 0) html += '<div class="opt-divider"></div>';
            html += '<div class="opt-row">';
            html += '<div class="opt-row__text">';
            html += '<div class="opt-row__label">' + shared.esc(p.label) + '</div>';
            html += '<div class="opt-row__desc" style="font-family:Consolas,monospace;font-size:10px;color:var(--text-muted)">' + shared.esc(p.method) + ' ' + shared.esc(p.path) + '</div>';
            html += '</div>';
            html += '<div class="opt-row__control">';
            html += '<button class="opt-toggle-btn opt-ux-probe-toggle' + (p.enabled ? ' opt-toggle-btn--on' : '') + '" data-probe-idx="' + i + '">';
            html += '<span class="opt-toggle-btn__label">' + (p.enabled ? 'On' : 'Off') + '</span>';
            html += '</button>';
            html += '</div>';
            html += '</div>';
        }
        container.innerHTML = html;

        // Wire toggles
        var toggles = container.querySelectorAll(".opt-ux-probe-toggle");
        for (var ti = 0; ti < toggles.length; ti++) {
            toggles[ti].addEventListener("click", function () {
                var idx = parseInt(this.getAttribute("data-probe-idx"), 10);
                _uxProbes[idx].enabled = !_uxProbes[idx].enabled;
                renderUxProbeList();
            });
        }
    }

    function runUxProbesNow() {
        var btn = document.getElementById("optUxRunProbesBtn");
        btn.disabled = true;
        btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span> Running...';
        fetch("/api/ux/probe/run", { method: "POST" })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.results) {
                    renderUxLatestResults(data.results);
                }
                btn.innerHTML = '<span class="fa fa-check"></span> Done';
                setTimeout(function () {
                    btn.innerHTML = '<span class="fa fa-play"></span> Run';
                    btn.disabled = false;
                }, 2000);
            })
            .catch(function () {
                btn.innerHTML = '<span class="fa fa-play"></span> Run';
                btn.disabled = false;
            });
    }

    function loadUxLatestResults() {
        fetch("/api/ux/status").then(function (r) { return r.json(); }).then(function (data) {
            if (data.latestProbes) {
                renderUxLatestResults(data.latestProbes);
            }
        }).catch(function () {});
    }

    function renderUxLatestResults(results) {
        var container = document.getElementById("optUxLatestResults");
        if (!results || !results.probes || results.probes.length === 0) {
            container.innerHTML = '<div class="opt-row"><div class="opt-row__text"><div class="opt-row__desc">No results yet.</div></div></div>';
            return;
        }

        var ts = results.ts ? new Date(results.ts).toLocaleString() : "--";
        var html = '<div class="opt-ux-results__header">' + shared.esc(ts) + '</div>';
        html += '<table class="opt-ux-results__table">';
        html += '<thead><tr><th class="opt-ux-th--api">API</th><th class="opt-ux-th--status">Status</th><th class="opt-ux-th--ms">Response</th><th class="opt-ux-th--server">Server</th></tr></thead>';
        html += '<tbody>';

        for (var i = 0; i < results.probes.length; i++) {
            var p = results.probes[i];
            var critThresh = parseInt(document.getElementById("optUxThresholdCrit").value, 10) || 5000;
            var warnThresh = parseInt(document.getElementById("optUxThresholdWarn").value, 10) || 3000;
            var levelClass = "";
            var msText = "";
            if (p.error) {
                levelClass = "opt-ux-result--error";
                msText = "ERR";
            } else if (p.ms >= critThresh) {
                levelClass = "opt-ux-result--crit";
                msText = p.ms + "ms";
            } else if (p.ms >= warnThresh) {
                levelClass = "opt-ux-result--warn";
                msText = p.ms + "ms";
            } else {
                levelClass = "opt-ux-result--ok";
                msText = p.ms + "ms";
            }
            var serverText = p.tookMs != null ? p.tookMs + "ms" : "--";

            html += '<tr class="' + levelClass + '">';
            html += '<td class="opt-ux-td--api">' + shared.esc(p.label) + '</td>';
            html += '<td class="opt-ux-td--status">' + shared.esc(p.status != null ? String(p.status) : "--") + '</td>';
            html += '<td class="opt-ux-td--ms">' + msText + '</td>';
            html += '<td class="opt-ux-td--server">' + serverText + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ─── Test notification ───

    function sendTestNotification() {
        fetch("/api/alerts/test", { method: "POST" })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showNotifyStatus("Sent " + data.sent + " test notifications via SSE (desktop only)");
                    setTimeout(hideNotifyStatus, 3000);
                }
            })
            .catch(function () { showNotifyStatus("Failed to send test"); });
    }

    function sendTestTeamsNotification() {
        fetch("/api/alerts/test-teams", { method: "POST" })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.error) {
                    showTeamsTestStatus(data.message || "Teams webhook not enabled");
                } else if (data.success) {
                    showTeamsTestStatus("Sent " + data.sent + " test notifications to Teams + desktop");
                    setTimeout(hideTeamsTestStatus, 4000);
                }
            })
            .catch(function () { showTeamsTestStatus("Failed to send test"); });
    }

    function showNotifyStatus(msg) {
        var el = document.getElementById("optNotifyStatus");
        el.textContent = msg;
        el.classList.add("opt-notify-status--visible");
    }

    function hideNotifyStatus() {
        document.getElementById("optNotifyStatus").classList.remove("opt-notify-status--visible");
    }

    function showTeamsTestStatus(msg) {
        var el = document.getElementById("optTeamsTestStatus");
        el.textContent = msg;
        el.classList.add("opt-notify-status--visible");
    }

    function hideTeamsTestStatus() {
        document.getElementById("optTeamsTestStatus").classList.remove("opt-notify-status--visible");
    }

    // ─── Authentication ───

    function loadAuthStatus() {
        fetch("/api/auth/status").then(function (r) { return r.json(); }).then(function (data) {
            var container = document.getElementById("optAuthRows");
            if (!container) return;

            if (!data.length) {
                container.innerHTML = '<div class="opt-row"><div class="opt-row__text"><div class="opt-row__desc opt-auth-none">No environments configured.</div></div></div>';
                return;
            }

            var html = "";
            for (var i = 0; i < data.length; i++) {
                var env = data[i];

                // Source label based on actual cookie origin
                var sourceLabel;
                if (!env.hasCookie) {
                    sourceLabel = "Not set";
                } else if (env.cookieSource === "autoauth") {
                    sourceLabel = "Auto Auth";
                } else if (env.cookieSource === "browser" || env.cookieSource === "manual") {
                    sourceLabel = "Browser session";
                } else {
                    sourceLabel = "Unknown";
                }

                // Identity from JWT
                var identityText = "";
                if (env.identity) {
                    var displayName = env.identity;
                    var atIdx = displayName.indexOf("@");
                    if (atIdx > 0) displayName = displayName.substring(0, atIdx);
                    identityText = shared.esc(displayName);
                }

                // Status HTML (only when cookie set)
                var statusHtml = "";
                if (env.hasCookie) {
                    var statusParts = "Cookie set";
                    if (env.expiresInMin != null) statusParts += " | Expires: ~" + env.expiresInMin + " min";
                    var refreshIcon = env.autoRefreshing
                        ? '<span class="fa fa-recycle opt-auth-icon--ok"></span> '
                        : '<span class="fa fa-exclamation-circle opt-auth-icon--warn"></span> ';
                    statusHtml = '<span class="usd-status-dot usd-status-dot--live"></span>' + refreshIcon + '<span class="opt-auth-status-text">' + statusParts + '</span>';
                }

                html += '<div class="opt-auth-row" data-env="' + shared.esc(env.envName) + '">';

                // Section 1: env info (stacked)
                html += '<div class="opt-auth-row__info">';
                html += '<div class="opt-auth-row__label">' + shared.esc(env.label) + '</div>';
                html += '<div class="opt-auth-row__source">' + shared.esc(sourceLabel) + '</div>';
                if (identityText) {
                    html += '<div class="opt-auth-row__identity"><span class="fa fa-id-card-o"></span> ' + identityText + '</div>';
                }
                html += '</div>';

                // Section 2: status OR paste input
                html += '<div class="opt-auth-row__status">';
                if (env.hasCookie) {
                    html += statusHtml;
                } else {
                    html += '<input type="text" class="opt-input opt-auth-paste-input" placeholder="Paste browser cookie here" />';
                }
                html += '</div>';

                // Section 3: action buttons (icon-only with tooltips)
                html += '<div class="opt-auth-row__actions">';

                // 3.1: Clear or Paste
                if (env.hasCookie) {
                    html += '<button class="usd-btn opt-auth-btn opt-auth-clear-btn" data-env="' + shared.esc(env.envName) + '" title="Clear cookie"><span class="fa fa-times"></span></button>';
                } else {
                    html += '<button class="usd-btn opt-auth-btn opt-auth-paste-btn" data-env="' + shared.esc(env.envName) + '" title="Set cookie from paste"><span class="fa fa-paste"></span></button>';
                }

                // 3.2: Auto Auth (spacer if not available)
                if (env.hasAutoAuth) {
                    html += '<button class="usd-btn opt-auth-btn opt-auth-reacquire-btn" data-env="' + shared.esc(env.envName) + '" title="Auto Auth"><span class="fa fa-refresh"></span></button>';
                } else {
                    html += '<span class="opt-auth-btn-spacer"></span>';
                }

                // 3.3: Login/Re-login
                html += '<button class="usd-btn opt-auth-btn opt-auth-login-btn" data-env="' + shared.esc(env.envName) + '" title="' + (env.hasCookie ? 'Re-login' : 'Login') + '"><span class="fa fa-globe"></span></button>';

                html += '</div>';
                html += '</div>';
            }
            container.innerHTML = html;

            // Wire clear buttons
            var clearBtns = container.querySelectorAll(".opt-auth-clear-btn");
            for (var ci = 0; ci < clearBtns.length; ci++) {
                clearBtns[ci].addEventListener("click", function () {
                    var envName = this.getAttribute("data-env");
                    fetch("/api/cookie/" + envName, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie: "" }) })
                        .then(function () { loadAuthStatus(); shared.refreshCookieStatus(); })
                        .catch(function () {});
                });
            }

            // Wire paste buttons
            var pasteBtns = container.querySelectorAll(".opt-auth-paste-btn");
            for (var pi = 0; pi < pasteBtns.length; pi++) {
                pasteBtns[pi].addEventListener("click", function () {
                    var envName = this.getAttribute("data-env");
                    var row = this.closest(".opt-auth-row");
                    var input = row.querySelector(".opt-auth-paste-input");
                    var val = input ? input.value.trim() : "";
                    if (!val) { if (input) input.focus(); return; }
                    fetch("/api/cookie/" + envName, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie: val }) })
                        .then(function () { loadAuthStatus(); shared.refreshCookieStatus(); })
                        .catch(function () {});
                });
            }

            // Wire paste input enter key
            var pasteInputs = container.querySelectorAll(".opt-auth-paste-input");
            for (var ii = 0; ii < pasteInputs.length; ii++) {
                pasteInputs[ii].addEventListener("keydown", function (e) {
                    if (e.key === "Enter") {
                        var row = this.closest(".opt-auth-row");
                        var btn = row.querySelector(".opt-auth-paste-btn");
                        if (btn) btn.click();
                    }
                });
            }

            // Wire re-acquire buttons
            var reacquireBtns = container.querySelectorAll(".opt-auth-reacquire-btn");
            for (var ri = 0; ri < reacquireBtns.length; ri++) {
                reacquireBtns[ri].addEventListener("click", function () {
                    var btn = this;
                    var envName = btn.getAttribute("data-env");
                    btn.disabled = true;
                    btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span>';
                    fetch("/api/auth/reacquire/" + envName, { method: "POST" })
                        .then(function (r) { return r.json(); })
                        .then(function () {
                            setTimeout(function () { loadAuthStatus(); shared.refreshCookieStatus(); }, 500);
                        })
                        .catch(function () {
                            btn.innerHTML = '<span class="fa fa-refresh"></span>';
                            btn.disabled = false;
                        });
                });
            }

            // Wire login buttons
            var loginBtns = container.querySelectorAll(".opt-auth-login-btn");
            for (var bi = 0; bi < loginBtns.length; bi++) {
                loginBtns[bi].addEventListener("click", function () {
                    launchBrowserLogin(this.getAttribute("data-env"), this);
                });
            }
        }).catch(function () {
            var container = document.getElementById("optAuthRows");
            if (container) container.innerHTML = '<div class="opt-row"><div class="opt-row__text"><div class="opt-row__desc opt-auth-none">Failed to load authentication status.</div></div></div>';
        });
    }

    function launchBrowserLogin(envName, btn) {
        var originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="fa fa-spinner fa-spin"></span>';

        fetch("/api/auth/launch-browser", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ environment: envName })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                btn.innerHTML = '<span class="fa fa-exclamation-triangle"></span>';
                setTimeout(function () { btn.innerHTML = originalText; btn.disabled = false; }, 3000);
                return;
            }
            // Browser launched -- poll auth status until session appears or timeout
            var pollCount = 0;
            var maxPolls = 90; // 3 minutes at 2s intervals
            var pollTimer = setInterval(function () {
                pollCount++;
                fetch("/api/auth/status").then(function (r) { return r.json(); }).then(function (statuses) {
                    for (var si = 0; si < statuses.length; si++) {
                        if (statuses[si].envName === envName && statuses[si].hasCookie) {
                            clearInterval(pollTimer);
                            btn.innerHTML = '<span class="fa fa-check"></span>';
                            setTimeout(function () { loadAuthStatus(); }, 1500);
                            return;
                        }
                    }
                    if (pollCount >= maxPolls) {
                        clearInterval(pollTimer);
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                }).catch(function () {});
            }, 2000);
        })
        .catch(function () {
            btn.innerHTML = originalText;
            btn.disabled = false;
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();