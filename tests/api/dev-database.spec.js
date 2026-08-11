const { test, expect } = require('../fixtures');
const { execFileSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const { resolveInstance } = require('../../instance');

const repoRoot = path.join(__dirname, '..', '..');
const devDb = path.join(repoRoot, 'scripts', 'dev-db.sh');

// Resolve an instance descriptor for an arbitrary name, without ambient overrides leaking in.
function resolveNamed(name, extraEnv = {}) {
    const overridden = {
        AUTOTASKCALENDAR_INSTANCE: name,
        AUTOTASKCALENDAR_PORT_OFFSET: undefined,
        AUTOTASKCALENDAR_API_PORT: undefined,
        AUTOTASKCALENDAR_WEB_PORT: undefined,
        AUTOTASKCALENDAR_MONGO_PORT: undefined,
        AUTOTASKCALENDAR_INSPECT_PORT: undefined,
        AUTOTASKCALENDAR_MONGO_URL: undefined,
        ...extraEnv,
    };
    const saved = {};

    for (const [key, value] of Object.entries(overridden)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }

    try {
        return resolveInstance();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function wslcAvailable() {
    try {
        execFileSync('bash', ['-c', 'command -v wslc'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Count the shared mongo containers wslc knows about.
function sharedContainerCount() {
    const raw = execFileSync('bash', ['-c', 'wslc list --all --format json 2>/dev/null || true'], {
        encoding: 'utf8',
    });

    let parsed = [];
    try {
        parsed = JSON.parse(raw.replace(/\r/g, ''));
    } catch {
        return 0;
    }

    return (Array.isArray(parsed) ? parsed : [])
        .filter(entry => entry?.Name === 'autotaskcalendar-mongo').length;
}

// Write one document into a scratch database on the shared server.
async function writeMarker(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl, {
        serverSelectionTimeoutMS: 10_000,
    }).asPromise();
    await connection.collection('markers').insertOne({ marker: true });
    await connection.close();
}

async function countMarkers(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl, {
        serverSelectionTimeoutMS: 10_000,
    }).asPromise();
    const count = await connection.collection('markers').countDocuments();
    await connection.close();
    return count;
}

async function dropDatabase(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl, {
        serverSelectionTimeoutMS: 10_000,
    }).asPromise();
    await connection.dropDatabase();
    await connection.close();
}

test.describe('shared dev database', () => {
    test('gives every instance the same container, volume and mongo port', () => {
        const a = resolveNamed('shared-db-spec-a');
        const b = resolveNamed('shared-db-spec-b');

        expect(a.containerName).toBe('autotaskcalendar-mongo');
        expect(a.volumeName).toBe('autotaskcalendar-mongo-data');
        expect(b.containerName).toBe(a.containerName);
        expect(b.volumeName).toBe(a.volumeName);
        expect(b.mongoPort).toBe(a.mongoPort);
    });

    test('still isolates instances by database name and app ports', () => {
        const a = resolveNamed('shared-db-spec-a');
        const b = resolveNamed('shared-db-spec-b');

        expect(a.dbName).not.toBe(b.dbName);
        expect(a.apiPort).not.toBe(b.apiPort);
        expect(a.webPort).not.toBe(b.webPort);
        expect(a.inspectPort).not.toBe(b.inspectPort);
    });

    test('honours an explicit shared mongo port override', () => {
        const overridden = resolveNamed('shared-db-spec-a', {
            AUTOTASKCALENDAR_MONGO_PORT: '31234',
        });

        expect(overridden.mongoPort).toBe(31234);
        expect(overridden.mongoUrl).toContain('127.0.0.1:31234');
    });

    test('keeps long branch names inside MongoDB 63-byte database names', () => {
        const long = 'feature/'.padEnd(120, 'x');
        const a = resolveNamed(`${long}-one`);
        const b = resolveNamed(`${long}-two`);

        expect(a.dbName.length).toBeLessThanOrEqual(63);
        expect(b.dbName.length).toBeLessThanOrEqual(63);
        expect(a.dbName).not.toBe(b.dbName);
    });

    test('up is idempotent and leaves exactly one container', async () => {
        test.skip(!wslcAvailable(), 'wslc is not available on this host');
        test.slow();

        execFileSync(devDb, ['up'], { cwd: repoRoot, stdio: 'ignore' });
        execFileSync(devDb, ['up'], { cwd: repoRoot, stdio: 'ignore' });

        expect(sharedContainerCount()).toBe(1);
    });

    test('down drops only the calling instance database', async () => {
        test.skip(!wslcAvailable(), 'wslc is not available on this host');
        test.slow();

        const victim = resolveNamed('shared-db-spec-victim');
        const bystander = resolveNamed('shared-db-spec-bystander');

        // Start from a clean slate so a retry does not inherit the previous attempt's data.
        await dropDatabase(victim.mongoUrl);
        await dropDatabase(bystander.mongoUrl);

        await writeMarker(victim.mongoUrl);
        await writeMarker(bystander.mongoUrl);
        expect(await countMarkers(victim.mongoUrl)).toBe(1);

        // The test harness exports a pinned MONGO_URL; drop it so the subprocess resolves
        // the victim instance's own database.
        const env = { ...process.env, AUTOTASKCALENDAR_INSTANCE: 'shared-db-spec-victim' };
        delete env.AUTOTASKCALENDAR_MONGO_URL;
        delete env.AUTOTASKCALENDAR_PORT_OFFSET;

        execFileSync(devDb, ['down'], { cwd: repoRoot, stdio: 'ignore', env });

        expect(await countMarkers(victim.mongoUrl)).toBe(0);
        // The shared server, and every other instance's data, is untouched.
        expect(await countMarkers(bystander.mongoUrl)).toBe(1);
        expect(sharedContainerCount()).toBe(1);

        await dropDatabase(bystander.mongoUrl);
    });
});
