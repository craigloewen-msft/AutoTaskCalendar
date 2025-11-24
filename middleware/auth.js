const jwt = require('jsonwebtoken');

function authenticateToken(config) {
    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader;

        if (token == null) return res.sendStatus(401);

        jwt.verify(token, config.secret, (err, user) => {
            if (err) return res.sendStatus(401);
            req.user = user;
            next();
        });
    };
}

module.exports = {
    authenticateToken
};
