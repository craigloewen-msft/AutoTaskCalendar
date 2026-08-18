'use strict';

/**
 * Seed runner for development and tests.
 *
 * CLI seeding wipes the instance; tests replace one namespaced tenant so workers can run
 * concurrently against the same database.
 */

const mongoose = require('mongoose');
const moment = require('moment');
const { parseDateOnly } = require('../utils/temporal');

function seedCivilDate(value) {
    if (!value) return null;
    return parseDateOnly(moment(value).format('YYYY-MM-DD')).date;
}

function normalizeCivilFields(doc, fields) {
    for (const field of fields) {
        if (doc[field]) doc[field] = seedCivilDate(doc[field]);
    }
    if (doc.recurrence?.endsOn) doc.recurrence.endsOn = seedCivilDate(doc.recurrence.endsOn);
    return doc;
}

const {
    UserDetails,
    TaskDetails,
    EventDetails,
    RoleDetails,
    GoalDetails,
    ProjectDetails,
    GoogleOAuthStateDetails,
} = require('../models');
const instance = require('../instance');
const factories = require('./factories');
const dataset = require('./dataset');

let seedQueue = Promise.resolve();

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
        GoogleOAuthStateDetails.deleteMany({}),
    ]);
}

function namespacePattern(namespace) {
    const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}-`);
}

/** Remove one test tenant without touching concurrent workers. */
async function wipeNamespace(namespace) {
    const users = await UserDetails.find({ username: namespacePattern(namespace) }).select('_id');
    const userIds = users.map((user) => user._id);

    if (userIds.length === 0) return;

    const owned = { userRef: { $in: userIds } };
    await Promise.all([
        TaskDetails.deleteMany(owned),
        EventDetails.deleteMany(owned),
        RoleDetails.deleteMany(owned),
        GoalDetails.deleteMany(owned),
        ProjectDetails.deleteMany(owned),
        GoogleOAuthStateDetails.deleteMany(owned),
    ]);
    await UserDetails.deleteMany({ _id: { $in: userIds } });
}

/**
 * The imperative API handed to the dataset builder. Persisting as we go means it can
 * reference real ObjectIds (task dependencies, event taskRefs) without extra plumbing.
 */
function makeBuilder(anchor, namespace) {
    const created = { users: [], tasks: [], events: [], roles: [], goals: [], projects: [] };

    function namespaceUser(overrides) {
        if (!namespace) return overrides;

        const base = overrides.username || 'testuser';
        return {
            ...overrides,
            username: `${namespace}-${base}`,
            email: `${namespace}-${base}@example.test`,
        };
    }

    const builder = {
        anchor,
        ...factories,

        async createUser(overrides = {}) {
            const namespaced = namespaceUser(overrides);
            const { password, attributes } = factories.makeUser({ anchor, ...namespaced });
            const user = await UserDetails.register(attributes, password);
            const record = { user, username: attributes.username, password };
            created.users.push(record);
            return record;
        },

        async createTask(user, overrides = {}) {
            const doc = normalizeCivilFields(
                factories.makeTask({ anchor, ...overrides }),
                ['startDate', 'dueDate', 'occurrenceDate']
            );
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
            const doc = normalizeCivilFields(factories.makeRole({ anchor, ...overrides }), ['startDate', 'endDate']);
            const role = await RoleDetails.create({ ...doc, userRef: user._id });
            created.roles.push(role);
            return role;
        },

        async createGoal(user, role, overrides = {}) {
            const doc = normalizeCivilFields(factories.makeGoal({ anchor, ...overrides }), ['startDate', 'endDate']);
            const goal = await GoalDetails.create({ ...doc, roleRef: role._id, userRef: user._id });
            created.goals.push(goal);
            return goal;
        },

        async createProject(user, goal, overrides = {}) {
            const doc = normalizeCivilFields(factories.makeProject({ anchor, ...overrides }), ['startDate', 'endDate']);
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
 * Build the dataset, replacing either the whole instance or one namespaced tenant.
 *
 * Returns `{ anchor, users, tasks, events, roles, goals, projects, primary, other, recurring,
 * slip, named, counts }` — everything created, so tests can assert without re-querying.
 */
async function executeSeed({ mongoUrl, anchor, disconnect = false, namespace = null } = {}) {
    const url = resolveMongoUrl(mongoUrl);
    const ownsConnection = mongoose.connection.readyState === 0;

    if (ownsConnection) {
        await mongoose.connect(url);
    }

    try {
        factories.resetRandomness();

        const seedAnchor = anchor || factories.defaultAnchor();
        const { builder, created } = makeBuilder(seedAnchor, namespace);

        if (namespace) await wipeNamespace(namespace);
        else await wipe();
        const result = (await dataset.build(builder)) || {};

        return {
            anchor: seedAnchor,
            namespace,
            ...created,
            ...result,
        };
    } finally {
        if (disconnect && ownsConnection) {
            await mongoose.connection.close();
        }
    }
}

function runSeed(options = {}) {
    const next = seedQueue.then(() => executeSeed(options));
    seedQueue = next.catch(() => {});
    return next;
}

module.exports = {
    runSeed,
    wipeNamespace,
};
