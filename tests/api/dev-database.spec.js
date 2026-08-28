const { test, expect } = require('../fixtures');
const path = require('path');
const mongoose = require('mongoose');

const { resolveInstance } = require('../../instance');

const repoRoot = path.join(__dirname, '..', '..');

function resolveWith(env = {}) {
    const saved = {};

    for (const [key, value] of Object.entries(env)) {
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

async function withConnection(url, fn) {
    const connection = await mongoose.createConnection(url).asPromise();
    try {
        return await fn(connection);
    } finally {
        await connection.close();
    }
}

test.describe('dev environment', () => {
    test('every checkout resolves the same fixed ports and the one shared database', () => {
        const base = resolveWith({
            AUTOTASKCALENDAR_API_PORT: undefined,
            AUTOTASKCALENDAR_WEB_PORT: undefined,
            AUTOTASKCALENDAR_INSPECT_PORT: undefined,
            AUTOTASKCALENDAR_MONGO_PORT: undefined,
            AUTOTASKCALENDAR_MONGO_URL: undefined,
        });

        expect(base.apiPort).toBe(3000);
        expect(base.webPort).toBe(8080);
        expect(base.inspectPort).toBe(9229);
        expect(base.dbName).toBe('autotaskcalendar');
        expect(base.mongoUrl).toBe('mongodb://127.0.0.1:27017/autotaskcalendar');

        // The instance name only ever picks a seed namespace; it never splits the database.
        const named = resolveWith({
            AUTOTASKCALENDAR_INSTANCE: 'Some/Other Branch',
            AUTOTASKCALENDAR_MONGO_URL: undefined,
        });

        expect(named.namespace).toBe('some-other-branch');
        expect(named.dbName).toBe(base.dbName);
        expect(named.mongoUrl).toBe(base.mongoUrl);
    });

    test('ports can still be pinned, and nonsense is rejected', () => {
        const pinned = resolveWith({
            AUTOTASKCALENDAR_API_PORT: '4567',
            AUTOTASKCALENDAR_WEB_PORT: '4568',
        });

        expect(pinned.apiPort).toBe(4567);
        expect(pinned.webPort).toBe(4568);
        expect(() => resolveWith({ AUTOTASKCALENDAR_API_PORT: 'abc' })).toThrow(/must be an integer/);
    });

    test('the app under test is using that shared database', async () => {
        const instance = resolveInstance();

        await withConnection(instance.mongoUrl, async (connection) => {
            expect(connection.name).toBe('autotaskcalendar');
            await connection.db.admin().ping();
        });
    });

    test('ensureDatabase is a no-op when something already answers on the port', () => {
        const { ensureDatabase, MONGO_PORT } = require(path.join(repoRoot, 'scripts', 'db.js'));

        // The suite could not have got this far without a database, so this must not touch
        // Docker and must return promptly.
        const started = Date.now();

        expect(ensureDatabase()).toBe(MONGO_PORT);
        expect(Date.now() - started).toBeLessThan(5000);
    });
});
