'use strict';

/**
 * Seed runner. Wipes the target database and builds the dataset.
 *
 * Used by both `npm run seed` (scripts/seed.js) and the Playwright `seed` fixture, so the
 * data a test runs against is exactly the data you can reproduce locally.
 */

const mongoose = require('mongoose');

const { UserDetails, TaskDetails, EventDetails, RoleDetails, GoalDetails, ProjectDetails } = require('../models');
const instance = require('../instance');
const factories = require('./factories');
const dataset = require('./dataset');

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
        RoleDetails.deleteMany({}),
        GoalDetails.deleteMany({}),
        ProjectDetails.deleteMany({}),
    ]);
}

/**
 * The imperative API handed to the dataset builder. Persisting as we go means it can
 * reference real ObjectIds (task dependencies, event taskRefs) without extra plumbing.
 */
function makeBuilder(anchor) {
    const created = { users: [], tasks: [], events: [], roles: [], goals: [], projects: [] };

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

        async createRole(user, overrides = {}) {
            const doc = factories.makeRole({ anchor, ...overrides });
            const role = await RoleDetails.create({ ...doc, userRef: user._id });
            created.roles.push(role);
            return role;
        },

        async createGoal(user, role, overrides = {}) {
            const doc = factories.makeGoal({ anchor, ...overrides });
            const goal = await GoalDetails.create({ ...doc, roleRef: role._id, userRef: user._id });
            created.goals.push(goal);
            return goal;
        },

        async createProject(user, goal, overrides = {}) {
            const doc = factories.makeProject({ anchor, ...overrides });
            const project = await ProjectDetails.create({ ...doc, goalRef: goal._id, userRef: user._id });
            created.projects.push(project);
            return project;
        },

        // Point already-created tasks at a project, the way the UI does.
        async alignTasks(tasks, project) {
            const ids = tasks.map((t) => t._id);
            await TaskDetails.updateMany({ _id: { $in: ids } }, { $set: { projectRef: project._id } });
            return ids.length;
        },
    };

    return { builder, created };
}

/**
 * Seed the database.
 *
 * Returns `{ anchor, users, tasks, events, roles, goals, projects, primary, other, named,
 * counts }` — everything the dataset created, so tests can assert without re-querying.
 */
async function runSeed({ mongoUrl, anchor, disconnect = false } = {}) {
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
        const result = (await dataset.build(builder)) || {};

        return {
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
};
