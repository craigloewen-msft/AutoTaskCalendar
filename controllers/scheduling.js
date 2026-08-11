const { TaskDetails, EventDetails } = require('../models');
const {
    DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
    expandRecurrences,
    recurrenceWhenUnschedulableBehavior,
} = require('./recurrence');
const {
    dateOnlyInZone,
    addDateOnlyDays,
    zonedDateTime,
    todayInZone,
    taskEligibleInstant,
    nextDateStartInZone,
} = require('../utils/temporal');
const momentTz = require('moment-timezone');

// ============================================================================
// Constants
// ============================================================================

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Bounds the events query AND recurrence expansion. Keep them equal: the scheduling loop
// is unbounded, so a shorter event window books on top of real calendar events.
const SCHEDULING_HORIZON_DAYS = 60;
const MAX_SCHEDULING_ITERATIONS = 10000;
const MAX_NO_PROGRESS_ITERATIONS = 100;
const VERY_LARGE_TIME_MS = 999 * MS_PER_DAY;

// ============================================================================
// Dependency Helpers
// ============================================================================

/**
 * Check if all dependencies for a task are met.
 * A dependency is met if:
 * 1. The dependent task is completed (not in incompleteTaskMap), OR
 * 2. The dependent task has been scheduled (in scheduledTaskIds)
 */
function areDependenciesMet(task, incompleteTaskMap, scheduledTaskIds) {
    if (!task.dependsOn || task.dependsOn.length === 0) {
        return true;
    }

    for (const depId of task.dependsOn) {
        const depIdStr = depId.toString();
        const dependentTask = incompleteTaskMap.get(depIdStr);

        // If task is in the map, it's incomplete - check if it's been scheduled
        if (dependentTask && !scheduledTaskIds.has(depIdStr)) {
            return false;
        }
    }

    return true;
}

/**
 * Validate that no circular dependencies exist in the task list.
 * Uses DFS to detect cycles in the dependency graph.
 */
function validateNoCycles(tasks) {
    const taskMap = new Map();
    tasks.forEach(task => taskMap.set(task._id.toString(), task));

    const visited = new Set();
    const recursionStack = new Set();

    function hasCycleDFS(taskId) {
        visited.add(taskId);
        recursionStack.add(taskId);

        const task = taskMap.get(taskId);
        if (task?.dependsOn?.length > 0) {
            for (const depId of task.dependsOn) {
                const depIdStr = depId.toString();

                // Skip if dependency is completed or doesn't exist
                if (!taskMap.has(depIdStr)) continue;

                if (!visited.has(depIdStr)) {
                    if (hasCycleDFS(depIdStr)) return true;
                } else if (recursionStack.has(depIdStr)) {
                    return true;
                }
            }
        }

        recursionStack.delete(taskId);
        return false;
    }

    for (const task of tasks) {
        const taskId = task._id.toString();
        if (!visited.has(taskId) && hasCycleDFS(taskId)) {
            console.error(`Circular dependency detected involving task: "${task.title}" (ID: ${taskId})`);
            return false;
        }
    }

    return true;
}

// ============================================================================
// Time & Working Hours Helpers
// ============================================================================

/**
 * Get the start and end times for working hours on a given day.
 */
function getWorkingHoursForDay(date, workingStartMinutes, workingEndMinutes, timeZone) {
    const civilDate = dateOnlyInZone(date, timeZone);
    const start = zonedDateTime(civilDate, workingStartMinutes, timeZone);
    const end = zonedDateTime(civilDate, workingEndMinutes, timeZone);
    return { start, end };
}

/**
 * Check if a date falls on a working day.
 */
function isWorkingDay(date, workingDays, timeZone = 'UTC') {
    const dayName = momentTz(date).tz(timeZone).format('dddd');
    return workingDays.includes(dayName);
}

/**
 * Calculate available time in current slot, bounded by next event and end of working hours.
 */
function getAvailableTimeInSlot(currentTime, nextEvent, endOfWorking) {
    let availableTime = VERY_LARGE_TIME_MS;

    if (nextEvent) {
        availableTime = nextEvent.startDate.getTime() - currentTime.getTime();
    }

    const timeToEndOfWork = endOfWorking.getTime() - currentTime.getTime();
    return Math.min(availableTime, timeToEndOfWork);
}

// ============================================================================
// Task Duration Helpers
// ============================================================================

/**
 * Get the remaining duration for a task, accounting for any chunks already scheduled.
 */
function getRemainingDuration(task, chunkInfo) {
    const info = chunkInfo[task._id];
    return info ? info.remainingDuration : task.duration * MS_PER_MINUTE;
}

/**
 * Get the chunk duration for a task (0 if not a chunked task).
 */
function getChunkDuration(task) {
    return task.breakUpTask ? task.breakUpTaskChunkDuration * MS_PER_MINUTE : 0;
}

// ============================================================================
// Task Selection
// ============================================================================

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
            delete context.chunkInfo[task._id];
            context.pendingTasks.splice(index, 1);
            removed++;
        }
    }

    return removed;
}

/**
 * Find the best task to schedule in the given time slot.
 * Prioritizes by earliest deadline, considering both tasks that fit fully
 * and tasks that can be chunked. Picks whichever eligible candidate has the
 * soonest due date so that urgent tasks are never delayed in favour of a
 * lower-priority task that happens to fit in the remaining time.
 *
 * Returns { task, index, canFitFully } or null if no task fits.
 */
function findBestTaskForSlot(context, availableTime) {
    const { pendingTasks, chunkInfo, incompleteTaskMap, scheduledTaskIds, currentTime } = context;

    // NOTE: pendingTasks is sorted by deadline (earliest first) coming from
    // buildSchedulingContext. The logic below relies on this ordering: the
    // first eligible "fits fully" task and the first eligible "chunkable"
    // task encountered are already the earliest-deadline candidates of each
    // type, so we stop searching as soon as we have one of each.
    let bestFullTask = null;
    let bestFullIndex = -1;
    let bestChunkableTask = null;
    let bestChunkableIndex = -1;

    for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i];

        // Skip if dependencies aren't met
        if (!areDependenciesMet(task, incompleteTaskMap, scheduledTaskIds)) {
            continue;
        }

        // Civil task dates become timeline instants in the user's timezone.
        const eligibleAt = taskEligibleInstant(task.startDate, context.timeZone);
        if (!eligibleAt || currentTime.getTime() < eligibleAt.getTime()) {
            continue;
        }

        const remainingDuration = getRemainingDuration(task, chunkInfo);
        const chunkDuration = getChunkDuration(task);

        // First eligible task that fits fully has the earliest deadline of its kind
        if (availableTime >= remainingDuration && !bestFullTask) {
            bestFullTask = task;
            bestFullIndex = i;
        }

        // First eligible chunkable task has the earliest deadline of its kind
        if (task.breakUpTask && availableTime >= chunkDuration && !bestChunkableTask) {
            bestChunkableTask = task;
            bestChunkableIndex = i;
        }

        // Both candidates found - no need to scan further
        if (bestFullTask && bestChunkableTask) {
            break;
        }
    }

    // Prefer the candidate with the earlier deadline (use priority as tiebreaker)
    if (bestFullTask && bestChunkableTask) {
        const fullPriority = bestFullTask.priority != null ? bestFullTask.priority : 100;
        const chunkPriority = bestChunkableTask.priority != null ? bestChunkableTask.priority : 100;
        if (bestChunkableTask.dueDate < bestFullTask.dueDate ||
            (bestChunkableTask.dueDate.getTime() === bestFullTask.dueDate.getTime() && chunkPriority < fullPriority)) {
            return { task: bestChunkableTask, index: bestChunkableIndex, canFitFully: false };
        }
        return { task: bestFullTask, index: bestFullIndex, canFitFully: true };
    }

    if (bestFullTask) {
        return { task: bestFullTask, index: bestFullIndex, canFitFully: true };
    }

    if (bestChunkableTask) {
        return { task: bestChunkableTask, index: bestChunkableIndex, canFitFully: false };
    }

    return null;
}

// ============================================================================
// Event Creation
// ============================================================================

/**
 * Create and save a calendar event for a task or task chunk.
 */
async function createTaskEvent(task, startTime, duration, chunkInfo, userId) {
    const isChunk = !!chunkInfo;
    const chunkNumber = isChunk ? chunkInfo.chunkNumber : null;

    const title = chunkNumber ? `${task.title} (${chunkNumber})` : task.title;
    const type = isChunk ? 'task-chunk' : 'task';

    const event = new EventDetails({
        title,
        startDate: startTime,
        endDate: new Date(startTime.getTime() + duration),
        notes: task.notes,
        type,
        userRef: userId,
        taskRef: task._id,
    });

    await event.save();
    return event;
}

/**
 * Schedule a full task (or remaining portion of a chunked task).
 */
async function scheduleFullTask(context, task, taskIndex) {
    const { chunkInfo, currentTime, userId, pendingTasks, scheduledTaskIds } = context;

    const duration = getRemainingDuration(task, chunkInfo);
    const existingChunkInfo = chunkInfo[task._id];

    // Increment chunk number if this task was previously chunked
    if (existingChunkInfo) {
        existingChunkInfo.chunkNumber++;
    }

    const event = await createTaskEvent(
        task,
        currentTime,
        duration,
        existingChunkInfo,
        userId
    );

    // Remove task from pending and mark as scheduled
    pendingTasks.splice(taskIndex, 1);
    scheduledTaskIds.add(task._id.toString());

    // Update the scheduled date. updateOne rather than save() because a concurrent run can
    // prune this occurrence mid-loop, and save() would throw DocumentNotFoundError.
    task.scheduledDate = currentTime;
    await TaskDetails.updateOne({ _id: task._id }, { $set: { scheduledDate: currentTime } });

    // Advance time
    context.currentTime = event.endDate;

    return true;
}

/**
 * Schedule a chunk of a task.
 */
async function scheduleTaskChunk(context, task, availableTime) {
    const { chunkInfo, currentTime, userId } = context;

    const chunkDuration = getChunkDuration(task);
    const numChunks = Math.floor(availableTime / chunkDuration);
    const totalChunkTime = numChunks * chunkDuration;

    // Initialize or update chunk info
    let taskChunkInfo = chunkInfo[task._id];
    if (!taskChunkInfo) {
        const fullDuration = getRemainingDuration(task, chunkInfo);
        taskChunkInfo = { chunkNumber: 0, remainingDuration: fullDuration };
        chunkInfo[task._id] = taskChunkInfo;
    }

    taskChunkInfo.chunkNumber++;
    taskChunkInfo.remainingDuration -= totalChunkTime;

    const event = await createTaskEvent(
        task,
        currentTime,
        totalChunkTime,
        taskChunkInfo,
        userId
    );

    // Advance time
    context.currentTime = event.endDate;

    return true;
}

// ============================================================================
// Main Scheduling Loop Helpers
// ============================================================================

/**
 * Handle case where current time overlaps with an existing event.
 * Returns true if we handled an overlap (caller should continue loop).
 */
function handleEventOverlap(context) {
    const { events, currentTime } = context;
    const nextEvent = events[context.eventIndex];

    if (!nextEvent) return false;

    const isOverlapping = nextEvent.startDate.getTime() <= currentTime.getTime();
    if (!isOverlapping) return false;

    // Move past the event if we're inside it
    if (currentTime.getTime() < nextEvent.endDate.getTime()) {
        context.currentTime = new Date(nextEvent.endDate);
    }
    context.eventIndex++;

    return true;
}

/**
 * Handle case where current time is not on a working day.
 * Returns true if we skipped a day (caller should continue loop).
 */
function handleNonWorkingDay(context) {
    const { currentTime, workingDays, timeZone } = context;

    if (isWorkingDay(currentTime, workingDays, timeZone)) {
        return false;
    }

    const currentDate = dateOnlyInZone(currentTime, timeZone);
    context.currentTime = zonedDateTime(addDateOnlyDays(currentDate, 1), 0, timeZone);
    return true;
}

/**
 * Handle case where current time is outside working hours.
 * Returns { handled, workingHours } where handled is true if we adjusted time.
 */
function handleOutsideWorkingHours(context) {
    const { currentTime, workingStartMinutes, workingEndMinutes, timeZone } = context;

    const { start, end } = getWorkingHoursForDay(
        currentTime,
        workingStartMinutes,
        workingEndMinutes,
        timeZone
    );

    const beforeStart = currentTime.getTime() < start.getTime();
    const afterEnd = currentTime.getTime() >= end.getTime();

    if (beforeStart) {
        context.currentTime = start;
        return { handled: true, workingHours: { start, end } };
    }

    if (afterEnd) {
        const currentDate = dateOnlyInZone(start, timeZone);
        context.currentTime = zonedDateTime(
            addDateOnlyDays(currentDate, 1),
            workingStartMinutes,
            timeZone
        );
        return { handled: true, workingHours: { start, end } };
    }

    return { handled: false, workingHours: { start, end } };
}

/**
 * Advance time to the next scheduling boundary (end of work or next event).
 */
function advanceToNextBoundary(context, endOfWorking) {
    const nextEvent = context.events[context.eventIndex];
    let nextTime = endOfWorking;

    if (nextEvent && nextEvent.startDate.getTime() <= nextTime.getTime()) {
        nextTime = nextEvent.startDate;
    }

    context.currentTime = nextTime;
}

/**
 * Check if we're stuck in an infinite loop.
 */
function checkForInfiniteLoop(context) {
    context.iterations++;

    if (context.iterations > MAX_SCHEDULING_ITERATIONS ||
        context.noProgressCount > MAX_NO_PROGRESS_ITERATIONS) {
        console.error('Task scheduling loop limit reached. Remaining tasks:', context.pendingTasks.length);
        for (const task of context.pendingTasks) {
            console.error(`Unschedulable task: "${task.title}" - Duration: ${task.duration} mins, Break up: ${task.breakUpTask}`);
        }
        return true;
    }

    return false;
}

/**
 * Track progress to detect if we're stuck.
 */
function trackProgress(context) {
    if (context.pendingTasks.length === context.lastTaskCount) {
        context.noProgressCount++;
    } else {
        context.noProgressCount = 0;
        context.lastTaskCount = context.pendingTasks.length;
    }
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Build the initial scheduling context with all necessary state.
 */
async function buildSchedulingContext(user) {
    const currentTime = new Date();
    const today = todayInZone(user.timeZone, currentTime);
    const schedulingHorizon = zonedDateTime(
        addDateOnlyDays(today, SCHEDULING_HORIZON_DAYS + 1),
        0,
        user.timeZone
    );

    // Get all incomplete tasks to build dependency map. Series templates own a rule and
    // are never work items, so they are excluded wherever tasks are treated as schedulable.
    const allIncompleteTasks = await TaskDetails.find({
        userRef: user._id,
        'recurrence.freq': { $exists: false },
        $or: [{ completed: false }, { completed: null }]
    });

    const incompleteTaskMap = new Map();
    allIncompleteTasks.forEach(task => {
        incompleteTaskMap.set(task._id.toString(), task);
    });

    const seriesIds = [
        ...new Set(
            allIncompleteTasks
                .filter((task) => task.seriesRef)
                .map((task) => task.seriesRef.toString())
        ),
    ];
    const seriesTemplates = seriesIds.length > 0
        ? await TaskDetails.find({
            _id: { $in: seriesIds },
            userRef: user._id,
        }, 'recurrence repeat')
        : [];
    const seriesWhenUnschedulableBehaviorById = new Map(seriesTemplates.map((template) => [
        template._id.toString(),
        recurrenceWhenUnschedulableBehavior(template.recurrence),
    ]));

    // Get regular tasks (sorted by deadline) and backlog tasks (sorted by start date)
    const regularTasks = await TaskDetails.find({
        userRef: user._id,
        'recurrence.freq': { $exists: false },
        $and: [
            { $or: [{ completed: false }, { completed: null }] },
            { $or: [{ isBacklog: false }, { isBacklog: null }] }
        ]
    }).sort({ dueDate: 1, priority: 1 });

    const backlogTasks = await TaskDetails.find({
        userRef: user._id,
        'recurrence.freq': { $exists: false },
        $or: [{ completed: false }, { completed: null }],
        isBacklog: true,
    }).sort({ startDate: 1 });

    // Get existing events
    const events = await EventDetails.find({
        userRef: user._id,
        startDate: { $lte: schedulingHorizon },
        endDate: { $gte: currentTime }
    }).sort({ startDate: 1 });

    return {
        // Time tracking
        currentTime,
        schedulingHorizon,

        // User settings
        userId: user._id,
        workingDays: user.workingDays,
        timeZone: user.timeZone,
        workingStartMinutes: user.workingStartMinutes,
        workingEndMinutes: user.workingEndMinutes,

        // Tasks
        pendingTasks: [...regularTasks, ...backlogTasks],
        incompleteTaskMap,
        scheduledTaskIds: new Set(),
        chunkInfo: {},
        seriesWhenUnschedulableBehaviorById,

        // Events
        events,
        eventIndex: 0,

        // Loop control
        iterations: 0,
        noProgressCount: 0,
        lastTaskCount: regularTasks.length + backlogTasks.length,
    };
}

/**
 * Main scheduling function - generates calendar events for all pending tasks.
 */
async function generateTaskEvents(user) {
    // Early exit if no working days configured
    if (!user.workingDays || user.workingDays.length === 0) {
        return;
    }

    // Materialise recurring series first, so occurrences are ordinary task documents by
    // the time the scheduling loop sees them.
    await expandRecurrences(user, SCHEDULING_HORIZON_DAYS);

    // Placement is rebuilt from scratch. Tasks that are no longer placeable must not retain
    // a stale sidebar date from an earlier run.
    await TaskDetails.updateMany({
        userRef: user._id,
        'recurrence.freq': { $exists: false },
        $or: [{ completed: false }, { completed: null }],
    }, { $set: { scheduledDate: null } });

    // Clear existing task events
    await EventDetails.deleteMany({
        userRef: user._id,
        type: { $in: ['task', 'task-chunk'] }
    });

    // Build scheduling context
    const context = await buildSchedulingContext(user);

    // Validate no circular dependencies
    if (!validateNoCycles(context.pendingTasks)) {
        console.error('Circular dependency detected in tasks. Scheduling may not work correctly.');
    }

    // Main scheduling loop
    while (
        context.pendingTasks.length > 0
        && context.currentTime.getTime() < context.schedulingHorizon.getTime()
    ) {
        // Safety check for infinite loops
        if (checkForInfiniteLoop(context)) break;

        if (removeExpiredOccurrences(context) > 0) {
            trackProgress(context);
            continue;
        }

        // Skip past any overlapping events
        if (handleEventOverlap(context)) continue;

        // Skip non-working days
        if (handleNonWorkingDay(context)) continue;

        // Adjust to working hours if needed
        const { handled, workingHours } = handleOutsideWorkingHours(context);
        if (handled) continue;

        // We're now in a valid working time slot
        const nextEvent = context.events[context.eventIndex];
        const availableTime = getAvailableTimeInSlot(
            context.currentTime,
            nextEvent,
            workingHours.end
        );

        // Find the best task to schedule
        const selection = findBestTaskForSlot(context, availableTime);

        if (selection) {
            const { task, index, canFitFully } = selection;

            if (canFitFully) {
                await scheduleFullTask(context, task, index);
            } else {
                await scheduleTaskChunk(context, task, availableTime);
            }
        } else {
            // No task fits, advance to next boundary
            advanceToNextBoundary(context, workingHours.end);
        }

        // Track progress for infinite loop detection
        trackProgress(context);
    }
}

module.exports = {
    generateTaskEvents,
    SCHEDULING_HORIZON_DAYS,
    // Export helpers for testing
    areDependenciesMet,
    validateNoCycles,
    findBestTaskForSlot,
    getWorkingHoursForDay,
    isWorkingDay,
    removeExpiredOccurrences,
};
