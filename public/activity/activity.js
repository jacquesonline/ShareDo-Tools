/**
 * Activity page — user activity feed from ShareDo tracking events.
 */
(function () {
    "use strict";

    var esc = shared.esc;

    var _events = [];        // raw meaningful events (no api-calls), newest first
    var _autoRefresh = false;
    var _autoTimer = null;
    var _apiHost = "";

    // ─── Friendly page labels ───
    var PATH_LABELS = {
        "/": "Home",
        "/calendar": "Calendar",
        "/search": "Search",
        "/tasks": "Tasks",
        "/reporting": "Reporting",
        "/documents": "Documents",
        "/admin": "Admin portal",
        "/modeller": "Modeller",
        "/modeller/ide": "Modeller — IDE",
        "/modeller/features": "Modeller — Features",
        "/modeller/workflows": "Modeller — Workflows",
        "/modeller/worktypes": "Modeller — Work Types",
        "/modeller/integrations": "Modeller — Integrations",
        "/modeller/assistant": "Modeller — Assistant",
        "/modeller/reports": "Modeller — Reports",
        "/my-notifications": "Notifications",
        "/listviews": "List views",
        "/my-tasks": "My tasks",
        "/my-schedule": "My schedule"
    };

    function describeNav(ev) {
        var to = (ev.data && ev.data.to) || ev.path || "";
        if (PATH_LABELS[to]) return PATH_LABELS[to];
        if (/^\/sharedo\/[a-f0-9-]{36}/i.test(to)) {
            return ev.reference ? "Work item " + ev.reference : "Work item";
        }
        if (to.startsWith("/admin/")) return "Admin — " + prettifyPath(to.replace("/admin/", ""));
        if (to.startsWith("/modeller/")) return "Modeller — " + prettifyPath(to.replace("/modeller/", ""));
        if (to.startsWith("/sharedo/")) return "ShareDo";
        return prettifyPath(to) || "Unknown";
    }

    function prettifyPath(p) {
        return p.replace(/^\//, "").replace(/\//g, " / ").replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function describeEvent(ev) {
        switch (ev.type) {
            case "page-navigation": return describeNav(ev);
            case "blade-open":  return "Opened ‘" + (ev.data && ev.data.title || "panel") + "’";
            case "blade-close": return "Closed ‘" + (ev.data && ev.data.title || "panel") + "’";
            case "button-click":
                var lbl = ev.data && ev.data.label;
                return lbl ? "Clicked ‘" + lbl + "’" : "Button action";
            default: return ev.type;
        }
    }

    var TYPE_ICON = {
        "page-navigation": "fa-arrow-right",
        "blade-open":      "fa-window-maximize",
        "blade-close":     "fa-window-minimize",
        "button-click":    "fa-hand-pointer-o"
    };

    var TYPE_COLOUR = {
        "page-navigation": "act-icon--blue",
        "blade-open":      "act-icon--green",
        "blade-close":     "act-icon--muted",
        "button-click":    "act-icon--amber"
    };

    // ─── Deduplication ───
    // Events are newest-first. Suppress an event when the same user performed the same
    // action within 5 minutes (consecutive duplicates caused by page reloads / re-visits).
    function fingerprint(ev) {
        var user = ev.userEmail || ev.userName || "?";
        switch (ev.type) {
            case "page-navigation":
                return user + ":nav:" + ((ev.data && ev.data.to) || ev.path || "");
            case "blade-open":
            case "blade-close":
                return user + ":" + ev.type + ":" + ((ev.data && ev.data.title) || "");
            case "button-click":
                return user + ":click:" + ((ev.data && ev.data.label) || "") + "@" + (ev.path || "");
            default:
                return user + ":" + ev.type;
        }
    }

    function deduplicateFeed(events) {
        var result = [];
        var lastSeen = {};  // fingerprint -> ms timestamp of most recent kept entry
        var WINDOW_MS = 5 * 60 * 1000;
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var fp = fingerprint(ev);
            var ts = new Date(ev.serverTs).getTime();
            if (lastSeen[fp] !== undefined && (lastSeen[fp] - ts) < WINDOW_MS) continue;
            lastSeen[fp] = ts;
            result.push(ev);
        }
        return result;
    }

    // ─── User summaries ───
    function buildUserSummaries(events) {
        var users = {};
        // events are newest-first, so first occurrence per user is their current state
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var key = ev.userEmail || ev.userName || "unknown";
            if (!users[key]) {
                users[key] = {
                    userName: ev.userName || "Unknown",
                    userEmail: ev.userEmail || "",
                    lastSeen: ev.serverTs,
                    description: describeEvent(ev),
                    page: ev.page || "",
                    workItemId: ev.workItemId || null,
                    type: ev.type
                };
            }
        }
        return Object.keys(users).map(function (k) { return users[k]; }).sort(function (a, b) {
            return new Date(b.lastSeen) - new Date(a.lastSeen);
        });
    }

    // ─── Relative time ───
    function relTime(isoTs) {
        var diff = Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000);
        if (diff < 5)   return "just now";
        if (diff < 60)  return diff + "s ago";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        return Math.floor(diff / 86400) + "d ago";
    }

    function staleness(isoTs) {
        var diff = (Date.now() - new Date(isoTs).getTime()) / 1000;
        if (diff < 300)  return "act-stale--fresh";   // < 5 min
        if (diff < 1800) return "act-stale--idle";    // < 30 min
        return "act-stale--old";
    }

    function initials(name) {
        if (!name) return "?";
        var parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    }

    // ─── Render user cards ───
    function renderUsers(users) {
        var el = document.getElementById("userCards");
        var emptyEl = document.getElementById("usersEmpty");
        var countEl = document.getElementById("userCount");

        if (!users.length) {
            el.innerHTML = "";
            emptyEl.style.display = "";
            countEl.style.display = "none";
            return;
        }
        emptyEl.style.display = "none";
        countEl.style.display = "";
        countEl.textContent = users.length;

        var html = "";
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            var stale = staleness(u.lastSeen);
            var wiLink = "";
            if (u.workItemId && _apiHost) {
                wiLink = ' <a class="act-wi-link" href="https://' + esc(_apiHost) + '/sharedo/' + esc(u.workItemId) + '" target="_blank" title="Open in ShareDo"><span class="fa fa-external-link"></span></a>';
            }
            html += '<div class="act-user-card ' + stale + '">';
            html += '<div class="act-user-avatar">' + esc(initials(u.userName)) + '</div>';
            html += '<div class="act-user-info">';
            html += '<div class="act-user-name">' + esc(u.userName) + (u.userEmail ? ' <span class="act-user-email">' + esc(u.userEmail) + '</span>' : '') + '</div>';
            html += '<div class="act-user-desc">' + esc(u.description) + wiLink + '</div>';
            html += '</div>';
            html += '<div class="act-user-time">' + relTime(u.lastSeen) + '</div>';
            html += '</div>';
        }
        el.innerHTML = html;
    }

    // ─── Render feed ───
    function renderFeed(events, filterUser, filterType) {
        var deduped = deduplicateFeed(events);
        var feedCountEl = document.getElementById("feedCount");
        var feedEmpty = document.getElementById("feedEmpty");
        var feedBody = document.getElementById("feedBody");

        var filtered = deduped.filter(function (ev) {
            if (filterUser && (ev.userEmail || ev.userName || "") !== filterUser) return false;
            if (filterType && ev.type !== filterType) return false;
            return true;
        });

        feedCountEl.style.display = filtered.length ? "" : "none";
        feedCountEl.textContent = filtered.length;

        if (!filtered.length) {
            feedBody.innerHTML = "";
            feedEmpty.style.display = "";
            return;
        }
        feedEmpty.style.display = "none";

        var html = "";
        for (var i = 0; i < filtered.length; i++) {
            var ev = filtered[i];
            var icon = TYPE_ICON[ev.type] || "fa-circle";
            var colour = TYPE_COLOUR[ev.type] || "act-icon--muted";
            var desc = describeEvent(ev);
            var page = ev.page || "";
            var wiLink = "";
            if (ev.workItemId && _apiHost) {
                wiLink = ' <a class="act-wi-link" href="https://' + esc(_apiHost) + '/sharedo/' + esc(ev.workItemId) + '" target="_blank"><span class="fa fa-external-link"></span></a>';
            }
            var locationText = friendlyPage(page);
            if (ev.workItemId) locationText = "Work item" + (wiLink ? "" : "");

            html += '<tr>';
            html += '<td><span class="act-type-icon ' + colour + '"><span class="fa ' + icon + '"></span></span></td>';
            html += '<td class="act-feed-user">' + esc(ev.userName || "Unknown") + '</td>';
            html += '<td class="act-feed-desc">' + esc(desc) + wiLink + '</td>';
            html += '<td class="act-feed-page">' + esc(locationText) + '</td>';
            html += '<td class="act-feed-time" title="' + esc(ev.serverTs) + '">' + relTime(ev.serverTs) + '</td>';
            html += '</tr>';
        }
        feedBody.innerHTML = html;
    }

    function friendlyPage(page) {
        var map = { "home": "Home", "work-item": "Work item", "modeller": "Modeller", "other": "Other" };
        return map[page] || page || "—";
    }

    // ─── Populate user filter dropdown ───
    function populateUserFilter(events) {
        var seen = {};
        var users = [];
        for (var i = 0; i < events.length; i++) {
            var key = events[i].userEmail || events[i].userName || "";
            if (key && !seen[key]) { seen[key] = true; users.push({ key: key, name: events[i].userName || key }); }
        }
        var sel = document.getElementById("filterUser");
        var current = sel.value;
        var html = '<option value="">All users</option>';
        for (var j = 0; j < users.length; j++) {
            html += '<option value="' + esc(users[j].key) + '"' + (current === users[j].key ? " selected" : "") + '>' + esc(users[j].name) + '</option>';
        }
        sel.innerHTML = html;
    }

    // ─── Tracking badge ───
    function updateTrackingBadge(enabled) {
        var el = document.getElementById("trackingBadge");
        el.className = "act-tracking-badge " + (enabled ? "act-tracking-badge--on" : "act-tracking-badge--off");
        el.textContent = enabled ? "Tracking ON" : "Tracking OFF";
    }

    // ─── Main refresh ───
    function refresh() {
        var btn = document.getElementById("refreshBtn");
        btn.classList.add("usd-btn--loading");

        fetch("/api/activity?limit=500")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                btn.classList.remove("usd-btn--loading");
                _events = data.events || [];
                updateTrackingBadge(!!data.tracking);
                populateUserFilter(_events);

                var users = buildUserSummaries(_events);
                renderUsers(users);

                var filterUser = document.getElementById("filterUser").value;
                var filterType = document.getElementById("filterType").value;
                renderFeed(_events, filterUser, filterType);
            })
            .catch(function () {
                btn.classList.remove("usd-btn--loading");
            });
    }

    // ─── Auto refresh ───
    function setAutoRefresh(on) {
        _autoRefresh = on;
        var track = document.getElementById("toggleTrack");
        var label = document.getElementById("autoRefreshLabel");
        if (on) {
            track.classList.add("usd-toggle-track--active");
            label.textContent = "Auto 30s";
            _autoTimer = setInterval(refresh, 30000);
        } else {
            track.classList.remove("usd-toggle-track--active");
            label.textContent = "Auto off";
            clearInterval(_autoTimer);
        }
    }

    // ─── Section toggle (shared pattern) ───
    function toggleSection(id) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle("usd-section--collapsed");
    }
    window.toggleSection = toggleSection;

    // ─── Init ───
    function init() {
        shared.init({ activePage: "activity" });
        shared.onEnvChange(function (d) {
            _apiHost = d.apiHost || "";
        });

        fetch("/api/env").then(function (r) { return r.json(); }).then(function (d) {
            var envs = d.environments || [];
            var cur = d.current || "";
            for (var i = 0; i < envs.length; i++) {
                if (envs[i].name === cur) { _apiHost = envs[i].apiHost || ""; break; }
            }
        }).catch(function () {});

        document.getElementById("refreshBtn").addEventListener("click", refresh);

        document.getElementById("autoRefreshToggle").addEventListener("click", function () {
            setAutoRefresh(!_autoRefresh);
        });

        document.getElementById("filterUser").addEventListener("change", function () {
            renderFeed(_events, this.value, document.getElementById("filterType").value);
        });
        document.getElementById("filterType").addEventListener("change", function () {
            renderFeed(_events, document.getElementById("filterUser").value, this.value);
        });

        setAutoRefresh(true);
        refresh();
    }

    document.addEventListener("DOMContentLoaded", init);
}());
