/**
 * Per-instance environment resolution.
 *
 * AutoTaskCalendar supports running several fully isolated instances on one host at the
 * same time (for example, one per AI agent or per git worktree). Everything that could
 * collide between instances -- TCP ports, the MongoDB database, the container and volume
 * names, and the session cookie -- is derived from a single input:
 *
 *     AUTOTASKCALENDAR_INSTANCE   (default: "default")
 *
 * This module is the single source of truth for that derivation. Both the Node app and
 * scripts/dev-db.sh read it, so the two can never disagree about which port or database
 * belongs to an instance.
 */

'use strict';

const BASE_PORTS = {
    apiPort: 3000,
    webPort: 8080,
    mongoPort: 27017,
    inspectPort: 9229,
};

// Ports are allocated in blocks of 10, so offset N uses 3000+N*10, 8080+N*10, etc.
// Offsets are capped so that the highest port (27017 + 49*10 = 27507) stays well clear
// of the ephemeral port range.
const PORT_STRIDE = 10;
const MAX_OFFSET = 49;

/**
 * Reduce an arbitrary instance name to a filesystem/DNS/Mongo-safe token.
 */
function slugify(rawName) {
    const slug = String(rawName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || 'default';
}

/**
 * FNV-1a. Chosen because it is short, dependency-free, and stable across Node versions --
 * the same instance name must always map to the same ports, on every machine and forever.
 */
function hashToOffset(name) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        // 32-bit FNV prime multiply, kept in unsigned range.
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    // Offset 0 is reserved for the "default" instance so its ports match the historical
    // 3000/8080/27017 values that docs, bookmarks, and OAuth redirect URIs assume.
    return (hash % MAX_OFFSET) + 1;
}

/**
 * Read a port from the environment, falling back to the offset-derived value.
 */
function resolvePort(envVarName, basePort, offset) {
    const override = process.env[envVarName];

    if (override === undefined || override === '') {
        return basePort + offset * PORT_STRIDE;
    }

    const parsed = Number.parseInt(override, 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(
            `${envVarName} must be an integer between 1 and 65535, got "${override}"`
        );
    }

    return parsed;
}

function resolveOffset(name) {
    const override = process.env.AUTOTASKCALENDAR_PORT_OFFSET;

    if (override !== undefined && override !== '') {
        const parsed = Number.parseInt(override, 10);

        if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_OFFSET) {
            throw new Error(
                `AUTOTASKCALENDAR_PORT_OFFSET must be an integer between 0 and ${MAX_OFFSET}, ` +
                `got "${override}"`
            );
        }

        return parsed;
    }

    return name === 'default' ? 0 : hashToOffset(name);
}

function resolveInstance() {
    const name = slugify(process.env.AUTOTASKCALENDAR_INSTANCE || 'default');
    const offset = resolveOffset(name);

    const apiPort = resolvePort('AUTOTASKCALENDAR_API_PORT', BASE_PORTS.apiPort, offset);
    const webPort = resolvePort('AUTOTASKCALENDAR_WEB_PORT', BASE_PORTS.webPort, offset);
    const mongoPort = resolvePort('AUTOTASKCALENDAR_MONGO_PORT', BASE_PORTS.mongoPort, offset);
    const inspectPort = resolvePort('AUTOTASKCALENDAR_INSPECT_PORT', BASE_PORTS.inspectPort, offset);

    const dbName = `autotaskcalendar_${name.replace(/-/g, '_')}`;
    const mongoUrl =
        process.env.AUTOTASKCALENDAR_MONGO_URL ||
        `mongodb://127.0.0.1:${mongoPort}/${dbName}`;

    return {
        name,
        offset,
        apiPort,
        webPort,
        mongoPort,
        inspectPort,
        dbName,
        mongoUrl,
        // Session cookies are scoped by host, not port, so two instances on localhost
        // would otherwise clobber each other's login state.
        sessionCookieName: `autotaskcalendar.sid.${name}`,
        containerName: `autotaskcalendar-mongo-${name}`,
        volumeName: `autotaskcalendar-mongo-data-${name}`,
        containerLabel: `autotaskcalendar.instance=${name}`,
    };
}

module.exports = resolveInstance();
module.exports.resolveInstance = resolveInstance;
