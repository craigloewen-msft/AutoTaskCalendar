#!/usr/bin/env node
/**
 * Seed the shared database with the test dataset.
 *
 * Usage: npm run seed            seed this checkout's own namespace
 *        npm run seed -- --global  wipe the shared database and seed bare usernames
 */

'use strict';

const { ensureDatabase } = require('./db');

ensureDatabase();

const { runSeed } = require('../seed');
const { resolveInstance } = require('../instance');

const instance = resolveInstance();

const global = process.argv.includes('--global');

async function main() {
    const result = await runSeed({
        mongoUrl: instance.mongoUrl,
        disconnect: true,
        global,
        namespace: global ? null : instance.namespace,
    });

    console.log(
        `\nSeeded ${instance.dbName}` +
        `${global ? ' (whole database)' : ` namespace "${instance.namespace}"`}: ` +
        `${result.users.length} users, ${result.tasks.length} tasks, ` +
        `${result.events.length} events, ${result.roles.length} roles, ` +
        `${result.goals.length} goals, ${result.projects.length} projects.\n`
    );

    for (const user of result.users) {
        console.log(`  login  ${user.username} / ${user.password}`);
    }
    console.log('');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`Error seeding database: ${error.message}`);
        process.exit(1);
    });
