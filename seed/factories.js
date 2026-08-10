'use strict';

/**
 * Deterministic factories for seeded data.
 *
 * Every factory takes an overrides object, so scenarios only state what matters to them.
 * All dates derive from an explicit anchor rather than the wall clock, which keeps seeded
 * data stable and makes assertions possible.
 */

const moment = require('moment');
const { faker } = require('@faker-js/faker');
const { TEMPORAL_DATA_VERSION } = require('../utils/temporal');

// Fixed seed: the same scenario always produces the same words, notes, and titles.
const FAKER_SEED = 20240101;

function resetRandomness() {
    faker.seed(FAKER_SEED);
}

// The reference point every scenario builds dates from: today at 00:00 local time.
function defaultAnchor() {
    return moment().startOf('day');
}

// `at(anchor, { days: 2, hours: 10 })` -> Date.
function at(anchor, { days = 0, hours = 0, minutes = 0 } = {}) {
    return moment(anchor).add(days, 'days').add(hours, 'hours').add(minutes, 'minutes').toDate();
}

// Legacy name retained for dataset readability; task due dates are civil-date markers.
function endOfDay(anchor, days = 0) {
    return civilDate(anchor, days);
}

// Canonical UTC marker for a civil date.
function civilDate(anchor, days = 0) {
    return moment.utc(moment(anchor).add(days, 'days').format('YYYY-MM-DD'), 'YYYY-MM-DD').toDate();
}

const DEFAULT_WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * User attributes. The password is returned separately because passport-local-mongoose
 * hashes it through `register()` instead of storing it on the document.
 */
function makeUser(overrides = {}) {
    const { anchor = defaultAnchor(), password = 'testpassword', ...rest } = overrides;

    return {
        password,
        attributes: {
            username: 'testuser',
            email: 'testuser@example.com',
            timeZone: 'UTC',
            workingStartMinutes: 9 * 60,
            workingEndMinutes: 17 * 60,
            temporalDataVersion: TEMPORAL_DATA_VERSION,
            workingDays: [...DEFAULT_WORKING_DAYS],
            ...rest,
        },
    };
}

/**
 * Task attributes. `duration` and `breakUpTaskChunkDuration` are in MINUTES, matching
 * controllers/scheduling.js.
 */
function makeTask(overrides = {}) {
    const { anchor = defaultAnchor(), ...rest } = overrides;

    return {
        title: `${faker.hacker.verb()} ${faker.hacker.noun()}`,
        notes: faker.lorem.sentence(),
        dueDate: civilDate(anchor, 1),
        startDate: civilDate(anchor, -1),
        duration: 60,
        breakUpTask: false,
        breakUpTaskChunkDuration: null,
        completed: false,
        completedDate: null,
        repeat: null,
        recurrence: null,
        seriesRef: null,
        occurrenceDate: null,
        isBacklog: false,
        priority: 100,
        dependsOn: [],
        ...rest,
    };
}

/**
 * Event attributes. `type: 'calendar'` events belong to the user or Google; the scheduler
 * owns 'task' and 'task-chunk' events and deletes them on every run.
 */
function makeEvent(overrides = {}) {
    const { anchor = defaultAnchor(), ...rest } = overrides;

    return {
        title: faker.company.catchPhrase(),
        startDate: at(anchor, { days: 1, hours: 10 }),
        endDate: at(anchor, { days: 1, hours: 11 }),
        notes: faker.lorem.sentence(),
        type: 'calendar',
        ...rest,
    };
}

/**
 * Compass role attributes. No `endDate` means the role is still active.
 */
function makeRole(overrides = {}) {
    const { anchor = defaultAnchor(), ...rest } = overrides;

    return {
        title: faker.person.jobTitle(),
        description: faker.lorem.sentence(),
        startDate: at(anchor, { days: -365 }),
        endDate: null,
        sortOrder: 0,
        ...rest,
    };
}

/**
 * Compass goal attributes. Requires a `roleRef` from the caller.
 */
function makeGoal(overrides = {}) {
    const { anchor = defaultAnchor(), ...rest } = overrides;

    return {
        title: faker.company.catchPhrase(),
        description: faker.lorem.sentence(),
        startDate: at(anchor, { days: -180 }),
        endDate: null,
        sortOrder: 0,
        ...rest,
    };
}

/**
 * Compass project attributes. No `startDate` means a parked "someday" item.
 */
function makeProject(overrides = {}) {
    const { anchor = defaultAnchor(), ...rest } = overrides;

    return {
        title: `${faker.hacker.verb()} the ${faker.hacker.noun()}`,
        description: faker.lorem.sentence(),
        startDate: at(anchor, { days: -90 }),
        endDate: null,
        sortOrder: 0,
        ...rest,
    };
}

module.exports = {
    FAKER_SEED,
    DEFAULT_WORKING_DAYS,
    faker,
    resetRandomness,
    defaultAnchor,
    at,
    civilDate,
    endOfDay,
    makeUser,
    makeTask,
    makeEvent,
    makeRole,
    makeGoal,
    makeProject,
};
