/**
 * WAILA - Workflow Analyser In Lieu of Admin
 *
 * Extracted from server.js. Owns the WAILA workflow index, cache, search, and diff.
 *
 * Exports:
 *   init(deps)                -- wire up dependencies
 *   getState(envName)         -- return index state for an environment
 *   loadCaches()              -- load cached indexes from disk on startup
 *   buildIndex(envName)       -- async: build the workflow index
 *   search(envName, query)    -- search the index
 *   getWorkflow(envName, sn)  -- get single workflow from index
 *   fetchPreview(envName, sn) -- fetch script preview on demand
 *   diff(envA, envB)          -- diff two environment indexes
 *   getFetchDelay()           -- current fetch delay
 *   setFetchDelay(ms)         -- update fetch delay
 */
"use strict";

var _deps = null;
var _index = {};  // envName -> { status, workflows[], builtAt, error, progress }
var _cacheDir = null;
var _fetchDelay = 100;

function init(deps) {
    _deps = deps;
    _cacheDir = deps.path.join(deps.baseDir, "cache", "waila-indexes");
    _fetchDelay = parseInt(deps.initialFetchDelay, 10) || 100;
}

function getState(envName) {
    if (!_index[envName]) {
        _index[envName] = { status: "empty", workflows: [], builtAt: null, error: null, progress: null };
    }
    return _index[envName];
}

function getFetchDelay() { return _fetchDelay; }
function setFetchDelay(ms) { _fetchDelay = ms; }

// ── Cache persistence ──
function cachePath(envName) { return _deps.path.join(_cacheDir, "waila-" + envName + ".json"); }

function saveCache(envName) {
    var state = _index[envName];
    if (!state || state.status !== "ready" || !state.workflows.length) return;
    try {
        if (!_deps.fs.existsSync(_cacheDir)) _deps.fs.mkdirSync(_cacheDir, { recursive: true });
        var payload = { builtAt: state.builtAt, count: state.workflows.length, workflows: state.workflows };
        _deps.fs.writeFileSync(cachePath(envName), JSON.stringify(payload));
        _deps.log("waila", "Cache saved for " + envName + " (" + state.workflows.length + " workflows)");
    } catch (err) { _deps.log("waila", "Cache save failed for " + envName + ": " + err.message); }
}

function loadCaches() {
    if (!_deps.fs.existsSync(_cacheDir)) return;
    var files = _deps.fs.readdirSync(_cacheDir).filter(function (f) { return f.startsWith("waila-") && f.endsWith(".json"); });
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var envName = file.replace(/^waila-/, "").replace(/\.json$/, "");
        if (!_deps.environments[envName]) continue;
        try {
            var raw = _deps.fs.readFileSync(_deps.path.join(_cacheDir, file), "utf8");
            var data = JSON.parse(raw);
            if (data.workflows && Array.isArray(data.workflows) && data.builtAt) {
                _index[envName] = { status: "ready", workflows: data.workflows, builtAt: data.builtAt, error: null, progress: null };
                _deps.log("waila", "Cache loaded for " + envName + ": " + data.workflows.length + " workflows (built " + data.builtAt + ")");
            }
        } catch (err) { _deps.log("waila", "Cache load failed for " + envName + ": " + err.message); }
    }
}

// ── Index build ──
async function buildIndex(envName) {
    var env = _deps.environments[envName];
    if (!env) return { status: "error", message: "Unknown environment" };
    if (env.isMock) return { status: "error", message: "Index build is not available for Test Env" };

    var state = getState(envName);
    if (state.status === "building") return { status: "building", message: "Build already in progress", progress: state.progress };

    state.status = "building";
    state.error = null;
    state.progress = { phase: "listing", fetched: 0, total: 0, current: "" };

    // Run async
    (async function () {
        try {
            var host = env.apiHost;
            var token = await _deps.auth.getToken(envName);
            var adminCookie = _deps.auth.cookieCache[envName] || null;

            _deps.log("waila", "Building index for " + envName + "...");
            var listUrl = "/api/listview/core-admin-plan-list/500/1/noSort/asc/?view=table&withCounts=1";
            var listBody = { additionalParameters: {}, filters: [{ fieldId: "planType", filterId: "clv-filter-lov", config: "{}", parameters: JSON.stringify({ selectedValues: ["visualWorkflow"] }) }] };
            var listResult = await _deps.auth.tryAuth(host, "POST", listUrl, listBody, token, adminCookie);
            if (!listResult || listResult.error) { state.status = "error"; state.error = "Failed to fetch workflow list: " + (listResult && listResult.message ? listResult.message : "Unknown error"); _deps.log("waila", state.error); return; }

            var rows = listResult.rows || [];
            var systemNames = [];
            for (var ri = 0; ri < rows.length; ri++) { var sn = rows[ri].data && rows[ri].data.systemName; if (sn) systemNames.push(sn); }

            var totalCount = listResult.resultCount || rows.length;
            if (totalCount > 500) {
                var pages = Math.ceil(totalCount / 500);
                for (var page = 2; page <= pages; page++) {
                    var pageUrl = "/api/listview/core-admin-plan-list/500/" + page + "/noSort/asc/?view=table&withCounts=1";
                    var pageResult = await _deps.auth.tryAuth(host, "POST", pageUrl, listBody, token, adminCookie);
                    if (pageResult && !pageResult.error && pageResult.rows) { for (var pi = 0; pi < pageResult.rows.length; pi++) { var psn = pageResult.rows[pi].data && pageResult.rows[pi].data.systemName; if (psn) systemNames.push(psn); } }
                }
            }

            _deps.log("waila", "Found " + systemNames.length + " visual workflows");
            state.progress = { phase: "fetching", fetched: 0, total: systemNames.length, current: "" };

            var workflows = [];
            for (var i = 0; i < systemNames.length; i++) {
                if (_deps.getCurrentEnv() !== envName) { state.status = "error"; state.error = "Environment changed during build"; _deps.log("waila", "Build aborted: env changed"); return; }

                var wfSn = systemNames[i];
                state.progress = { phase: "fetching", fetched: i, total: systemNames.length, current: wfSn };
                var planUrl = "/api/executionengine/visualmodeller/plans/" + encodeURIComponent(wfSn);
                var plan = await _deps.auth.tryAuth(host, "GET", planUrl, null, token, adminCookie);

                if (plan && !plan.error) {
                    var entry = {
                        systemName: plan.systemName || wfSn, name: plan.name || wfSn, description: plan.description || "",
                        variables: (plan.variables || []).map(function (v) { return { systemName: v.systemName, name: v.name, type: v.type, defaultValue: v.defaultValue, isInputVariable: v.isInputVariable }; }),
                        steps: (plan.steps || []).map(function (step) {
                            return { systemName: step.systemName, name: step.name, isStart: step.isStart, isEnd: step.isEnd,
                                actions: (step.actions || []).map(function (action) {
                                    return { actionSystemName: action.actionSystemName, name: action.name, configJson: safeStringify(action.config), config: action.config, connectionTargets: Object.values(action.connections || {}).map(function (c) { return c.step; }).filter(Boolean) };
                                })
                            };
                        }),
                        stepCount: (plan.steps || []).length,
                        actionCount: (plan.steps || []).reduce(function (sum, s) { return sum + (s.actions || []).length; }, 0),
                        _searchBlob: "", _searchBlobOriginal: ""
                    };
                    var parts = [entry.systemName, entry.name, entry.description];
                    for (var vi = 0; vi < entry.variables.length; vi++) { var v = entry.variables[vi]; parts.push(v.systemName, v.name, v.type, v.defaultValue || ""); }
                    for (var si = 0; si < entry.steps.length; si++) { var step = entry.steps[si]; parts.push(step.systemName, step.name); for (var ai = 0; ai < step.actions.length; ai++) { var action = step.actions[ai]; parts.push(action.actionSystemName, action.name, action.configJson); } }
                    var blobOriginal = parts.join(" \n ");
                    entry._searchBlobOriginal = blobOriginal;
                    entry._searchBlob = blobOriginal.toLowerCase();
                    workflows.push(entry);
                } else { _deps.log("waila", "Failed to fetch plan: " + wfSn + (plan && plan.message ? " (" + plan.message + ")" : "")); }

                if (_fetchDelay > 0 && i < systemNames.length - 1) await new Promise(function (r) { setTimeout(r, _fetchDelay); });
            }

            state.workflows = workflows; state.builtAt = new Date().toISOString(); state.status = "ready"; state.progress = null;
            _deps.log("waila", "Index built: " + workflows.length + " workflows for " + envName);
            saveCache(envName);
        } catch (err) { state.status = "error"; state.error = err.message; state.progress = null; _deps.log("waila", "Build error: " + err.message); }
    })();

    return { status: "building", message: "Build started" };
}

function safeStringify(obj) { try { return JSON.stringify(obj); } catch (e) { return ""; } }

// ── Search ──
function search(envName, query) {
    var state = getState(envName);
    if (state.status !== "ready" || state.workflows.length === 0) return { results: [], total: 0, message: "Index not built. Click Build Index first." };

    var exact = !!query.exactMatch;
    var caseSens = exact && !!query.caseSensitive;
    function norm(s) { return caseSens ? (s || "").trim() : (s || "").trim().toLowerCase(); }
    function matchesField(haystack, needle) { if (!needle) return true; var h = caseSens ? haystack : haystack.toLowerCase(); return exact ? h === needle : h.includes(needle); }
    function matchesText(haystack, needle) { if (!needle) return true; var h = caseSens ? haystack : haystack.toLowerCase(); return h.includes(needle); }

    var unified = norm(query.unified || "");
    var sysName = norm(query.systemName || "");
    var stepName = norm(query.stepName || "");
    var blockType = norm(query.blockType || "");
    var blockName = norm(query.blockName || "");
    var configText = norm(query.configText || "");
    var variableText = norm(query.variableText || "");

    var hasFilter = unified || sysName || stepName || blockType || blockName || configText || variableText;
    if (!hasFilter) {
        var summaries = state.workflows.map(function (w) { return { systemName: w.systemName, name: w.name, description: w.description, stepCount: w.stepCount, actionCount: w.actionCount, matches: {} }; });
        return { results: summaries, total: summaries.length };
    }

    var results = [];
    var startMs = Date.now();

    for (var wi = 0; wi < state.workflows.length; wi++) {
        var wf = state.workflows[wi];
        var mtch = { steps: [], actions: [], variables: [], configExcerpts: [] };
        var matched = false;

        if (unified) {
            var blob = caseSens ? wf._searchBlobOriginal : wf._searchBlob;
            var blobHit = false;
            if (exact) { blobHit = blob.includes(unified); }
            else { var terms = unified.split(/\s+/).filter(Boolean); blobHit = terms.every(function (term) { return blob.includes(term); }); }
            if (!blobHit) continue;
            matched = true;
            var searchTerms = exact ? [unified] : unified.split(/\s+/).filter(Boolean);
            for (var sti = 0; sti < wf.steps.length; sti++) {
                var st = wf.steps[sti];
                var sNorm = caseSens ? st.name : st.name.toLowerCase();
                var ssNorm = caseSens ? st.systemName : st.systemName.toLowerCase();
                if (searchTerms.some(function (t) { return sNorm.includes(t) || ssNorm.includes(t); })) mtch.steps.push(st.name + " (" + st.systemName + ")");
                for (var ati = 0; ati < st.actions.length; ati++) {
                    var act = st.actions[ati];
                    var aSysNorm = caseSens ? act.actionSystemName : act.actionSystemName.toLowerCase();
                    var aNameNorm = caseSens ? act.name : act.name.toLowerCase();
                    if (searchTerms.some(function (t) { return aSysNorm.includes(t) || aNameNorm.includes(t); })) mtch.actions.push(st.name + " > " + act.name + " [" + act.actionSystemName + "]");
                    var cfgNorm = caseSens ? act.configJson : act.configJson.toLowerCase();
                    if (searchTerms.some(function (t) { return cfgNorm.includes(t); })) { var excerpt = extractConfigExcerpt(act.configJson, searchTerms[0], 80, caseSens); if (excerpt) mtch.configExcerpts.push(st.name + " > " + act.name + ": " + excerpt); }
                }
            }
            for (var vii = 0; vii < wf.variables.length; vii++) {
                var vr = wf.variables[vii];
                var vSys = caseSens ? vr.systemName : vr.systemName.toLowerCase();
                var vName = caseSens ? vr.name : vr.name.toLowerCase();
                var vType = caseSens ? (vr.type || "") : (vr.type || "").toLowerCase();
                if (searchTerms.some(function (t) { return vSys.includes(t) || vName.includes(t) || vType.includes(t); })) mtch.variables.push(vr.name + " (" + vr.systemName + ") : " + vr.type);
            }
        } else {
            if (sysName) { var wfSys = caseSens ? wf.systemName : wf.systemName.toLowerCase(); var wfName = caseSens ? wf.name : wf.name.toLowerCase(); if (!matchesField(wfSys, sysName) && !matchesField(wfName, sysName)) continue; }
            var stepOk = !stepName, blockTypeOk = !blockType, blockNameOk = !blockName, configOk = !configText, varOk = !variableText;
            for (var ssi = 0; ssi < wf.steps.length; ssi++) {
                var stp = wf.steps[ssi];
                var snNorm = caseSens ? stp.systemName : stp.systemName.toLowerCase();
                var snName = caseSens ? stp.name : stp.name.toLowerCase();
                if (stepName && (matchesField(snName, stepName) || matchesField(snNorm, stepName))) { stepOk = true; mtch.steps.push(stp.name + " (" + stp.systemName + ")"); }
                for (var aai = 0; aai < stp.actions.length; aai++) {
                    var ac = stp.actions[aai];
                    var actSys = caseSens ? ac.actionSystemName : ac.actionSystemName.toLowerCase();
                    var actName = caseSens ? ac.name : ac.name.toLowerCase();
                    if (blockType && matchesField(actSys, blockType)) { blockTypeOk = true; mtch.actions.push(stp.name + " > " + ac.name + " [" + ac.actionSystemName + "]"); }
                    if (blockName && matchesField(actName, blockName)) { blockNameOk = true; mtch.actions.push(stp.name + " > " + ac.name + " [" + ac.actionSystemName + "]"); }
                    if (configText) { var cfgN = caseSens ? ac.configJson : ac.configJson.toLowerCase(); if (matchesText(cfgN, configText)) { configOk = true; var exc = extractConfigExcerpt(ac.configJson, caseSens ? (query.configText || "").trim() : configText, 80, caseSens); if (exc) mtch.configExcerpts.push(stp.name + " > " + ac.name + ": " + exc); } }
                }
            }
            if (variableText) { for (var vvi = 0; vvi < wf.variables.length; vvi++) { var vv = wf.variables[vvi]; var vs = caseSens ? vv.systemName : vv.systemName.toLowerCase(); var vn = caseSens ? vv.name : vv.name.toLowerCase(); var vt = caseSens ? (vv.type || "") : (vv.type || "").toLowerCase(); if (matchesField(vs, variableText) || matchesField(vn, variableText) || matchesText(vt, variableText)) { varOk = true; mtch.variables.push(vv.name + " (" + vv.systemName + ") : " + vv.type); } } }
            if (!stepOk || !blockTypeOk || !blockNameOk || !configOk || !varOk) continue;
            matched = true;
        }

        if (matched) {
            mtch.steps = dedup(mtch.steps); mtch.actions = dedup(mtch.actions); mtch.variables = dedup(mtch.variables); mtch.configExcerpts = dedup(mtch.configExcerpts).slice(0, 10);
            results.push({ systemName: wf.systemName, name: wf.name, description: wf.description, stepCount: wf.stepCount, actionCount: wf.actionCount, matches: mtch });
        }
    }
    return { results: results, total: results.length, searchMs: Date.now() - startMs };
}

function dedup(arr) { var seen = {}; return arr.filter(function (v) { if (seen[v]) return false; seen[v] = true; return true; }); }

function extractConfigExcerpt(json, term, radius, caseSensitive) {
    var haystack = caseSensitive ? json : json.toLowerCase();
    var needle = caseSensitive ? term : term.toLowerCase();
    var idx = haystack.indexOf(needle);
    if (idx === -1) return null;
    var start = Math.max(0, idx - radius);
    var end = Math.min(json.length, idx + term.length + radius);
    var excerpt = json.substring(start, end);
    if (start > 0) excerpt = "..." + excerpt;
    if (end < json.length) excerpt = excerpt + "...";
    return excerpt;
}

function getWorkflow(envName, systemName) {
    var state = getState(envName);
    return state.workflows.find(function (w) { return w.systemName === systemName; }) || null;
}

async function fetchPreview(envName, systemName) {
    var env = _deps.environments[envName];
    if (!env) return { error: true, message: "Unknown environment" };
    var host = env.apiHost;
    var token = await _deps.auth.getToken(envName);
    var adminCookie = _deps.auth.cookieCache[envName] || null;
    var planUrl = "/api/executionengine/visualmodeller/plans/" + encodeURIComponent(systemName);
    var plan = await _deps.auth.tryAuth(host, "GET", planUrl, null, token, adminCookie);
    if (!plan || plan.error) return { error: true, message: "Failed to fetch plan for preview" };
    var previewUrl = "/api/executionengine/visualmodeller/plans/" + encodeURIComponent(systemName) + "/preview";
    var preview = await _deps.auth.tryAuth(host, "POST", previewUrl, plan, token, adminCookie);
    if (!preview || preview.error) return { error: true, message: "Failed to generate preview" };
    return { systemName: systemName, script: preview.script || "" };
}

function diff(envA, envB) {
    var stateA = getState(envA); var stateB = getState(envB);
    if (stateA.status !== "ready" || !stateA.workflows.length) return { error: true, message: "Index not built for " + (_deps.environments[envA] ? _deps.environments[envA].label : envA) };
    if (stateB.status !== "ready" || !stateB.workflows.length) return { error: true, message: "Index not built for " + (_deps.environments[envB] ? _deps.environments[envB].label : envB) + ". Switch to that environment and build the index first." };

    var mapA = {}; for (var ai = 0; ai < stateA.workflows.length; ai++) mapA[stateA.workflows[ai].systemName] = stateA.workflows[ai];
    var mapB = {}; for (var bi = 0; bi < stateB.workflows.length; bi++) mapB[stateB.workflows[bi].systemName] = stateB.workflows[bi];
    var allKeys = Object.keys(mapA).concat(Object.keys(mapB));
    var allNames = {}; for (var ki = 0; ki < allKeys.length; ki++) allNames[allKeys[ki]] = true;

    var onlyA = [], onlyB = [], changed = [], identicalCount = 0;
    for (var sn in allNames) {
        var a = mapA[sn], b = mapB[sn];
        if (a && !b) { onlyA.push({ systemName: a.systemName, name: a.name, stepCount: a.stepCount, actionCount: a.actionCount }); }
        else if (!a && b) { onlyB.push({ systemName: b.systemName, name: b.name, stepCount: b.stepCount, actionCount: b.actionCount }); }
        else {
            var diffs = [];
            if (a.stepCount !== b.stepCount) diffs.push({ field: "Steps", valueA: a.stepCount, valueB: b.stepCount });
            if (a.actionCount !== b.actionCount) diffs.push({ field: "Blocks", valueA: a.actionCount, valueB: b.actionCount });
            if (a.name !== b.name) diffs.push({ field: "Name", valueA: a.name, valueB: b.name });
            var stepsA = {}; for (var sai = 0; sai < a.steps.length; sai++) stepsA[a.steps[sai].systemName] = a.steps[sai];
            var stepsB = {}; for (var sbi = 0; sbi < b.steps.length; sbi++) stepsB[b.steps[sbi].systemName] = b.steps[sbi];
            var allStepKeys = Object.keys(stepsA).concat(Object.keys(stepsB));
            var allSteps = {}; for (var ski = 0; ski < allStepKeys.length; ski++) allSteps[allStepKeys[ski]] = true;
            var addedSteps = [], removedSteps = [], changedSteps = [];
            for (var ssn in allSteps) { var sa = stepsA[ssn], sb = stepsB[ssn]; if (sa && !sb) removedSteps.push(sa.name + " (" + sa.systemName + ")"); else if (!sa && sb) addedSteps.push(sb.name + " (" + sb.systemName + ")"); else { var stepDiffs = []; if (sa.name !== sb.name) stepDiffs.push("renamed: " + sa.name + " -> " + sb.name); if (sa.actions.length !== sb.actions.length) stepDiffs.push("blocks: " + sa.actions.length + " -> " + sb.actions.length); if (stepDiffs.length) changedSteps.push(sa.name + " (" + ssn + "): " + stepDiffs.join(", ")); } }
            var varsA = {}; for (var vai = 0; vai < a.variables.length; vai++) varsA[a.variables[vai].systemName] = a.variables[vai];
            var varsB = {}; for (var vbi = 0; vbi < b.variables.length; vbi++) varsB[b.variables[vbi].systemName] = b.variables[vbi];
            var allVarKeys = Object.keys(varsA).concat(Object.keys(varsB));
            var allVars = {}; for (var vki = 0; vki < allVarKeys.length; vki++) allVars[allVarKeys[vki]] = true;
            var addedVars = [], removedVars = [];
            for (var vsn in allVars) { if (varsA[vsn] && !varsB[vsn]) removedVars.push(varsA[vsn].name + " (" + vsn + ")"); else if (!varsA[vsn] && varsB[vsn]) addedVars.push(varsB[vsn].name + " (" + vsn + ")"); }
            var hasStepDiff = addedSteps.length || removedSteps.length || changedSteps.length;
            var hasVarDiff = addedVars.length || removedVars.length;
            if (diffs.length || hasStepDiff || hasVarDiff) { changed.push({ systemName: a.systemName, name: a.name, summary: diffs, steps: { added: addedSteps, removed: removedSteps, changed: changedSteps }, variables: { added: addedVars, removed: removedVars } }); }
            else { identicalCount++; }
        }
    }
    return {
        envA: { name: envA, label: _deps.environments[envA].label, count: stateA.workflows.length, builtAt: stateA.builtAt },
        envB: { name: envB, label: _deps.environments[envB].label, count: stateB.workflows.length, builtAt: stateB.builtAt },
        onlyA: onlyA, onlyB: onlyB, changed: changed, identicalCount: identicalCount
    };
}

module.exports = {
    init: init, getState: getState, loadCaches: loadCaches, buildIndex: buildIndex,
    search: search, getWorkflow: getWorkflow, fetchPreview: fetchPreview, diff: diff,
    getFetchDelay: getFetchDelay, setFetchDelay: setFetchDelay
};