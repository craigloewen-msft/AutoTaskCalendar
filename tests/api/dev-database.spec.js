const { test, expect } = require('../fixtures');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const { resolveInstance, resolveInstanceName } = require('../../instance');
const { CONTAINER_NAME } = require('../../scripts/db');

const repoRoot = path.join(__dirname, '..', '..');
const testRunNamespace = `pid-${process.pid}`;

function testInstanceName(name) {
    return `${name}-${testRunNamespace}`;
}

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
    test('instance naming stays isolated, stable, bounded, and accepts pinned ports', () => {
        const a = resolveNamed(testInstanceName('dev-env-spec-a'));
        const b = resolveNamed(testInstanceName('dev-env-spec-b'));
        const stable = resolveNamed(testInstanceName('dev-env-spec-stable'));
        const pinned = resolveNamed(testInstanceName('dev-env-spec-a'), {
            AUTOTASKCALENDAR_API_PORT: '4567',
            AUTOTASKCALENDAR_WEB_PORT: '4568',
        });
        const long = 'feature/'.padEnd(120, 'x');
        const longA = resolveNamed(testInstanceName(`${long}-one`));
        const longB = resolveNamed(testInstanceName(`${long}-two`));

        expect(a.dbName).toContain('autotaskcalendar_dev_env_spec_a');
        expect(b.dbName).not.toBe(a.dbName);
        expect(b.mongoPort).toBe(a.mongoPort);
        expect(resolveNamed(testInstanceName('dev-env-spec-a')).dbName).toBe(a.dbName);
        expect(resolveNamed(testInstanceName('dev-env-spec-stable')).apiPort).toBe(stable.apiPort);
        expect(resolveNamed(testInstanceName('dev-env-spec-stable')).webPort).toBe(stable.webPort);
        expect(resolveNamed(testInstanceName('dev-env-spec-stable')).inspectPort).toBe(stable.inspectPort);
        expect(longA.dbName.length).toBeLessThanOrEqual(63);
        expect(longB.dbName.length).toBeLessThanOrEqual(63);
        expect(longA.dbName).not.toBe(longB.dbName);
        expect(pinned.apiPort).toBe(4567);
        expect(pinned.webPort).toBe(4568);
        expect(() => resolveNamed(testInstanceName('dev-env-spec-a'), {
            AUTOTASKCALENDAR_API_PORT: 'abc',
        })).toThrow(/must be an integer/);

        const savedPort = process.env.AUTOTASKCALENDAR_API_PORT;
        process.env.AUTOTASKCALENDAR_API_PORT = 'not-a-port';
        try {
            expect(resolveInstanceName()).toBeTruthy();
        } finally {
            if (savedPort === undefined) delete process.env.AUTOTASKCALENDAR_API_PORT;
            else process.env.AUTOTASKCALENDAR_API_PORT = savedPort;
        }
    });

    test('concurrent port resolution and ensureDatabase avoid shared-container collisions', async () => {
        test.slow();

        const script = `
            const { resolveInstance } = require(${JSON.stringify(path.join(repoRoot, 'instance.js'))});
            const i = resolveInstance();
            process.stdout.write(JSON.stringify([i.apiPort, i.webPort, i.inspectPort]) + '\\n');
            setTimeout(() => {}, 5000);
        `;
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

        const db = path.join(repoRoot, 'scripts', 'db.js');
        execFileSync(process.execPath, [db], { cwd: repoRoot, stdio: 'ignore' });
        execFileSync(process.execPath, [db], { cwd: repoRoot, stdio: 'ignore' });

        expect(runningContainerCount()).toBe(1);
    });

    test('one instance database does not leak into another', async () => {
        const a = resolveNamed(testInstanceName('dev-env-spec-marker-a'));
        const b = resolveNamed(testInstanceName('dev-env-spec-marker-b'));

        await dropDatabase(a.mongoUrl);
        await dropDatabase(b.mongoUrl);

        await writeMarker(a.mongoUrl);

        expect(await countMarkers(a.mongoUrl)).toBe(1);
        expect(await countMarkers(b.mongoUrl)).toBe(0);

        await dropDatabase(a.mongoUrl);
    });
});
