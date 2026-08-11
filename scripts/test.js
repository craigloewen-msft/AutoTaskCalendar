#!/usr/bin/env node
/**
 * Run the Playwright suite against a dedicated test instance.
 *
 * Tests get their own instance name ("<branch>-test") and database, and allocate their own
 * ports, so a suite run never disturbs a dev stack. MongoDB itself is one shared
 * container; see docs/DEV_DATABASE.md.
 *
 * Usage: npm test [-- <playwright args>]   /   npm run test:ui
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');

// Derive the test instance from the current one, unless the caller pinned it explicitly.
const baseInstance = require('../instance');
const testInstanceName = process.env.AUTOTASKCALENDAR_TEST_INSTANCE || `${baseInstance.name}-test`;

const { resolveInstance } = require('../instance');

function resolveTestInstance() {
    const previous = process.env.AUTOTASKCALENDAR_INSTANCE;
    process.env.AUTOTASKCALENDAR_INSTANCE = testInstanceName;

    // Port overrides from the ambient dev shell would pin the test stack onto the dev
    // ports, so clear them for this resolution.
    const portVars = [
        'AUTOTASKCALENDAR_PORT_OFFSET',
        'AUTOTASKCALENDAR_API_PORT',
        'AUTOTASKCALENDAR_WEB_PORT',
        'AUTOTASKCALENDAR_MONGO_PORT',
        'AUTOTASKCALENDAR_INSPECT_PORT',
        'AUTOTASKCALENDAR_MONGO_URL',
    ];
    const savedPorts = {};
    for (const key of portVars) {
        savedPorts[key] = process.env[key];
        delete process.env[key];
    }

    const resolved = resolveInstance();

    for (const key of portVars) {
        if (savedPorts[key] !== undefined) {
            process.env[key] = savedPorts[key];
        }
    }
    if (previous !== undefined) {
        process.env.AUTOTASKCALENDAR_INSTANCE = previous;
    }

    return resolved;
}

const instance = resolveTestInstance();
const externalMongoUrl = process.env.AUTOTASKCALENDAR_TEST_MONGO_URL;
const { allocatePorts } = require('./port-allocator');

async function main() {
    // Probed, not derived: two agents testing at once would otherwise pick the same block.
    const ports = await allocatePorts({ preferredOffset: instance.offset });

    const childEnv = {
        ...process.env,
        TZ: 'UTC',
        AUTOTASKCALENDAR_INSTANCE: instance.name,
        AUTOTASKCALENDAR_API_PORT: String(ports.apiPort),
        AUTOTASKCALENDAR_WEB_PORT: String(ports.webPort),
        AUTOTASKCALENDAR_MONGO_PORT: String(instance.mongoPort),
        AUTOTASKCALENDAR_INSPECT_PORT: String(ports.inspectPort),
        AUTOTASKCALENDAR_MONGO_URL: externalMongoUrl || instance.mongoUrl,
        // The suite drives the API and the built SPA from one Express server.
        AUTOTASKCALENDAR_BASE_URL: `http://127.0.0.1:${ports.apiPort}`,
    };

    // NOTE: deliberately NOT setting NODE_ENV=test. @vue/babel-preset-app switches to
    // CommonJS output when NODE_ENV is "test", and vue-gtag's package exports declare no
    // "require" condition, so the web build fails with "Package path . is not exported".
    // Nothing in this app needs NODE_ENV=test; app.js only ever checks for "production".

    function run(command, args, options = {}) {
        const result = spawnSync(command, args, {
            cwd: repoRoot,
            env: childEnv,
            stdio: 'inherit',
            ...options,
        });

        if (result.error) {
            console.error(`Failed to run ${command}: ${result.error.message}`);
            process.exit(1);
        }

        return result.status === null ? 1 : result.status;
    }

    console.log(
        `\nAutoTaskCalendar test instance "${instance.name}"\n` +
        `  app        http://127.0.0.1:${ports.apiPort}\n` +
        `  database   ${externalMongoUrl ? 'externally managed' : instance.dbName}\n`
    );

    // 1. The shared mongo container. The test instance gets its own database inside it.
    if (run('scripts/dev-db.sh', ['up']) !== 0) {
        process.exit(1);
    }

    // 2. The SPA bundle Express serves from dist/. Rebuild when it is missing, or when
    //    AUTOTASKCALENDAR_TEST_BUILD=1 forces it after front-end changes.
    const distIndex = path.join(repoRoot, 'dist', 'index.html');
    if (process.env.AUTOTASKCALENDAR_TEST_BUILD === '1' || !fs.existsSync(distIndex)) {
        console.log('Building the web interface (dist/ is missing or a rebuild was requested)...');
        if (run('npm', ['run', 'build']) !== 0) {
            process.exit(1);
        }
    }

    // 3. Playwright. Everything after `--` is forwarded, e.g. `npm test -- tests/api`.
    const playwrightArgs = ['playwright', 'test', ...process.argv.slice(2)];
    process.exit(run('npx', playwrightArgs));
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
