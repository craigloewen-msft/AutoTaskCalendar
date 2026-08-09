#!/usr/bin/env node
/**
 * Seed this instance's database with a named scenario.
 *
 * Usage:
 *   node scripts/seed.js                     # the default "basic" scenario
 *   node scripts/seed.js --scenario=full
 *   node scripts/seed.js --list
 */

'use strict';

const { runSeed, listScenarios, DEFAULT_SCENARIO } = require('../seed');
const instance = require('../instance');

function parseArgs(argv) {
    const args = { scenario: DEFAULT_SCENARIO, list: false };

    for (const arg of argv) {
        if (arg === '--list' || arg === '-l') {
            args.list = true;
        } else if (arg.startsWith('--scenario=')) {
            args.scenario = arg.slice('--scenario='.length);
        } else if (!arg.startsWith('-')) {
            // Bare positional works too: `npm run seed -- full`.
            args.scenario = arg;
        }
    }

    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.list) {
        console.log('Available scenarios:\n');
        for (const s of listScenarios()) {
            const marker = s.name === DEFAULT_SCENARIO ? ' (default)' : '';
            console.log(`  ${s.name}${marker}\n      ${s.description}\n`);
        }
        return;
    }

    console.log(`Seeding "${args.scenario}" into ${instance.dbName}...`);

    const result = await runSeed({ scenario: args.scenario, disconnect: true });

    console.log('\n=================================================');
    console.log(`Scenario "${result.scenario}" seeded successfully`);
    console.log('=================================================');
    console.log(`  Users:    ${result.users.length}`);
    console.log(`  Tasks:    ${result.tasks.length}`);
    console.log(`  Events:   ${result.events.length}`);
    console.log('-------------------------------------------------');
    console.log('Test credentials:');
    for (const u of result.users) {
        console.log(`  Username: ${u.username}   Password: ${u.password}`);
    }
    console.log('=================================================\n');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error seeding database:', error);
        process.exit(1);
    });
