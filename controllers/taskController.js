const { UserDetails, TaskDetails } = require('../models');
const moment = require('moment');
const { addDateOnlyDays, dateOnlyFromMarker, parseDateOnly } = require('../utils/temporal');
const mongoose = require('mongoose');
const { generateTaskEvents } = require('./scheduling');
const { effectiveRule } = require('./recurrence');

async function getTaskListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate({
        path: 'taskList',
        // A task with a rule is a series template: it owns the rule but is never work, so
        // its occurrences appear in the list instead.
        match: {
            'recurrence.freq': { $exists: false },
            $or: [{ completed: false }, { completed: null }],
        },
        options: { sort: { dueDate: 1, priority: 1 } },
    });

    return attachSeriesRules(user.taskList);
}

/**
 * Occurrences do not carry the rule (their template owns it), so the editor would show
 * "Does not repeat" for a task the UI calls part of a series. Attach it for display.
 */
async function attachSeriesRules(taskList) {
    if (!taskList || taskList.length === 0) {
        return taskList;
    }

    const seriesIds = [
        ...new Set(taskList.filter((t) => t.seriesRef).map((t) => t.seriesRef.toString())),
    ];

    if (seriesIds.length === 0) {
        return taskList;
    }

    const templates = await TaskDetails.find({ _id: { $in: seriesIds } }, 'recurrence');
    const ruleById = new Map(templates.map((template) => {
        const plain = template.toObject ? template.toObject() : template;
        return [template._id.toString(), plain.recurrence];
    }));

    return taskList.map((task) => {
        if (!task.seriesRef) return task;

        const plain = task.toObject ? task.toObject() : { ...task };
        plain.seriesRecurrence = ruleById.get(task.seriesRef.toString()) || null;
        return plain;
    });
}

const completeTask = async (task, user) => {
    if (!task) {
        return { success: false, message: 'Task not found' };
    }
    task.completed = true;
    task.completedDate = new Date();
    await task.save();

    // An occurrence completes on its own: the next one already exists, so each completion
    // stands as its own record rather than overwriting one row.
    if (task.seriesRef) {
        return { success: true };
    }

    // Legacy path: a `repeat` string not yet promoted to a series still clones itself
    // forward, so nothing breaks mid-migration.
    const rule = effectiveRule(task);
    if (rule && !task.recurrence) {
        // Create a new task based on the completed task
        const newTask = new TaskDetails({
            // Copy all properties of the original task
            ...task._doc,
            // Set the new task as not completed
            completed: false,
            completedDate: null,
            // Generate a new id for the new task
            _id: new mongoose.Types.ObjectId(),
        });

        const amount = { daily: 1, weekly: 7 }[rule.freq];
        if (amount) {
            newTask.startDate = parseDateOnly(addDateOnlyDays(dateOnlyFromMarker(task.startDate), amount)).date;
            newTask.dueDate = parseDateOnly(addDateOnlyDays(dateOnlyFromMarker(task.dueDate), amount)).date;
        } else {
            const unit = rule.freq === 'monthly' ? 'months' : 'years';
            newTask.startDate = moment.utc(task.startDate).add(1, unit).startOf('day').toDate();
            newTask.dueDate = moment.utc(task.dueDate).add(1, unit).startOf('day').toDate();
        }

        await newTask.save();
    }

    return { success: true };
}

module.exports = {
    getTaskListFromUsername,
    completeTask,
    generateTaskEvents
};
