#!/usr/bin/env node
/**
 * Run the Playwright API suite against the shared database.
 *
 * Every test seeds its own namespace inside that one database, so many agents can run the
 * suite at once. Nothing is dropped; this run's namespaces are wiped at the end and stale
 * ones are swept. See docs/SHARED_DATABASE.md.
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { ensureDatabase } = require('./db');

const repoRoot = path.join(__dirname, '..');
const playwrightCli = require.resolve('@playwright/test/cli');

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
        result = await runPlaywright(process.argv.slice(2), env);
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
