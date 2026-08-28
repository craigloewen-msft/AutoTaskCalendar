/**
 * Fixed environment for this app.
 *
 * Everything is a constant: the API, web, and inspect ports, and one shared MongoDB at
 * localhost:27017 holding one database. Isolation between agents is the IDE's job —
 * each plan gets its own loopback, so every stack can use the same numbers — and
 * isolation between tests is by seed namespace inside the shared database.
 * See docs/SHARED_DATABASE.md.
 *
 * Each value can still be pinned from the environment, which is what a second stack on
 * one unisolated host needs.
 */

'use strict';

const DEFAULTS = {
    apiPort: 3000,
    webPort: 8080,
    inspectPort: 9229,
    mongoPort: 27017,
};

const DB_NAME = 'autotaskcalendar';

function parsePort(envVarName, value) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`${envVarName} must be an integer between 1 and 65535, got "${value}"`);
    }

    return parsed;
}

function port(envVarName, fallback) {
    const override = process.env[envVarName];

    if (override === undefined || override === '') {
        return fallback;
    }

    return parsePort(envVarName, override);
}

/** The seed tenant prefix for this checkout. Only seeding cares. */
function resolveNamespace() {
    const raw = process.env.AUTOTASKCALENDAR_INSTANCE || 'local';
    const slug = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    return slug || 'local';
}

function resolveInstance() {
    const apiPort = port('AUTOTASKCALENDAR_API_PORT', DEFAULTS.apiPort);
    const webPort = port('AUTOTASKCALENDAR_WEB_PORT', DEFAULTS.webPort);
    const inspectPort = port('AUTOTASKCALENDAR_INSPECT_PORT', DEFAULTS.inspectPort);
    const mongoPort = port('AUTOTASKCALENDAR_MONGO_PORT', DEFAULTS.mongoPort);

    return {
        name: resolveNamespace(),
        namespace: resolveNamespace(),
        apiPort,
        webPort,
        inspectPort,
        mongoPort,
        dbName: DB_NAME,
        mongoUrl:
            process.env.AUTOTASKCALENDAR_MONGO_URL
            || `mongodb://127.0.0.1:${mongoPort}/${DB_NAME}`,
        sessionCookieName: 'autotaskcalendar.sid',
    };
}

module.exports = { resolveInstance, DB_NAME };

for (const field of [
    'name',
    'namespace',
    'apiPort',
    'webPort',
    'mongoPort',
    'inspectPort',
    'dbName',
    'mongoUrl',
    'sessionCookieName',
]) {
    Object.defineProperty(module.exports, field, {
        enumerable: true,
        get: () => resolveInstance()[field],
    });
}
