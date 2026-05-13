/**
 * Shared module for ShareDo Monitor pages.
 * Renders the header, env dropdown, cookie bar, and navigation.
 *
 * Usage: shared.init({ activePage: "monitor" | "search" | ... })
 */
var shared = (function () {
    "use strict";

    var _onEnvChangeCallbacks = [];
    var _onCookieChangeCallbacks = [];
    var _onAlertCallbacks = [];

    // ─── Client-side environment tracking ───
    // Each browser tab tracks its own selected environment independently.
    // The X-Sharedo-Env header is sent on env-scoped API calls via apiFetch().
    var _currentEnv = null;
    var _envList = [];       // cached env list from /api/env response
    var ENV_KEY = "sharedo-tools-env";

    // ─── Session state (multi-user mode) ───
    var _session = null;     // { firstName, lastName, email, isAdmin } or null
    var _multiUser = false;
    var _userDesktopNotifications = false;  // per-user desktop notification preference

    // ─── Navigation ───
    // Single source of truth for all page nav links.
    // To add a new page, add an entry here -- no HTML changes needed.
    var NAV_ITEMS = [
        { href: "/",         page: "monitor",      label: "Monitor" },
        { href: "/issues",   page: "issues",       label: "Issues" },
        { href: "/metrics",  page: "metrics",      label: "Metrics" },
        { href: "/ux",       page: "ux",            label: "UX" },
        { href: "/search",   page: "search",       label: "Search" },
        { href: "/waila",    page: "waila",        label: "WAILA" },
        { href: "/worktype", page: "worktype",     label: "Work Types" },
        { href: "/activity", page: "activity",     label: "Activity" },
        { href: "/options",  page: "options",       label: null, icon: "fa-cog", title: "Options" }
    ];

    function buildNav(activePage) {
        var nav = document.getElementById("mainNav");
        if (!nav) return;
        var html = "";
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            var item = NAV_ITEMS[i];
            var active = item.page === activePage ? " usd-nav__link--active" : "";
            var titleAttr = item.title ? ' title="' + item.title + '"' : "";
            if (item.icon) {
                html += '<a href="' + item.href + '" class="usd-nav__link' + active + '"' + titleAttr + '><span class="fa ' + item.icon + '"></span></a>';
            } else {
                html += '<a href="' + item.href + '" class="usd-nav__link' + active + '" data-page="' + item.page + '"' + titleAttr + '>' + item.label + '</a>';
            }
        }
        nav.innerHTML = html;
    }

    function init(options) {
        var activePage = (options && options.activePage) || "monitor";

        // Build navigation
        buildNav(activePage);

        // Load environment info
        fetch("/api/env").then(function (r) { return r.json(); }).then(function (data) {
            _envList = data.environments || [];

            // Determine initial env: prefer localStorage, fall back to server default
            var savedEnv = null;
            try { savedEnv = localStorage.getItem(ENV_KEY); } catch (e) {}
            var initialEnv = (savedEnv && findEnv(savedEnv)) ? savedEnv : data.current;

            _currentEnv = initialEnv;
            try { localStorage.setItem(ENV_KEY, _currentEnv); } catch (e) {}

            populateEnvDropdown(_envList, _currentEnv);

            // Show host and cookie status for the selected env (may differ from server default)
            var envInfo = findEnv(_currentEnv);
            if (envInfo) {
                document.getElementById("hostLabel").textContent = envInfo.apiHost;
                updateCookieStatus(envInfo.hasCookie);
            }

            // If client restored a different env than the server default, tell the server
            // so its logging and health-monitor context stays reasonable (single-user benefit).
            // In multi-user mode (Phase 3), this POST will be reconsidered.
            if (_currentEnv !== data.current) {
                fetch("/api/env/select", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ environment: _currentEnv })
                }).catch(function () {});
            }
        }).catch(function () {});

        // Wire controls
        document.getElementById("envSelect").addEventListener("change", switchEnvironment);

        // Session info (multi-user mode -- determines user display and admin state)
        fetch("/api/session").then(function (r) { return r.json(); }).then(function (data) {
            _multiUser = !!data.multiUser;
            if (data.multiUser && data.authenticated && data.user) {
                _session = data.user;
                renderUserInfo();
            }
        }).catch(function () {});

        // Theme -- instant apply from localStorage (avoids flash), then sync with server
        initTheme();

        // Alert stream -- conditional on notification settings
        initAlertStream();

        // Guidance dismissal -- restore dismissed state, wire dismiss buttons
        initGuidance();

        // Tooltips -- JS-positioned to escape overflow containers
        initTooltips();

        // Close SSE on page unload to free the connection slot
        window.addEventListener("beforeunload", closeAlertStream);
    }

    // ─── Environment lookup ───

    function findEnv(envName) {
        for (var i = 0; i < _envList.length; i++) {
            if (_envList[i].name === envName) return _envList[i];
        }
        return null;
    }

    // ─── User info display (multi-user mode) ───

    function renderUserInfo() {
        if (!_session) return;
        var container = document.querySelector(".usd-header__right");
        if (!container) return;
        var displayName = _session.firstName + " " + _session.lastName;
        var adminBadge = _session.isAdmin
            ? ' <span class="usd-admin-badge">Admin</span>'
            : "";
        container.innerHTML = '<div style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-md);color:var(--nav-text);font-family:var(--font-ui)">' +
            '<span class="fa fa-user-circle-o" style="font-size:14px;color:var(--nav-text)"></span>' +
            '<span>' + esc(displayName) + '</span>' +
            adminBadge +
            '</div>';
    }

    // ─── apiFetch ───
    // Drop-in replacement for fetch() that injects the X-Sharedo-Env header.
    // Use for any API call where the server needs to know which ShareDo environment
    // to operate against. Do NOT use for control-plane calls (settings, auth management).

    function apiFetch(url, options) {
        if (!options) options = {};
        if (!options.headers) options.headers = {};
        if (_currentEnv && !options.headers["X-Sharedo-Env"]) {
            options.headers["X-Sharedo-Env"] = _currentEnv;
        }
        return fetch(url, options).then(function (r) {
            // In multi-user mode, 401 with needsRegistration triggers redirect to /register
            if (r.status === 401 && _multiUser) {
                r.clone().json().then(function (data) {
                    if (data && data.needsRegistration) {
                        window.location.href = "/register?return=" + encodeURIComponent(window.location.pathname);
                    }
                }).catch(function () {});
            }
            return r;
        });
    }

    // ─── Theme ───
    var THEME_KEY = "sharedo-tools-theme";
    var HC_KEY = "sharedo-tools-high-contrast";
    var _themeManifest = null;
    var _themeManifestPromise = fetch("/shared/themes/manifest.json").then(function (r) { return r.json(); }).then(function (data) {
        _themeManifest = data;
        return data;
    }).catch(function () { return []; });

    function isLightBased(themeId) {
        if (!_themeManifest) return themeId === "light"; // fallback before manifest loads
        for (var i = 0; i < _themeManifest.length; i++) {
            if (_themeManifest[i].id === themeId) return !!_themeManifest[i].lightBased;
        }
        return false;
    }

    function isValidTheme(themeId) {
        if (!_themeManifest) return themeId === "dark" || themeId === "light";
        for (var i = 0; i < _themeManifest.length; i++) {
            if (_themeManifest[i].id === themeId) return true;
        }
        return false;
    }

    function applyThemeAttr(theme) {
        document.body.dataset.theme = theme;
        if (isLightBased(theme)) document.body.classList.add("light-theme");
        else document.body.classList.remove("light-theme");
    }

    function initTheme() {
        var saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
        // Fast path from localStorage (manifest may not be loaded yet)
        applyThemeAttr(saved || "dark");

        var hcSaved = null;
        try { hcSaved = localStorage.getItem(HC_KEY); } catch (e) {}
        if (hcSaved === "true") document.body.classList.add("high-contrast");

        // Sync with server (this fetch is shared with initAlertStream via _settingsPromise)
        _settingsPromise.then(function (data) {
            if (data.theme) {
                applyThemeAttr(data.theme);
                try { localStorage.setItem(THEME_KEY, data.theme); } catch (e) {}
            }
            if (data.highContrast) {
                document.body.classList.add("high-contrast");
                try { localStorage.setItem(HC_KEY, "true"); } catch (e) {}
            } else {
                document.body.classList.remove("high-contrast");
                try { localStorage.setItem(HC_KEY, "false"); } catch (e) {}
            }
        }).catch(function () {});
    }

    // Single settings fetch shared across init tasks
    var _settingsPromise = fetch("/api/settings").then(function (r) { return r.json(); }).catch(function () { return {}; });

    // ─── SSE Alert Stream ───
    var _alertSource = null;

    function initAlertStream() {
        if (typeof EventSource === "undefined") return;
        _settingsPromise.then(function (data) {
            // Store per-user desktop notification preference
            _userDesktopNotifications = !!data.desktopNotifications;

            // Open SSE when the server is actively pushing alerts.
            // desktopAlertMonitoring = server gate (admin-controlled)
            // desktopNotifications = per-user opt-in (mirrors server gate in single-user mode)
            var serverPushing = data.desktopAlertMonitoring || data.desktopNotifications;
            if (serverPushing && typeof Notification !== "undefined" && Notification.permission === "granted") {
                openAlertStream();
            }
        }).catch(function () {});
    }

    function openAlertStream() {
        if (_alertSource) return;
        _alertSource = new EventSource("/api/alerts/stream");
        _alertSource.addEventListener("alert", function (e) {
            try {
                var alert = JSON.parse(e.data);
                // Only show desktop notification if user has opted in
                if (_userDesktopNotifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
                    new Notification(alert.title || "ShareDo Alert", {
                        body: alert.body || "",
                        tag: alert.tag || "sharedo-alert",
                        requireInteraction: true
                    });
                }
                for (var i = 0; i < _onAlertCallbacks.length; i++) _onAlertCallbacks[i](alert);
            } catch (err) { console.warn("[shared] Alert handler error:", err); }
        });
    }

    function closeAlertStream() {
        if (_alertSource) { _alertSource.close(); _alertSource = null; }
    }

    function populateEnvDropdown(envList, current) {
        var s = document.getElementById("envSelect"); s.innerHTML = "";
        for (var i = 0; i < envList.length; i++) {
            var o = document.createElement("option");
            o.value = envList[i].name; o.textContent = envList[i].label;
            if (envList[i].name === current) o.selected = true;
            s.appendChild(o);
        }
    }

    function switchEnvironment() {
        var target = document.getElementById("envSelect").value;

        // Update client-side tracking immediately so any callbacks
        // that fire API calls will use the new env via apiFetch
        _currentEnv = target;
        try { localStorage.setItem(ENV_KEY, target); } catch (e) {}

        fetch("/api/env/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: target }) })
            .then(function (r) { return r.json(); }).then(function (d) {
                if (d.error) return;
                document.getElementById("hostLabel").textContent = d.apiHost;
                updateCookieStatus(d.hasCookie);
                for (var i = 0; i < _onEnvChangeCallbacks.length; i++) _onEnvChangeCallbacks[i](d);
            }).catch(function () {});
    }

    function updateCookieStatus(hc) {
        var el = document.getElementById("cookieStatus");
        if (!el) return;
        if (hc) {
            apiFetch("/api/cookie/status").then(function (r) { return r.json(); }).then(function (d) {
                var dot = '<span class="usd-status-dot usd-status-dot--live"></span>';
                var text = "Cookie set";
                if (d.expiresInMin != null) text += " | Expires: ~" + d.expiresInMin + " min";
                var icon = d.autoRefreshing
                    ? '<span class="fa fa-recycle usd-clr--green usd-icon-mr"></span>'
                    : '<span class="fa fa-exclamation-circle usd-clr--amber usd-icon-mr"></span>';
                el.innerHTML = dot + icon + '<span>' + text + '</span>';
                el.className = "usd-header__cookie-status usd-header__cookie-status--set";
            }).catch(function () {
                el.innerHTML = '<span class="usd-status-dot usd-status-dot--live"></span><span>Cookie set</span>';
                el.className = "usd-header__cookie-status usd-header__cookie-status--set";
            });
        } else {
            el.innerHTML = '<span class="usd-status-dot usd-status-dot--warn"></span><span>No cookie</span>';
            el.className = "usd-header__cookie-status";
        }
    }

    // ─── Public API ───

    function onEnvChange(cb) { _onEnvChangeCallbacks.push(cb); }
    function onCookieChange(cb) { _onCookieChangeCallbacks.push(cb); }
    function onAlert(cb) { _onAlertCallbacks.push(cb); }

    // ─── Utility functions shared across pages ───

    function esc(t) { if (t == null) return ""; var d = document.createElement("div"); d.appendChild(document.createTextNode(String(t))); return d.innerHTML; }
    function fmtNum(n) { return n == null ? "--" : n.toLocaleString(); }
    function fmtDate(iso) {
        if (!iso) return "--";
        try { var d = new Date(iso); if (isNaN(d.getTime())) return "--"; var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; var h = d.getHours(), m = String(d.getMinutes()).padStart(2,"0"), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return d.getDate() + " " + mo[d.getMonth()] + " " + d.getFullYear() + ", " + h + ":" + m + " " + ap; }
        catch (e) { return "--"; }
    }

    function refreshCookieStatus() {
        apiFetch("/api/cookie/status").then(function (r) { return r.json(); }).then(function (d) {
            updateCookieStatus(d.hasCookie);
        }).catch(function () {});
    }

    // ─── Guidance dismissal ───
    var GUIDANCE_PREFIX = "sharedo-tools-guidance-";

    function initGuidance() {
        var blocks = document.querySelectorAll(".usd-guidance[data-guidance-id]");
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            var id = block.getAttribute("data-guidance-id");
            // Restore dismissed state
            try { if (localStorage.getItem(GUIDANCE_PREFIX + id) === "dismissed") { block.hidden = true; continue; } } catch (e) {}
            // Wire dismiss button
            var btn = block.querySelector(".usd-guidance__dismiss");
            if (btn) {
                btn.addEventListener("click", (function (el, key) {
                    return function () {
                        el.hidden = true;
                        try { localStorage.setItem(GUIDANCE_PREFIX + key, "dismissed"); } catch (e) {}
                    };
                })(block, id));
            }
        }
    }

    // ─── Tooltips (JS-positioned to escape overflow containers) ───
    var _tooltipEl = null;
    var _tooltipTimer = null;

    function initTooltips() {
        // Create shared tooltip element once
        _tooltipEl = document.createElement("div");
        _tooltipEl.className = "usd-tooltip";
        document.body.appendChild(_tooltipEl);

        // Delegate via document -- catches dynamically added .usd-help elements too
        document.addEventListener("mouseenter", function (e) {
            if (!e.target || !e.target.closest) return;
            var trigger = e.target.closest(".usd-help[data-tooltip]");
            if (!trigger) return;
            showTooltip(trigger);
        }, true);

        document.addEventListener("mouseleave", function (e) {
            if (!e.target || !e.target.closest) return;
            var trigger = e.target.closest(".usd-help[data-tooltip]");
            if (!trigger) return;
            hideTooltip();
        }, true);

        document.addEventListener("focusin", function (e) {
            if (!e.target || !e.target.closest) return;
            var trigger = e.target.closest(".usd-help[data-tooltip]");
            if (trigger) showTooltip(trigger);
        });

        document.addEventListener("focusout", function (e) {
            if (!e.target || !e.target.closest) return;
            var trigger = e.target.closest(".usd-help[data-tooltip]");
            if (trigger) hideTooltip();
        });
    }

    function showTooltip(trigger) {
        clearTimeout(_tooltipTimer);
        _tooltipTimer = setTimeout(function () {
            var text = trigger.getAttribute("data-tooltip");
            if (!text) return;
            _tooltipEl.textContent = "";
            var lines = text.split("\n");
            for (var i = 0; i < lines.length; i++) {
                if (i > 0) _tooltipEl.appendChild(document.createElement("br"));
                _tooltipEl.appendChild(document.createTextNode(lines[i]));
            }

            _tooltipEl.style.left = "-9999px";
            _tooltipEl.style.top = "-9999px";
            _tooltipEl.classList.add("usd-tooltip--visible");

            var tipRect = _tooltipEl.getBoundingClientRect();
            var trigRect = trigger.getBoundingClientRect();
            var gap = 8;
            var vw = window.innerWidth;
            var vh = window.innerHeight;

            var pos = trigger.getAttribute("data-tooltip-pos") || "above";
            var left, top;

            if (pos === "right") {
                left = trigRect.right + gap;
                top = trigRect.top + (trigRect.height / 2) - (tipRect.height / 2);
                if (left + tipRect.width > vw - gap) { left = trigRect.left - tipRect.width - gap; }
            } else if (pos === "left") {
                left = trigRect.left - tipRect.width - gap;
                top = trigRect.top + (trigRect.height / 2) - (tipRect.height / 2);
                if (left < gap) { left = trigRect.right + gap; }
            } else if (pos === "below") {
                left = trigRect.left + (trigRect.width / 2) - (tipRect.width / 2);
                top = trigRect.bottom + gap;
                if (top + tipRect.height > vh - gap) { top = trigRect.top - tipRect.height - gap; }
            } else {
                left = trigRect.left + (trigRect.width / 2) - (tipRect.width / 2);
                top = trigRect.top - tipRect.height - gap;
                if (top < gap) { top = trigRect.bottom + gap; }
            }

            if (left < gap) left = gap;
            if (left + tipRect.width > vw - gap) left = vw - tipRect.width - gap;
            if (top < gap) top = gap;
            if (top + tipRect.height > vh - gap) top = vh - tipRect.height - gap;

            _tooltipEl.style.left = Math.round(left) + "px";
            _tooltipEl.style.top = Math.round(top) + "px";
        }, 400);
    }

    function hideTooltip() {
        clearTimeout(_tooltipTimer);
        _tooltipTimer = setTimeout(function () {
            if (_tooltipEl) _tooltipEl.classList.remove("usd-tooltip--visible");
        }, 80);
    }

    return {
        init: init,
        onEnvChange: onEnvChange,
        onCookieChange: onCookieChange,
        onAlert: onAlert,
        openAlertStream: openAlertStream,
        updateCookieStatus: updateCookieStatus,
        refreshCookieStatus: refreshCookieStatus,
        initGuidance: initGuidance,
        initTooltips: initTooltips,
        themeManifest: function () { return _themeManifestPromise; },
        apiFetch: apiFetch,
        getCurrentEnv: function () { return _currentEnv; },
        getEnvList: function () { return _envList; },
        getSession: function () { return _session; },
        isMultiUser: function () { return _multiUser; },
        esc: esc,
        fmtNum: fmtNum,
        fmtDate: fmtDate
    };
})();