'use strict';

const crypto = require('crypto');

const ENVELOPE_VERSION = 'v1';
const AAD = Buffer.from('autotaskcalendar/google-calendar-credentials/v1');
const KEY_INFO = Buffer.from('autotaskcalendar/google-calendar-credentials');

function credentialKey(secret) {
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error('Server secret is required to protect Google credentials');
    }
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), KEY_INFO, 32));
}

function encryptGoogleCredential(value, secret) {
    if (typeof value !== 'string' || value.length === 0) return null;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(secret), iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [ENVELOPE_VERSION, iv, ciphertext, tag]
        .map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part)
        .join('.');
}

function decryptGoogleCredential(envelope, secret) {
    if (envelope == null || envelope === '') return null;
    if (typeof envelope !== 'string') throw new Error('Invalid encrypted Google credential');

    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
        throw new Error('Invalid encrypted Google credential');
    }

    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const ciphertext = Buffer.from(parts[2], 'base64url');
        const tag = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
            throw new Error('Invalid encrypted Google credential');
        }

        const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(secret), iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
        if (error.message === 'Server secret is required to protect Google credentials') throw error;
        throw new Error('Could not decrypt Google credential');
    }
}

function readGoogleCredentials(user, config) {
    return {
        accessToken: decryptGoogleCredential(user.googleAccessTokenEncrypted, config.secret),
        refreshToken: decryptGoogleCredential(user.googleRefreshTokenEncrypted, config.secret),
    };
}

function writeGoogleCredentials(user, config, { accessToken, refreshToken }) {
    if (accessToken !== undefined) {
        user.googleAccessTokenEncrypted = encryptGoogleCredential(accessToken, config.secret);
    }
    if (refreshToken != null) {
        user.googleRefreshTokenEncrypted = encryptGoogleCredential(refreshToken, config.secret);
    }
}

module.exports = {
    encryptGoogleCredential,
    decryptGoogleCredential,
    readGoogleCredentials,
    writeGoogleCredentials,
};
