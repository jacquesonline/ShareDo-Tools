"use strict";

/**
 * Standalone activity client for a calling application.
 * No require/import of local project files.
 */
function createShareDoActivityClient(config) {
    var cfg = Object.assign({
        baseUrl: "http://localhost:3000",
        source: "ShareDo",
        trackingKey: "",
        userEmail: "",
        userId: null,
        userName: null,
        workItemId: null,
        reference: null,
        maxEvents: 10,
        logCheckLimit: 200
    }, config || {});

    var state = {
        callCount: 0
    };

    function join(base, p) {
        return String(base || "").replace(/\/$/, "") + p;
    }

    function buildToggleUrl() {
        var q = new URLSearchParams();
        q.set("source", cfg.source || "ShareDo");
        if (cfg.userEmail) q.set("userEmail", cfg.userEmail);
        if (cfg.userId) q.set("userId", cfg.userId);
        if (cfg.userName) q.set("userName", cfg.userName);
        if (cfg.workItemId) q.set("workItemId", cfg.workItemId);
        if (cfg.reference) q.set("reference", cfg.reference);
        if (cfg.trackingKey) q.set("key", cfg.trackingKey);
        return join(cfg.baseUrl, "/track/activity?") + q.toString();
    }

    async function toggle() {
        var r = await fetch(buildToggleUrl(), { method: "GET" });
        if (!r.ok) throw new Error("toggle failed: " + r.status);
        return r.json();
    }

    async function ensureEnabled(desired) {
        var first = await toggle();
        if (!!first.enabled === !!desired) return first;
        return toggle();
    }

    function buildLogUrl() {
        var limit = parseInt(cfg.logCheckLimit, 10);
        if (isNaN(limit) || limit < 1) limit = 200;
        return join(cfg.baseUrl, "/api/activity/log?limit=") + encodeURIComponent(String(limit));
    }

    function latestRecordingState(items) {
        var rows = Array.isArray(items) ? items : [];
        for (var i = 0; i < rows.length; i++) {
            var a = rows[i] && rows[i].action ? String(rows[i].action) : "";
            if (a === "tracking-started") return { active: true, action: a };
            if (a === "tracking-stopped" || a === "tracking-stopped-limit") return { active: false, action: a };
        }
        return { active: false, action: null };
    }

    async function isRecordingActive() {
        var r = await fetch(buildLogUrl(), { method: "GET" });
        if (!r.ok) throw new Error("log check failed: " + r.status);
        var json = await r.json();
        return latestRecordingState(json && json.items ? json.items : []);
    }

    function payload(type, data) {
        var input = data || {};
        return {
            type: type || "event",
            page: input.page || null,
            path: input.path || null,
            userEmail: input.userEmail || cfg.userEmail || null,
            userId: input.userId || cfg.userId || null,
            userName: input.userName || cfg.userName || null,
            workItemId: input.workItemId || cfg.workItemId || null,
            reference: input.reference || cfg.reference || null,
            data: input.data != null ? input.data : input
        };
    }

    async function postEvent(type, data) {
        var r = await fetch(join(cfg.baseUrl, "/track/event"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload(type, data))
        });
        if (!r.ok && r.status !== 204) throw new Error("event failed: " + r.status);
    }

    return {
        async start() {
            if (!cfg.userEmail) throw new Error("userEmail is required");
            state.callCount = 0;
            return ensureEnabled(true);
        },

        async event(type, data) {
            var rec = await isRecordingActive();
            if (!rec.active) {
                return { ok: false, skipped: true, reason: "recording-not-started" };
            }

            var max = parseInt(cfg.maxEvents, 10);
            if (!isNaN(max) && max > 0 && state.callCount >= max) {
                await ensureEnabled(false);
                return {
                    ok: false,
                    skipped: true,
                    reason: "max-events-reached",
                    callCount: state.callCount,
                    maxEvents: max
                };
            }

            await postEvent(type, data);
            state.callCount += 1;

            if (!isNaN(max) && max > 0 && state.callCount >= max) {
                await ensureEnabled(false);
                return {
                    ok: true,
                    stopped: true,
                    reason: "max-events-reached",
                    callCount: state.callCount,
                    maxEvents: max
                };
            }

            return { ok: true, callCount: state.callCount, maxEvents: max };
        },

        async stop() {
            state.callCount = 0;
            return ensureEnabled(false);
        },

        async status() {
            var rec = await isRecordingActive();
            return {
                recordingActive: rec.active,
                lastAction: rec.action,
                callCount: state.callCount,
                maxEvents: cfg.maxEvents
            };
        }
    };
}

/*
Example usage:

const activity = createShareDoActivityClient({
    baseUrl: "http://localhost:3000",
    source: "ShareDo",
    trackingKey: "performance",
    userEmail: "jsteenkamp@mbdts.com.au",
    maxEvents: 10
});

await activity.start();
await activity.event("heartbeat", {
    page: "vnext",
    path: "/work-items/123",
    data: { action: "open" }
});
await activity.stop();
*/
