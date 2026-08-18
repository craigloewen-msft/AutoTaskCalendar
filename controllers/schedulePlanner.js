'use strict';

const momentTz = require('moment-timezone');
const {
    addDateOnlyDays,
    dateOnlyInZone,
    nextDateStartInZone,
    taskEligibleInstant,
    zonedDateTime,
} = require('../utils/temporal');
const {
    DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
} = require('./recurrence');

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MAX_SCHEDULING_ITERATIONS = 10000;
const MAX_NO_PROGRESS_ITERATIONS = 100;
const VERY_LARGE_TIME_MS = 999 * MS_PER_DAY;

function taskId(task) {
    return task?._id?.toString() || '';
}

function areDependenciesMet(task, incompleteTaskMap, scheduledTaskIds) {
    if (!task.dependsOn || task.dependsOn.length === 0) return true;

    for (const dependencyId of task.dependsOn) {
        const id = dependencyId.toString();
        if (incompleteTaskMap.has(id) && !scheduledTaskIds.has(id)) return false;
    }
    return true;
}

function validateNoCycles(tasks) {
    const taskMap = new Map(tasks.map((task) => [taskId(task), task]));
    const visited = new Set();
    const stack = new Set();

    function hasCycle(id) {
        visited.add(id);
        stack.add(id);
        const task = taskMap.get(id);

        for (const dependencyId of task?.dependsOn || []) {
            const dependency = dependencyId.toString();
            if (!taskMap.has(dependency)) continue;
            if (!visited.has(dependency) && hasCycle(dependency)) return true;
            if (stack.has(dependency)) return true;
        }

        stack.delete(id);
        return false;
    }

    for (const id of taskMap.keys()) {
        if (!visited.has(id) && hasCycle(id)) return false;
    }
    return true;
}

function getWorkingHoursForDay(date, workingStartMinutes, workingEndMinutes, timeZone) {
    const civilDate = dateOnlyInZone(date, timeZone);
    return {
        start: zonedDateTime(civilDate, workingStartMinutes, timeZone),
        end: zonedDateTime(civilDate, workingEndMinutes, timeZone),
    };
}

function isWorkingDay(date, workingDays, timeZone = 'UTC') {
    return workingDays.includes(momentTz(date).tz(timeZone).format('dddd'));
}

function getAvailableTimeInSlot(currentTime, nextEvent, endOfWorking) {
    const untilEvent = nextEvent
        ? nextEvent.startDate.getTime() - currentTime.getTime()
        : VERY_LARGE_TIME_MS;
    return Math.min(untilEvent, endOfWorking.getTime() - currentTime.getTime());
}

function getRemainingDuration(task, chunkInfo) {
    return chunkInfo[taskId(task)]?.remainingDuration ?? task.duration * MS_PER_MINUTE;
}

function getChunkDuration(task) {
    return task.breakUpTask ? task.breakUpTaskChunkDuration * MS_PER_MINUTE : 0;
}

function priorityRank(task) {
    const priority = Number(task?.priority ?? 100);
    return Number.isFinite(priority) ? priority : 100;
}

function dateRank(value) {
    if (!value) return Number.POSITIVE_INFINITY;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareRanks(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function compareTasksForScheduling(left, right) {
    const backlogOrder = Number(!!left?.isBacklog) - Number(!!right?.isBacklog);
    if (backlogOrder) return backlogOrder;

    if (left?.isBacklog && right?.isBacklog) {
        const startOrder = compareRanks(dateRank(left.startDate), dateRank(right.startDate));
        if (startOrder) return startOrder;
    }

    const priorityOrder = compareRanks(priorityRank(left), priorityRank(right));
    if (priorityOrder) return priorityOrder;

    const dueDateOrder = compareRanks(dateRank(left?.dueDate), dateRank(right?.dueDate));
    if (dueDateOrder) return dueDateOrder;

    return taskId(left).localeCompare(taskId(right));
}

function whenUnschedulableBehaviorForTask(task, context) {
    if (!task.seriesRef) return null;
    return context.seriesWhenUnschedulableBehaviorById.get(task.seriesRef.toString())
        || DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR;
}

function occurrenceExpiresAt(task, context) {
    if (whenUnschedulableBehaviorForTask(task, context) !== 'skip' || !task.occurrenceDate) {
        return null;
    }
    return nextDateStartInZone(task.occurrenceDate, context.timeZone);
}

function removeExpiredOccurrences(context) {
    let removed = 0;
    for (let index = context.pendingTasks.length - 1; index >= 0; index--) {
        const task = context.pendingTasks[index];
        const expiresAt = occurrenceExpiresAt(task, context);
        if (expiresAt && context.currentTime.getTime() >= expiresAt.getTime()) {
            delete context.chunkInfo[taskId(task)];
            context.pendingTasks.splice(index, 1);
            if (context.expiredTaskIds) context.expiredTaskIds.push(taskId(task));
            removed++;
        }
    }
    return removed;
}

function findBestTaskForSlot(context, availableTime) {
    const { pendingTasks, chunkInfo, incompleteTaskMap, scheduledTaskIds, currentTime } = context;
    let best = null;

    for (let index = 0; index < pendingTasks.length; index++) {
        const task = pendingTasks[index];
        if (!areDependenciesMet(task, incompleteTaskMap, scheduledTaskIds)) continue;

        const eligibleAt = taskEligibleInstant(task.startDate, context.timeZone);
        if (!eligibleAt || currentTime.getTime() < eligibleAt.getTime()) continue;

        const canFitFully = availableTime >= getRemainingDuration(task, chunkInfo);
        const canFitChunk = task.breakUpTask && availableTime >= getChunkDuration(task);
        if (!canFitFully && !canFitChunk) continue;

        const candidate = { task, index, canFitFully };
        if (!best || compareTasksForScheduling(candidate.task, best.task) < 0) {
            best = candidate;
        }
    }

    return best;
}

function placementFor(task, startDate, duration, chunkNumber = null) {
    return {
        task,
        taskId: taskId(task),
        title: chunkNumber ? `${task.title} (${chunkNumber})` : task.title,
        type: chunkNumber ? 'task-chunk' : 'task',
        startDate: new Date(startDate),
        endDate: new Date(startDate.getTime() + duration),
    };
}

function scheduleFullTask(context, task, taskIndex) {
    const id = taskId(task);
    const chunk = context.chunkInfo[id];
    if (chunk) chunk.chunkNumber++;

    const placement = placementFor(
        task,
        context.currentTime,
        getRemainingDuration(task, context.chunkInfo),
        chunk?.chunkNumber || null
    );
    context.placements.push(placement);
    context.pendingTasks.splice(taskIndex, 1);
    context.scheduledTaskIds.add(id);
    context.scheduledDates.set(id, new Date(context.currentTime));
    context.currentTime = placement.endDate;
}

function scheduleTaskChunk(context, task, availableTime) {
    const id = taskId(task);
    const chunkDuration = getChunkDuration(task);
    const totalChunkTime = Math.floor(availableTime / chunkDuration) * chunkDuration;
    let chunk = context.chunkInfo[id];

    if (!chunk) {
        chunk = { chunkNumber: 0, remainingDuration: getRemainingDuration(task, context.chunkInfo) };
        context.chunkInfo[id] = chunk;
    }
    chunk.chunkNumber++;
    chunk.remainingDuration -= totalChunkTime;

    const placement = placementFor(task, context.currentTime, totalChunkTime, chunk.chunkNumber);
    context.placements.push(placement);
    context.currentTime = placement.endDate;
}

function handleEventOverlap(context) {
    const nextEvent = context.events[context.eventIndex];
    if (!nextEvent || nextEvent.startDate.getTime() > context.currentTime.getTime()) return false;

    if (context.currentTime.getTime() < nextEvent.endDate.getTime()) {
        context.currentTime = new Date(nextEvent.endDate);
    }
    context.eventIndex++;
    return true;
}

function handleNonWorkingDay(context) {
    if (isWorkingDay(context.currentTime, context.workingDays, context.timeZone)) return false;

    const currentDate = dateOnlyInZone(context.currentTime, context.timeZone);
    context.currentTime = zonedDateTime(addDateOnlyDays(currentDate, 1), 0, context.timeZone);
    return true;
}

function handleOutsideWorkingHours(context) {
    const hours = getWorkingHoursForDay(
        context.currentTime,
        context.workingStartMinutes,
        context.workingEndMinutes,
        context.timeZone
    );
    if (context.currentTime.getTime() < hours.start.getTime()) {
        context.currentTime = hours.start;
        return { handled: true, hours };
    }
    if (context.currentTime.getTime() >= hours.end.getTime()) {
        const nextDate = addDateOnlyDays(dateOnlyInZone(hours.start, context.timeZone), 1);
        context.currentTime = zonedDateTime(nextDate, context.workingStartMinutes, context.timeZone);
        return { handled: true, hours };
    }
    return { handled: false, hours };
}

function advanceToNextBoundary(context, endOfWorking) {
    const nextEvent = context.events[context.eventIndex];
    context.currentTime = nextEvent && nextEvent.startDate.getTime() <= endOfWorking.getTime()
        ? new Date(nextEvent.startDate)
        : new Date(endOfWorking);
}

function trackProgress(context) {
    if (context.pendingTasks.length === context.lastTaskCount) {
        context.noProgressCount++;
    } else {
        context.noProgressCount = 0;
        context.lastTaskCount = context.pendingTasks.length;
    }
}

/**
 * Pure scheduling engine. Inputs are read but never mutated or persisted.
 */
function planTaskPlacements({
    tasks,
    events = [],
    user,
    currentTime = new Date(),
    schedulingHorizon,
    seriesWhenUnschedulableBehaviorById = new Map(),
}) {
    const pendingTasks = [...tasks];
    const context = {
        currentTime: new Date(currentTime),
        schedulingHorizon: new Date(schedulingHorizon),
        workingDays: [...(user.workingDays || [])],
        timeZone: user.timeZone || 'UTC',
        workingStartMinutes: user.workingStartMinutes,
        workingEndMinutes: user.workingEndMinutes,
        pendingTasks,
        incompleteTaskMap: new Map(pendingTasks.map((task) => [taskId(task), task])),
        scheduledTaskIds: new Set(),
        scheduledDates: new Map(),
        chunkInfo: {},
        seriesWhenUnschedulableBehaviorById,
        events: events
            .map((event) => ({
                ...event,
                startDate: new Date(event.startDate),
                endDate: new Date(event.endDate),
            }))
            .sort((left, right) => left.startDate - right.startDate),
        eventIndex: 0,
        placements: [],
        expiredTaskIds: [],
        iterations: 0,
        noProgressCount: 0,
        lastTaskCount: pendingTasks.length,
    };

    if (!context.workingDays.length) {
        return {
            placements: [],
            scheduledDates: context.scheduledDates,
            unscheduledTaskIds: pendingTasks.map(taskId),
            expiredTaskIds: [],
            reachedLimit: false,
        };
    }

    let reachedLimit = false;
    while (context.pendingTasks.length
        && context.currentTime.getTime() < context.schedulingHorizon.getTime()) {
        context.iterations++;
        if (context.iterations > MAX_SCHEDULING_ITERATIONS
            || context.noProgressCount > MAX_NO_PROGRESS_ITERATIONS) {
            reachedLimit = true;
            break;
        }
        if (removeExpiredOccurrences(context)) {
            trackProgress(context);
            continue;
        }
        if (handleEventOverlap(context)) continue;
        if (handleNonWorkingDay(context)) continue;

        const { handled, hours } = handleOutsideWorkingHours(context);
        if (handled) continue;

        const availableTime = getAvailableTimeInSlot(
            context.currentTime,
            context.events[context.eventIndex],
            hours.end
        );
        const selection = findBestTaskForSlot(context, availableTime);
        if (selection?.canFitFully) {
            scheduleFullTask(context, selection.task, selection.index);
        } else if (selection) {
            scheduleTaskChunk(context, selection.task, availableTime);
        } else {
            advanceToNextBoundary(context, hours.end);
        }
        trackProgress(context);
    }

    return {
        placements: context.placements,
        scheduledDates: context.scheduledDates,
        unscheduledTaskIds: context.pendingTasks.map(taskId),
        expiredTaskIds: context.expiredTaskIds,
        reachedLimit,
    };
}

module.exports = {
    areDependenciesMet,
    findBestTaskForSlot,
    getWorkingHoursForDay,
    isWorkingDay,
    planTaskPlacements,
    removeExpiredOccurrences,
    validateNoCycles,
};
