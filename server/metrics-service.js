/**
 * Metrics Recording -- JSONL file management, deduplication, pruning
 *
 * Extracted from server.js. Owns all metric file I/O.
 *
 * Exports:
 *   init(deps)                          -- wire up dependencies
 *   ensureDir(envName)                  -- ensure metrics directory exists
 *   filePath(envName, metric)           -- return path to a metric JSONL file
 *   migrate()                           -- migrate flat files to env-based layout
 *   append(envName, metric, data)       -- append a metric entry (with dedup + prune)
 *   recordStreamStats(envName, stats)   -- normalise and append streamstats
 *   recordNodeStatus(envName, status)   -- normalise and append nodestatus
 *   getStatus()                         -- return file listing for /api/metrics/status
 *   readMetric(envName, metric, query)  -- read + filter entries for /api/metrics/:env/:metric
 *   isEnabled()                         -- whether metrics recording is active
 *   getCapMB()                          -- configured cap in MB
 */
"use strict";

var _deps = null;

// ─── Constants ───
var _metricsDir = null;   // set by init
var _maxBytes = null;     // set by init

// ─── Deduplication state ───
var _lastWrite = {};  // "metric-env" -> timestamp


// ═══════════════════════════════════════════════════════════════════
// Initialisation
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {Object} deps
 * @param {Function} deps.log              - (category, message)
 * @param {Function} deps.isEnabled        - () -> boolean
 * @param {Function} deps.getInterval      - () -> number (seconds between writes)
 * @param {Object}   deps.fs               - Node fs module
 * @param {Object}   deps.path             - Node path module
 * @param {string}   deps.baseDir          - __dirname of server.js
 * @param {number}   [deps.maxMB]          - cap per file in MB (default: 50)
 */
function init(deps) {
    _deps = deps;
    _metricsDir = deps.path.join(deps.baseDir, "cache", "metrics");
    _maxBytes = (deps.maxMB || 50) * 1024 * 1024;
}


// ═══════════════════════════════════════════════════════════════════
// File helpers
// ═══════════════════════════════════════════════════════════════════

function ensureDir(envName) {
    var dir = envName ? _deps.path.join(_metricsDir, envName) : _metricsDir;
    if (!_deps.fs.existsSync(dir)) _deps.fs.mkdirSync(dir, { recursive: true });
}

function filePath(envName, metric) {
    return _deps.path.join(_metricsDir, envName, metric + ".jsonl");
}


// ═══════════════════════════════════════════════════════════════════
// Migration (flat -> env-based layout)
// ═══════════════════════════════════════════════════════════════════

function migrate() {
    if (!_deps.fs.existsSync(_metricsDir)) return;
    try {
        var files = _deps.fs.readdirSync(_metricsDir).filter(function (f) { return f.endsWith(".jsonl"); });
        if (files.length === 0) return;
        var migrated = 0;
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var fullPath = _deps.path.join(_metricsDir, f);
            var stat = _deps.fs.statSync(fullPath);
            if (!stat.isFile()) continue;

            var base = f.replace(".jsonl", "");
            var lastDash = base.lastIndexOf("-");
            if (lastDash < 1) continue;

            var metric = base.substring(0, lastDash);
            var env = base.substring(lastDash + 1);

            if (!env || env.length > 30 || !/^[a-zA-Z0-9_-]+$/.test(env)) continue;

            var newDir = _deps.path.join(_metricsDir, env);
            if (!_deps.fs.existsSync(newDir)) _deps.fs.mkdirSync(newDir, { recursive: true });
            var newPath = _deps.path.join(newDir, metric + ".jsonl");

            if (_deps.fs.existsSync(newPath)) {
                var oldContent = _deps.fs.readFileSync(fullPath, "utf8");
                _deps.fs.appendFileSync(newPath, oldContent);
            } else {
                _deps.fs.renameSync(fullPath, newPath);
            }
            if (_deps.fs.existsSync(fullPath) && _deps.fs.existsSync(newPath) && fullPath !== newPath) {
                _deps.fs.unlinkSync(fullPath);
            }
            migrated++;
        }
        if (migrated > 0) _deps.log("metrics", "Migrated " + migrated + " metric files to env-based layout");
    } catch (e) { _deps.log("metrics", "Migration failed: " + e.message); }
}


// ═══════════════════════════════════════════════════════════════════
// Write / Prune
// ═══════════════════════════════════════════════════════════════════

function append(envName, metric, data) {
    if (!_deps.isEnabled()) return;

    var dedupeKey = metric + "-" + envName;
    var now = Date.now();
    var intervalMs = _deps.getInterval() * 1000;
    if (_lastWrite[dedupeKey] && (now - _lastWrite[dedupeKey]) < intervalMs) {
        _deps.log("metrics", "Skipped " + metric + " for " + envName + " (dedup " + _deps.getInterval() + "s)");
        return;
    }

    try {
        ensureDir(envName);
        var fp = filePath(envName, metric);
        var line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), env: envName }, data)) + "\n";

        if (_deps.fs.existsSync(fp)) {
            var stat = _deps.fs.statSync(fp);
            if (stat.size + line.length > _maxBytes) {
                pruneFile(fp);
            }
        }

        _deps.fs.appendFileSync(fp, line);
        _lastWrite[dedupeKey] = now;
        _deps.log("metrics", "Recorded " + metric + " for " + envName);
    } catch (err) {
        _deps.log("metrics", "Write failed for " + metric + "-" + envName + ": " + err.message);
    }
}

function pruneFile(fp) {
    try {
        var content = _deps.fs.readFileSync(fp, "utf8");
        var lines = content.split("\n").filter(Boolean);
        var dropCount = Math.max(1, Math.floor(lines.length * 0.2));
        var remaining = lines.slice(dropCount);
        _deps.fs.writeFileSync(fp, remaining.join("\n") + "\n");
        _deps.log("metrics", "Pruned " + dropCount + " entries from " + _deps.path.basename(fp));
    } catch (err) {
        _deps.log("metrics", "Prune failed: " + err.message);
    }
}


// ═══════════════════════════════════════════════════════════════════
// Structured recorders (stream stats, node status)
// ═══════════════════════════════════════════════════════════════════

function recordStreamStats(envName, streamStats) {
    if (!streamStats || streamStats.error || !Array.isArray(streamStats)) return;
    var streams = {};
    for (var i = 0; i < streamStats.length; i++) {
        var s = streamStats[i];
        var name = s.groupName || s.streamName || "";
        if (name) {
            streams[name] = { backlog: s.backlog || 0, connections: s.connectionCount || s.connections || 0 };
        }
    }
    append(envName, "streamstats", { streams: streams });
}

function recordNodeStatus(envName, nodeStatus) {
    var nodeArr = [];
    if (nodeStatus && !nodeStatus.error) {
        nodeArr = Array.isArray(nodeStatus) ? nodeStatus : (nodeStatus.nodes && Array.isArray(nodeStatus.nodes) ? nodeStatus.nodes : []);
    }
    if (!nodeArr.length) return;
    var nodes = {};
    for (var i = 0; i < nodeArr.length; i++) {
        var nd = nodeArr[i];
        var nm = nd.systemName || nd.name || "";
        if (nm) {
            nodes[nm] = { running: nd.running || 0, stopped: nd.stopped || 0, restarting: nd.restarting || 0 };
        }
    }
    append(envName, "nodestatus", { nodes: nodes });
}


// ═══════════════════════════════════════════════════════════════════
// Read / Query (for API routes)
// ═══════════════════════════════════════════════════════════════════

function getStatus() {
    ensureDir();
    var result = { enabled: _deps.isEnabled(), capMB: Math.round(_maxBytes / 1024 / 1024), files: [] };
    try {
        var entries = _deps.fs.readdirSync(_metricsDir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry.isDirectory()) continue;
            var envName = entry.name;
            var envDir = _deps.path.join(_metricsDir, envName);
            var files = _deps.fs.readdirSync(envDir).filter(function (f) { return f.endsWith(".jsonl"); });
            for (var j = 0; j < files.length; j++) {
                var f = files[j];
                var stat = _deps.fs.statSync(_deps.path.join(envDir, f));
                var metric = f.replace(".jsonl", "");
                result.files.push({
                    filename: envName + "/" + f,
                    metric: metric,
                    env: envName,
                    sizeBytes: stat.size,
                    sizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
                    capPct: Math.round(stat.size / _maxBytes * 100)
                });
            }
        }
    } catch (err) {}
    return result;
}

function readMetric(envName, metric, query) {
    var fp = filePath(envName, metric);
    if (!_deps.fs.existsSync(fp)) return { entries: [], count: 0 };

    var content = _deps.fs.readFileSync(fp, "utf8");
    var lines = content.split("\n").filter(Boolean);

    var after = query && query.after ? new Date(query.after).getTime() : null;
    var before = query && query.before ? new Date(query.before).getTime() : null;

    var entries = [];
    for (var i = 0; i < lines.length; i++) {
        try {
            var entry = JSON.parse(lines[i]);
            if (after || before) {
                var t = new Date(entry.ts).getTime();
                if (after && t < after) continue;
                if (before && t > before) continue;
            }
            entries.push(entry);
        } catch (e) {}
    }

    return { entries: entries, count: entries.length };
}


// ═══════════════════════════════════════════════════════════════════
// Convenience accessors
// ═══════════════════════════════════════════════════════════════════

function isEnabled() { return _deps.isEnabled(); }
function getCapMB() { return Math.round(_maxBytes / 1024 / 1024); }


// ═══════════════════════════════════════════════════════════════════
// Module exports
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    init: init,
    ensureDir: ensureDir,
    filePath: filePath,
    migrate: migrate,
    append: append,
    recordStreamStats: recordStreamStats,
    recordNodeStatus: recordNodeStatus,
    getStatus: getStatus,
    readMetric: readMetric,
    isEnabled: isEnabled,
    getCapMB: getCapMB
};