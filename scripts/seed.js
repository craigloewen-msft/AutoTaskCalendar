#!/usr/bin/env node
/**
 * Seed this instance's database with the test dataset.
 *
 * Usage: npm run seed
 */

'use strict';

const { ensureDatabase } = require('./db');

// Must run before the instance is resolved: it exports the Mongo port everything uses.
ensureDatabase();

const { runSeed } = require('../seed');
const { resolveInstance } = require('../instance');

const instance = resolveInstance();

async function main() {
    const result = await runSeed({ mongoUrl: instance.mongoUrl, disconnect: true });

    console.log(
        `\nSeeded ${instance.dbName}: ` +
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
