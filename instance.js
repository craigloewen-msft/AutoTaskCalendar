/**
 * Per-instance environment resolution.
 *
 * Several AutoTaskCalendar instances can run on one host at once (one per agent, or per
 * git worktree). Ports, the database, and the session cookie are all derived from one
 * instance name, so instances never collide.
 *
 * MongoDB is the exception: every instance shares one container on one port, and isolation
 * comes from the per-instance database name. See docs/DEV_DATABASE.md.
 *
 * The name is detected automatically from the git branch, so nothing needs to be exported
 * by hand. Set AUTOTASKCALENDAR_INSTANCE to override it.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const BASE_PORTS = {
    apiPort: 3000,
    webPort: 8080,
    mongoPort: 27017,
    inspectPort: 9229,
};

// Ports are allocated in blocks of 10, so offset N uses 3000+N*10, 8080+N*10, etc.
const PORT_STRIDE = 10;
const MAX_OFFSET = 49;

// Trunk branches map to the "default" instance, which keeps the historical ports.
const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk']);

/**
 * Reduce an arbitrary name to a filesystem/DNS/Mongo-safe token.
 */
function slugify(rawName) {
    const slug = String(rawName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || 'default';
}

/**
 * Detect the instance name from the current git branch, falling back to the directory
 * name when git is unavailable (tarball checkout, detached HEAD, no git installed).
 */
function detectName() {
    const explicit = process.env.AUTOTASKCALENDAR_INSTANCE;

    if (explicit) {
        return slugify(explicit);
    }

    let branch = '';

    try {
        branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        // Not a git checkout, or git is missing: fall through to the directory name.
    }

    if (!branch || branch === 'HEAD') {
        branch = path.basename(__dirname);
    }

    if (DEFAULT_BRANCHES.has(branch)) {
        return 'default';
    }

    return slugify(branch);
}

/** FNV-1a. Short, dependency-free, and stable across Node versions. */
function fnv1a(name) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash >>> 0;
}

/**
 * The instance's preferred port offset. Only 49 blocks exist, so collisions are routine;
 * scripts/port-allocator.js treats this as a starting point.
 */
function hashToOffset(name) {
    // Offset 0 is reserved for the "default" instance.
    return (fnv1a(name) % MAX_OFFSET) + 1;
}

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

// All instances share a single MongoDB container; each gets its own database inside it.
const SHARED_CONTAINER_NAME = 'autotaskcalendar-mongo';
const SHARED_VOLUME_NAME = 'autotaskcalendar-mongo-data';
const SHARED_CONTAINER_LABEL = 'autotaskcalendar.shared=mongo';

const DB_NAME_PREFIX = 'autotaskcalendar_';
// MongoDB rejects database names longer than 63 bytes.
const MAX_DB_NAME_LENGTH = 63;

/**
 * Build a Mongo-safe database name that always fits in 63 characters.
 *
 * The suffix is derived from the name, never the port offset: ports are allocated at
 * startup and can move, and a database that moved with them would silently come up empty.
 */
function buildDbName(name) {
    const normalized = name.replace(/-/g, '_');
    const full = `${DB_NAME_PREFIX}${normalized}`;

    if (full.length <= MAX_DB_NAME_LENGTH) {
        return full;
    }

    const suffix = `_${fnv1a(name).toString(36)}`;
    const room = MAX_DB_NAME_LENGTH - DB_NAME_PREFIX.length - suffix.length;

    return `${DB_NAME_PREFIX}${normalized.slice(0, room)}${suffix}`;
}

function resolveInstance() {
    const name = detectName();
    const offset = resolveOffset(name);

    const apiPort = resolvePort('AUTOTASKCALENDAR_API_PORT', BASE_PORTS.apiPort, offset);
    const webPort = resolvePort('AUTOTASKCALENDAR_WEB_PORT', BASE_PORTS.webPort, offset);
    // Every instance shares one MongoDB container, so the Mongo port is NOT offset by
    // instance: isolation comes from the per-instance database name instead.
    const mongoPort = resolvePort('AUTOTASKCALENDAR_MONGO_PORT', BASE_PORTS.mongoPort, 0);
    const inspectPort = resolvePort('AUTOTASKCALENDAR_INSPECT_PORT', BASE_PORTS.inspectPort, offset);

    // MongoDB caps database names at 63 bytes; truncate and append a hash of the name.
    const dbName = buildDbName(name);
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
        // Cookies are scoped by host and ignore the port, so each instance needs its own.
        sessionCookieName: `autotaskcalendar.sid.${name}`,
        // One shared container/volume for the whole host; see docs/DEV_DATABASE.md.
        containerName: SHARED_CONTAINER_NAME,
        volumeName: SHARED_VOLUME_NAME,
        containerLabel: SHARED_CONTAINER_LABEL,
    };
}

module.exports = resolveInstance();
module.exports.resolveInstance = resolveInstance;
// Port block arithmetic, used by scripts/port-allocator.js.
module.exports.BASE_PORTS = BASE_PORTS;
module.exports.PORT_STRIDE = PORT_STRIDE;
module.exports.MAX_OFFSET = MAX_OFFSET;
