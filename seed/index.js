'use strict';

/**
 * Seed runner for development and tests.
 *
 * Every agent shares one database, so seeding is always scoped to a namespace: a tenant
 * of users (and everything they own) that no other agent touches. `global: true` opts
 * into the old wipe-everything behaviour. See docs/SHARED_DATABASE.md.
 */

const mongoose = require('mongoose');
const moment = require('moment');
const { mondayWeekBounds, parseDateOnly } = require('../utils/temporal');

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
    WeeklyPlanDetails,
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
        WeeklyPlanDetails.deleteMany({}),
        GoogleOAuthStateDetails.deleteMany({}),
    ]);
}

function namespacePattern(namespace) {
    const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}-`);
}

/** Delete these users and everything they own. */
async function deleteUsers(userIds) {
    if (userIds.length === 0) return;

    const owned = { userRef: { $in: userIds } };
    await Promise.all([
        TaskDetails.deleteMany(owned),
        EventDetails.deleteMany(owned),
        RoleDetails.deleteMany(owned),
        GoalDetails.deleteMany(owned),
        ProjectDetails.deleteMany(owned),
        WeeklyPlanDetails.deleteMany(owned),
        GoogleOAuthStateDetails.deleteMany(owned),
    ]);
    await UserDetails.deleteMany({ _id: { $in: userIds } });
}

/**
 * Remove one tenant without touching concurrent agents.
 *
 * Matches the indexed seedNamespace field, falling back to the username prefix so rows
 * seeded before that field existed are still cleaned up.
 */
async function wipeNamespace(namespace) {
    const users = await UserDetails.find({
        $or: [{ seedNamespace: namespace }, { username: namespacePattern(namespace) }],
    }).select('_id');

    await deleteUsers(users.map((user) => user._id));
}

/**
 * Delete tenants left behind by runs that never cleaned up.
 *
 * Nothing drops the shared database any more, so abandoned namespaces would otherwise
 * accumulate forever.
 */
async function sweepStaleNamespaces({ olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
    const cutoff = new Date(Date.now() - olderThanMs);
    const users = await UserDetails.find({
        seedNamespace: { $ne: null },
        seededAt: { $lt: cutoff },
    }).select('_id seedNamespace');

    await deleteUsers(users.map((user) => user._id));

    return new Set(users.map((user) => user.seedNamespace)).size;
}

/** Remove every tenant whose namespace starts with this prefix (one test run's workers). */
async function wipeNamespacePrefix(prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await UserDetails.find({
        seedNamespace: new RegExp(`^${escaped}`),
    }).select('_id');

    await deleteUsers(users.map((user) => user._id));
}

/**
 * The imperative API handed to the dataset builder. Persisting as we go means it can
 * reference real ObjectIds (task dependencies, event taskRefs) without extra plumbing.
 */
function makeBuilder(anchor, namespace) {
    const created = { users: [], tasks: [], events: [], roles: [], goals: [], projects: [], weeklyPlans: [] };

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
        // Monday anchors for the current and previous week, so weekly-plan seed data lands
        // in the right week no matter which day the seed runs on.
        thisMondayDate: mondayWeekBounds(moment(anchor).format('YYYY-MM-DD'), 'UTC').startDate,
        lastMondayDate: mondayWeekBounds(
            moment(anchor).subtract(7, 'days').format('YYYY-MM-DD'),
            'UTC'
        ).startDate,
        ...factories,
    };

    builder.thisMonday = moment.utc(builder.thisMondayDate, 'YYYY-MM-DD');
    builder.lastMonday = moment.utc(builder.lastMondayDate, 'YYYY-MM-DD');

    Object.assign(builder, {

        async createUser(overrides = {}) {
            const namespaced = namespaceUser(overrides);
            const { password, attributes } = factories.makeUser({ anchor, ...namespaced });
            const user = await UserDetails.register(
                { ...attributes, seedNamespace: namespace, seededAt: new Date() },
                password
            );
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

        // A committed week. Items snapshot the tasks exactly as commitWeeklyPlan would.
        async commitWeek(user, weekStart, tasks, overrides = {}) {
            const bounds = mondayWeekBounds(weekStart, user.timeZone);
            const committedAt = overrides.committedAt
                || parseDateOnly(bounds.startDate).date;
            const plan = await WeeklyPlanDetails.create({
                userRef: user._id,
                weekStart: parseDateOnly(bounds.startDate).date,
                weekEnd: parseDateOnly(bounds.endDate).date,
                timeZone: user.timeZone,
                committedAt,
                amendedAt: overrides.amendedAt || null,
                items: tasks.map((task) => ({
                    taskRef: task._id,
                    projectRef: task.projectRef || null,
                    title: task.title,
                    duration: task.duration,
                    dueDate: task.seriesRef ? task.occurrenceDate : task.dueDate,
                    seriesRef: task.seriesRef || null,
                    addedAt: committedAt,
                })),
            });
            created.weeklyPlans.push(plan);
            return plan;
        },

        // Move a task after it was committed, so a plan item resolves as `moved`.
        async moveTaskDueDate(task, dueDate) {
            task.dueDate = seedCivilDate(dueDate);
            await task.save();
            return task;
        },

        // Delete a task after it was committed, so a plan item resolves as `removed`.
        async deleteTask(task) {
            await TaskDetails.deleteOne({ _id: task._id });
            const index = created.tasks.findIndex((t) => String(t._id) === String(task._id));
            if (index >= 0) created.tasks.splice(index, 1);
            return task;
        },
    });

    return { builder, created };
}

/**
 * Build the dataset into one namespaced tenant, or — with `global: true` — over the whole
 * shared database.
 *
 * Returns `{ anchor, users, tasks, events, roles, goals, projects, primary, other, recurring,
 * slip, named, counts }` — everything created, so tests can assert without re-querying.
 */
async function executeSeed({
    mongoUrl,
    anchor,
    disconnect = false,
    namespace = null,
    global = false,
} = {}) {
    if (!namespace && !global) {
        throw new Error(
            'runSeed needs a namespace: every agent shares one database. Pass { namespace } ' +
            'or, to wipe and reseed the whole database, { global: true }.'
        );
    }

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
    wipeNamespacePrefix,
    sweepStaleNamespaces,
};
