'use strict';

/**
 * Seed runner. Wipes the target database and builds one named scenario.
 *
 * Used by both `npm run seed` (scripts/seed.js) and the Playwright `seed` fixture, so the
 * data a test runs against is exactly the data you can reproduce locally.
 */

const mongoose = require('mongoose');

const { UserDetails, TaskDetails, EventDetails } = require('../models');
const instance = require('../instance');
const factories = require('./factories');

const scenarios = {
    empty: require('./scenarios/empty'),
    basic: require('./scenarios/basic'),
    full: require('./scenarios/full'),
    edge: require('./scenarios/edge'),
};

const DEFAULT_SCENARIO = 'basic';

function listScenarios() {
    return Object.values(scenarios).map((s) => ({ name: s.name, description: s.description }));
}

function resolveMongoUrl(explicitUrl) {
    if (explicitUrl) {
        return explicitUrl;
    }

    if (process.env.NODE_ENV === 'production') {
        return process.env.prodMongoDBConnectionString;
    }

    return instance.mongoUrl;
}

/**
 * Delete everything this app owns. Sessions live in their own collection and are left
 * alone; they are harmless and expire on their own.
 */
async function wipe() {
    await Promise.all([
        UserDetails.deleteMany({}),
        TaskDetails.deleteMany({}),
        EventDetails.deleteMany({}),
    ]);
}

/**
 * The imperative API handed to each scenario. Persisting as we go means a scenario can
 * reference real ObjectIds (task dependencies, event taskRefs) without extra plumbing.
 */
function makeBuilder(anchor) {
    const created = { users: [], tasks: [], events: [] };

    const builder = {
        anchor,
        ...factories,

        async createUser(overrides = {}) {
            const { password, attributes } = factories.makeUser({ anchor, ...overrides });
            const user = await UserDetails.register(attributes, password);
            const record = { user, username: attributes.username, password };
            created.users.push(record);
            return record;
        },

        async createTask(user, overrides = {}) {
            const doc = factories.makeTask({ anchor, ...overrides });
            const task = await TaskDetails.create({ ...doc, userRef: user._id });
            created.tasks.push(task);
            return task;
        },

        async createTasks(user, count, overridesFor = () => ({})) {
            const tasks = [];
            for (let i = 0; i < count; i++) {
                tasks.push(await builder.createTask(user, overridesFor(i)));
            }
            return tasks;
        },

        async createEvent(user, overrides = {}) {
            const doc = factories.makeEvent({ anchor, ...overrides });
            const event = await EventDetails.create({ ...doc, userRef: user._id });
            created.events.push(event);
            return event;
        },
    };

    return { builder, created };
}

/**
 * Seed the database.
 *
 * Returns `{ scenario, anchor, users, tasks, events, ...scenarioResult }` where the
 * scenario result carries whatever handles the scenario chose to expose (named tasks, the
 * primary user, and so on) so tests can assert without re-querying.
 */
async function runSeed({ scenario = DEFAULT_SCENARIO, mongoUrl, anchor, disconnect = false } = {}) {
    const definition = scenarios[scenario];

    if (!definition) {
        const known = Object.keys(scenarios).join(', ');
        throw new Error(`Unknown scenario "${scenario}". Known scenarios: ${known}`);
    }

    const url = resolveMongoUrl(mongoUrl);
    const ownsConnection = mongoose.connection.readyState === 0;

    if (ownsConnection) {
        await mongoose.connect(url);
    }

    try {
        factories.resetRandomness();

        const seedAnchor = anchor || factories.defaultAnchor();
        const { builder, created } = makeBuilder(seedAnchor);

        await wipe();
        const result = (await definition.build(builder)) || {};

        return {
            scenario: definition.name,
            description: definition.description,
            anchor: seedAnchor,
            ...created,
            ...result,
        };
    } finally {
        if (disconnect && ownsConnection) {
            await mongoose.connection.close();
        }
    }
}

module.exports = {
    runSeed,
    listScenarios,
    scenarios,
    DEFAULT_SCENARIO,
};
