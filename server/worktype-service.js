/**
 * Work Type Config Index -- build, search, cache for type configuration data
 *
 * Extracted from server.js. Owns the work type config index, cache, and search.
 *
 * Exports:
 *   init(deps)            -- wire up dependencies
 *   getState(envName)     -- return index state for an environment
 *   loadCaches()          -- load cached indexes from disk on startup
 *   buildIndex(envName)   -- async: build the type config index
 *   search(envName, body) -- search the index
 *   getFetchDelay()       -- current fetch delay
 *   setFetchDelay(ms)     -- update fetch delay
 */
"use strict";

var _deps = null;
var _index = {};  // envName -> { status, types[], builtAt, error, progress }
var _cacheDir = null;
var _fetchDelay = 100;

function init(deps) {
    _deps = deps;
    _cacheDir = deps.path.join(deps.baseDir, "cache", "worktype-indexes");
    _fetchDelay = parseInt(deps.initialFetchDelay, 10) || 100;
}

function getState(envName) {
    if (!_index[envName]) {
        _index[envName] = { status: "empty", types: [], builtAt: null, error: null, progress: null };
    }
    return _index[envName];
}

function getFetchDelay() { return _fetchDelay; }
function setFetchDelay(ms) { _fetchDelay = ms; }

// ── Cache persistence ──
function cachePath(envName) { return _deps.path.join(_cacheDir, "worktype-config-" + envName + ".json"); }

function saveCache(envName) {
    var state = _index[envName];
    if (!state || state.status !== "ready" || !state.types.length) return;
    try {
        if (!_deps.fs.existsSync(_cacheDir)) _deps.fs.mkdirSync(_cacheDir, { recursive: true });
        var payload = { builtAt: state.builtAt, count: state.types.length, types: state.types };
        _deps.fs.writeFileSync(cachePath(envName), JSON.stringify(payload));
        _deps.log("wtindex", "Cache saved for " + envName + " (" + state.types.length + " types)");
    } catch (err) { _deps.log("wtindex", "Cache save failed for " + envName + ": " + err.message); }
}

function loadCaches() {
    if (!_deps.fs.existsSync(_cacheDir)) return;
    var files = _deps.fs.readdirSync(_cacheDir).filter(function (f) { return f.startsWith("worktype-config-") && f.endsWith(".json"); });
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var envName = file.replace(/^worktype-config-/, "").replace(/\.json$/, "");
        if (!_deps.environments[envName]) continue;
        try {
            var raw = _deps.fs.readFileSync(_deps.path.join(_cacheDir, file), "utf8");
            var data = JSON.parse(raw);
            if (data.types && Array.isArray(data.types) && data.builtAt) {
                _index[envName] = { status: "ready", types: data.types, builtAt: data.builtAt, error: null, progress: null };
                _deps.log("wtindex", "Cache loaded for " + envName + ": " + data.types.length + " types (built " + data.builtAt + ")");
            }
        } catch (err) { _deps.log("wtindex", "Cache load failed for " + envName + ": " + err.message); }
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
    state.progress = { current: "Fetching type tree...", done: 0, total: 0 };

    (async function () {
        try {
            var host = env.apiHost;
            var token = await _deps.auth.getToken(envName);
            var adminCookie = _deps.auth.cookieCache[envName] || null;

            _deps.log("wtindex", "Building index for " + envName + "...");
            var treeResult = await _deps.auth.tryAuth(host, "GET", "/api/modeller/sharedoTypes", null, token, adminCookie);
            if (!treeResult || treeResult.error) { state.status = "error"; state.error = "Failed to fetch type tree: " + (treeResult && treeResult.message ? treeResult.message : "Unknown error"); _deps.log("wtindex", state.error); return; }

            var treeNodes = Array.isArray(treeResult) ? treeResult : (treeResult.children || treeResult.derivedTypes || []);
            var flatTypes = [];
            function walkTree(nodes) {
                if (!nodes) return;
                for (var ni = 0; ni < nodes.length; ni++) {
                    var n = nodes[ni];
                    flatTypes.push({ systemName: n.systemName || n.name, name: n.title || n.name || n.systemName, icon: n.icon || n.iconClass || "fa-cube", isAbstract: !!n.isAbstract, isCoreType: !!n.isCoreType, hasPortals: !!n.hasPortals, tileColour: n.tileColour || null });
                    walkTree(n.children || n.derivedTypes || []);
                }
            }
            walkTree(treeNodes);

            _deps.log("wtindex", "Found " + flatTypes.length + " types to index");
            state.progress = { current: "", done: 0, total: flatTypes.length };
            var formCache = {};

            var indexedTypes = [];
            for (var i = 0; i < flatTypes.length; i++) {
                var ft = flatTypes[i];
                var sn = ft.systemName;
                state.progress = { current: sn, done: i, total: flatTypes.length };

                var entry = { systemName: sn, name: ft.name, icon: ft.icon, isAbstract: ft.isAbstract, isCoreType: ft.isCoreType, hasPortals: ft.hasPortals, tileColour: ft.tileColour, aspects: [], keyDates: [], roles: [], errors: [], searchBlob: "" };

                // Aspects
                try {
                    var aspectUrl = "/api/admin/aspects/sharedoTypes/" + encodeURIComponent(sn);
                    var aspectData = await _deps.auth.tryAuth(host, "GET", aspectUrl, null, token, adminCookie);
                    if (aspectData && !aspectData.error) {
                        var rawAspects = aspectData.aspects || {};
                        for (var zoneKey in rawAspects) {
                            var normZone = zoneKey.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
                            var items = rawAspects[zoneKey] || [];
                            for (var ai = 0; ai < items.length; ai++) {
                                var asp = items[ai];
                                var formId = null, formTitle = null;
                                if (asp.aspectDefinitionSystemName === "FormBuilder" && asp.config) { try { var cfg = JSON.parse(asp.config); formId = cfg.formId || null; formTitle = cfg.title || null; } catch (e) {} }
                                var formSystemName = null;
                                if (formId) {
                                    if (formId in formCache) { formSystemName = formCache[formId]; }
                                    else { try { var formUrl = "/api/formbuilder/forms/" + encodeURIComponent(formId); var formData = await _deps.auth.tryAuth(host, "GET", formUrl, null, token, adminCookie); if (formData && !formData.error && formData.systemName) formSystemName = formData.systemName; formCache[formId] = formSystemName; } catch (e) { formCache[formId] = null; } }
                                }
                                entry.aspects.push({ zoneName: normZone, displayName: asp.displayName || asp.aspectDefinitionSystemName, aspectDefinitionSystemName: asp.aspectDefinitionSystemName, inherited: !!asp.inherited, inheritedFrom: asp.inheritedFrom || null, alwaysHide: !!asp.alwaysHide, hasRules: !!(asp.ruleSetSelection), ruleNames: (asp.ruleSetSelection && asp.ruleSetSelection.ruleSetSystemNames) || [], formId: formId, formTitle: formTitle, formSystemName: formSystemName });
                            }
                        }
                    } else { entry.errors.push("aspects: " + (aspectData && aspectData.message ? aspectData.message : "request failed")); }
                } catch (e) { entry.errors.push("aspects: " + e.message); }

                if (_fetchDelay > 0) await new Promise(function (r) { setTimeout(r, _fetchDelay); });

                // Key dates
                try {
                    var kdUrl = "/api/admin/keyDates/definitionForType/" + encodeURIComponent(sn);
                    var kdData = await _deps.auth.tryAuth(host, "GET", kdUrl, null, token, adminCookie);
                    if (kdData && !kdData.error) {
                        var defs = kdData.definitions || [];
                        for (var ki = 0; ki < defs.length; ki++) { var kd = defs[ki]; entry.keyDates.push({ keyDateType: kd.keyDateType || "", title: kd.keyDateTypeTitle || "", displayCategory: kd.displayCategory || "", isMandatory: !!kd.isMandatory, allowMultiple: !!kd.allowMultiple, dateOnly: !!kd.dateOnly, owningType: kd.owningType || "", owningTypeName: kd.owningTypeName || "" }); }
                    } else { entry.errors.push("keyDates: " + (kdData && kdData.message ? kdData.message : "request failed")); }
                } catch (e) { entry.errors.push("keyDates: " + e.message); }

                if (_fetchDelay > 0) await new Promise(function (r) { setTimeout(r, _fetchDelay); });

                // Roles
                try {
                    var rolesUrl = "/api/listview/core-modeller-sharedo-roles/100/1/name/asc/?view=table&withCounts=1&contextId=" + encodeURIComponent(sn);
                    var rolesPayload = { additionalParameters: {}, filters: [] };
                    var rolesData = await _deps.auth.tryAuth(host, "POST", rolesUrl, rolesPayload, token, adminCookie);
                    if (rolesData && !rolesData.error) {
                        var rrows = rolesData.rows || [];
                        for (var ri = 0; ri < rrows.length; ri++) { var d = rrows[ri].data || {}; var perms = (d.permissions || []).map(function (p) { return p.text || ""; }).filter(Boolean); entry.roles.push({ systemName: d.systemName || "", name: d.name || "", roleSource: d.roleSource || "", isActive: !!d.isActive, permissionCount: perms.length, permissions: perms }); }
                    } else { entry.errors.push("roles: " + (rolesData && rolesData.message ? rolesData.message : "request failed")); }
                } catch (e) { entry.errors.push("roles: " + e.message); }

                // Build search blob
                var blobParts = [sn, ft.name];
                for (var bai = 0; bai < entry.aspects.length; bai++) { var ba = entry.aspects[bai]; blobParts.push(ba.displayName, ba.aspectDefinitionSystemName); if (ba.formTitle) blobParts.push(ba.formTitle); if (ba.formId) blobParts.push(ba.formId); if (ba.formSystemName) blobParts.push(ba.formSystemName); for (var bri = 0; bri < ba.ruleNames.length; bri++) blobParts.push(ba.ruleNames[bri]); }
                for (var bki = 0; bki < entry.keyDates.length; bki++) { var bk = entry.keyDates[bki]; blobParts.push(bk.title, bk.keyDateType, bk.displayCategory); }
                for (var bli = 0; bli < entry.roles.length; bli++) { var bl = entry.roles[bli]; blobParts.push(bl.name, bl.systemName); for (var bpi = 0; bpi < bl.permissions.length; bpi++) blobParts.push(bl.permissions[bpi]); }
                entry.searchBlob = blobParts.join(" ").toLowerCase();
                indexedTypes.push(entry);

                if (_fetchDelay > 0 && i < flatTypes.length - 1) await new Promise(function (r) { setTimeout(r, _fetchDelay); });
            }

            state.types = indexedTypes; state.builtAt = new Date().toISOString(); state.status = "ready"; state.progress = null;
            _deps.log("wtindex", "Index built: " + indexedTypes.length + " types for " + envName);
            saveCache(envName);
        } catch (err) { state.status = "error"; state.error = err.message; state.progress = null; _deps.log("wtindex", "Build error: " + err.message); }
    })();

    return { status: "building", message: "Build started" };
}

// ── Search ──
function search(envName, body) {
    var state = getState(envName);
    if (state.status !== "ready" || state.types.length === 0) return { results: [], totalIndexed: 0, resultCount: 0, message: "Index not built. Click Build Index first." };

    var query = (body.query || "").trim().toLowerCase();
    var filters = body.filters || {};
    var excludeMode = !!body.excludeMode;
    var fAspectName = (filters.aspectName || "").trim().toLowerCase();
    var fFormTitle = (filters.formTitle || "").trim().toLowerCase();
    var fKeyDateName = (filters.keyDateName || "").trim().toLowerCase();
    var fRoleName = (filters.roleName || "").trim().toLowerCase();
    var hasFilter = query || fAspectName || fFormTitle || fKeyDateName || fRoleName;

    if (!hasFilter) {
        if (excludeMode) return { results: [], totalIndexed: state.types.length, resultCount: 0, searchTime: "0ms" };
        var all = state.types.map(function (t) { return { systemName: t.systemName, name: t.name, icon: t.icon, isAbstract: t.isAbstract, isCoreType: t.isCoreType, tileColour: t.tileColour, matches: { aspects: [], forms: [], keyDates: [], roles: [] } }; });
        return { results: all, totalIndexed: state.types.length, resultCount: all.length, searchTime: "0ms" };
    }

    var startMs = Date.now();
    var results = [];

    for (var ti = 0; ti < state.types.length; ti++) {
        var t = state.types[ti];
        var matched = true;
        var mtch = { aspects: [], forms: [], keyDates: [], roles: [] };

        if (query) {
            var terms = query.split(/\s+/).filter(Boolean);
            var blobHit = terms.every(function (term) { return t.searchBlob.includes(term); });
            if (!blobHit) { matched = false; }
            else {
                for (var ai = 0; ai < t.aspects.length; ai++) { var a = t.aspects[ai]; if (terms.some(function (term) { return a.displayName.toLowerCase().includes(term) || a.aspectDefinitionSystemName.toLowerCase().includes(term); })) mtch.aspects.push(a.displayName + " (" + a.zoneName + ") [" + a.aspectDefinitionSystemName + "]"); if (a.formTitle && terms.some(function (term) { return a.formTitle.toLowerCase().includes(term); })) mtch.forms.push(a.formTitle + (a.formSystemName ? " [" + a.formSystemName + "]" : "")); if (a.formSystemName && terms.some(function (term) { return a.formSystemName.toLowerCase().includes(term); })) { if (!mtch.forms.some(function (f) { return f.includes(a.formSystemName); })) mtch.forms.push((a.formTitle || a.formId) + " [" + a.formSystemName + "]"); } if (a.formId && terms.some(function (term) { return a.formId.toLowerCase().includes(term); })) { if (!mtch.forms.some(function (f) { return f.includes(a.formId); })) mtch.forms.push((a.formTitle || "Form") + " [" + a.formId + "]"); } }
                for (var ki = 0; ki < t.keyDates.length; ki++) { var kd = t.keyDates[ki]; if (terms.some(function (term) { return kd.title.toLowerCase().includes(term) || kd.keyDateType.toLowerCase().includes(term) || kd.displayCategory.toLowerCase().includes(term); })) mtch.keyDates.push(kd.title + " [" + kd.keyDateType + "]"); }
                for (var ri = 0; ri < t.roles.length; ri++) { var rl = t.roles[ri]; if (terms.some(function (term) { return rl.name.toLowerCase().includes(term) || rl.systemName.toLowerCase().includes(term) || rl.permissions.some(function (p) { return p.toLowerCase().includes(term); }); })) mtch.roles.push(rl.name + " [" + rl.systemName + "]"); }
            }
        }
        if (matched && fAspectName) { var hitA = t.aspects.find(function (a) { return a.displayName.toLowerCase().includes(fAspectName) || a.aspectDefinitionSystemName.toLowerCase().includes(fAspectName); }); if (!hitA) matched = false; else mtch.aspects.push(hitA.displayName + " (" + hitA.zoneName + ") [" + hitA.aspectDefinitionSystemName + "]"); }
        if (matched && fFormTitle) { var hitF = t.aspects.find(function (a) { return (a.formTitle && a.formTitle.toLowerCase().includes(fFormTitle)) || (a.formId && a.formId.toLowerCase().includes(fFormTitle)) || (a.formSystemName && a.formSystemName.toLowerCase().includes(fFormTitle)); }); if (!hitF) matched = false; else mtch.forms.push((hitF.formTitle || "Form") + (hitF.formSystemName ? " [" + hitF.formSystemName + "]" : "") + (hitF.formId ? " (" + hitF.formId.substring(0, 8) + "...)" : "")); }
        if (matched && fKeyDateName) { var hitK = t.keyDates.find(function (kd) { return kd.title.toLowerCase().includes(fKeyDateName) || kd.keyDateType.toLowerCase().includes(fKeyDateName); }); if (!hitK) matched = false; else mtch.keyDates.push(hitK.title + " [" + hitK.keyDateType + "]"); }
        if (matched && fRoleName) { var hitR = t.roles.find(function (rl) { return rl.name.toLowerCase().includes(fRoleName) || rl.systemName.toLowerCase().includes(fRoleName); }); if (!hitR) matched = false; else mtch.roles.push(hitR.name + " [" + hitR.systemName + "]"); }

        var dedup = function (arr) { var seen = {}; return arr.filter(function (v) { if (seen[v]) return false; seen[v] = true; return true; }); };
        mtch.aspects = dedup(mtch.aspects); mtch.forms = dedup(mtch.forms); mtch.keyDates = dedup(mtch.keyDates); mtch.roles = dedup(mtch.roles);
        var include = excludeMode ? !matched : matched;
        if (include) results.push({ systemName: t.systemName, name: t.name, icon: t.icon, isAbstract: t.isAbstract, isCoreType: t.isCoreType, tileColour: t.tileColour, matches: excludeMode ? { aspects: [], forms: [], keyDates: [], roles: [] } : mtch });
    }

    return { results: results, totalIndexed: state.types.length, resultCount: results.length, searchTime: (Date.now() - startMs) + "ms" };
}

module.exports = {
    init: init, getState: getState, loadCaches: loadCaches,
    buildIndex: buildIndex, search: search,
    getFetchDelay: getFetchDelay, setFetchDelay: setFetchDelay
};