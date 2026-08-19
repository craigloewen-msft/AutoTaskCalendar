const { TaskDetails, WeeklyPlanDetails } = require('../models');
const {
    addDateOnlyDays,
    compareDateOnly,
    dateOnlyFromMarker,
    mondayWeekBounds,
    parseDateOnly,
    todayInZone,
} = require('../utils/temporal');

/**
 * Weekly Plan commitments. See docs/WEEKLY_PLAN.md.
 *
 * One document per user per week, keyed on the Monday civil marker. Items are a snapshot
 * taken at commit time, so a review still shows work that was later edited away or deleted.
 *
 * Status is DERIVED here on every read, never stored -- the same rule Compass uses for
 * active/ended. That keeps completing a task on Calendar instantly correct on Weekly Plan.
 */

// A range wider than this is refused, mirroring the bounded getProjectCompletions read.
const MAX_RANGE_WEEKS = 8;

class WeeklyPlanError extends Error {}

function fail(message) {
    throw new WeeklyPlanError(message);
}

// The week a task belongs to. A generated occurrence is identified by its occurrence date,
// matching how the client groups the same task.
function taskPlanDate(task) {
    if (task.seriesRef) return dateOnlyFromMarker(task.occurrenceDate);
    return dateOnlyFromMarker(task.dueDate);
}

function withinWeek(dateOnly, weekStart, weekEnd) {
    if (!dateOnly) return false;
    return compareDateOnly(dateOnly, weekStart) >= 0 && compareDateOnly(dateOnly, weekEnd) <= 0;
}

// Strict civil Monday, rejected rather than silently snapped to the containing week.
function parseMondayOrFail(value, label) {
    const parsed = parseDateOnly(value);
    if (!parsed.provided) fail(`${label} is required`);
    if (!parsed.valid) fail(`${label} must use YYYY-MM-DD`);

    const bounds = mondayWeekBounds(parsed.value, 'UTC');
    if (bounds.startDate !== parsed.value) fail(`${label} must be a Monday`);

    return parsed.value;
}

function currentWeek(user, now = new Date()) {
    return mondayWeekBounds(todayInZone(user.timeZone, now), user.timeZone);
}

/**
 * Resolve each stored item against its live task.
 *
 * One query for the whole plan set. A missing task is `removed` rather than dropped: the
 * snapshot is the record that the work was promised, and hiding it would make the review
 * quietly flattering.
 */
function resolveItems(plan, tasksById) {
    const weekStart = dateOnlyFromMarker(plan.weekStart);
    const weekEnd = dateOnlyFromMarker(plan.weekEnd);

    return (plan.items || []).map((item) => {
        const snapshot = {
            taskRef: item.taskRef ? String(item.taskRef) : null,
            projectRef: item.projectRef ? String(item.projectRef) : null,
            title: item.title,
            duration: item.duration,
            dueDate: dateOnlyFromMarker(item.dueDate),
            seriesRef: item.seriesRef ? String(item.seriesRef) : null,
            addedAt: item.addedAt,
        };

        const task = tasksById.get(snapshot.taskRef);
        if (!task) return { ...snapshot, status: 'removed' };

        if (task.completed) {
            return { ...snapshot, status: 'done', completedDate: task.completedDate };
        }

        const liveDate = taskPlanDate(task);
        if (!withinWeek(liveDate, weekStart, weekEnd)) {
            return { ...snapshot, status: 'moved', liveDueDate: liveDate };
        }

        return { ...snapshot, status: 'open', liveDueDate: liveDate, liveDuration: task.duration };
    });
}

function serializePlan(plan, tasksById) {
    return {
        weekStart: dateOnlyFromMarker(plan.weekStart),
        weekEnd: dateOnlyFromMarker(plan.weekEnd),
        timeZone: plan.timeZone,
        committedAt: plan.committedAt,
        amendedAt: plan.amendedAt,
        items: resolveItems(plan, tasksById),
    };
}

/**
 * Plans whose Monday falls inside an inclusive civil range, newest first.
 *
 * Bounded on purpose: the page only ever needs the current and previous Monday, and an
 * unbounded read would grow without limit as weeks accumulate.
 */
async function getWeeklyPlans(user, { from, to } = {}) {
    const fromMonday = parseMondayOrFail(from, 'from');
    const toMonday = parseMondayOrFail(to, 'to');

    if (compareDateOnly(fromMonday, toMonday) > 0) {
        fail('from must be on or before to');
    }

    const limit = addDateOnlyDays(fromMonday, MAX_RANGE_WEEKS * 7);
    if (compareDateOnly(toMonday, limit) > 0) {
        fail(`Range must cover at most ${MAX_RANGE_WEEKS} weeks`);
    }

    const plans = await WeeklyPlanDetails.find({
        userRef: user._id,
        weekStart: {
            $gte: parseDateOnly(fromMonday).date,
            $lte: parseDateOnly(toMonday).date,
        },
    }).sort({ weekStart: -1 });

    const taskIds = plans.flatMap((plan) => (plan.items || []).map((item) => item.taskRef));
    const tasks = taskIds.length
        ? await TaskDetails.find({ _id: { $in: taskIds }, userRef: user._id })
            .select('_id completed completedDate dueDate occurrenceDate seriesRef duration')
            .lean()
        : [];
    const tasksById = new Map(tasks.map((task) => [String(task._id), task]));

    return { plans: plans.map((plan) => serializePlan(plan, tasksById)) };
}

/**
 * Snapshot the tasks a user is committing to for the current week.
 *
 * Only the current week is accepted. That is what makes the feature honestly time-based:
 * there is no way to retro-fit a past week or pre-commit a future one, so no week navigation
 * is needed and last week's record can never be rewritten.
 *
 * Amending is ADDITIVE. Existing items are always kept exactly as they were snapshotted --
 * a commitment is a promise, so work that was later deleted or pushed out of the week must
 * survive as `removed`/`moved` rather than disappearing the next time the plan is updated.
 * `committedAt` is preserved and surviving items keep their original `addedAt`.
 */
async function commitWeeklyPlan(user, { weekStart, taskIds } = {}, now = new Date()) {
    const requested = parseMondayOrFail(weekStart, 'weekStart');
    const week = currentWeek(user, now);

    if (requested !== week.startDate) {
        fail('Only the current week can be committed');
    }

    if (taskIds !== undefined && !Array.isArray(taskIds)) {
        fail('taskIds must be an array');
    }

    const existing = await WeeklyPlanDetails.findOne({
        userRef: user._id,
        weekStart: parseDateOnly(week.startDate).date,
    });

    const alreadyCommitted = new Set(
        (existing?.items || []).map((item) => String(item.taskRef))
    );

    // Only genuinely new work is validated. Re-sending an already-committed id is a no-op,
    // so a caller echoing the current plan never trips the in-week check on a moved task.
    const additions = await selectCommittableTasks(user, week, taskIds, alreadyCommitted);
    const newItems = additions.map((task) => ({
        taskRef: task._id,
        projectRef: task.projectRef || null,
        title: task.title,
        duration: task.duration,
        dueDate: parseDateOnly(taskPlanDate(task)).date,
        seriesRef: task.seriesRef || null,
        addedAt: now,
    }));

    if (existing) {
        if (!newItems.length) return existing;

        existing.items = [...existing.items, ...newItems];
        existing.amendedAt = now;
        existing.timeZone = user.timeZone;
        await existing.save();
        return existing;
    }

    return WeeklyPlanDetails.create({
        userRef: user._id,
        weekStart: parseDateOnly(week.startDate).date,
        weekEnd: parseDateOnly(week.endDate).date,
        timeZone: user.timeZone,
        committedAt: now,
        amendedAt: null,
        items: newItems,
    });
}

/**
 * The tasks to add to a commitment.
 *
 * With explicit ids, every new one must belong to the caller and genuinely fall in the week
 * -- an unowned or out-of-week id is an error rather than a silent omission, so the client
 * never believes it committed something it did not. With no ids, take every project-linked
 * task currently in the week.
 */
async function selectCommittableTasks(user, week, taskIds, alreadyCommitted = new Set()) {
    if (taskIds === undefined) {
        const candidates = await TaskDetails.find({
            userRef: user._id,
            projectRef: { $ne: null },
            'recurrence.freq': { $exists: false },
        });
        return candidates.filter(
            (task) => inCommittableWeek(task, week) && !alreadyCommitted.has(String(task._id))
        );
    }

    const unique = [...new Set(taskIds.map((id) => String(id)))]
        .filter((id) => !alreadyCommitted.has(id));
    if (!unique.length) return [];

    let found = [];
    try {
        found = await TaskDetails.find({ _id: { $in: unique }, userRef: user._id });
    } catch (error) {
        // A malformed id is just a not-found from the caller's point of view.
        fail('Task not found');
    }

    const byId = new Map(found.map((task) => [String(task._id), task]));

    return unique.map((id) => {
        const task = byId.get(id);
        if (!task) fail('Task not found');
        if (task.recurrence?.freq) fail(`"${task.title}" is a repeating series, not a task`);
        if (!inCommittableWeek(task, week)) {
            fail(`"${task.title}" is not due during this week`);
        }
        return task;
    });
}

// Completed work still counts: finishing a task on Monday must not make it uncommittable.
function inCommittableWeek(task, week) {
    return withinWeek(taskPlanDate(task), week.startDate, week.endDate);
}

module.exports = {
    WeeklyPlanError,
    MAX_RANGE_WEEKS,
    getWeeklyPlans,
    commitWeeklyPlan,
};
