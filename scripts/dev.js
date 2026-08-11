#!/usr/bin/env node
/**
 * Start the dev stack: the Express API under nodemon, plus the Vue dev server.
 *
 * Ports are allocated here rather than derived, so the banner below is the source of truth
 * for where to connect. See scripts/port-allocator.js.
 *
 * Usage: node scripts/dev.js   (normally via `npm run dev`)
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const instance = require('../instance');
const { allocatePorts } = require('./port-allocator');

const repoRoot = path.join(__dirname, '..');

async function main() {
    const ports = await allocatePorts();

    const childEnv = {
        ...process.env,
        AUTOTASKCALENDAR_INSTANCE: instance.name,
        AUTOTASKCALENDAR_API_PORT: String(ports.apiPort),
        AUTOTASKCALENDAR_WEB_PORT: String(ports.webPort),
        AUTOTASKCALENDAR_MONGO_PORT: String(instance.mongoPort),
        AUTOTASKCALENDAR_INSPECT_PORT: String(ports.inspectPort),
        AUTOTASKCALENDAR_MONGO_URL: instance.mongoUrl,
    };

    // Say so when the block moved, rather than leaving the reader to wonder.
    const moved = ports.movedFrom !== null
        ? `  note       preferred block ${ports.movedFrom} was busy; using ${ports.offset} instead\n`
        : '';

    console.log(
        `\nAutoTaskCalendar instance "${instance.name}"\n` +
        `  web        http://localhost:${ports.webPort}\n` +
        `  api        http://localhost:${ports.apiPort}\n` +
        `  debugger   ${ports.inspectPort}\n` +
        `  database   ${instance.dbName}\n` +
        moved
    );

    const targets = [
        {
            label: 'api',
            command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
            args: ['nodemon', `--inspect=0.0.0.0:${ports.inspectPort}`, 'app.js'],
            cwd: repoRoot,
        },
        {
            label: 'web',
            command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
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
            console.error(`[${target.label}] failed to start:`, error.message);
            shutdown('SIGTERM');
            process.exitCode = 1;
        });

        child.on('exit', (code, signal) => {
            if (!shuttingDown) {
                console.error(
                    `[${target.label}] exited (${signal || `code ${code}`}); stopping dev stack.`
                );
                process.exitCode = code === 0 ? 0 : 1;
            }
            shutdown('SIGTERM');
        });

        children.push(child);
    }

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => shutdown(signal));
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
