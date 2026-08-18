function requestIsSameOrigin(req, config) {
    const fetchSite = req.get('Sec-Fetch-Site');
    if (fetchSite === 'cross-site') return false;

    const origin = req.get('Origin');
    if (!origin) return true;

    try {
        return new URL(origin).origin === new URL(config.appUrl).origin;
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

module.exports = {
    authenticateSession,
    requireSameOrigin,
};
