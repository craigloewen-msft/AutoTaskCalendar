const express = require('express');
const router = express.Router();
const { UserDetails, TaskDetails, ProjectDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const {
    getTaskListFromUsername,
    getProjectCompletions,
    completeTask,
    generateTaskEvents,
} = require('../controllers/taskController');
const { validateRecurrence, normaliseRecurrence, expandRecurrences } = require('../controllers/recurrence');
const { SCHEDULING_HORIZON_DAYS } = require('../controllers/scheduling');
const { parseDateOnly } = require('../utils/temporal');
const { createCompletedTaskReport } = require('../controllers/completedTaskExport');

function parseTaskDate(value, label, { required = false } = {}) {
    const parsed = parseDateOnly(value);
    if (!parsed.provided) {
        return required ? { error: `${label} is required` } : { date: null };
    }
    if (!parsed.valid) return { error: `${label} must use YYYY-MM-DD` };
    return { date: parsed.date };
}

// Resolve an optional Compass project, making sure it belongs to the caller.
async function resolveProjectRef(projectRef, userId) {
    if (!projectRef) {
        return null;
    }

    let project = null;
    try {
        project = await ProjectDetails.findOne({ _id: projectRef, userRef: userId });
    } catch (error) {
        return undefined;
    }

    return project ? project._id : undefined;
}

// Helper function to check for circular dependencies
async function hasCircularDependency(taskId, dependsOn, userId) {
    if (!dependsOn || dependsOn.length === 0) {
        return false;
    }
    
    // Check if any of the dependencies depend on this task (directly or indirectly)
    const visited = new Set();
    const queue = [...dependsOn];
    
    while (queue.length > 0) {
        const currentDepId = queue.shift();
        
        // If we've already checked this task, skip it
        if (visited.has(currentDepId.toString())) {
            continue;
        }
        visited.add(currentDepId.toString());
        
        // If this dependency is the task itself, we have a circular dependency
        if (taskId && currentDepId.toString() === taskId.toString()) {
            return true;
        }
        
        // Get the dependencies of this dependency
        const depTask = await TaskDetails.findOne({ _id: currentDepId, userRef: userId });
        if (depTask && depTask.dependsOn && depTask.dependsOn.length > 0) {
            queue.push(...depTask.dependsOn);
        }
    }
    
    return false;
}

function createTaskRoutes(config, authenticateSession) {

    router.post('/createTask', authenticateSession, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.username });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        // The front end posts `repeat`; `taskRepeat` is accepted for older callers.
        let { title, dueDate, notes, duration, startDate, breakUpTask, breakUpTaskChunkDuration, repeat, taskRepeat, recurrence, isBacklog, dependsOn, priority, projectRef } = req.body;
        const repeatValue = repeat !== undefined ? repeat : taskRepeat;

        if (!title || !duration || !startDate) {
            return res.send(returnFailure('Title, duration, and start date are required'));
        }

        if (breakUpTask && !breakUpTaskChunkDuration) {
            breakUpTask = false;
        }

        if (!isBacklog && !dueDate) {
            return res.send(returnFailure('Due date is required for non-backlog tasks'));
        }

        const recurrenceError = validateRecurrence(recurrence);
        if (recurrenceError) {
            return res.send(returnFailure(recurrenceError));
        }

        const parsedStart = parseTaskDate(startDate, 'Start date', { required: true });
        const parsedDue = parseTaskDate(dueDate, 'Due date', { required: !isBacklog });
        if (parsedStart.error || parsedDue.error) {
            return res.send(returnFailure(parsedStart.error || parsedDue.error));
        }

        // A backlog task has no due date to advance, so recurrence is meaningless.
        if (isBacklog && (recurrence || repeatValue)) {
            return res.send(returnFailure('A backlog task cannot repeat'));
        }

        // Validate dependencies
        if (dependsOn && dependsOn.length > 0) {
            // Make sure all dependent tasks exist and belong to the user
            for (let depId of dependsOn) {
                const depTask = await TaskDetails.findOne({ _id: depId, userRef: user._id });
                if (!depTask) {
                    return res.send(returnFailure('Invalid dependency task'));
                }
            }
            
            // Check for circular dependencies
            const hasCircular = await hasCircularDependency(null, dependsOn, user._id);
            if (hasCircular) {
                return res.send(returnFailure('Circular dependency detected'));
            }
        }

        try {
            const resolvedProject = await resolveProjectRef(projectRef, user._id);
            if (resolvedProject === undefined) {
                return res.send(returnFailure('Invalid project'));
            }

            const normalisedRecurrence = normaliseRecurrence(recurrence);
            const task = new TaskDetails({
                title: req.body.title,
                dueDate: parsedDue.date,
                notes: notes,
                duration: req.body.duration,
                startDate: parsedStart.date,
                userRef: user._id,
                breakUpTask: breakUpTask,
                breakUpTaskChunkDuration: breakUpTaskChunkDuration,
                repeat: repeatValue,
                recurrence: normalisedRecurrence,
                isBacklog: isBacklog || false,
                dependsOn: dependsOn || [],
                priority: priority != null ? priority : 100,
                projectRef: resolvedProject,
            });
            await task.save();

            // Materialise now, so a new series shows its occurrences without waiting for
            // the user to press "Schedule Tasks".
            if (normalisedRecurrence || repeatValue) {
                await expandRecurrences(user, SCHEDULING_HORIZON_DAYS);
            }

            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.username);

            return res.json({ success: true, taskList: returnTaskList });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.post('/editTask', authenticateSession, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.username });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        try {
            let { task } = req.body;

            if (!task || !task._id) {
                return res.send(returnFailure('Task id is required'));
            }

            const recurrenceError = validateRecurrence(task.recurrence);
            if (recurrenceError) {
                return res.send(returnFailure(recurrenceError));
            }

            if (task.isBacklog && (task.recurrence || task.repeat)) {
                return res.send(returnFailure('A backlog task cannot repeat'));
            }

            // Validate dependencies if they're being updated
            if (task.dependsOn && task.dependsOn.length > 0) {
                // Make sure task doesn't depend on itself
                if (task.dependsOn.includes(task._id)) {
                    return res.send(returnFailure('Task cannot depend on itself'));
                }
                
                // Make sure all dependent tasks exist and belong to the user
                for (let depId of task.dependsOn) {
                    const depTask = await TaskDetails.findOne({ _id: depId, userRef: user._id });
                    if (!depTask) {
                        return res.send(returnFailure('Invalid dependency task'));
                    }
                }
                
                // Check for circular dependencies
                const hasCircular = await hasCircularDependency(task._id, task.dependsOn, user._id);
                if (hasCircular) {
                    return res.send(returnFailure('Circular dependency detected'));
                }
            }

            if (task.projectRef !== undefined) {
                const resolvedProject = await resolveProjectRef(task.projectRef, user._id);
                if (resolvedProject === undefined) {
                    return res.send(returnFailure('Invalid project'));
                }
                task.projectRef = resolvedProject;
            }

            // Editing any occurrence edits the whole series, so redirect the write to the
            // template that owns the rule.
            let targetId = task._id;
            const existing = await TaskDetails.findOne({ _id: task._id, userRef: user._id });
            const isOccurrence = !!(existing && existing.seriesRef);
            if (isOccurrence) {
                targetId = existing.seriesRef;
            }

            const parsedStart = task.startDate !== undefined
                ? parseTaskDate(task.startDate, 'Start date', { required: true })
                : null;
            const parsedDue = task.dueDate !== undefined
                ? parseTaskDate(task.dueDate, 'Due date', { required: !task.isBacklog })
                : null;
            if (parsedStart?.error || parsedDue?.error) {
                return res.send(returnFailure(parsedStart?.error || parsedDue?.error));
            }

            const update = { ...task };
            delete update._id;
            delete update.seriesRecurrence;
            // Completion and occurrence identity are server-owned, never editable fields.
            delete update.userRef;
            delete update.completed;
            delete update.completedDate;
            delete update.scheduledDate;
            delete update.slipForecast;
            delete update.occurrenceDate;
            delete update.seriesRef;
            if (parsedStart) update.startDate = parsedStart.date;
            if (parsedDue) update.dueDate = parsedDue.date;

            // An occurrence's dates come from the rule, so they are not authored here.
            if (isOccurrence) {
                delete update.dueDate;
                delete update.startDate;
            }

            if (task.recurrence !== undefined) {
                update.recurrence = normaliseRecurrence(task.recurrence);

                // A series that stopped repeating becomes a plain task, so its orphaned
                // incomplete occurrences go.
                if (!update.recurrence && !task.repeat) {
                    await TaskDetails.deleteMany({
                        userRef: user._id,
                        seriesRef: targetId,
                        $or: [{ completed: false }, { completed: null }],
                    });
                }
            }

            // Scope the update to the owner so a task id alone cannot edit someone else's task.
            const actualTask = await TaskDetails.findOneAndUpdate(
                { _id: targetId, userRef: user._id },
                update
            );

            if (!actualTask) {
                return res.send(returnFailure('Task not found'));
            }

            // Refresh every series edit immediately. Expansion also synchronizes authored
            // template fields onto pending occurrences, even when the rule was not posted.
            const isSeriesEdit = isOccurrence
                || !!existing?.recurrence?.freq
                || !!existing?.repeat
                || !!update.recurrence?.freq
                || !!update.repeat;
            if (isSeriesEdit) {
                await expandRecurrences(user, SCHEDULING_HORIZON_DAYS, {
                    synchronizeSeriesId: targetId,
                });
            }

            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.post('/deleteTask', authenticateSession, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.username });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { taskId } = req.body;
        if (!taskId) {
            return res.send(returnFailure('Task id is required'));
        }

        try {
            const task = await TaskDetails.findOne({ _id: taskId, userRef: user._id });
            if (!task) {
                return res.send(returnFailure('Task not found'));
            }

            // Deleting any occurrence deletes the whole series.
            const hasRule = !!(task.recurrence && task.recurrence.freq);
            const seriesId = task.seriesRef || (hasRule ? task._id : null);
            if (seriesId) {
                // Incomplete occurrences go; completed ones stay as history.
                await TaskDetails.deleteMany({
                    userRef: user._id,
                    seriesRef: seriesId,
                    $or: [{ completed: false }, { completed: null }],
                });
                await TaskDetails.deleteOne({ _id: seriesId, userRef: user._id });
            } else {
                // `document.remove()` was removed in Mongoose 8; deleteOne() is the replacement.
                await task.deleteOne();
            }


            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.username);
            return res.json({ success: true, taskList: returnTaskList });
        } catch (err) {
            res.send(returnFailure('Error deleting task'));
        }
    });

    router.post('/completeTask', authenticateSession, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.username });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { taskId } = req.body;
        if (!taskId) {
            return res.send(returnFailure('Task id is required'));
        }

        try {
            const task = await TaskDetails.findOne({ _id: taskId, userRef: user._id });
            const result = await completeTask(task, user);

            if (!result.success) {
                return res.send(returnFailure(result.message));
            }


            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.username);
            return res.json({ success: true, taskList: returnTaskList });
        } catch (err) {
            return res.send(returnFailure('Error completing task'));
        }
    });

    router.post('/completeTaskChunk', authenticateSession, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.username });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { taskId, chunkDuration } = req.body;
        if (!taskId || !chunkDuration) {
            return res.send(returnFailure('Task id and chunkDuration are required'));
        }

        const task = await TaskDetails.findOne({ _id: taskId, userRef: user._id });

        if (!task) {
            return res.send(returnFailure('Task not found'));
        }

        // Subtract chunkDuration from task's total duration
        task.duration -= chunkDuration;

        // If duration is less than or equal to 0, complete the task
        if (task.duration <= 0) {
            const result = await completeTask(task, user);

            if (!result.success) {
                return res.send(returnFailure(result.message));
            }
        } else {
            await task.save();
        }

        const returnTaskList = await getTaskListFromUsername(req.user.username);
        return res.json({ success: true, taskList: returnTaskList });
    });

    router.get('/exportCompletedTasks', authenticateSession, async (req, res) => {
        try {
            const user = await UserDetails.findOne({ username: req.user.username });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            const from = parseDateOnly(req.query.completedFrom);
            const to = parseDateOnly(req.query.completedTo);
            if (!from.provided || !to.provided) {
                return res.send(returnFailure('completedFrom and completedTo are required'));
            }
            if (!from.valid || !to.valid) {
                return res.send(returnFailure('Completion dates must use YYYY-MM-DD'));
            }
            if (from.value > to.value) {
                return res.send(returnFailure('completedFrom must be on or before completedTo'));
            }

            const report = await createCompletedTaskReport(user, from.value, to.value);
            const filename = `completed-tasks-${from.value}-to-${to.value}.md`;
            res.set({
                'Content-Type': 'text/markdown; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
                Pragma: 'no-cache',
            });
            return res.send(report);
        } catch (error) {
            console.error(error);
            return res.send(returnFailure('Completed task export could not be created'));
        }
    });

    router.get('/getProjectCompletions', authenticateSession, async (req, res) => {
        try {
            const user = await UserDetails.findOne({ username: req.user.username });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            const from = parseDateOnly(req.query.completedFrom);
            const to = parseDateOnly(req.query.completedTo);
            if (!from.provided || !to.provided) {
                return res.send(returnFailure('completedFrom and completedTo are required'));
            }
            if (!from.valid || !to.valid) {
                return res.send(returnFailure('Completion dates must use YYYY-MM-DD'));
            }
            if (from.value > to.value) {
                return res.send(returnFailure('completedFrom must be on or before completedTo'));
            }

            const items = await getProjectCompletions(user, from.value, to.value);
            return res.json({
                success: true,
                completedFrom: from.value,
                completedTo: to.value,
                items,
            });
        } catch (error) {
            console.error(error);
            return res.send(returnFailure('Completion history could not be loaded'));
        }
    });

    router.get('/getUserTasks', authenticateSession, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.username });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }
            const returnTaskList = await getTaskListFromUsername(req.user.username);
            return res.json({ success: true, taskList: returnTaskList });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });


    router.post('/setFollowUp', authenticateSession, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.username });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { title, followUpDate, taskID } = req.body;
        if (!title || !followUpDate) {
            return res.send(returnFailure('Title, and followUpDate are required'));
        }

        const parsedFollowUp = parseTaskDate(followUpDate, 'Follow up date', { required: true });
        if (parsedFollowUp.error) {
            return res.send(returnFailure(parsedFollowUp.error));
        }

        try {
            // If taskID exists get task and complete it
            if (taskID) {
                let inputTask = await TaskDetails.findOne({ _id: taskID, userRef: user._id });

                if (inputTask) {
                    // Complete task
                    const result = await completeTask(inputTask, user);

                    if (!result.success) {
                        return res.send(returnFailure(result.message));
                    }
                } else {
                    throw new Error("Task not found");
                }
            }

            // Create the new follow up task
            const task = new TaskDetails({
                title: title,
                dueDate: parsedFollowUp.date,
                notes: "",
                duration: 20,
                startDate: parsedFollowUp.date,
                userRef: user._id,
                breakUpTask: false,
                breakUpTaskChunkDuration: null,
                repeat: null,
            });
            let saveResult = await task.save();
            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.username);

            return res.json({ success: true, taskList: returnTaskList });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.get('/scheduletasks', authenticateSession, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.username });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            await generateTaskEvents(user);
            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    return router;
}

module.exports = createTaskRoutes;
