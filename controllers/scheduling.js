'use strict';

const { TaskDetails, EventDetails, UserDetails } = require('../models');
const {
    DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
    expandRecurrences,
    recurrenceWhenUnschedulableBehavior,
} = require('./recurrence');
const {
    addDateOnlyDays,
    dateOnlyFromMarker,
    dateOnlyInZone,
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
// One replan per selected task's slots is cheap, but the request is user-driven, so cap it.
const MAX_BLOCKED_SLOT_SELECTION = 10;

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
    // Forecasts replay this run, so remember the instant its capacity was measured from.
    await UserDetails.updateOne(
        { _id: user._id },
        { $set: { lastScheduleRunAt: input.currentTime } }
    );
    await cacheBlockedSlotForecasts(user, input.currentTime);
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

function isPlacedAfterDue(summary, task, timeZone) {
    if (!summary) return false;
    const completionDate = dateOnlyInZone(summary.last, timeZone);
    const dueDate = dateOnlyFromMarker(task.dueDate);
    return !!completionDate && !!dueDate && completionDate > dueDate;
}

function serializeImpact(task, baseline, forecast, timeZone) {
    const baselineDate = dateOnlyInZone(baseline.first, timeZone);
    const forecastDate = forecast ? dateOnlyInZone(forecast.first, timeZone) : null;
    return {
        taskId: task._id.toString(),
        title: task.title,
        baselineStart: baseline.first.toISOString(),
        baselineEnd: baseline.last.toISOString(),
        forecastStart: forecast?.first?.toISOString() || null,
        forecastEnd: forecast?.last?.toISOString() || null,
        baselineDate,
        forecastDate,
        dueDate: dateOnlyFromMarker(task.dueDate),
        moved: !forecast
            || forecast.first.getTime() !== baseline.first.getTime()
            || forecast.last.getTime() !== baseline.last.getTime(),
        newlyLate: !isPlacedAfterDue(baseline, task, timeZone)
            && isPlacedAfterDue(forecast, task, timeZone),
        unscheduled: !forecast,
    };
}

function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Load everything a blocked-slot simulation reads, once. `scheduleStart` must be the instant
 * the baseline schedule was generated from, or the comparison is against different capacity.
 */
async function loadForecastContext(user, scheduleStart) {
    const currentTime = new Date(scheduleStart);
    const horizon = schedulingHorizon(user, currentTime);

    const [tasks, baselineEvents, conflicts] = await Promise.all([
        loadSchedulingTasks(user._id),
        EventDetails.find({
            userRef: user._id,
            type: { $in: ['task', 'task-chunk'] },
        }).sort({ startDate: 1 }).lean(),
        EventDetails.find({
            userRef: user._id,
            type: { $nin: ['task', 'task-chunk'] },
            startDate: { $lte: horizon },
            endDate: { $gte: currentTime },
        }).sort({ startDate: 1 }).lean(),
    ]);
    const baselineByTask = placementSummary(baselineEvents);

    return {
        tasks,
        taskById: new Map(tasks.map((task) => [task._id.toString(), task])),
        baselineEvents,
        baselineByTask,
        baselineTaskIds: [...baselineByTask.keys()],
        conflicts,
        behaviorMap: await seriesBehaviorMap(tasks, user._id),
        taskTemporalCache: new Map(),
        currentTime,
        horizon,
    };
}

/**
 * Block every generated placement of every selected task, replan the normal queue once, and
 * diff against the baseline. One selected id reproduces the cached single-task forecast;
 * several model losing all those slots together, which is not the union of the separate runs.
 */
function simulateBlockedSlots(context, selectedTaskIds, user) {
    const selectedIds = new Set(selectedTaskIds.map(String));
    const blockers = context.baselineEvents
        .filter((event) => selectedIds.has(event.taskRef?.toString()))
        .map((event) => ({
            startDate: event.startDate,
            endDate: event.endDate,
            type: 'calendar',
        }));
    const plan = planTaskPlacements({
        tasks: context.tasks,
        events: [...context.conflicts, ...blockers],
        user,
        currentTime: context.currentTime,
        schedulingHorizon: context.horizon,
        seriesWhenUnschedulableBehaviorById: context.behaviorMap,
        taskTemporalCache: context.taskTemporalCache,
    });
    const forecastByTask = plannedPlacementSummary(plan.placements);
    // Selected tasks are the premise: they stay in the queue but never count as downstream.
    const affected = context.baselineTaskIds
        .filter((id) => !selectedIds.has(id) && context.taskById.has(id))
        .map((id) => serializeImpact(
            context.taskById.get(id),
            context.baselineByTask.get(id),
            forecastByTask.get(id),
            user.timeZone
        ))
        .filter((impact) => impact.moved);

    return {
        selectedTaskIds: [...selectedIds],
        movedCount: affected.length,
        newlyLateCount: affected.filter((impact) => impact.newlyLate).length,
        affected,
    };
}

async function calculateBlockedSlotForecasts(user, requestedTaskIds, scheduleStart) {
    if (!requestedTaskIds.length) return { impacts: {} };
    const ids = requestedTaskIds.map(String);
    const context = await loadForecastContext(user, scheduleStart);
    const impacts = {};

    for (const selectedId of ids) {
        const result = simulateBlockedSlots(context, [selectedId], user);
        impacts[selectedId] = { ...result, selectedTaskId: selectedId };
        await yieldToEventLoop();
    }

    return { impacts };
}

/**
 * On-demand combined forecast. Reads the saved schedule and writes nothing.
 */
async function analyzeBlockedSlots(user, requestedTaskIds) {
    if (!user.lastScheduleRunAt) {
        return { error: 'Run Schedule Tasks first to analyze blocked slots' };
    }

    const context = await loadForecastContext(user, user.lastScheduleRunAt);
    // Only the caller's own scheduled tasks are honoured, so an id alone reveals nothing.
    const selectedTaskIds = [...new Set(requestedTaskIds.map(String))]
        .filter((id) => context.taskById.has(id) && context.baselineByTask.has(id));
    if (!selectedTaskIds.length) {
        return { error: 'Select at least one scheduled task' };
    }

    const result = simulateBlockedSlots(context, selectedTaskIds, user);
    return {
        forecast: {
            ...result,
            selectedTitles: selectedTaskIds.map((id) => context.taskById.get(id).title),
            calculatedAt: new Date().toISOString(),
        },
    };
}

async function cacheBlockedSlotForecasts(user, scheduleStart = new Date()) {
    const windowEnd = zonedDateTime(
        addDateOnlyDays(dateOnlyInZone(scheduleStart, user.timeZone), FORECAST_WINDOW_DAYS + 1),
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
    const { impacts } = await calculateBlockedSlotForecasts(user, ids, scheduleStart);
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
    analyzeBlockedSlots,
    SCHEDULING_HORIZON_DAYS,
    MAX_FORECAST_TASKS,
    MAX_BLOCKED_SLOT_SELECTION,
    areDependenciesMet,
    validateNoCycles,
    findBestTaskForSlot,
    getWorkingHoursForDay,
    isWorkingDay,
    removeExpiredOccurrences,
};
