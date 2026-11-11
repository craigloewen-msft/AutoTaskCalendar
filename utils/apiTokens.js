'use strict';

const crypto = require('crypto');

const TOKEN_PREFIX = 'atc_';
const TOKEN_PATTERN = /^atc_[A-Za-z0-9_-]{43}$/;
// Shown in lists so a user can tell tokens apart without the secret.
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;
const MAX_TOKEN_NAME_LENGTH = 100;
const MAX_TOKENS_PER_USER = 20;
// Writing lastUsedAt on every request would turn reads into writes.
const LAST_USED_RESOLUTION_MS = 60 * 1000;

function digestToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken() {
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    return { token, digest: digestToken(token), prefix: token.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/** The token from an `Authorization: Bearer` header, null when absent, or false when malformed. */
function bearerTokenFrom(req) {
    const header = req.get('Authorization');
    if (!header) return null;

    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match || !TOKEN_PATTERN.test(match[1])) return false;
    return match[1];
}

function publicToken(doc) {
    return {
        _id: String(doc._id),
        name: doc.name,
        prefix: doc.prefix,
        createdAt: doc.createdAt,
        lastUsedAt: doc.lastUsedAt,
    };
}

module.exports = {
    LAST_USED_RESOLUTION_MS,
    MAX_TOKEN_NAME_LENGTH,
    MAX_TOKENS_PER_USER,
    bearerTokenFrom,
    digestToken,
    generateToken,
    publicToken,
};
