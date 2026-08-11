#!/usr/bin/env node
/**
 * Start the dev stack: MongoDB, the Express API under nodemon, and the Vue dev server.
 *
 * Usage: npm run dev
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { ensureDatabase } = require('./db');

// Must run before the instance is resolved: it exports the Mongo port everything uses.
ensureDatabase();

const { resolveInstance } = require('../instance');

const instance = resolveInstance();
const repoRoot = path.join(__dirname, '..');

// Pin every port so the API, the Vue proxy, and nodemon all agree.
const childEnv = {
    ...process.env,
    AUTOTASKCALENDAR_INSTANCE: instance.name,
    AUTOTASKCALENDAR_API_PORT: String(instance.apiPort),
    AUTOTASKCALENDAR_WEB_PORT: String(instance.webPort),
    AUTOTASKCALENDAR_MONGO_PORT: String(instance.mongoPort),
    AUTOTASKCALENDAR_INSPECT_PORT: String(instance.inspectPort),
    AUTOTASKCALENDAR_MONGO_URL: instance.mongoUrl,
};

console.log(
    `\n  web       http://localhost:${instance.webPort}\n` +
    `  api       http://localhost:${instance.apiPort}\n` +
    `  database  ${instance.dbName}\n`
);

const targets = [
    {
        label: 'api',
        command: 'npx',
        args: ['nodemon', `--inspect=0.0.0.0:${instance.inspectPort}`, 'app.js'],
        cwd: repoRoot,
    },
    {
        label: 'web',
        command: 'npm',
        args: ['run', 'serve'],
        cwd: path.join(repoRoot, 'webinterface'),
    },
];

const children = [];
let shuttingDown = false;

// If either process dies the other is useless, so tear the stack down together.
function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill(signal);
        }
    }
}

for (const target of targets) {
    const child = spawn(target.command, target.args, {
        cwd: target.cwd,
        env: childEnv,
        stdio: 'inherit',
    });

    child.on('error', (error) => {
        console.error(`[${target.label}] failed to start: ${error.message}`);
        process.exitCode = 1;
        shutdown('SIGTERM');
    });

    child.on('exit', (code, signal) => {
        if (!shuttingDown) {
            console.error(`[${target.label}] exited (${signal || `code ${code}`}); stopping.`);
            process.exitCode = code === 0 ? 0 : 1;
        }
        shutdown('SIGTERM');
    });

    children.push(child);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal));
}
