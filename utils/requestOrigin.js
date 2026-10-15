/**
 * The origin the browser actually used to reach us.
 *
 * In development a stack is often reached through a forwarded port (an agent container or
 * network namespace), so the app's own `localhost:8080` is not what the browser typed.
 * Reading the origin off each request keeps the app port- and host-agnostic with no
 * per-instance configuration. See docs/PROXIED_ACCESS.md.
 */

'use strict';

/** Takes the first entry of a possibly comma-separated forwarded header. */
function firstHop(value) {
    if (typeof value !== 'string') return '';

    return value.split(',')[0].trim();
}

/**
 * Build `scheme://host[:port]` from the forwarding headers, falling back to `Host`.
 *
 * Deliberately uses the raw headers rather than `req.hostname`, which strips the port —
 * the port is the whole point when every stack differs only by it.
 */
function resolveRequestOrigin(req) {
    const forwardedHost = firstHop(req.get('X-Forwarded-Host'));
    const host = forwardedHost || firstHop(req.get('Host'));
    if (!host) return null;

    const forwardedProto = firstHop(req.get('X-Forwarded-Proto'));
    const protocol = forwardedProto || (req.secure ? 'https' : 'http');

    try {
        return new URL(`${protocol}://${host}`).origin;
    } catch (error) {
        return null;
    }
}

module.exports = { resolveRequestOrigin };
