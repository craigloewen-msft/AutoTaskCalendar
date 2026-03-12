const { UserDetails, TaskDetails } = require('../models');
const moment = require('moment');
const mongoose = require('mongoose');
const { generateTaskEvents } = require('./scheduling');

async function getTaskListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate({
        path: 'taskList',
        match: { $or: [{ completed: false }, { completed: null }] },
        options: { sort: { dueDate: 1, priority: 1 } },
    });

    return user.taskList;
}

async function getCompletedTasksFromUsername(inUsername, limit = null, skip = 0) {
    let user = await UserDetails.findOne({ username: inUsername });

    if (!user) {
        return { tasks: [], totalCount: 0 };
    }

    // Build query for completed tasks
    const query = TaskDetails.find({
        userRef: user._id,
        completed: true
    }).sort({ completedDate: -1 });

    // Apply pagination if limit is specified
    if (limit !== null) {
        query.limit(limit).skip(skip);
    }

    const tasks = await query.exec();

    // Get total count for pagination
    const totalCount = await TaskDetails.countDocuments({
        userRef: user._id,
        completed: true
    });

    return { tasks, totalCount };
}

const completeTask = async (task, user) => {
    if (!task) {
        return { success: false, message: 'Task not found' };
    }
    task.completed = true;
    task.completedDate = new Date();
    await task.save();

    // Check if task is a repeating task
    if (task.repeat) {
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

        switch (task.repeat) {
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
    getCompletedTasksFromUsername,
    completeTask,
    generateTaskEvents
};
