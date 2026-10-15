const { resolveRequestOrigin } = require('../utils/requestOrigin');

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

function authenticateSession(config) {
    return (req, res, next) => {
        if (!requestIsSameOrigin(req, config)) return res.sendStatus(403);
        if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
            return res.sendStatus(401);
        }
        next();
    };
}

// Site-wide admin surfaces. Runs after authenticateSession, which owns 401 and same-origin.
function requireAdmin(req, res, next) {
    if (req.user?.isAdmin !== true) return res.sendStatus(403);
    next();
}

module.exports = {
    authenticateSession,
    requireSameOrigin,
    requireAdmin,
    expectedOrigin,
};
