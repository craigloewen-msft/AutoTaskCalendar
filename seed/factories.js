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

// End of a day relative to the anchor, which is how the UI stores due dates.
function endOfDay(anchor, days = 0) {
    return moment(anchor).add(days, 'days').endOf('day').toDate();
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
            // 09:00 local start, 8 hour day.
            workingStartTime: at(anchor, { hours: 9 }),
            workingDuration: 8,
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
        dueDate: endOfDay(anchor, 1),
        startDate: at(anchor, { days: -1 }),
        duration: 60,
        breakUpTask: false,
        breakUpTaskChunkDuration: null,
        completed: false,
        completedDate: null,
        repeat: null,
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

module.exports = {
    FAKER_SEED,
    DEFAULT_WORKING_DAYS,
    faker,
    resetRandomness,
    defaultAnchor,
    at,
    endOfDay,
    makeUser,
    makeTask,
    makeEvent,
};
