#!/usr/bin/env node
/**
 * Run the Playwright suite (API and browser specs) against the shared database.
 *
 * Every test seeds its own namespace inside that one database, so many agents can run the
 * suite at once. Nothing is dropped; this run's namespaces are wiped at the end and stale
 * ones are swept. See docs/SHARED_DATABASE.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ensureDatabase } = require('./db');

const repoRoot = path.join(__dirname, '..');
const webRoot = path.join(repoRoot, 'webinterface');
const distIndex = path.join(repoRoot, 'dist', 'index.html');
const playwrightCli = require.resolve('@playwright/test/cli');

function runSync(command, args, cwd = repoRoot) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status === null ? 1 : result.status;
}

function newestMtime(target) {
    if (!fs.existsSync(target)) return 0;
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return stat.mtimeMs;
    return fs.readdirSync(target).reduce(
        (newest, entry) => Math.max(newest, newestMtime(path.join(target, entry))),
        stat.mtimeMs
    );
}

// Browser specs are skipped only when the run is limited to the API specs.
function runsBrowserSpecs(args) {
    const projects = [];
    const paths = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg.startsWith('--project=')) projects.push(arg.slice('--project='.length));
        else if (arg === '--project') projects.push(args[++index]);
        else if (arg === '-g' || arg === '--grep' || arg === '--grep-invert') index++;
        else if (!arg.startsWith('-')) paths.push(arg);
    }
    if (projects.length && !projects.includes('ui')) return false;
    return !paths.length || paths.some((arg) => !/(^|\/)tests\/api(\/|$)/.test(arg));
}

// Express serves the SPA from dist/, so the browser specs need a bundle that matches the source.
function buildIfStale() {
    const inputs = ['src', 'public', 'package.json', 'vue.config.js', 'babel.config.js']
        .map((entry) => newestMtime(path.join(webRoot, entry)));
    const envFiles = fs.readdirSync(webRoot).filter((name) => name.startsWith('.env'));
    const sources = Math.max(...inputs, ...envFiles.map((name) => newestMtime(path.join(webRoot, name))));

    const built = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
    if (built && built >= sources) return;

    if (!fs.existsSync(path.join(webRoot, 'node_modules'))) {
        throw new Error('webinterface/node_modules is missing; run `npm install` first');
    }
    console.log(`${built ? 'Rebuilding' : 'Building'} the web interface for the browser specs...`);
    if (runSync('npm', ['run', 'build']) !== 0) throw new Error('the web interface build failed');
}

// Idempotent and quick when present; Playwright picks the revision matching its own version.
function ensureBrowser() {
    if (runSync(process.execPath, [playwrightCli, 'install', 'chromium']) !== 0) {
        throw new Error('could not install Chromium; try `npx playwright install --with-deps chromium`');
    }
}

function runPlaywright(args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [playwrightCli, 'test', ...args], {
            cwd: repoRoot,
            env,
            stdio: 'inherit',
        });
        const handlers = {};

        for (const signal of ['SIGINT', 'SIGTERM']) {
            handlers[signal] = () => child.kill(signal);
            process.once(signal, handlers[signal]);
        }

        const removeHandlers = () => {
            for (const signal of ['SIGINT', 'SIGTERM']) {
                process.removeListener(signal, handlers[signal]);
            }
        };

        child.once('error', (error) => {
            removeHandlers();
            reject(error);
        });
        child.once('exit', (code, signal) => {
            removeHandlers();
            resolve({ code: code ?? 1, signal });
        });
    });
}

/** Remove this run's tenants, and any left behind by runs that died. */
async function cleanUp(runId) {
    const mongoose = require('mongoose');
    const { wipeNamespacePrefix, sweepStaleNamespaces } = require('../seed');
    const instance = require('../instance');

    await mongoose.connect(instance.mongoUrl, { maxPoolSize: 5 });
    try {
        await wipeNamespacePrefix(`pw-${runId}-`);
        await sweepStaleNamespaces();
    } finally {
        await mongoose.connection.close();
    }
}

async function main() {
    ensureDatabase();

    const args = process.argv.slice(2);
    if (runsBrowserSpecs(args)) {
        buildIfStale();
        ensureBrowser();
    }

    const instance = require('../instance').resolveInstance();
    const runId = `${Date.now().toString(36)}-${process.pid}`;
    const runRoot = path.join(repoRoot, '.playwright', 'runs', runId);
    const baseUrl = `http://127.0.0.1:${instance.apiPort}`;
    const env = {
        ...process.env,
        TZ: 'UTC',
        AUTOTASKCALENDAR_TEST_RUN_ID: runId,
        AUTOTASKCALENDAR_BASE_URL: baseUrl,
        AUTOTASKCALENDAR_TEST_ORCHESTRATED: '1',
        AUTOTASKCALENDAR_GOOGLE_OAUTH_CLIENT_ID: 'playwright-client-id',
        AUTOTASKCALENDAR_GOOGLE_OAUTH_CLIENT_SECRET: 'playwright-client-secret',
        AUTOTASKCALENDAR_TEST_OUTPUT_DIR: path.join(runRoot, 'test-results'),
        PLAYWRIGHT_HTML_OPEN: 'never',
        PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(runRoot, 'playwright-report'),
    };

    console.log(
        `\n  app       ${baseUrl}\n` +
        `  database  ${instance.dbName} (shared)\n` +
        `  namespace pw-${runId}-*\n` +
        `  artifacts ${path.relative(repoRoot, runRoot)}\n`
    );

    let result;
    try {
        result = await runPlaywright(args, env);
    } finally {
        await cleanUp(runId).catch((error) => {
            console.warn(`Could not clean up namespaces for run ${runId}: ${error.message}`);
        });
    }

    if (result.signal === 'SIGINT') return 130;
    if (result.signal === 'SIGTERM') return 143;
    return result.code;
}

main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
        console.error(`error: ${error.message}`);
        process.exitCode = 1;
    });
