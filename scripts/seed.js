#!/usr/bin/env node
/**
 * Seed this instance's database with the test dataset.
 *
 * Usage: node scripts/seed.js   (normally via `npm run seed`)
 */

'use strict';

const { runSeed } = require('../seed');
const instance = require('../instance');

async function main() {
    console.log(`Seeding ${instance.dbName}...`);

    const result = await runSeed({ disconnect: true });

    console.log('\n=================================================');
    console.log('Database seeded successfully');
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
