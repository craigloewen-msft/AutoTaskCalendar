const { UserDetails, TaskDetails, EventDetails } = require('../models');
const moment = require('moment');
const mongoose = require('mongoose');

async function getTaskListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate({
        path: 'taskList',
        match: { $or: [{ completed: false }, { completed: null }] },
        options: { sort: { dueDate: 1 } },
    });

    return user.taskList;
}

async function getCompletedTasksFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate({
        path: 'taskList',
        match: { completed: true },
        options: { sort: { completedDate: -1 } },
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
            _id: mongoose.Types.ObjectId(),
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

async function generateTaskEvents(inUser) {
    // If the user has no working days, don't generate any events
    if (inUser.workingDays.length == 0) {
        return;
    }

    const currentTime = new Date();
    // Clear out old events if type is task or task-chunk
    await EventDetails.deleteMany({ userRef: inUser._id, type: { $in: ['task', 'task-chunk'] } });

    // Get the TaskDetails sorted in order of their deadlines, earliest first. Only get tasks that have deadlines less than 2 weeks from now
    const twoWeeksFromNow = new Date(currentTime.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    // Separate regular tasks and backlog tasks
    const regularTasks = await TaskDetails.find({
        userRef: inUser._id,
        $and: [
            { $or: [{ completed: false }, { completed: null }] },
            { $or: [{ isBacklog: false }, { isBacklog: null }] }
        ]
    }).sort({ dueDate: 1 });
    
    const backlogTasks = await TaskDetails.find({
        userRef: inUser._id,
        $or: [{ completed: false }, { completed: null }],
        isBacklog: true,
    }).sort({ startDate: 1 });
    
    // Combine regular tasks first, then backlog tasks
    const sortedTasks = [...regularTasks, ...backlogTasks];

    // Query the EventDetails sorted in order of when they appear, up to 2 weeks from now
    const sortedEvents = await EventDetails.find({
        userRef: inUser._id,
        startDate: { $lte: twoWeeksFromNow },
        endDate: { $gte: currentTime }
    }).sort({ startDate: 1 });

    // Start organizing the tasks into events:
    let currentExaminedTime = currentTime;

    // Get the user's working hours and days
    const workingStartTime = inUser.workingStartTime;
    const workingDuration = inUser.workingDuration;
    const workingDays = inUser.workingDays;

    // Store task chunk info in a dictionary
    let taskChunkInfoList = {};

    let eventIndex = 0;
    let loopIterations = 0;
    const maxIterations = 10000; // Safety limit to prevent infinite loops
    let lastTaskCount = sortedTasks.length;
    let noProgressIterations = 0;
    
    while (sortedTasks.length > 0) {
        loopIterations++;
        
        // Safety check: if we've looped too many times or made no progress for too long, break
        if (loopIterations > maxIterations || noProgressIterations > 100) {
            console.error('Task scheduling infinite loop detected. Remaining tasks:', sortedTasks.length);
            // Log the problematic tasks
            for (let task of sortedTasks) {
                console.error(`Unschedulable task: "${task.title}" - Duration: ${task.duration} mins, Break up: ${task.breakUpTask}`);
            }
            break;
        }
        
        let nextEvent = null;
        try {
            nextEvent = sortedEvents[eventIndex];
        } catch {
            nextEvent = null;
        }

        // Check if we are in an event
        if (nextEvent ? nextEvent.startDate.getTime() <= currentExaminedTime.getTime() : false) {
            if (currentExaminedTime.getTime() < nextEvent.endDate.getTime()) {
                currentExaminedTime = nextEvent.endDate;
            }
            eventIndex++;
            // Else check if we are outside of the user's working hours and days
        } else {

            // Check if we are not in a working day
            if (!workingDays.includes(currentExaminedTime.toLocaleDateString('en-US', { weekday: 'long' }))) {
                // Move ahead 24 hours
                currentExaminedTime.setTime(currentExaminedTime.getTime() + 24 * 60 * 60 * 1000);
            } else {

                // Get user's starting time and date for today
                let startOfWorking = new Date(workingStartTime);
                // Set start of working time to today's date
                startOfWorking.setFullYear(currentExaminedTime.getFullYear());
                startOfWorking.setMonth(currentExaminedTime.getMonth());
                startOfWorking.setDate(currentExaminedTime.getDate());
                startOfWorking.setHours(workingStartTime.getHours());
                startOfWorking.setMinutes(workingStartTime.getMinutes());
                startOfWorking.setSeconds(workingStartTime.getSeconds());

                // Get the user's end of working time and date
                let endOfWorking = new Date();
                endOfWorking.setTime(startOfWorking.getTime() + workingDuration * 60 * 60 * 1000);

                // Get time between working hour boundaries
                let timeBetweenStartOfWorking = currentExaminedTime.getTime() - startOfWorking.getTime();
                let timeBetweenEndOfWorking = currentExaminedTime.getTime() - endOfWorking.getTime();

                // Check if we are before the start of working hours
                if (timeBetweenStartOfWorking < 0) {
                    // Move to the start of working hours
                    currentExaminedTime = startOfWorking;

                    // Check if we are after the end of working hours
                } else if (timeBetweenEndOfWorking >= 0) {
                    // Move to the start of the next working day
                    currentExaminedTime.setTime(startOfWorking.getTime() + 24 * 60 * 60 * 1000);

                } else {
                    // Get the amount of time between the current examined time and the next event
                    let timeBetween = 999 * 24 * 60 * 60 * 1000;
                    if (nextEvent) {
                        timeBetween = nextEvent.startDate.getTime() - currentExaminedTime.getTime();
                    }

                    let timeToEndOfWorkingHours = endOfWorking.getTime() - currentExaminedTime.getTime();

                    if (timeBetween > timeToEndOfWorkingHours) {
                        timeBetween = timeToEndOfWorkingHours;
                    }

                    // Determine if a task can fit into that timeslot (Starting with the earliest tasks first)
                    let insertedTask = false;
                    for (let k = 0; k < sortedTasks.length; k++) {
                        let task = sortedTasks[k];
                        const taskDuration = taskChunkInfoList[task._id] ? taskChunkInfoList[task._id].remainingDuration : task.duration * 60 * 1000;
                        const breakUpTaskChunkDuration = task.breakUpTask ? task.breakUpTaskChunkDuration * 60 * 1000 : 0;
                        if (currentExaminedTime.getTime() > task.startDate.getTime()) {
                            if (timeBetween >= taskDuration) {
                                // Create a new task event from the task

                                if (taskChunkInfoList[task._id]) {
                                    taskChunkInfoList[task._id].chunkNumber++;
                                }

                                const taskEvent = new EventDetails({
                                    title: taskChunkInfoList[task._id] ? task.title + " (" + taskChunkInfoList[task._id].chunkNumber + ")" : task.title,
                                    startDate: currentExaminedTime,
                                    endDate: new Date(currentExaminedTime.getTime() + taskDuration),
                                    notes: task.notes,
                                    type: taskChunkInfoList[task._id] ? 'task-chunk' : 'task',
                                    userRef: inUser._id,
                                    taskRef: task._id,
                                });
                                await taskEvent.save();

                                // Remove the task from the list
                                sortedTasks.splice(k, 1);

                                // Update the task's scheduledDate to be the current time.
                                task.scheduledDate = currentExaminedTime;
                                await task.save();

                                // Set the examined time to the endDate of this last task
                                currentExaminedTime = taskEvent.endDate;
                                insertedTask = true;
                                break;
                            } else if (task.breakUpTask ? timeBetween >= breakUpTaskChunkDuration : false) {
                                // Chunk out the task 

                                // Get how many chunks could fit into the timeBetween
                                const numChunks = Math.floor(timeBetween / breakUpTaskChunkDuration);

                                const chunkDuration = numChunks * breakUpTaskChunkDuration;
                                const chunkDurationMins = chunkDuration / 1000 / 60;

                                // Modify task to show it's a chunk
                                let taskChunkInfo = taskChunkInfoList[task._id];

                                if (!taskChunkInfo) {
                                    taskChunkInfo = { chunkNumber: 0, remainingDuration: taskDuration };
                                    taskChunkInfoList[task._id] = taskChunkInfo;
                                }
                                taskChunkInfo.chunkNumber++;
                                taskChunkInfo.remainingDuration -= chunkDuration;

                                const taskEvent = new EventDetails({
                                    title: task.title + " (" + taskChunkInfo.chunkNumber + ")",
                                    startDate: currentExaminedTime,
                                    endDate: new Date(currentExaminedTime.getTime() + chunkDuration),
                                    notes: task.notes,
                                    type: 'task-chunk',
                                    userRef: inUser._id,
                                    taskRef: task._id,
                                });
                                await taskEvent.save();

                                // Set the examined time to the endDate of this last task
                                currentExaminedTime = taskEvent.endDate;
                                insertedTask = true;
                                break;
                            }
                        }
                    }

                    // If no task was inserted, check if we have to go next to one of these destinations: [endOfWorkingHours, nextEventStartTime] whichever is earliest
                    if (!insertedTask) {
                        let nextCurrentTime = endOfWorking;
                        if (nextEvent ? nextEvent.startDate.getTime() <= nextCurrentTime.getTime() : false) {
                            nextCurrentTime = nextEvent.startDate;
                        }

                        // Move to the next destination
                        currentExaminedTime = nextCurrentTime;
                    }
                }
            }
        }
        
        // Track progress to detect if we're stuck
        if (sortedTasks.length === lastTaskCount) {
            noProgressIterations++;
        } else {
            noProgressIterations = 0;
            lastTaskCount = sortedTasks.length;
        }
    }

    return;
}

module.exports = {
    getTaskListFromUsername,
    getCompletedTasksFromUsername,
    completeTask,
    generateTaskEvents
};
