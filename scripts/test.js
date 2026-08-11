#!/usr/bin/env node
/**
 * Run the Playwright suite.
 *
 * The suite gets its own instance name ("<branch>-test"), and therefore its own database
 * and ports, so it never disturbs the stack you are developing against.
 *
 * Usage: npm test [-- <playwright args>]
 *   npm test -- --project=api      just the API specs (fast)
 *   npm test -- -g "scheduling"    one group
 *   npm test -- --ui               interactive mode
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDatabase } = require('./db');

// Must run before the instance is resolved: it exports the Mongo port everything uses.
ensureDatabase();

const { resolveInstance } = require('../instance');

const repoRoot = path.join(__dirname, '..');

// Resolve the test instance without the dev shell's pinned ports leaking in.
function resolveTestInstance() {
    const saved = {};
    const overrides = {
        AUTOTASKCALENDAR_INSTANCE: process.env.AUTOTASKCALENDAR_TEST_INSTANCE
            || `${resolveInstance().name}-test`,
        AUTOTASKCALENDAR_API_PORT: undefined,
        AUTOTASKCALENDAR_WEB_PORT: undefined,
        AUTOTASKCALENDAR_INSPECT_PORT: undefined,
        AUTOTASKCALENDAR_MONGO_URL: undefined,
    };

    for (const [key, value] of Object.entries(overrides)) {
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

const instance = resolveTestInstance();

const childEnv = {
    ...process.env,
    TZ: 'UTC',
    AUTOTASKCALENDAR_INSTANCE: instance.name,
    AUTOTASKCALENDAR_API_PORT: String(instance.apiPort),
    AUTOTASKCALENDAR_WEB_PORT: String(instance.webPort),
    AUTOTASKCALENDAR_MONGO_PORT: String(instance.mongoPort),
    AUTOTASKCALENDAR_INSPECT_PORT: String(instance.inspectPort),
    AUTOTASKCALENDAR_MONGO_URL: instance.mongoUrl,
    // The suite drives the API and the built SPA from one Express server.
    AUTOTASKCALENDAR_BASE_URL: `http://127.0.0.1:${instance.apiPort}`,
};

// NOTE: deliberately NOT setting NODE_ENV=test. @vue/babel-preset-app switches to
// CommonJS output when NODE_ENV is "test", and vue-gtag's package exports declare no
// "require" condition, so the web build fails with "Package path . is not exported".

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        env: childEnv,
        stdio: 'inherit',
    });

    if (result.error) {
        console.error(`Failed to run ${command}: ${result.error.message}`);
        process.exit(1);
    }

    return result.status === null ? 1 : result.status;
}

/** The newest mtime anywhere under `dir`. */
function newestMtime(dir) {
    let newest = 0;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const mtime = entry.isDirectory()
            ? newestMtime(full)
            : fs.statSync(full).mtimeMs;

        if (mtime > newest) newest = mtime;
    }

    return newest;
}

/**
 * Express serves the SPA from dist/, so the bundle has to match the source. Rebuilding
 * when it is stale is what makes `npm test` a trustworthy gate on its own.
 */
function buildIfStale() {
    const distIndex = path.join(repoRoot, 'dist', 'index.html');

    if (fs.existsSync(distIndex)) {
        const built = fs.statSync(distIndex).mtimeMs;
        const sources = Math.max(
            newestMtime(path.join(repoRoot, 'webinterface', 'src')),
            fs.statSync(path.join(repoRoot, 'webinterface', 'package.json')).mtimeMs
        );

        if (built >= sources) return;
        console.log('Rebuilding the web interface (sources changed since the last build)...');
    } else {
        console.log('Building the web interface...');
    }

    if (run('npm', ['run', 'build']) !== 0) {
        process.exit(1);
    }
}

/** Playwright needs its own browser download; do it for the caller rather than document it. */
function ensureBrowser() {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(process.env.HOME || '', '.cache', 'ms-playwright');

    const installed = fs.existsSync(cache)
        && fs.readdirSync(cache).some((entry) => entry.startsWith('chromium'));

    if (!installed) {
        console.log('Installing the Playwright Chromium browser (one time)...');
        run('npx', ['playwright', 'install', '--with-deps', 'chromium']);
    }
}

console.log(`\n  app       http://127.0.0.1:${instance.apiPort}\n  database  ${instance.dbName}\n`);

buildIfStale();
ensureBrowser();

process.exit(run('npx', ['playwright', 'test', ...process.argv.slice(2)]));
