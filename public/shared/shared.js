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

    // ─── Navigation ───
    // Single source of truth for all page nav links.
    // To add a new page, add an entry here -- no HTML changes needed.
    var NAV_ITEMS = [
        { href: "/",         page: "monitor",      label: "Monitor" },
        { href: "/metrics",  page: "metrics",      label: "Metrics" },
        { href: "/issues",   page: "issues",       label: "Issues" },
        { href: "/search",   page: "search",       label: "Search" },
        { href: "/waila",    page: "waila",        label: "WAILA" },
        { href: "/worktype", page: "worktype",     label: "Work Types" },
        { href: "/ux",       page: "ux",            label: "UX" },
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
            populateEnvDropdown(data.environments, data.current);
            document.getElementById("hostLabel").textContent = data.apiHost;
            updateCookieStatus(data.hasCookie);
        }).catch(function () {});

        // Wire controls
        document.getElementById("envSelect").addEventListener("change", switchEnvironment);

        // Theme -- instant apply from localStorage (avoids flash), then sync with server
        initTheme();

        // Alert stream -- conditional on notification settings
        initAlertStream();

        // Close SSE on page unload to free the connection slot
        window.addEventListener("beforeunload", closeAlertStream);
    }

    // ─── Theme ───
    var THEME_KEY = "sharedo-tools-theme";
    var HC_KEY = "sharedo-tools-high-contrast";

    function applyThemeAttr(theme) {
        document.body.dataset.theme = theme;
        if (theme === "light") document.body.classList.add("light-theme");
        else document.body.classList.remove("light-theme");
    }

    function initTheme() {
        var saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
        applyThemeAttr(saved === "light" ? "light" : "dark");

        var hcSaved = null;
        try { hcSaved = localStorage.getItem(HC_KEY); } catch (e) {}
        if (hcSaved === "true") document.body.classList.add("high-contrast");

        // Sync with server (this fetch is shared with initAlertStream via _settingsPromise)
        _settingsPromise.then(function (data) {
            if (data.theme === "light") {
                applyThemeAttr("light");
                try { localStorage.setItem(THEME_KEY, "light"); } catch (e) {}
            } else if (data.theme === "dark") {
                applyThemeAttr("dark");
                try { localStorage.setItem(THEME_KEY, "dark"); } catch (e) {}
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
            if (data.desktopNotifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
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
                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
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
            fetch("/api/cookie/status").then(function (r) { return r.json(); }).then(function (d) {
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
        fetch("/api/env").then(function (r) { return r.json(); }).then(function (data) {
            updateCookieStatus(data.hasCookie);
        }).catch(function () {});
    }

    return {
        init: init,
        onEnvChange: onEnvChange,
        onCookieChange: onCookieChange,
        onAlert: onAlert,
        openAlertStream: openAlertStream,
        updateCookieStatus: updateCookieStatus,
        refreshCookieStatus: refreshCookieStatus,
        esc: esc,
        fmtNum: fmtNum,
        fmtDate: fmtDate
    };
})();