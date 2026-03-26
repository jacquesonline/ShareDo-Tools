"use strict";

/**
 * Headless ShareDo activity tracker (no UI, no DOM).
 *
 * Usage (Node/CommonJS):
 * const createTracker = require("./integrations/sharedo-activity-headless");
 * const tracker = createTracker({ baseUrl, userEmail, trackingKey, source });
 * await tracker.start();
 * await tracker.event("heartbeat", { path: "/work-items/123" });
 * await tracker.stop();
 */
function createTracker(options) {
    var cfg = Object.assign({
        baseUrl: "http://localhost:3000",
        source: "ShareDo",
        trackingKey: "",
        userEmail: "",
        userId: null,
        userName: null,
        workItemId: null,
        reference: null,
        maxEvents: null,
        logCheckLimit: 200
    }, options || {});

    var state = {
        started: false,
        callCount: 0
    };

    function pathJoin(base, p) {
        return String(base || "").replace(/\/$/, "") + p;
    }

    function buildToggleUrl() {
        var params = new URLSearchParams();
        params.set("source", cfg.source || "ShareDo");
        if (cfg.userEmail) params.set("userEmail", cfg.userEmail);
        if (cfg.userId) params.set("userId", cfg.userId);
        if (cfg.userName) params.set("userName", cfg.userName);
        if (cfg.workItemId) params.set("workItemId", cfg.workItemId);
        if (cfg.reference) params.set("reference", cfg.reference);
        if (cfg.trackingKey) params.set("key", cfg.trackingKey);
        return pathJoin(cfg.baseUrl, "/track/activity?") + params.toString();
    }

    function buildActivityLogUrl(limit) {
        var l = parseInt(limit, 10);
        if (isNaN(l) || l < 1) l = 200;
        return pathJoin(cfg.baseUrl, "/api/activity/log?limit=") + encodeURIComponent(String(l));
    }

    async function toggle() {
        var response = await fetch(buildToggleUrl(), { method: "GET" });
        if (!response.ok) {
            throw new Error("Tracking toggle failed: " + response.status);
        }
        return response.json();
    }

    async function ensureEnabled(desiredEnabled) {
        var first = await toggle();
        if (!!first.enabled === !!desiredEnabled) return first;
        return toggle();
    }

    function parseLatestTrackingState(items) {
        var rows = Array.isArray(items) ? items : [];
        for (var i = 0; i < rows.length; i++) {
            var action = rows[i] && rows[i].action ? String(rows[i].action) : "";
            if (action === "tracking-started") {
                return { active: true, action: action, row: rows[i] };
            }
            if (action === "tracking-stopped" || action === "tracking-stopped-limit") {
                return { active: false, action: action, row: rows[i] };
            }
        }
        return { active: false, action: null, row: null };
    }

    async function getRecordingState() {
        var response = await fetch(buildActivityLogUrl(cfg.logCheckLimit), { method: "GET" });
        if (!response.ok) {
            throw new Error("Activity log check failed: " + response.status);
        }
        var json = await response.json();
        return parseLatestTrackingState(json && json.items ? json.items : []);
    }

    async function stopIfActive() {
        var status = await getRecordingState();
        if (!status.active) {
            state.started = false;
            return { success: true, enabled: false, skipped: true };
        }
        var result = await ensureEnabled(false);
        state.started = false;
        return result;
    }

    function hasReachedLimit() {
        var max = parseInt(cfg.maxEvents, 10);
        if (isNaN(max) || max < 1) return false;
        return state.callCount >= max;
    }

    function makeEventPayload(type, data) {
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

    return {
        async start() {
            if (!cfg.userEmail) {
                throw new Error("userEmail is required");
            }
            var result = await ensureEnabled(true);
            state.started = !!result.enabled;
            state.callCount = 0;
            return {
                success: true,
                enabled: !!result.enabled,
                callCount: state.callCount,
                maxEvents: cfg.maxEvents
            };
        },

        async event(type, data) {
            var recording = await getRecordingState();
            if (!recording.active) {
                state.started = false;
                return {
                    ok: false,
                    skipped: true,
                    reason: "recording-not-started"
                };
            }

            if (hasReachedLimit()) {
                await stopIfActive();
                return {
                    ok: false,
                    skipped: true,
                    reason: "max-events-reached",
                    callCount: state.callCount,
                    maxEvents: cfg.maxEvents
                };
            }

            var response = await fetch(pathJoin(cfg.baseUrl, "/track/event"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(makeEventPayload(type, data))
            });

            if (!response.ok && response.status !== 204) {
                throw new Error("Activity event failed: " + response.status);
            }

            state.callCount += 1;
            state.started = true;

            if (hasReachedLimit()) {
                await stopIfActive();
                return {
                    ok: true,
                    stopped: true,
                    reason: "max-events-reached",
                    callCount: state.callCount,
                    maxEvents: cfg.maxEvents
                };
            }

            return {
                ok: true,
                callCount: state.callCount,
                maxEvents: cfg.maxEvents
            };
        },

        async stop() {
            var result = await stopIfActive();
            state.callCount = 0;
            return result;
        },

        async status() {
            var recording = await getRecordingState();
            return {
                recordingActive: recording.active,
                lastAction: recording.action,
                callCount: state.callCount,
                maxEvents: cfg.maxEvents
            };
        }
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = createTracker;
}
