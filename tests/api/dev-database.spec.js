const { test, expect } = require('../fixtures');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const { resolveInstance } = require('../../instance');
const { CONTAINER_NAME } = require('../../scripts/db');

const repoRoot = path.join(__dirname, '..', '..');

// Resolve an instance descriptor for an arbitrary name, without ambient overrides leaking in.
function resolveNamed(name, extraEnv = {}) {
    const overridden = {
        AUTOTASKCALENDAR_INSTANCE: name,
        AUTOTASKCALENDAR_API_PORT: undefined,
        AUTOTASKCALENDAR_WEB_PORT: undefined,
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

function runningContainerCount() {
    const raw = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], {
        encoding: 'utf8',
    });

    return raw.split('\n').filter((name) => name.trim() === CONTAINER_NAME).length;
}

async function countMarkers(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    const count = await connection.collection('markers').countDocuments();
    await connection.close();
    return count;
}

async function writeMarker(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    await connection.collection('markers').insertOne({ marker: true });
    await connection.close();
}

async function dropDatabase(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    await connection.dropDatabase();
    await connection.close();
}

test.describe('dev environment', () => {
    test('isolates instances by database name', () => {
        const a = resolveNamed('dev-env-spec-a');
        const b = resolveNamed('dev-env-spec-b');

        expect(a.dbName).toBe('autotaskcalendar_dev_env_spec_a');
        expect(b.dbName).not.toBe(a.dbName);
    });

    test('gives every instance the same mongo port', () => {
        const a = resolveNamed('dev-env-spec-a');
        const b = resolveNamed('dev-env-spec-b');

        // One container serves the whole host; isolation comes from the database name.
        expect(b.mongoPort).toBe(a.mongoPort);
    });

    test('keeps long branch names inside MongoDB 63-byte database names', () => {
        const long = 'feature/'.padEnd(120, 'x');
        const a = resolveNamed(`${long}-one`);
        const b = resolveNamed(`${long}-two`);

        expect(a.dbName.length).toBeLessThanOrEqual(63);
        expect(b.dbName.length).toBeLessThanOrEqual(63);
        expect(a.dbName).not.toBe(b.dbName);
    });

    test('derives a stable database name from the same instance name', () => {
        expect(resolveNamed('dev-env-spec-a').dbName)
            .toBe(resolveNamed('dev-env-spec-a').dbName);
    });

    test('honours pinned ports from the environment', () => {
        const pinned = resolveNamed('dev-env-spec-a', {
            AUTOTASKCALENDAR_API_PORT: '4567',
            AUTOTASKCALENDAR_WEB_PORT: '4568',
        });

        expect(pinned.apiPort).toBe(4567);
        expect(pinned.webPort).toBe(4568);
    });

    test('rejects a nonsense port override', () => {
        expect(() => resolveNamed('dev-env-spec-a', { AUTOTASKCALENDAR_API_PORT: 'abc' }))
            .toThrow(/must be an integer/);
    });

    test('resolves the same ports every time within one process', () => {
        // The API and the web proxy resolve separately; if they disagreed, the proxy
        // would forward to a port nothing is listening on.
        const first = resolveNamed('dev-env-spec-stable');
        const second = resolveNamed('dev-env-spec-stable');

        expect(second.apiPort).toBe(first.apiPort);
        expect(second.webPort).toBe(first.webPort);
        expect(second.inspectPort).toBe(first.inspectPort);
    });

    test('never hands two concurrent instances the same port', async () => {
        test.slow();

        // Two real processes, because that is the case that matters: two agents starting
        // stacks at the same time must not both be told port 3000 is free.
        const script = `
            const { resolveInstance } = require(${JSON.stringify(path.join(repoRoot, 'instance.js'))});
            const i = resolveInstance();
            process.stdout.write(JSON.stringify([i.apiPort, i.webPort, i.inspectPort]) + '\\n');
            setTimeout(() => {}, 5000);
        `;

        // The test runner pins its own ports through the environment; a child inheriting
        // them would skip port probing entirely, which is the thing under test.
        const env = { ...process.env };
        delete env.AUTOTASKCALENDAR_API_PORT;
        delete env.AUTOTASKCALENDAR_WEB_PORT;
        delete env.AUTOTASKCALENDAR_INSPECT_PORT;

        const resolveInChild = () => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['-e', script], { cwd: repoRoot, env });
            let out = '';

            child.stdout.on('data', (chunk) => {
                out += chunk;
                if (out.includes('\n')) resolve({ ports: JSON.parse(out.trim()), child });
            });
            child.on('error', reject);
            child.on('exit', () => reject(new Error(`child exited early: ${out}`)));
        });

        const first = await resolveInChild();

        try {
            const second = await resolveInChild();

            try {
                for (const port of second.ports) {
                    expect(first.ports).not.toContain(port);
                }
            } finally {
                second.child.kill();
            }
        } finally {
            first.child.kill();
        }
    });

    test('ensureDatabase is idempotent and leaves exactly one container', () => {
        test.slow();

        const db = path.join(repoRoot, 'scripts', 'db.js');
        execFileSync(process.execPath, [db], { cwd: repoRoot, stdio: 'ignore' });
        execFileSync(process.execPath, [db], { cwd: repoRoot, stdio: 'ignore' });

        expect(runningContainerCount()).toBe(1);
    });

    test('one instance database does not leak into another', async () => {
        const a = resolveNamed('dev-env-spec-marker-a');
        const b = resolveNamed('dev-env-spec-marker-b');

        await dropDatabase(a.mongoUrl);
        await dropDatabase(b.mongoUrl);

        await writeMarker(a.mongoUrl);

        expect(await countMarkers(a.mongoUrl)).toBe(1);
        expect(await countMarkers(b.mongoUrl)).toBe(0);

        await dropDatabase(a.mongoUrl);
    });
});
