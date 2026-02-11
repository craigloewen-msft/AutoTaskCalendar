const { TaskDetails, EventDetails } = require('../models');

// ============================================================================
// Constants
// ============================================================================

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const SCHEDULING_HORIZON_DAYS = 14;
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
function getWorkingHoursForDay(date, workingStartTime, workingDurationHours) {
    const start = new Date(date);
    start.setHours(
        workingStartTime.getHours(),
        workingStartTime.getMinutes(),
        workingStartTime.getSeconds(),
        0
    );

    const end = new Date(start.getTime() + workingDurationHours * MS_PER_HOUR);

    return { start, end };
}

/**
 * Check if a date falls on a working day.
 */
function isWorkingDay(date, workingDays) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
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

/**
 * Find the best task to schedule in the given time slot.
 * Prioritizes:
 * 1. Tasks that can fit fully (earliest deadline first)
 * 2. Tasks that can be chunked (earliest deadline first)
 *
 * Returns { task, index, canFitFully } or null if no task fits.
 */
function findBestTaskForSlot(context, availableTime) {
    const { pendingTasks, chunkInfo, incompleteTaskMap, scheduledTaskIds, currentTime } = context;

    let bestChunkableTask = null;
    let bestChunkableIndex = -1;

    for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i];

        // Skip if dependencies aren't met
        if (!areDependenciesMet(task, incompleteTaskMap, scheduledTaskIds)) {
            continue;
        }

        // Skip if task hasn't started yet
        if (currentTime.getTime() <= task.startDate.getTime()) {
            continue;
        }

        const remainingDuration = getRemainingDuration(task, chunkInfo);
        const chunkDuration = getChunkDuration(task);

        // Check if task can fit fully
        if (availableTime >= remainingDuration) {
            return { task, index: i, canFitFully: true };
        }

        // Check if task can be chunked (remember first chunkable task)
        if (task.breakUpTask && availableTime >= chunkDuration && !bestChunkableTask) {
            bestChunkableTask = task;
            bestChunkableIndex = i;
        }
    }

    // Return chunkable task if no full task fits
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

    // Update task's scheduled date
    task.scheduledDate = currentTime;
    await task.save();

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
    const { currentTime, workingDays } = context;

    if (isWorkingDay(currentTime, workingDays)) {
        return false;
    }

    // Move to next day
    context.currentTime = new Date(currentTime.getTime() + MS_PER_DAY);
    return true;
}

/**
 * Handle case where current time is outside working hours.
 * Returns { handled, workingHours } where handled is true if we adjusted time.
 */
function handleOutsideWorkingHours(context) {
    const { currentTime, workingStartTime, workingDuration } = context;

    const { start, end } = getWorkingHoursForDay(currentTime, workingStartTime, workingDuration);

    const beforeStart = currentTime.getTime() < start.getTime();
    const afterEnd = currentTime.getTime() >= end.getTime();

    if (beforeStart) {
        context.currentTime = start;
        return { handled: true, workingHours: { start, end } };
    }

    if (afterEnd) {
        // Move to start of next day
        context.currentTime = new Date(start.getTime() + MS_PER_DAY);
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
    const schedulingHorizon = new Date(currentTime.getTime() + SCHEDULING_HORIZON_DAYS * MS_PER_DAY);

    // Get all incomplete tasks to build dependency map
    const allIncompleteTasks = await TaskDetails.find({
        userRef: user._id,
        $or: [{ completed: false }, { completed: null }]
    });

    const incompleteTaskMap = new Map();
    allIncompleteTasks.forEach(task => {
        incompleteTaskMap.set(task._id.toString(), task);
    });

    // Get regular tasks (sorted by deadline) and backlog tasks (sorted by start date)
    const regularTasks = await TaskDetails.find({
        userRef: user._id,
        $and: [
            { $or: [{ completed: false }, { completed: null }] },
            { $or: [{ isBacklog: false }, { isBacklog: null }] }
        ]
    }).sort({ dueDate: 1 });

    const backlogTasks = await TaskDetails.find({
        userRef: user._id,
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

        // User settings
        userId: user._id,
        workingDays: user.workingDays,
        workingStartTime: user.workingStartTime,
        workingDuration: user.workingDuration,

        // Tasks
        pendingTasks: [...regularTasks, ...backlogTasks],
        incompleteTaskMap,
        scheduledTaskIds: new Set(),
        chunkInfo: {},

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
    while (context.pendingTasks.length > 0) {
        // Safety check for infinite loops
        if (checkForInfiniteLoop(context)) break;

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
    // Export helpers for testing
    areDependenciesMet,
    validateNoCycles,
    findBestTaskForSlot,
    getWorkingHoursForDay,
    isWorkingDay,
};
