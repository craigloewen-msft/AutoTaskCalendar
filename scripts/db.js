#!/usr/bin/env node
/**
 * Start the shared MongoDB container.
 *
 * Every instance on this host talks to one container and is isolated by database name, so
 * this is convergent: `dev`, `test`, and `seed` all call it freely.
 *
 * The running container is the source of truth for the port. If the default is taken we
 * publish on the next free one and report it back, so a busy host cannot block startup.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTAINER_NAME = 'autotaskcalendar-mongo';
const VOLUME_NAME = 'autotaskcalendar-mongo-data';
const IMAGE = process.env.AUTOTASKCALENDAR_MONGO_IMAGE || 'mongo:7';

const DEFAULT_PORT = 27017;
const READY_TIMEOUT_MS = 90_000;
const LOCK_FILE = path.join(os.tmpdir(), 'autotaskcalendar-mongo.lock');
// Records the port in use, so a one-off script can find the database without asking Docker.
const PORT_FILE = path.join(os.tmpdir(), 'autotaskcalendar-mongo.port');
const LOCK_STALE_MS = 180_000;

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function docker(args, options = {}) {
    return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

function daemonIsUp() {
    return docker(['info'], { stdio: 'ignore' }).status === 0;
}

/** Docker is often installed but not enabled at boot, so try to start it. */
function startDaemon() {
    if (daemonIsUp()) {
        return;
    }

    spawnSync('sudo', ['-n', 'systemctl', 'start', 'docker'], { stdio: 'ignore' });

    if (!daemonIsUp()) {
        fail(
            'the Docker daemon is not running and could not be started automatically.\n' +
            'Start it with:  sudo systemctl enable --now docker'
        );
    }
}

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

function inspect(format) {
    const result = docker(['inspect', '-f', format, CONTAINER_NAME]);

    return result.status === 0 ? result.stdout.trim() : null;
}

/** 'missing' | 'running' | 'exited' | 'created' | ... */
function containerState() {
    return inspect('{{.State.Status}}') ?? 'missing';
}

/** The host port the existing container publishes 27017 on. */
function publishedPort() {
    const raw = inspect('{{(index (index .NetworkSettings.Ports "27017/tcp") 0).HostPort}}');
    const port = Number.parseInt(raw, 10);

    return Number.isInteger(port) ? port : null;
}

/**
 * Find a bindable port at or after `base`.
 *
 * A port can be unbindable with nothing visibly listening on it — WSL's mirrored
 * networking leaves ghost reservations behind — so probe rather than assume.
 */
function findFreePort(base) {
    const script = `
        const net = require('net');
        const base = Number(process.argv[1]);
        (async () => {
            for (let port = base; port < base + 200; port++) {
                const free = await new Promise((resolve) => {
                    const server = net.createServer();
                    server.once('error', () => resolve(false));
                    server.once('listening', () => server.close(() => resolve(true)));
                    server.listen(port, '0.0.0.0');
                });
                if (free) return process.stdout.write(String(port));
            }
            process.exit(1);
        })();
    `;

    const result = spawnSync(process.execPath, ['-e', script, String(base)], {
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        fail(`no free port available at or after ${base}.`);
    }

    return Number.parseInt(result.stdout.trim(), 10);
}

function createContainer(port) {
    const result = docker([
        'run', '-d',
        '--name', CONTAINER_NAME,
        '--restart', 'unless-stopped',
        '-p', `${port}:27017`,
        '-v', `${VOLUME_NAME}:/data/db`,
        IMAGE,
    ]);

    if (result.status !== 0) {
        // `docker run` leaves the container behind when the port bind fails, and a stale
        // one would poison every later run.
        docker(['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
        return result.stderr.trim();
    }

    return null;
}

const PING = `
const { MongoClient } = require('mongodb');
MongoClient.connect(process.argv[1], { serverSelectionTimeoutMS: 2000 })
    .then((client) => client.db().admin().ping().then(() => client.close()))
    .catch(() => process.exit(1));
`;

// The ping runs in a subprocess that requires the driver, so a missing install would
// otherwise look exactly like a database that never answers.
function pingDriverInstalled(root = path.join(__dirname, '..')) {
    try {
        require.resolve('mongodb', { paths: [root] });
        return true;
    } catch (error) {
        return false;
    }
}

/** Connect through the published port, exactly the route the app uses. */
function respondsToPing(port) {
    const result = spawnSync(process.execPath, ['-e', PING, `mongodb://127.0.0.1:${port}/admin`], {
        cwd: path.join(__dirname, '..'),
        stdio: 'ignore',
    });

    return result.status === 0;
}

function waitUntilReady(port) {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (respondsToPing(port)) {
            return true;
        }
        if (containerState() === 'exited') {
            return false;
        }
        sleepSync(500);
    }

    return false;
}

/**
 * Serialize concurrent callers, so two agents starting at once cannot both try to create
 * the container.
 */
function withLock(fn) {
    const deadline = Date.now() + LOCK_STALE_MS;
    let handle = null;

    while (handle === null && Date.now() < deadline) {
        try {
            handle = fs.openSync(LOCK_FILE, 'wx');
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;

            // Reclaim a lock orphaned by a killed process.
            const stat = fs.statSync(LOCK_FILE, { throwIfNoEntry: false });
            if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                fs.rmSync(LOCK_FILE, { force: true });
                continue;
            }

            sleepSync(250);
        }
    }

    try {
        return fn();
    } finally {
        if (handle !== null) {
            fs.closeSync(handle);
            fs.rmSync(LOCK_FILE, { force: true });
        }
    }
}

function start() {
    const state = containerState();

    if (state === 'running') {
        return publishedPort() ?? DEFAULT_PORT;
    }

    if (state !== 'missing') {
        const existing = publishedPort();

        if (docker(['start', CONTAINER_NAME], { stdio: 'ignore' }).status === 0) {
            return existing ?? DEFAULT_PORT;
        }

        // Its published port was taken while it was stopped; rebuild it on a free one.
        docker(['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
    }

    const wanted = Number.parseInt(process.env.AUTOTASKCALENDAR_MONGO_PORT, 10) || DEFAULT_PORT;

    for (let attempt = 0; attempt < 5; attempt++) {
        const port = findFreePort(attempt === 0 ? wanted : wanted + 1 + attempt);

        console.log(`Starting MongoDB (${IMAGE}) on port ${port}...`);
        const error = createContainer(port);

        if (!error) {
            return port;
        }

        // Another process can claim the port between the probe and the bind.
        if (!/address already in use|port is already allocated/i.test(error)) {
            fail(`could not start MongoDB:\n${error}`);
        }
    }

    return fail('could not find a bindable port for MongoDB.');
}

/**
 * Ensure MongoDB is up, and return the host port it is listening on.
 *
 * Also exports AUTOTASKCALENDAR_MONGO_PORT so instance.js and every child process agree.
 */
function ensureDatabase() {
    if (!pingDriverInstalled()) {
        fail(
            'Cannot check MongoDB: the "mongodb" package is not installed.\n' +
            'Install dependencies first:  npm install'
        );
    }

    startDaemon();

    const port = withLock(() => {
        const chosen = start();

        if (!waitUntilReady(chosen)) {
            fail(
                `MongoDB did not become ready within ${READY_TIMEOUT_MS / 1000}s.\n` +
                `Inspect it with:  docker logs ${CONTAINER_NAME}`
            );
        }

        return chosen;
    });

    process.env.AUTOTASKCALENDAR_MONGO_PORT = String(port);
    fs.writeFileSync(PORT_FILE, String(port));

    return port;
}

module.exports = {
    ensureDatabase,
    pingDriverInstalled,
    CONTAINER_NAME,
    VOLUME_NAME,
    IMAGE,
    PORT_FILE,
};

if (require.main === module) {
    console.log(`MongoDB ready on port ${ensureDatabase()}`);
}
