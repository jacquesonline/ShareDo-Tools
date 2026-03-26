(function (global) {
    "use strict";

    var cfg = {
        baseUrl: "http://localhost:3000",
        source: "ShareDo",
        trackingKey: "",
        userEmail: "",
        heartbeatMs: 60000,
        pageName: "sharedo",
        showPanel: true,
        maxRows: 50,
        getWorkItemId: function () { return null; },
        getReference: function () { return null; }
    };

    var state = {
        enabled: false,
        heartbeatTimer: null,
        panel: null,
        list: null,
        status: null
    };

    function nowText() {
        return new Date().toLocaleTimeString();
    }

    function pathJoin(base, p) {
        return String(base || "").replace(/\/$/, "") + p;
    }

    function logRow(kind, msg) {
        if (!state.list) return;
        var li = document.createElement("li");
        li.style.margin = "0";
        li.style.padding = "4px 6px";
        li.style.borderBottom = "1px solid #2f3640";
        li.style.fontFamily = "Consolas, monospace";
        li.style.fontSize = "11px";
        li.style.lineHeight = "1.3";
        li.style.color = kind === "error" ? "#ff6b6b" : "#d2dae2";
        li.textContent = "[" + nowText() + "] " + msg;
        state.list.insertBefore(li, state.list.firstChild);

        while (state.list.children.length > cfg.maxRows) {
            state.list.removeChild(state.list.lastChild);
        }
    }

    function updateStatus() {
        if (!state.status) return;
        state.status.textContent = state.enabled ? "Tracking ON" : "Tracking OFF";
        state.status.style.color = state.enabled ? "#7bed9f" : "#ff6b6b";
    }

    function ensurePanel() {
        if (!cfg.showPanel || state.panel) return;

        var panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.right = "12px";
        panel.style.bottom = "12px";
        panel.style.width = "360px";
        panel.style.maxHeight = "45vh";
        panel.style.background = "#1e272e";
        panel.style.color = "#d2dae2";
        panel.style.border = "1px solid #485460";
        panel.style.borderRadius = "8px";
        panel.style.zIndex = "2147483647";
        panel.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
        panel.style.overflow = "hidden";

        var header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        header.style.padding = "8px 10px";
        header.style.background = "#2f3640";
        header.style.fontFamily = "Segoe UI, sans-serif";
        header.style.fontSize = "12px";

        var title = document.createElement("div");
        title.textContent = "ShareDo Tools Tracker";

        var status = document.createElement("div");
        status.style.fontWeight = "600";

        header.appendChild(title);
        header.appendChild(status);
        panel.appendChild(header);

        var controls = document.createElement("div");
        controls.style.display = "flex";
        controls.style.gap = "6px";
        controls.style.padding = "8px 10px";
        controls.style.background = "#242b33";

        function mkBtn(text, onClick) {
            var b = document.createElement("button");
            b.textContent = text;
            b.style.fontSize = "11px";
            b.style.padding = "4px 8px";
            b.style.border = "1px solid #57606f";
            b.style.borderRadius = "4px";
            b.style.background = "#2f3542";
            b.style.color = "#f1f2f6";
            b.style.cursor = "pointer";
            b.addEventListener("click", onClick);
            return b;
        }

        controls.appendChild(mkBtn("Start", function () { api.start(); }));
        controls.appendChild(mkBtn("Stop", function () { api.stop(); }));
        controls.appendChild(mkBtn("Ping Event", function () {
            api.track("manual-event", { title: document.title });
        }));
        panel.appendChild(controls);

        var listWrap = document.createElement("div");
        listWrap.style.maxHeight = "32vh";
        listWrap.style.overflow = "auto";

        var list = document.createElement("ul");
        list.style.listStyle = "none";
        list.style.margin = "0";
        list.style.padding = "0";

        listWrap.appendChild(list);
        panel.appendChild(listWrap);

        document.body.appendChild(panel);

        state.panel = panel;
        state.list = list;
        state.status = status;
        updateStatus();
        logRow("info", "Panel ready");
    }

    function getContext(data) {
        var context = data || {};
        if (context.workItemId == null) context.workItemId = safeCall(cfg.getWorkItemId);
        if (context.reference == null) context.reference = safeCall(cfg.getReference);
        return context;
    }

    function safeCall(fn) {
        try { return fn(); } catch (e) { return null; }
    }

    function toggleRequest() {
        var url = pathJoin(cfg.baseUrl, "/track/activity") +
            "?userEmail=" + encodeURIComponent(cfg.userEmail || "") +
            "&source=" + encodeURIComponent(cfg.source || "ShareDo") +
            "&key=" + encodeURIComponent(cfg.trackingKey || "");

        return fetch(url, {
            method: "GET",
            credentials: "include"
        }).then(function (r) {
            if (!r.ok) throw new Error("Toggle failed: " + r.status);
            return r.json();
        });
    }

    function postEvent(type, data) {
        return fetch(pathJoin(cfg.baseUrl, "/track/event"), {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: type,
                page: cfg.pageName,
                path: global.location ? global.location.pathname : "/",
                workItemId: data.workItemId,
                reference: data.reference,
                data: data
            }),
            keepalive: true
        }).then(function (r) {
            if (!r.ok && r.status !== 204) {
                throw new Error("Event failed: " + r.status);
            }
            return r;
        });
    }

    function setHeartbeat(enabled) {
        if (state.heartbeatTimer) {
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
        if (!enabled) return;

        state.heartbeatTimer = setInterval(function () {
            if (document.visibilityState !== "visible") return;
            api.track("heartbeat", { title: document.title, heartbeatMs: cfg.heartbeatMs });
        }, cfg.heartbeatMs);
    }

    function ensureEnabledState(desired) {
        return toggleRequest().then(function (res) {
            var isEnabled = !!res.enabled;
            if (isEnabled === desired) return res;
            return toggleRequest();
        });
    }

    var api = {
        configure: function (options) {
            var k = Object.keys(options || {});
            for (var i = 0; i < k.length; i++) cfg[k[i]] = options[k[i]];
            ensurePanel();
            return api;
        },
        start: function () {
            ensurePanel();
            if (!cfg.userEmail) {
                logRow("error", "Missing userEmail in config");
                return Promise.reject(new Error("Missing userEmail"));
            }
            return ensureEnabledState(true).then(function (res) {
                state.enabled = !!res.enabled;
                updateStatus();
                setHeartbeat(state.enabled);
                logRow("info", "Tracking started");
                return api.track("page-view", getContext({ title: document.title }));
            }).catch(function (err) {
                logRow("error", err.message || String(err));
                throw err;
            });
        },
        stop: function () {
            ensurePanel();
            return ensureEnabledState(false).then(function (res) {
                state.enabled = !!res.enabled;
                updateStatus();
                setHeartbeat(false);
                logRow("info", "Tracking stopped");
                return res;
            }).catch(function (err) {
                logRow("error", err.message || String(err));
                throw err;
            });
        },
        toggle: function () {
            ensurePanel();
            return toggleRequest().then(function (res) {
                state.enabled = !!res.enabled;
                updateStatus();
                setHeartbeat(state.enabled);
                logRow("info", state.enabled ? "Tracking toggled ON" : "Tracking toggled OFF");
                return res;
            }).catch(function (err) {
                logRow("error", err.message || String(err));
                throw err;
            });
        },
        track: function (type, data) {
            ensurePanel();
            var ctx = getContext(data);
            return postEvent(type || "event", ctx).then(function () {
                logRow("info", "Event: " + (type || "event"));
            }).catch(function (err) {
                logRow("error", err.message || String(err));
                throw err;
            });
        }
    };

    global.ShareDoToolsActivity = api;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensurePanel);
    } else {
        ensurePanel();
    }
})(window);
