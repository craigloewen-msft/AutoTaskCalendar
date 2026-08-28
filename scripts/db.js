#!/usr/bin/env node
/**
 * Make sure MongoDB is answering on localhost:27017.
 *
 * Under Kingdom the database is a declared shared resource (.kingdom/services.toml) that
 * the IDE raises; if anything already answers on the port we use it and never touch
 * Docker. Only outside Kingdom does this start a container of its own.
 *
 * Convergent either way: `dev`, `test`, and `seed` all call it freely.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTAINER_NAME = 'autotaskcalendar-mongo';
const VOLUME_NAME = 'autotaskcalendar-mongo-data';
const IMAGE = process.env.AUTOTASKCALENDAR_MONGO_IMAGE || 'mongo:7';

// Fixed, because every stack assumes its database is at localhost on this port.
const MONGO_PORT = Number.parseInt(process.env.AUTOTASKCALENDAR_MONGO_PORT, 10) || 27017;
const READY_TIMEOUT_MS = 90_000;
const LOCK_FILE = path.join(os.tmpdir(), 'autotaskcalendar-mongo.lock');
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
function pingDriverInstalled() {
    try {
        require.resolve('mongodb', { paths: [path.join(__dirname, '..')] });
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

/** Bring up our own container on the fixed port. Only reached outside Kingdom. */
function start() {
    const state = containerState();

    if (state === 'running') {
        return;
    }

    if (state !== 'missing') {
        if (docker(['start', CONTAINER_NAME], { stdio: 'ignore' }).status === 0) {
            return;
        }

        // It cannot start on the port it was built for; rebuild it.
        docker(['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
    }

    console.log(`Starting MongoDB (${IMAGE}) on port ${MONGO_PORT}...`);
    const error = createContainer(MONGO_PORT);

    if (error) {
        fail(
            `could not start MongoDB on port ${MONGO_PORT}:\n${error}\n` +
            'Something else may be holding the port; stop it, or point this stack elsewhere ' +
            'with AUTOTASKCALENDAR_MONGO_URL.'
        );
    }
}

/**
 * Ensure MongoDB is answering on MONGO_PORT, and return that port.
 *
 * Under Kingdom the container is already standing and this is a single ping. A plan must
 * never start, restart, or stop a shared resource the IDE owns.
 */
function ensureDatabase() {
    if (!pingDriverInstalled()) {
        fail(
            'Cannot check MongoDB: the "mongodb" package is not installed.\n' +
            'Install dependencies first:  npm install'
        );
    }

    if (respondsToPing(MONGO_PORT)) {
        return MONGO_PORT;
    }

    startDaemon();

    withLock(() => {
        // Another process may have started it while we waited for the lock.
        if (respondsToPing(MONGO_PORT)) return;

        start();

        if (!waitUntilReady(MONGO_PORT)) {
            fail(
                `MongoDB did not become ready within ${READY_TIMEOUT_MS / 1000}s.\n` +
                `Inspect it with:  docker logs ${CONTAINER_NAME}`
            );
        }
    });

    return MONGO_PORT;
}

module.exports = { ensureDatabase, CONTAINER_NAME, VOLUME_NAME, IMAGE, MONGO_PORT };

if (require.main === module) {
    console.log(`MongoDB ready on port ${ensureDatabase()}`);
}
