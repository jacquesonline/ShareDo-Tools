/**
 * Session management for multi-user mode.
 *
 * Gated behind MULTI_USER=true in .env.
 * When disabled, all middleware passes through and session routes return defaults.
 *
 * Exports:
 *   init(deps)                    -- wire up dependencies
 *   isMultiUser()                 -- whether multi-user mode is active
 *   middleware(req, res, next)    -- API session validation (401 if no session)
 *   pageGate(req, res, next)     -- page session validation (redirect to /register)
 *   requireAdmin(req, res, next) -- admin-only gate (403 if not admin)
 *   register(body)               -- validate + create session
 *   verifyAdminKey(key)          -- check key against ADMIN_KEY
 *   upgradeToAdmin(session)      -- re-sign session with isAdmin: true
 *   getSessionFromReq(req)       -- parse session from request (does not enforce)
 *   loadUserSettings(slug)       -- read user preferences
 *   saveUserSettings(slug, data) -- write user preferences
 *   getEmailSlug(email)          -- identity before @
 *   getSessionExpiryMs()         -- session lifetime in ms
 *   COOKIE_NAME                  -- cookie name constant
 */
"use strict";

var crypto = require("crypto");

var _deps = null;
var _multiUser = false;
var _adminKey = null;
var _sessionExpiryMs = 30 * 24 * 60 * 60 * 1000;
var _signingKey = null;
var _userSettingsDir = null;
var EMAIL_DOMAIN = "mauriceblackburn.com.au";
var COOKIE_NAME = "sdt-session";

// API paths exempt from session enforcement (relative to /api mount)
var EXEMPT_API = [
    { path: "/session",          method: "GET"  },
    { path: "/session/register", method: "POST" },
    { path: "/settings",         method: "GET"  }
];


// ═══════════════════════════════════════════════════════════════════
// Initialisation
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {Object} deps
 * @param {Function} deps.log       - (category, message)
 * @param {Object}   deps.fs        - Node fs module
 * @param {Object}   deps.path      - Node path module
 * @param {string}   deps.baseDir   - __dirname of server.js
 */
function init(deps) {
    _deps = deps;
    _multiUser = (process.env.MULTI_USER || "false").toLowerCase() === "true";
    _adminKey = process.env.ADMIN_KEY || null;

    var expiryDays = parseInt(process.env.SESSION_EXPIRY_DAYS, 10);
    if (!isNaN(expiryDays) && expiryDays > 0) _sessionExpiryMs = expiryDays * 24 * 60 * 60 * 1000;

    _userSettingsDir = deps.path.join(deps.baseDir, "cache", "user-settings");

    if (_multiUser) {
        if (!_adminKey) {
            console.error("\n  MULTI_USER=true requires ADMIN_KEY to be set in .env\n");
            process.exit(1);
        }
        _signingKey = crypto.createHash("sha256").update(_adminKey).digest();

        if (!deps.fs.existsSync(_userSettingsDir)) {
            deps.fs.mkdirSync(_userSettingsDir, { recursive: true });
        }

        deps.log("settings", "Multi-user mode enabled (session expiry: " + Math.round(_sessionExpiryMs / 86400000) + " days)");
    }
}

function isMultiUser() { return _multiUser; }
function getSessionExpiryMs() { return _sessionExpiryMs; }


// ═══════════════════════════════════════════════════════════════════
// Cookie signing / verification
// ═══════════════════════════════════════════════════════════════════

function sign(payload) {
    var json = JSON.stringify(payload);
    var data = Buffer.from(json).toString("base64");
    var hmac = crypto.createHmac("sha256", _signingKey).update(data).digest("base64");
    return data + "." + hmac;
}

function verify(cookieValue) {
    if (!cookieValue || typeof cookieValue !== "string") return null;
    var parts = cookieValue.split(".");
    if (parts.length !== 2) return null;

    var data = parts[0];
    var sig = parts[1];
    var expected = crypto.createHmac("sha256", _signingKey).update(data).digest("base64");

    var sigBuf = Buffer.from(sig);
    var expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    try {
        var payload = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch (e) { return null; }
}


// ═══════════════════════════════════════════════════════════════════
// Cookie parsing (manual -- no cookie-parser dependency)
// ═══════════════════════════════════════════════════════════════════

function parseCookieHeader(req, name) {
    var header = req.headers.cookie;
    if (!header) return null;
    var pairs = header.split(";");
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].trim();
        var eq = pair.indexOf("=");
        if (eq > 0 && pair.substring(0, eq) === name) {
            try { return decodeURIComponent(pair.substring(eq + 1)); } catch (e) { return pair.substring(eq + 1); }
        }
    }
    return null;
}


// ═══════════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════════

function isExempt(req) {
    for (var i = 0; i < EXEMPT_API.length; i++) {
        var e = EXEMPT_API[i];
        if (req.path === e.path && req.method === e.method) return true;
    }
    return false;
}

/**
 * API session middleware. Mounted on /api.
 * In single-user mode: passes through (no-op).
 * In multi-user mode: validates session cookie, attaches req.user, or returns 401.
 */
function middleware(req, res, next) {
    if (!_multiUser) { next(); return; }
    if (isExempt(req)) { next(); return; }

    var raw = parseCookieHeader(req, COOKIE_NAME);
    var session = raw ? verify(raw) : null;

    if (!session) {
        return res.status(401).json({ error: true, message: "Authentication required", needsRegistration: true });
    }

    req.user = session;
    next();
}

/**
 * Page route middleware. Applied per-route on page endpoints.
 * In single-user mode: passes through.
 * In multi-user mode: redirects to /register if no valid session.
 */
function pageGate(req, res, next) {
    if (!_multiUser) { next(); return; }

    var raw = parseCookieHeader(req, COOKIE_NAME);
    var session = raw ? verify(raw) : null;

    if (!session) {
        return res.redirect("/register?return=" + encodeURIComponent(req.originalUrl));
    }

    req.user = session;
    next();
}

/**
 * Admin-only gate. Returns 403 if user is not admin.
 * In single-user mode: passes through (all users are effectively admin).
 */
function requireAdmin(req, res, next) {
    if (!_multiUser) { next(); return; }
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ error: true, message: "Admin access required" });
    }
    next();
}

/**
 * Parse session from request without enforcing.
 * Returns the session payload or null.
 */
function getSessionFromReq(req) {
    var raw = parseCookieHeader(req, COOKIE_NAME);
    return raw ? verify(raw) : null;
}


// ═══════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════

function register(body) {
    if (!body) return { error: true, message: "Missing registration data" };

    var firstName = body.firstName ? String(body.firstName).trim() : "";
    var lastName = body.lastName ? String(body.lastName).trim() : "";
    var email = body.email ? String(body.email).trim().toLowerCase() : "";

    if (!firstName) return { error: true, message: "First name is required" };
    if (!lastName) return { error: true, message: "Last name is required" };
    if (!email) return { error: true, message: "Email is required" };
    if (!email.endsWith("@" + EMAIL_DOMAIN)) {
        return { error: true, message: "Email must be a @" + EMAIL_DOMAIN + " address" };
    }

    var slug = getEmailSlug(email);

    // Create or update user settings file
    var existing = loadUserSettings(slug);
    var userSettings = existing || {};
    userSettings.firstName = firstName;
    userSettings.lastName = lastName;
    userSettings.email = email;
    if (!existing) {
        userSettings.theme = "dark";
        userSettings.highContrast = false;
        userSettings.chartBackgrounds = false;
        userSettings.desktopNotifications = false;
    }
    saveUserSettings(slug, userSettings);

    // Build session payload
    var session = {
        email: email,
        firstName: firstName,
        lastName: lastName,
        slug: slug,
        isAdmin: false,
        exp: Date.now() + _sessionExpiryMs
    };

    var cookieValue = sign(session);
    _deps.log("settings", "User registered: " + firstName + " " + lastName + " (" + email + ")");

    return {
        success: true,
        session: session,
        cookieValue: cookieValue,
        cookieName: COOKIE_NAME,
        cookieMaxAge: _sessionExpiryMs
    };
}


// ═══════════════════════════════════════════════════════════════════
// Admin verification
// ═══════════════════════════════════════════════════════════════════

function verifyAdminKey(key) {
    if (!_adminKey || !key) return false;
    var keyBuf = Buffer.from(String(key));
    var adminBuf = Buffer.from(_adminKey);
    if (keyBuf.length !== adminBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, adminBuf);
}

function upgradeToAdmin(session) {
    var upgraded = {
        email: session.email,
        firstName: session.firstName,
        lastName: session.lastName,
        slug: session.slug,
        isAdmin: true,
        exp: Date.now() + _sessionExpiryMs
    };

    var cookieValue = sign(upgraded);
    _deps.log("settings", "Admin access granted: " + session.firstName + " " + session.lastName + " (" + session.email + ")");

    return {
        success: true,
        session: upgraded,
        cookieValue: cookieValue,
        cookieName: COOKIE_NAME,
        cookieMaxAge: _sessionExpiryMs
    };
}


// ═══════════════════════════════════════════════════════════════════
// User settings files
// ═══════════════════════════════════════════════════════════════════

function getEmailSlug(email) {
    var atIdx = email.indexOf("@");
    if (atIdx > 0) return email.substring(0, atIdx).toLowerCase();
    return email.toLowerCase();
}

function userSettingsPath(slug) {
    return _deps.path.join(_userSettingsDir, slug + ".json");
}

function loadUserSettings(slug) {
    try {
        var fp = userSettingsPath(slug);
        if (_deps.fs.existsSync(fp)) {
            return JSON.parse(_deps.fs.readFileSync(fp, "utf8"));
        }
    } catch (e) {
        _deps.log("settings", "Failed to load user settings for " + slug + ": " + e.message);
    }
    return null;
}

function saveUserSettings(slug, data) {
    try {
        if (!_deps.fs.existsSync(_userSettingsDir)) {
            _deps.fs.mkdirSync(_userSettingsDir, { recursive: true });
        }
        _deps.fs.writeFileSync(userSettingsPath(slug), JSON.stringify(data, null, 2));
    } catch (e) {
        _deps.log("settings", "Failed to save user settings for " + slug + ": " + e.message);
    }
}


// ═══════════════════════════════════════════════════════════════════
// Module exports
// ═══════════════════════════════════════════════════════════════════

module.exports = {
    init: init,
    isMultiUser: isMultiUser,
    middleware: middleware,
    pageGate: pageGate,
    requireAdmin: requireAdmin,
    register: register,
    verifyAdminKey: verifyAdminKey,
    upgradeToAdmin: upgradeToAdmin,
    getSessionFromReq: getSessionFromReq,
    loadUserSettings: loadUserSettings,
    saveUserSettings: saveUserSettings,
    getEmailSlug: getEmailSlug,
    getSessionExpiryMs: getSessionExpiryMs,
    COOKIE_NAME: COOKIE_NAME
};