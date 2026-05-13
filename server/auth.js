/**
 * Authentication -- token acquisition, cookie management, HTTP helpers, OIDC flow
 *
 * Extracted from server.js. Owns all auth state and API request helpers.
 *
 * Exports:
 *   init(deps)                          -- wire up dependencies
 *   cookieCache                         -- envName -> cookie string (direct reference)
 *   cookieSource                        -- envName -> source string
 *   getToken(envName)                   -- get/refresh service account bearer token
 *   extractApiJwt(cookieStr)            -- extract _api JWT from cookie string
 *   getJwtExpiry(jwt)                   -- extract expiry timestamp from JWT
 *   getJwtIdentity(jwt)                 -- extract identity from JWT
 *   setCookie(envName, cookie, source)  -- set cookie + start refresh
 *   clearCookie(envName)                -- clear cookie + stop refresh
 *   startCookieRefresh(envName)         -- start auto-refresh interval
 *   stopCookieRefresh(envName)          -- stop auto-refresh interval
 *   isRefreshing(envName)               -- whether auto-refresh is active
 *   acquireCookieForEnv(envName)        -- programmatic OIDC cookie acquisition
 *   startupCookieAcquisition()          -- acquire cookies for all configured envs
 *   extractCookiesFromBrowserSessions() -- restore cookies from Playwright browser data
 *   sharedoGet/sharedoPost/tryAuth      -- ShareDo API request helpers
 *   getCookieRefreshInterval/setCookieRefreshInterval -- interval management
 */
"use strict";

var _deps = null;
var tokenCache = {};
var cookieCache = {};
var cookieSource = {};
var cookieRefreshTimers = {};
var COOKIE_REFRESH_INTERVAL = 10 * 60 * 1000;

// Returns { rejectUnauthorized: false } for localhost/127.0.0.1 (self-signed certs in local dev).
function _tlsOpts(hostname) {
    var h = (hostname || "").split(":")[0];
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return { rejectUnauthorized: false };
    return {};
}

// Splits "hostname:port" into { hostname, port }. Falls back to port 443.
function _parseHost(host) {
    var idx = (host || "").indexOf(":");
    if (idx === -1) return { hostname: host || "", port: 443 };
    return { hostname: host.substring(0, idx), port: parseInt(host.substring(idx + 1), 10) || 443 };
}

function init(deps) { _deps = deps; }

// ── Token ──
function getToken(envName) {
    var env = _deps.environments[envName];
    if (!env) return Promise.reject(new Error("Unknown env: " + envName));
    var cached = tokenCache[envName];
    if (cached && cached.accessToken && Date.now() < cached.expiresAt - 60000) return Promise.resolve(cached.accessToken);
    return new Promise(function (resolve, reject) {
        var body = _deps.querystring.stringify({ grant_type: "client_credentials", scope: "sharedo" });
        var authHeader = "Basic " + Buffer.from(env.clientId + ":" + env.clientSecret).toString("base64");
        var urlObj = new URL("https://" + env.identityHost + "/connect/token");
        var opts = Object.assign({ hostname: urlObj.hostname, port: parseInt(urlObj.port, 10) || 443, path: urlObj.pathname, method: "POST", family: 4, headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body), "Authorization": authHeader } }, _tlsOpts(urlObj.hostname));
        var req = _deps.https.request(opts, function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () {
            if (res.statusCode !== 200) return reject(new Error("Token failed for " + envName + ": " + res.statusCode + " - " + d));
            try { var p = JSON.parse(d); tokenCache[envName] = { accessToken: p.access_token, expiresAt: Date.now() + (p.expires_in * 1000) }; resolve(p.access_token); } catch (e) { reject(new Error("Token parse: " + e.message)); }
        }); }); req.on("error", function (e) { reject(new Error("Token error: " + e.message)); }); req.write(body); req.end();
    });
}

// ── JWT helpers ──
function extractApiJwt(c) { if (!c) return null; var m = c.match(/_api=([^;]+)/); return m ? m[1] : null; }
function getJwtExpiry(jwt) { try { var p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8")); return p.exp ? p.exp * 1000 : null; } catch (e) { return null; } }
function getJwtIdentity(jwt) { try { var p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8")); return p.name || p.preferred_username || p.email || p.sub || null; } catch (e) { return null; } }

// ── Cookie management ──
function setCookie(envName, cookie, source) {
    cookieCache[envName] = cookie; cookieSource[envName] = source || "manual";
    _deps.log("cookie", "Set for " + envName + " (" + cookie.length + " chars, source: " + cookieSource[envName] + ")");
    startCookieRefresh(envName);
}
function clearCookie(envName) {
    delete cookieCache[envName]; delete cookieSource[envName]; stopCookieRefresh(envName);
    _deps.log("cookie", "Cleared for " + envName);
}
function startCookieRefresh(envName) { stopCookieRefresh(envName); refreshCookie(envName); cookieRefreshTimers[envName] = setInterval(function () { refreshCookie(envName); }, COOKIE_REFRESH_INTERVAL); }
function stopCookieRefresh(envName) { if (cookieRefreshTimers[envName]) { clearInterval(cookieRefreshTimers[envName]); delete cookieRefreshTimers[envName]; } }
function isRefreshing(envName) { return !!cookieRefreshTimers[envName]; }

function refreshCookie(envName) {
    var env = _deps.environments[envName]; var cur = cookieCache[envName]; if (!env || !cur) return;
    var _rh = _parseHost(env.apiHost);
    var opts = Object.assign({ hostname: _rh.hostname, port: _rh.port, path: "/security/refreshTokens", method: "GET", headers: { "Cookie": cur, "X-Requested-With": "XMLHttpRequest", "X-Passive-Request": "true", "Accept": "application/json" } }, _tlsOpts(_rh.hostname));
    var req = _deps.https.request(opts, function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () {
        if (res.statusCode === 200) { var sc = res.headers["set-cookie"]; if (sc && sc.length) {
            var base = cookieCache[envName] || cur;
            cookieCache[envName] = applyCookieUpdates(base, sc);
            var jwt = extractApiJwt(cookieCache[envName]); var exp = jwt ? getJwtExpiry(jwt) : null; var mins = exp ? Math.round((exp - Date.now())/1000/60) : "?";
            _deps.log("cookie", "Refreshed for " + envName + " (~" + mins + " min)"); } }
        else { _deps.log("cookie", "Refresh failed for " + envName + ": " + res.statusCode); if (res.statusCode === 401) { _deps.log("cookie", "Session expired for " + envName + " -- stopping auto-refresh"); stopCookieRefresh(envName); } }
    }); }); req.on("error", function (e) { _deps.log("cookie", "Refresh error: " + e.message); }); req.end();
}
function applyCookieUpdates(existing, setCookieHeaders) {
    var map = {}; existing.split(";").forEach(function (p) { var t = p.trim(); var e = t.indexOf("="); if (e > 0) map[t.substring(0,e).trim()] = t.substring(e+1).trim(); });
    for (var i = 0; i < setCookieHeaders.length; i++) { var m = setCookieHeaders[i].split(";")[0].trim(); var e = m.indexOf("="); if (e > 0) map[m.substring(0,e).trim()] = m.substring(e+1).trim(); }
    return Object.entries(map).map(function (kv) { return kv[0] + "=" + kv[1]; }).join("; ");
}
function getCookieRefreshInterval() { return COOKIE_REFRESH_INTERVAL; }
function setCookieRefreshInterval(ms) { COOKIE_REFRESH_INTERVAL = ms; for (var en in cookieRefreshTimers) { if (cookieCache[en]) startCookieRefresh(en); } }

// ── OIDC flow helpers ──
function httpsGet(hostname, urlPath, headers) {
    return new Promise(function (resolve, reject) {
        var _gh = _parseHost(hostname);
        var opts = Object.assign({ hostname: _gh.hostname, port: _gh.port, path: urlPath, method: "GET", headers: headers || {}, timeout: 15000 }, _tlsOpts(_gh.hostname));
        var req = _deps.https.request(opts, function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () { resolve({ status: res.statusCode, headers: res.headers, body: d }); }); });
        req.on("timeout", function () { req.destroy(); reject(new Error("Timeout: GET " + urlPath)); }); req.on("error", reject); req.end();
    });
}
function httpsPost(hostname, urlPath, body, headers) {
    return new Promise(function (resolve, reject) {
        var bodyBuf = Buffer.from(body); var h = Object.assign({ "Content-Length": bodyBuf.length }, headers || {});
        var _ph = _parseHost(hostname);
        var opts = Object.assign({ hostname: _ph.hostname, port: _ph.port, path: urlPath, method: "POST", headers: h, timeout: 15000 }, _tlsOpts(_ph.hostname));
        var req = _deps.https.request(opts, function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () { resolve({ status: res.statusCode, headers: res.headers, body: d }); }); });
        req.on("timeout", function () { req.destroy(); reject(new Error("Timeout: POST " + urlPath)); }); req.on("error", reject); req.write(bodyBuf); req.end();
    });
}
function jarFromSetCookie(existing, setCookieHeaders) {
    var map = Object.assign({}, existing); var hdrs = setCookieHeaders || [];
    for (var i = 0; i < hdrs.length; i++) { var seg = hdrs[i].split(";")[0].trim(); var eq = seg.indexOf("="); if (eq > 0) map[seg.substring(0, eq).trim()] = seg.substring(eq + 1).trim(); }
    return map;
}
function jarToHeader(jar) { return Object.entries(jar).map(function (kv) { return kv[0] + "=" + kv[1]; }).join("; "); }

// ── Programmatic cookie acquisition ──
async function acquireCookieForEnv(envName) {
    var env = _deps.environments[envName];
    if (!env || !env.cookieUsername || !env.cookiePassword) return;
    var apiHost = env.apiHost; var idHost = env.identityHost; var username = env.cookieUsername;
    _deps.log("autoauth", "[" + envName + "] Starting acquisition for " + username);
    var apiJar = {}; var idJar = {};
    try {
        var step1 = await httpsGet(apiHost, "/", { "Accept": "text/html" });
        if (step1.status !== 302) throw new Error("Step 1: expected 302, got " + step1.status);
        apiJar = jarFromSetCookie(apiJar, step1.headers["set-cookie"]);
        var authorizeUrl = step1.headers["location"];
        if (!authorizeUrl) throw new Error("Step 1: no Location header");
        _deps.log("autoauth", "[" + envName + "] Step 1 complete -- authorize URL obtained");

        var authParsed = new URL(authorizeUrl);
        var step2 = await httpsGet(idHost, authParsed.pathname + authParsed.search, { "Accept": "text/html", "Referer": "https://" + apiHost + "/" });
        if (step2.status !== 302) throw new Error("Step 2: expected 302, got " + step2.status);
        idJar = jarFromSetCookie(idJar, step2.headers["set-cookie"]);
        var loginUrl = step2.headers["location"];
        if (!loginUrl) throw new Error("Step 2: no Location header");
        var loginPath = loginUrl.startsWith("http") ? new URL(loginUrl).pathname + new URL(loginUrl).search : loginUrl;
        _deps.log("autoauth", "[" + envName + "] Step 2 complete -- login URL obtained");

        var step3 = await httpsGet(idHost, loginPath, { "Accept": "text/html", "Referer": authorizeUrl, "Cookie": jarToHeader(idJar) });
        if (step3.status !== 200) throw new Error("Step 3: expected 200, got " + step3.status);
        idJar = jarFromSetCookie(idJar, step3.headers["set-cookie"]);
        var modelMatch = step3.body.match(/<script[^>]+id="modelJson"[^>]*>([\s\S]*?)<\/script>/);
        if (!modelMatch) throw new Error("Step 3: modelJson not found in response");
        var modelJson; try { modelJson = JSON.parse(modelMatch[1]); } catch (e) { throw new Error("Step 3: modelJson parse failed: " + e.message); }
        var antiForgeryValue = modelJson.antiForgery && modelJson.antiForgery.value;
        var loginPostPath = modelJson.loginUrl;
        if (!antiForgeryValue || !loginPostPath) throw new Error("Step 3: missing antiForgery.value or loginUrl in modelJson");
        _deps.log("autoauth", "[" + envName + "] Step 3 complete -- antiForgery token obtained");

        var credBody = _deps.querystring.stringify({ "idsrv.xsrf": antiForgeryValue, "username": username, "password": env.cookiePassword });
        var step4 = await httpsPost(idHost, loginPostPath, credBody, { "Content-Type": "application/x-www-form-urlencoded", "Accept": "text/html", "Referer": "https://" + idHost + loginPath, "Cookie": jarToHeader(idJar) });
        if (step4.status !== 302) throw new Error("Step 4: expected 302, got " + step4.status + " -- credentials may be incorrect");
        idJar = jarFromSetCookie(idJar, step4.headers["set-cookie"]);
        if (!idJar["idsrv"]) throw new Error("Step 4: idsrv session cookie not set -- authentication failed");
        _deps.log("autoauth", "[" + envName + "] Step 4 complete -- authenticated, idsrv session established");

        var step5 = await httpsGet(idHost, authParsed.pathname + authParsed.search, { "Accept": "text/html", "Referer": "https://" + idHost + loginPostPath, "Cookie": jarToHeader(idJar) });
        if (step5.status !== 200) throw new Error("Step 5: expected 200, got " + step5.status);
        idJar = jarFromSetCookie(idJar, step5.headers["set-cookie"]);
        function extractHidden(html, name) { var re = new RegExp('<input[^>]+name="' + name + '"[^>]+value="([^"]*)"', "i"); var m = html.match(re); return m ? m[1] : null; }
        var code = extractHidden(step5.body, "code"); var idToken = extractHidden(step5.body, "id_token");
        var scope = extractHidden(step5.body, "scope"); var state = extractHidden(step5.body, "state");
        var sessionState = extractHidden(step5.body, "session_state");
        if (!code || !idToken || !state) throw new Error("Step 5: could not extract code/id_token/state from form response");
        _deps.log("autoauth", "[" + envName + "] Step 5 complete -- authorization code obtained");

        var callbackBody = _deps.querystring.stringify({ code: code, id_token: idToken, scope: scope || "openid profile sharedo offline_access", state: state, session_state: sessionState || "" });
        var step6 = await httpsPost(apiHost, "/", callbackBody, { "Content-Type": "application/x-www-form-urlencoded", "Accept": "text/html", "Cookie": jarToHeader(apiJar) });
        if (step6.status !== 302 && step6.status !== 200) throw new Error("Step 6: unexpected status " + step6.status);
        apiJar = jarFromSetCookie(apiJar, step6.headers["set-cookie"]);
        var hasSession = Object.keys(apiJar).some(function (k) { return k.toLowerCase().startsWith("sharedo."); });
        var hasApiJwt = !!apiJar["_api"];
        if (!hasSession || !hasApiJwt) throw new Error("Step 6: expected Sharedo session cookies not present in response");
        cookieCache[envName] = jarToHeader(apiJar); cookieSource[envName] = "autoauth"; startCookieRefresh(envName);
        _deps.log("cookie", "[" + envName + "] Acquisition complete -- session established (cookie: " + cookieCache[envName].length + " chars)");
    } catch (err) { _deps.log("cookie", "[" + envName + "] Acquisition failed: " + err.message); }
}

async function startupCookieAcquisition() {
    for (var i = 0; i < _deps.envNames.length; i++) {
        var envName = _deps.envNames[i]; var env = _deps.environments[envName];
        if (!env.cookieUsername || !env.cookiePassword) continue;
        if (cookieCache[envName]) { _deps.log("autoauth", "[" + envName + "] Cookie already set -- skipping acquisition"); continue; }
        await acquireCookieForEnv(envName);
    }
}

async function extractCookiesFromBrowserSessions() {
    if (!_deps.playwright) return;
    var uxDataDir = _deps.path.join(_deps.baseDir, "cache", "ux-user-data");
    if (!_deps.fs.existsSync(uxDataDir)) return;
    var dirs = _deps.fs.readdirSync(uxDataDir).filter(function (d) { return _deps.fs.statSync(_deps.path.join(uxDataDir, d)).isDirectory() && _deps.environments[d] && !_deps.environments[d].isMock; });
    for (var di = 0; di < dirs.length; di++) {
        var envName = dirs[di];
        if (cookieCache[envName]) continue;
        var env = _deps.environments[envName]; var userDataDir = _deps.path.join(uxDataDir, envName);
        try {
            var context = await _deps.playwright.chromium.launchPersistentContext(userDataDir, { headless: true, args: ["--disable-blink-features=AutomationControlled"] });
            var cookies = await context.cookies("https://" + env.apiHost);
            var cookieMap = {}; for (var ci = 0; ci < cookies.length; ci++) cookieMap[cookies[ci].name] = cookies[ci].value;
            var hasSession = Object.keys(cookieMap).some(function (k) { return k.toLowerCase().startsWith("sharedo."); });
            var hasApiJwt = !!cookieMap["_api"];
            if (hasSession && hasApiJwt) {
                var cookieHeader = cookies.map(function (ck) { return ck.name + "=" + ck.value; }).join("; ");
                cookieCache[envName] = cookieHeader; cookieSource[envName] = "browser"; startCookieRefresh(envName);
                var jwt = extractApiJwt(cookieHeader); var identity = jwt ? getJwtIdentity(jwt) : null;
                _deps.log("cookie", "[" + envName + "] Restored session from browser data" + (identity ? " (" + identity + ")" : ""));
            } else { _deps.log("cookie", "[" + envName + "] Browser data exists but no valid session found"); }
            await context.close();
        } catch (err) { _deps.log("cookie", "[" + envName + "] Browser session extraction failed: " + err.message); }
    }
}

// ── HTTP helpers ──
function sharedoGet(h, p, a) { return sharedoRequest(h, p, "GET", null, a); }
function sharedoPost(h, p, b, a) { return sharedoRequest(h, p, "POST", b, a); }
function sharedoRequest(apiHost, urlPath, method, body, authParam) {
    return new Promise(function (resolve) {
        var headers = { "Accept": "application/json" };
        if (authParam.type === "cookie") { headers["Cookie"] = authParam.value; headers["X-Requested-With"] = "XMLHttpRequest"; headers["X-Passive-Request"] = "true"; }
        else if (authParam.type === "cookie-and-bearer") { headers["Cookie"] = authParam.cookie; headers["Authorization"] = "Bearer " + authParam.bearer; headers["X-Requested-With"] = "XMLHttpRequest"; headers["X-Passive-Request"] = "true"; }
        else { headers["Authorization"] = "Bearer " + authParam.value; }
        if (body) { headers["Content-Type"] = "application/json"; }
        var bodyStr = body ? JSON.stringify(body) : null;
        if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
        var _sh = _parseHost(apiHost);
        var opts = Object.assign({ hostname: _sh.hostname, port: _sh.port, path: urlPath, method: method, headers: headers, timeout: 15000 }, _tlsOpts(_sh.hostname));
        var req = _deps.https.request(opts, function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () {
            if (res.statusCode >= 400) { var wa = res.headers["www-authenticate"] || null; if (res.statusCode !== 401 || _deps.isLog401()) _deps.log("api", res.statusCode + " " + method + " " + urlPath + (wa ? " | " + wa : "") + (d ? " | " + d.substring(0,150) : "")); return resolve({ error: true, status: res.statusCode, message: d.substring(0,500), url: urlPath, wwwAuthenticate: wa }); }
            try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: true, status: res.statusCode, message: "Invalid JSON" }); }
        }); });
        req.on("timeout", function () { req.destroy(); resolve({ error: true, status: 0, message: "Request timeout (15s): " + method + " " + urlPath }); });
        req.on("error", function (e) { resolve({ error: true, status: 0, message: e.message }); });
        if (bodyStr) req.write(bodyStr); req.end();
    });
}
async function tryAuth(host, method, urlPath, body, token, adminCookie) {
    var result = method === "GET" ? await sharedoGet(host, urlPath, { type: "bearer", value: token }) : await sharedoPost(host, urlPath, body, { type: "bearer", value: token });
    if (result && result.error && result.status === 401 && adminCookie) { var jwt = extractApiJwt(adminCookie); if (jwt) result = method === "GET" ? await sharedoGet(host, urlPath, { type: "bearer", value: jwt }) : await sharedoPost(host, urlPath, body, { type: "bearer", value: jwt }); }
    if (result && result.error && result.status === 401 && adminCookie) { result = method === "GET" ? await sharedoGet(host, urlPath, { type: "cookie", value: adminCookie }) : await sharedoPost(host, urlPath, body, { type: "cookie", value: adminCookie }); }
    return result;
}

module.exports = {
    init: init, cookieCache: cookieCache, cookieSource: cookieSource,
    getToken: getToken, extractApiJwt: extractApiJwt, getJwtExpiry: getJwtExpiry, getJwtIdentity: getJwtIdentity,
    setCookie: setCookie, clearCookie: clearCookie,
    startCookieRefresh: startCookieRefresh, stopCookieRefresh: stopCookieRefresh, isRefreshing: isRefreshing,
    acquireCookieForEnv: acquireCookieForEnv, startupCookieAcquisition: startupCookieAcquisition,
    extractCookiesFromBrowserSessions: extractCookiesFromBrowserSessions,
    sharedoGet: sharedoGet, sharedoPost: sharedoPost, sharedoRequest: sharedoRequest, tryAuth: tryAuth,
    getCookieRefreshInterval: getCookieRefreshInterval, setCookieRefreshInterval: setCookieRefreshInterval
};