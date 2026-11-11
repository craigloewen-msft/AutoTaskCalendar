const { resolveRequestOrigin } = require('../utils/requestOrigin');
const { ApiTokenDetails, UserDetails } = require('../models');
const { LAST_USED_RESOLUTION_MS, bearerTokenFrom, digestToken } = require('../utils/apiTokens');

/**
 * The origin a request must match to count as same-origin.
 *
 * Production has one known public URL and sits behind a proxy that can set forwarding
 * headers at will, so it stays pinned to `appUrl`. Development derives it from the
 * request, so a stack reached through a forwarded port still matches itself.
 */
function expectedOrigin(req, config) {
    if (process.env.NODE_ENV === 'production') return config.appUrl;

    return resolveRequestOrigin(req) || config.appUrl;
}

function requestIsSameOrigin(req, config) {
    const fetchSite = req.get('Sec-Fetch-Site');
    if (fetchSite === 'cross-site') return false;

    const origin = req.get('Origin');
    if (!origin) return true;

    const expected = expectedOrigin(req, config);
    if (!expected) return false;

    try {
        return new URL(origin).origin === new URL(expected).origin;
    } catch (error) {
        return false;
    }
}

function requireSameOrigin(config) {
    return (req, res, next) => {
        if (!requestIsSameOrigin(req, config)) return res.sendStatus(403);
        next();
    };
}

/** The user a personal API token belongs to, or null when the token is unknown. */
async function userForApiToken(token) {
    const record = await ApiTokenDetails.findOne({ tokenDigest: digestToken(token) });
    if (!record) return null;

    const user = await UserDetails.findById(record.userRef);
    if (!user) return null;

    const now = Date.now();
    if (!record.lastUsedAt || now - record.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
        await ApiTokenDetails.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date(now) } });
    }
    return user;
}

/**
 * Accepts a session cookie or an `Authorization: Bearer atc_…` token.
 *
 * A bearer token is never sent ambiently by a browser, so it skips the same-origin check.
 * A request that presents one is judged on it alone and never falls back to the session.
 */
function authenticateSession(config) {
    return async (req, res, next) => {
        const token = bearerTokenFrom(req);
        if (token === null) {
            if (!requestIsSameOrigin(req, config)) return res.sendStatus(403);
            if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
                return res.sendStatus(401);
            }
            return next();
        }

        if (token === false) return res.sendStatus(401);
        try {
            const user = await userForApiToken(token);
            if (!user) return res.sendStatus(401);
            req.user = user;
            req.authMethod = 'apiToken';
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

// Session-bound surfaces (token management, logout, OAuth) refuse API tokens so a leaked
// token cannot mint more tokens or touch the session. Runs after authenticateSession.
function requireSessionAuth(req, res, next) {
    if (req.authMethod === 'apiToken') return res.sendStatus(403);
    next();
}

// Site-wide admin surfaces. Runs after authenticateSession, which owns 401 and same-origin.
function requireAdmin(req, res, next) {
    if (req.authMethod === 'apiToken') return res.sendStatus(403);
    if (req.user?.isAdmin !== true) return res.sendStatus(403);
    next();
}

module.exports = {
    authenticateSession,
    requireSameOrigin,
    requireAdmin,
    requireSessionAuth,
    expectedOrigin,
};
