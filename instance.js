/**
 * Per-instance environment resolution.
 *
 * Several AutoTaskCalendar instances can run on one host at once (one per agent, or per
 * git worktree). The instance name comes from the git branch, so nothing needs to be
 * exported by hand; set AUTOTASKCALENDAR_INSTANCE to override it.
 *
 * Isolation has two halves:
 *   - data:  each instance gets its own database inside one shared MongoDB container.
 *   - ports: each stack claims the first free ports, so instances never collide.
 */

'use strict';

const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_PORTS = {
    apiPort: 3000,
    webPort: 8080,
    inspectPort: 9229,
};

const MONGO_PORT = 27017;

// Trunk branches map to the "default" instance, which keeps the historical ports.
const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk']);

const DB_NAME_PREFIX = 'autotaskcalendar_';
// MongoDB rejects database names longer than 63 bytes.
const MAX_DB_NAME_LENGTH = 63;

/** Reduce an arbitrary name to a filesystem/DNS/Mongo-safe token. */
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
    if (process.env.AUTOTASKCALENDAR_INSTANCE) {
        return slugify(process.env.AUTOTASKCALENDAR_INSTANCE);
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

    return DEFAULT_BRANCHES.has(branch) ? 'default' : slugify(branch);
}

/**
 * Build a Mongo-safe database name that always fits in 63 characters.
 *
 * Long names are truncated with a hash of the full name appended, so two branches sharing
 * a prefix still get separate databases.
 */
function buildDbName(name) {
    const full = `${DB_NAME_PREFIX}${name.replace(/-/g, '_')}`;

    if (full.length <= MAX_DB_NAME_LENGTH) {
        return full;
    }

    const suffix = `_${createHash('sha1').update(name).digest('hex').slice(0, 8)}`;

    return full.slice(0, MAX_DB_NAME_LENGTH - suffix.length) + suffix;
}

// Binds every port before reporting any, so one call cannot hand back a duplicate.
const PORT_PROBE = `
const net = require('net');
const { bases, skip } = JSON.parse(process.argv[1]);
const taken = new Set(skip);
const held = [];
const chosen = [];

function bind(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(null));
        server.once('listening', () => resolve(server));
        server.listen(port, '0.0.0.0');
    });
}

(async () => {
    for (const base of bases) {
        let found = false;
        for (let port = base; port < base + 500; port++) {
            if (taken.has(port)) continue;
            const server = await bind(port);
            if (server) {
                held.push(server);
                chosen.push(port);
                taken.add(port);
                found = true;
                break;
            }
        }
        if (!found) process.exit(1);
    }
    for (const server of held) server.close();
    process.stdout.write(chosen.join(','));
})();
`;

// Ports are handed to child processes, so a probe alone cannot reserve them: between
// choosing a port and the child binding it, another instance would probe the same free
// port and win. Claims are therefore recorded here and honoured by later probes.
const CLAIM_FILE = path.join(os.tmpdir(), 'autotaskcalendar-ports.json');
const CLAIM_LOCK = path.join(os.tmpdir(), 'autotaskcalendar-ports.lock');
const CLAIM_LOCK_STALE_MS = 30_000;

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Serialize claims across processes, so two instances cannot claim the same port. */
function withClaimLock(fn) {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            fs.mkdirSync(CLAIM_LOCK);

            try {
                return fn();
            } finally {
                fs.rmSync(CLAIM_LOCK, { recursive: true, force: true });
            }
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;

            const age = Date.now() - fs.statSync(CLAIM_LOCK).mtimeMs;

            if (age > CLAIM_LOCK_STALE_MS) {
                fs.rmSync(CLAIM_LOCK, { recursive: true, force: true });
            } else {
                sleepSync(50);
            }
        }
    }

    // Never block start-up on the bookkeeping; a bare probe is still usually correct.
    return fn();
}

function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

/** Ports claimed by instances that are still running. Dead claims are forgotten. */
function readClaims() {
    let claims = {};

    try {
        claims = JSON.parse(fs.readFileSync(CLAIM_FILE, 'utf8'));
    } catch {
        return {};
    }

    const live = {};

    for (const [port, pid] of Object.entries(claims)) {
        if (processIsAlive(pid)) live[port] = pid;
    }

    return live;
}

/**
 * Claim a free port at or after each base.
 *
 * One child process handles them all: instance.js is required at module load by app.js
 * and the scripts, none of which can await, and binding a socket has no synchronous API.
 */
function findFreePorts(bases) {
    if (bases.length === 0) {
        return [];
    }

    return withClaimLock(() => {
        const claims = readClaims();
        const request = JSON.stringify({ bases, skip: Object.keys(claims).map(Number) });
        let output = '';

        try {
            output = execFileSync(process.execPath, ['-e', PORT_PROBE, request], {
                encoding: 'utf8',
            }).trim();
        } catch {
            throw new Error(`No free ports available at or after ${bases.join(', ')}.`);
        }

        const ports = output.split(',').map((port) => Number.parseInt(port, 10));

        for (const port of ports) claims[port] = process.pid;
        try {
            fs.writeFileSync(CLAIM_FILE, JSON.stringify(claims));
        } catch {
            // Bookkeeping only: a failed write costs isolation, not correctness.
        }

        return ports;
    });
}

function parsePort(envVarName, value) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`${envVarName} must be an integer between 1 and 65535, got "${value}"`);
    }

    return parsed;
}

/**
 * Resolve app ports, preferring pinned values from the environment.
 *
 * dev.js and test.js resolve once and export the result, so every child process in a
 * stack agrees on the same numbers.
 */
function resolveAppPorts() {
    const wanted = [
        ['apiPort', 'AUTOTASKCALENDAR_API_PORT', BASE_PORTS.apiPort],
        ['webPort', 'AUTOTASKCALENDAR_WEB_PORT', BASE_PORTS.webPort],
        ['inspectPort', 'AUTOTASKCALENDAR_INSPECT_PORT', BASE_PORTS.inspectPort],
    ];

    const ports = {};
    const toProbe = wanted.filter(([key, envVarName, base]) => {
        const override = process.env[envVarName];

        if (override === undefined || override === '') {
            return true;
        }

        ports[key] = parsePort(envVarName, override);
        return false;
    });

    const probed = findFreePorts(toProbe.map(([, , base]) => base));

    toProbe.forEach(([key], index) => {
        ports[key] = probed[index];
    });

    return ports;
}

/**
 * The port the shared MongoDB container is published on.
 *
 * `scripts/db.js` records it when it starts the container, because the default can be
 * unavailable and it then publishes on the next free port instead.
 */
function resolveMongoPort() {
    if (process.env.AUTOTASKCALENDAR_MONGO_PORT) {
        return parsePort('AUTOTASKCALENDAR_MONGO_PORT', process.env.AUTOTASKCALENDAR_MONGO_PORT);
    }

    const recorded = Number.parseInt(
        fs.readFileSync(path.join(os.tmpdir(), 'autotaskcalendar-mongo.port'), 'utf8').trim(),
        10
    );

    return Number.isInteger(recorded) ? recorded : MONGO_PORT;
}

const cache = new Map();

/**
 * Resolve the current instance.
 *
 * Memoized per process: probing twice would claim a second set of ports and the two
 * halves of a stack would then disagree about where the app is.
 */
function resolveInstance() {
    const key = [
        detectName(),
        process.env.AUTOTASKCALENDAR_API_PORT,
        process.env.AUTOTASKCALENDAR_WEB_PORT,
        process.env.AUTOTASKCALENDAR_INSPECT_PORT,
        process.env.AUTOTASKCALENDAR_MONGO_PORT,
        process.env.AUTOTASKCALENDAR_MONGO_URL,
    ].join('|');

    if (!cache.has(key)) {
        cache.set(key, buildInstance());
    }

    return cache.get(key);
}

function buildInstance() {
    const name = detectName();
    const { apiPort, webPort, inspectPort } = resolveAppPorts();

    // Every instance talks to the same container; isolation comes from the database name.
    let mongoPort = MONGO_PORT;

    try {
        mongoPort = resolveMongoPort();
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const dbName = buildDbName(name);
    const mongoUrl =
        process.env.AUTOTASKCALENDAR_MONGO_URL || `mongodb://127.0.0.1:${mongoPort}/${dbName}`;

    return {
        name,
        apiPort,
        webPort,
        mongoPort,
        inspectPort,
        dbName,
        mongoUrl,
        // Cookies are scoped by host and ignore the port, so each instance needs its own.
        sessionCookieName: `autotaskcalendar.sid.${name}`,
    };
}

// Resolved on first property access rather than on require, so merely importing this
// module never claims ports.
module.exports = { resolveInstance };

for (const field of [
    'name',
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
