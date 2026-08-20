#!/usr/bin/env node
/** Run the Playwright API suite with one app server and isolated test users. */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { ensureDatabase } = require('./db');

const repoRoot = path.join(__dirname, '..');
const playwrightCli = require.resolve('@playwright/test/cli');

function resolveTestInstance(name) {
    const saved = {};
    const overrides = {
        AUTOTASKCALENDAR_INSTANCE: name,
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
        return require('../instance').resolveInstance();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
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

async function dropDatabase(mongoUrl) {
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    await connection.dropDatabase();
    await connection.close();
}

async function main() {
    ensureDatabase();

    const baseName = process.env.AUTOTASKCALENDAR_TEST_INSTANCE
        || `${require('../instance').resolveInstanceName()}-test`;
    const runId = `${Date.now().toString(36)}-${process.pid}`;
    const instance = resolveTestInstance(`${baseName}-${runId}`);
    const runRoot = path.join(repoRoot, '.playwright', 'runs', runId);
    const env = {
        ...process.env,
        TZ: 'UTC',
        AUTOTASKCALENDAR_INSTANCE: instance.name,
        AUTOTASKCALENDAR_API_PORT: String(instance.apiPort),
        AUTOTASKCALENDAR_WEB_PORT: String(instance.webPort),
        AUTOTASKCALENDAR_MONGO_PORT: String(instance.mongoPort),
        AUTOTASKCALENDAR_INSPECT_PORT: String(instance.inspectPort),
        AUTOTASKCALENDAR_MONGO_URL: instance.mongoUrl,
        AUTOTASKCALENDAR_BASE_URL: `http://127.0.0.1:${instance.apiPort}`,
        AUTOTASKCALENDAR_TEST_ORCHESTRATED: '1',
        AUTOTASKCALENDAR_GOOGLE_OAUTH_CLIENT_ID: 'playwright-client-id',
        AUTOTASKCALENDAR_GOOGLE_OAUTH_CLIENT_SECRET: 'playwright-client-secret',
        AUTOTASKCALENDAR_TEST_OUTPUT_DIR: path.join(runRoot, 'test-results'),
        PLAYWRIGHT_HTML_OPEN: 'never',
        PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(runRoot, 'playwright-report'),
    };

    console.log(
        `\n  app       ${env.AUTOTASKCALENDAR_BASE_URL}\n` +
        `  database  ${instance.dbName}\n` +
        `  artifacts ${path.relative(repoRoot, runRoot)}\n`
    );

    let result;
    try {
        result = await runPlaywright(process.argv.slice(2), env);
    } finally {
        await dropDatabase(instance.mongoUrl).catch((error) => {
            console.warn(`Could not clean database ${instance.dbName}: ${error.message}`);
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
