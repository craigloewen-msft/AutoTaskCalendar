'use strict';

const { TaskDetails, EventDetails } = require('../models');
const {
    DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
    expandRecurrences,
    recurrenceWhenUnschedulableBehavior,
} = require('./recurrence');
const {
    addDateOnlyDays,
    dateOnlyFromMarker,
    dateOnlyInZone,
    sameWallTimeNextDay,
    zonedDateTime,
} = require('../utils/temporal');
const {
    areDependenciesMet,
    findBestTaskForSlot,
    getWorkingHoursForDay,
    isWorkingDay,
    planTaskPlacements,
    removeExpiredOccurrences,
    validateNoCycles,
} = require('./schedulePlanner');

const SCHEDULING_HORIZON_DAYS = 60;
const FORECAST_WINDOW_DAYS = 21;
const MAX_FORECAST_TASKS = 100;

function incompleteTaskFilter(userId) {
    return {
        userRef: userId,
        'recurrence.freq': { $exists: false },
        $or: [{ completed: false }, { completed: null }],
    };
}

function schedulingHorizon(user, currentTime) {
    const currentDate = dateOnlyInZone(currentTime, user.timeZone);
    return zonedDateTime(
        addDateOnlyDays(currentDate, SCHEDULING_HORIZON_DAYS + 1),
        0,
        user.timeZone
    );
}

async function seriesBehaviorMap(tasks, userId) {
    const seriesIds = [...new Set(
        tasks.filter((task) => task.seriesRef).map((task) => task.seriesRef.toString())
    )];
    if (!seriesIds.length) return new Map();

    const templates = await TaskDetails.find({
        _id: { $in: seriesIds },
        userRef: userId,
    }, 'recurrence repeat');
    return new Map(templates.map((template) => [
        template._id.toString(),
        recurrenceWhenUnschedulableBehavior(template.recurrence)
            || DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
    ]));
}

async function loadSchedulingTasks(userId) {
    const filter = incompleteTaskFilter(userId);
    const [regular, backlog] = await Promise.all([
        TaskDetails.find({
            ...filter,
            $and: [
                { $or: [{ completed: false }, { completed: null }] },
                { $or: [{ isBacklog: false }, { isBacklog: null }] },
            ],
        }).sort({ dueDate: 1, priority: 1 }),
        TaskDetails.find({ ...filter, isBacklog: true }).sort({ startDate: 1 }),
    ]);
    return [...regular, ...backlog];
}

async function loadPlanningInput(user, currentTime = new Date()) {
    const horizon = schedulingHorizon(user, currentTime);
    const [tasks, events] = await Promise.all([
        loadSchedulingTasks(user._id),
        EventDetails.find({
            userRef: user._id,
            startDate: { $lte: horizon },
            endDate: { $gte: currentTime },
        }).sort({ startDate: 1 }).lean(),
    ]);
    return {
        tasks,
        events,
        currentTime,
        schedulingHorizon: horizon,
        seriesWhenUnschedulableBehaviorById: await seriesBehaviorMap(tasks, user._id),
    };
}

async function persistPlan(plan, user) {
    if (plan.placements.length) {
        await EventDetails.insertMany(plan.placements.map((placement) => ({
            title: placement.title,
            startDate: placement.startDate,
            endDate: placement.endDate,
            notes: placement.task.notes,
            type: placement.type,
            userRef: user._id,
            taskRef: placement.task._id,
        })));
    }

    const updates = [...plan.scheduledDates].map(([taskId, scheduledDate]) => ({
        updateOne: {
            filter: { _id: taskId, userRef: user._id },
            update: { $set: { scheduledDate } },
        },
    }));
    if (updates.length) await TaskDetails.bulkWrite(updates);
}

async function generateTaskEvents(user) {
    if (!user.workingDays?.length) return;

    await expandRecurrences(user, SCHEDULING_HORIZON_DAYS);
    await Promise.all([
        TaskDetails.updateMany(incompleteTaskFilter(user._id), {
            $set: { scheduledDate: null, slipForecast: null },
        }),
        EventDetails.deleteMany({
            userRef: user._id,
            type: { $in: ['task', 'task-chunk'] },
        }),
    ]);

    const input = await loadPlanningInput(user);
    if (!validateNoCycles(input.tasks)) {
        console.error('Circular dependency detected in tasks. Scheduling may not work correctly.');
    }
    const plan = planTaskPlacements({ ...input, user });
    if (plan.reachedLimit) {
        console.error('Task scheduling loop limit reached. Remaining tasks:', plan.unscheduledTaskIds.length);
    }
    await persistPlan(plan, user);
    await cacheOneDaySlipForecasts(user);
}

function placementSummary(events) {
    const byTask = new Map();
    for (const event of events) {
        const id = event.taskRef?.toString();
        if (!id) continue;
        const current = byTask.get(id) || { first: event.startDate, last: event.endDate };
        if (event.startDate < current.first) current.first = event.startDate;
        if (event.endDate > current.last) current.last = event.endDate;
        byTask.set(id, current);
    }
    return byTask;
}

function plannedPlacementSummary(placements) {
    const byTask = new Map();
    for (const placement of placements) {
        const current = byTask.get(placement.taskId) || {
            first: placement.startDate,
            last: placement.endDate,
        };
        if (placement.startDate < current.first) current.first = placement.startDate;
        if (placement.endDate > current.last) current.last = placement.endDate;
        byTask.set(placement.taskId, current);
    }
    return byTask;
}

function finishesAfterDue(summary, task, timeZone) {
    if (!summary) return true;
    const completionDate = dateOnlyInZone(summary.last, timeZone);
    const dueDate = dateOnlyFromMarker(task.dueDate);
    return !dueDate || completionDate > dueDate;
}

function serializeImpact(task, baseline, forecast, timeZone) {
    const baselineDate = dateOnlyInZone(baseline.first, timeZone);
    const forecastDate = forecast ? dateOnlyInZone(forecast.first, timeZone) : null;
    return {
        taskId: task._id.toString(),
        title: task.title,
        baselineStart: baseline.first.toISOString(),
        forecastStart: forecast?.first?.toISOString() || null,
        baselineDate,
        forecastDate,
        dueDate: dateOnlyFromMarker(task.dueDate),
        moved: !forecast || forecast.first.getTime() !== baseline.first.getTime(),
        newlyLate: !finishesAfterDue(baseline, task, timeZone)
            && finishesAfterDue(forecast, task, timeZone),
        unscheduled: !forecast,
    };
}

function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}

async function calculateOneDaySlipForecasts(user, requestedTaskIds) {
    if (!requestedTaskIds.length) return { impacts: {} };
    const ids = requestedTaskIds.map(String);
    const requestedIds = new Set(ids);

    const [tasks, baselineEvents] = await Promise.all([
        loadSchedulingTasks(user._id),
        EventDetails.find({
            userRef: user._id,
            type: { $in: ['task', 'task-chunk'] },
        }).sort({ startDate: 1 }).lean(),
    ]);
    const taskById = new Map(tasks.map((task) => [task._id.toString(), task]));
    const baselineByTask = placementSummary(baselineEvents);

    const firstStart = baselineEvents[0]?.startDate || new Date();
    const lastStart = baselineEvents[baselineEvents.length - 1]?.startDate || firstStart;
    const conflictHorizon = schedulingHorizon(user, lastStart);
    const conflicts = await EventDetails.find({
        userRef: user._id,
        type: { $nin: ['task', 'task-chunk'] },
        startDate: { $lte: conflictHorizon },
        endDate: { $gte: firstStart },
    }).sort({ startDate: 1 }).lean();
    const behaviorMap = await seriesBehaviorMap(tasks, user._id);
    const impacts = {};

    for (const selectedId of ids) {
        const selectedStart = baselineByTask.get(selectedId).first;
        const forecastStart = sameWallTimeNextDay(selectedStart, user.timeZone);
        const suffix = tasks.filter((task) => {
            const id = task._id.toString();
            const baseline = baselineByTask.get(id);
            return requestedIds.has(id)
                && baseline
                && baseline.first.getTime() >= selectedStart.getTime();
        });
        const suffixIds = new Set(suffix.map((task) => task._id.toString()));
        const fixedPrefixEvents = baselineEvents.filter((event) => {
            const baseline = baselineByTask.get(event.taskRef?.toString());
            return baseline
                && baseline.first.getTime() < selectedStart.getTime()
                && event.endDate >= forecastStart;
        });
        const relevantConflicts = [
            ...conflicts.filter((event) => event.endDate >= forecastStart),
            ...fixedPrefixEvents,
        ];
        const plan = planTaskPlacements({
            tasks: suffix,
            events: relevantConflicts,
            user,
            currentTime: forecastStart,
            schedulingHorizon: schedulingHorizon(user, forecastStart),
            seriesWhenUnschedulableBehaviorById: behaviorMap,
        });
        const forecastByTask = plannedPlacementSummary(plan.placements);
        const affected = baselineEvents
            .map((event) => event.taskRef?.toString())
            .filter((id, index, all) => id
                && id !== selectedId
                && all.indexOf(id) === index
                && suffixIds.has(id))
            .map((id) => serializeImpact(
                taskById.get(id),
                baselineByTask.get(id),
                forecastByTask.get(id),
                user.timeZone
            ))
            .filter((impact) => impact.moved);

        impacts[selectedId] = {
            selectedTaskId: selectedId,
            movedCount: affected.length,
            newlyLateCount: affected.filter((impact) => impact.newlyLate).length,
            affected,
        };
        await yieldToEventLoop();
    }

    return { impacts };
}

async function cacheOneDaySlipForecasts(user, now = new Date()) {
    const windowEnd = zonedDateTime(
        addDateOnlyDays(dateOnlyInZone(now, user.timeZone), FORECAST_WINDOW_DAYS + 1),
        0,
        user.timeZone
    );
    const candidates = await TaskDetails.find({
        ...incompleteTaskFilter(user._id),
        $and: [
            { scheduledDate: { $ne: null, $lt: windowEnd } },
            { $or: [{ isBacklog: false }, { isBacklog: null }] },
        ],
    }).sort({ scheduledDate: 1 }).limit(MAX_FORECAST_TASKS);
    const ids = candidates.map((task) => task._id.toString());
    const { impacts } = await calculateOneDaySlipForecasts(user, ids);
    const calculatedAt = new Date();
    const writes = ids.map((taskId) => ({
        updateOne: {
            filter: { _id: taskId, userRef: user._id },
            update: {
                $set: {
                    slipForecast: {
                        movedCount: impacts[taskId].movedCount,
                        newlyLateCount: impacts[taskId].newlyLateCount,
                        affected: impacts[taskId].affected,
                        calculatedAt,
                    },
                },
            },
        },
    }));
    if (writes.length) await TaskDetails.bulkWrite(writes);
    return impacts;
}

module.exports = {
    generateTaskEvents,
    SCHEDULING_HORIZON_DAYS,
    MAX_FORECAST_TASKS,
    areDependenciesMet,
    validateNoCycles,
    findBestTaskForSlot,
    getWorkingHoursForDay,
    isWorkingDay,
    removeExpiredOccurrences,
};
