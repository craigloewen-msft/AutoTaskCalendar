/**
 * Per-instance environment resolution.
 *
 * Several AutoTaskCalendar instances can run on one host at once (one per agent, or per
 * git worktree). Ports, the database, container/volume names, and the session cookie are
 * all derived from one instance name, so instances never collide.
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

/**
 * FNV-1a. Short, dependency-free, and stable across Node versions, so a given name always
 * maps to the same ports.
 */
function hashToOffset(name) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    // Offset 0 is reserved for the "default" instance.
    return (hash % MAX_OFFSET) + 1;
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

const DB_NAME_PREFIX = 'autotaskcalendar_';
// MongoDB rejects database names longer than 63 bytes.
const MAX_DB_NAME_LENGTH = 63;

/**
 * Build a Mongo-safe database name that always fits in 63 characters.
 *
 * Long branch names are truncated, with the port offset appended so two branches that
 * share a prefix still get separate databases.
 */
function buildDbName(name, offset) {
    const normalized = name.replace(/-/g, '_');
    const full = `${DB_NAME_PREFIX}${normalized}`;

    if (full.length <= MAX_DB_NAME_LENGTH) {
        return full;
    }

    const suffix = `_${offset}`;
    const room = MAX_DB_NAME_LENGTH - DB_NAME_PREFIX.length - suffix.length;

    return `${DB_NAME_PREFIX}${normalized.slice(0, room)}${suffix}`;
}

function resolveInstance() {
    const name = detectName();
    const offset = resolveOffset(name);

    const apiPort = resolvePort('AUTOTASKCALENDAR_API_PORT', BASE_PORTS.apiPort, offset);
    const webPort = resolvePort('AUTOTASKCALENDAR_WEB_PORT', BASE_PORTS.webPort, offset);
    const mongoPort = resolvePort('AUTOTASKCALENDAR_MONGO_PORT', BASE_PORTS.mongoPort, offset);
    const inspectPort = resolvePort('AUTOTASKCALENDAR_INSPECT_PORT', BASE_PORTS.inspectPort, offset);

    // MongoDB caps database names at 63 bytes, and branch names can be long. Truncate the
    // name portion and keep the port offset as a suffix so distinct instances stay distinct.
    const dbName = buildDbName(name, offset);
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
        containerName: `autotaskcalendar-mongo-${name}`,
        volumeName: `autotaskcalendar-mongo-data-${name}`,
        containerLabel: `autotaskcalendar.instance=${name}`,
    };
}

module.exports = resolveInstance();
module.exports.resolveInstance = resolveInstance;
