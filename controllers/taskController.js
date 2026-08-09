const { UserDetails, TaskDetails } = require('../models');
const moment = require('moment');
const mongoose = require('mongoose');
const { generateTaskEvents } = require('./scheduling');
const { effectiveRule } = require('./recurrence');

async function getTaskListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate({
        path: 'taskList',
        // Series templates hold the rule and are never work items, so they stay out of
        // the task list; their occurrences appear instead.
        match: {
            isSeriesTemplate: { $ne: true },
            $or: [{ completed: false }, { completed: null }],
        },
        options: { sort: { dueDate: 1, priority: 1 } },
    });

    return user.taskList;
}

const completeTask = async (task, user) => {
    if (!task) {
        return { success: false, message: 'Task not found' };
    }
    task.completed = true;
    task.completedDate = new Date();
    await task.save();

    // An occurrence of a series completes on its own. The next occurrence already exists,
    // so each completion stands as its own record rather than overwriting one row.
    if (task.seriesRef) {
        return { success: true };
    }

    // Legacy path: a `repeat` string that has not yet been promoted to a series still
    // clones itself forward, so nothing breaks mid-migration.
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

        switch (rule.freq) {
            case 'daily':
                newTask.startDate = moment(task.startDate).add(1, 'days').toDate();
                newTask.dueDate = moment(task.dueDate).add(1, 'days').toDate();
                break;
            case 'weekly':
                newTask.startDate = moment(task.startDate).add(1, 'weeks').toDate();
                newTask.dueDate = moment(task.dueDate).add(1, 'weeks').toDate();
                break;
            case 'monthly':
                newTask.startDate = moment(task.startDate).add(1, 'months').toDate();
                newTask.dueDate = moment(task.dueDate).add(1, 'months').toDate();
                break;
            case 'yearly':
                newTask.startDate = moment(task.startDate).add(1, 'years').toDate();
                newTask.dueDate = moment(task.dueDate).add(1, 'years').toDate();
                break;
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
