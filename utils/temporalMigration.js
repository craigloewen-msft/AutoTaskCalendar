'use strict';

const {
    TaskDetails,
    EventDetails,
    RoleDetails,
    GoalDetails,
    ProjectDetails,
} = require('../models');
const {
    TEMPORAL_DATA_VERSION,
    normaliseTimeZone,
    legacyWorkingMinutes,
    dateOnlyInZone,
    dateOnlyFromMarker,
    parseDateOnly,
} = require('./temporal');

function legacyTaskDate(value, timeZone, { due = false } = {}) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    // The old task form built due dates as local midnight + 86,399,000ms. Subtracting the
    // exact amount recovers the selected date even on 23-hour and 25-hour days.
    if (due && date.getSeconds() === 59 && date.getMilliseconds() === 0) {
        return dateOnlyInZone(new Date(date.getTime() - 86_399_000), timeZone);
    }

    const isCanonicalMarker =
        date.getUTCHours() === 0 &&
        date.getUTCMinutes() === 0 &&
        date.getUTCSeconds() === 0 &&
        date.getUTCMilliseconds() === 0;
    if (isCanonicalMarker) return dateOnlyFromMarker(date);

    return dateOnlyInZone(date, timeZone);
}

function legacyCivilDate(value, timeZone) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    // Bare date inputs were parsed as UTC midnight. Preserve that authored day; exact
    // instants (the old "End" button) are interpreted in the user's zone.
    const isUtcMidnight =
        date.getUTCHours() === 0 &&
        date.getUTCMinutes() === 0 &&
        date.getUTCSeconds() === 0 &&
        date.getUTCMilliseconds() === 0;
    return isUtcMidnight ? dateOnlyFromMarker(date) : dateOnlyInZone(date, timeZone);
}

function marker(value) {
    const parsed = parseDateOnly(value);
    return parsed.valid ? parsed.date : null;
}

async function migrateTasks(user, timeZone) {
    const tasks = await TaskDetails.find({ userRef: user._id });

    for (const task of tasks) {
        const startDate = legacyTaskDate(task.startDate, timeZone);
        const dueDate = legacyTaskDate(task.dueDate, timeZone, { due: true });
        const occurrenceDate = legacyTaskDate(task.occurrenceDate, timeZone);

        if (startDate) task.startDate = marker(startDate);
        if (dueDate) task.dueDate = marker(dueDate);
        if (occurrenceDate) task.occurrenceDate = marker(occurrenceDate);
        if (task.recurrence?.endsOn) {
            task.recurrence.endsOn = marker(legacyCivilDate(task.recurrence.endsOn, timeZone));
        }

        await task.save();
    }

    // Future projections are safe to recreate. Completed occurrences are permanent history.
    await TaskDetails.deleteMany({
        userRef: user._id,
        seriesRef: { $ne: null },
        $or: [{ completed: false }, { completed: null }],
    });
}

async function migrateCompass(user, timeZone) {
    for (const Model of [RoleDetails, GoalDetails, ProjectDetails]) {
        const items = await Model.find({ userRef: user._id });
        for (const item of items) {
            const startDate = legacyCivilDate(item.startDate, timeZone);
            const endDate = legacyCivilDate(item.endDate, timeZone);
            if (startDate) item.startDate = marker(startDate);
            if (endDate) item.endDate = marker(endDate);
            await item.save();
        }
    }
}

async function migrateTemporalData(user, requestedTimeZone) {
    if ((user.temporalDataVersion || 0) >= TEMPORAL_DATA_VERSION) {
        return user;
    }

    const timeZone = normaliseTimeZone(requestedTimeZone || user.timeZone);
    const working = legacyWorkingMinutes(user, timeZone);

    await migrateTasks(user, timeZone);
    await migrateCompass(user, timeZone);

    // Timed events and completion timestamps are true instants and are intentionally untouched.
    // Google all-day records cannot be inferred reliably; the next sync refreshes them.
    await EventDetails.updateMany(
        { userRef: user._id, type: 'google', allDay: { $exists: false } },
        { $set: { sourceTimeZone: timeZone } }
    );

    user.timeZone = timeZone;
    user.workingStartMinutes = working.start;
    user.workingEndMinutes = working.end;
    // The old fields are no longer authoritative and must not be exposed or rewritten.
    user.workingStartTime = undefined;
    user.workingDuration = undefined;

    const { expandRecurrences } = require('../controllers/recurrence');
    const { SCHEDULING_HORIZON_DAYS } = require('../controllers/scheduling');
    await expandRecurrences(user, SCHEDULING_HORIZON_DAYS);

    user.temporalDataVersion = TEMPORAL_DATA_VERSION;
    await user.save();
    return user;
}

module.exports = {
    migrateTemporalData,
    legacyTaskDate,
    legacyCivilDate,
};
