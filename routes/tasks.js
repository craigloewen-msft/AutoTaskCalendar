const express = require('express');
const router = express.Router();
const { UserDetails, TaskDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const { getTaskListFromUsername, getCompletedTasksFromUsername, completeTask, generateTaskEvents } = require('../controllers/taskController');

function createTaskRoutes(config, authenticateToken) {

    router.post('/createTask', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        let { title, dueDate, notes, duration, startDate, breakUpTask, breakUpTaskChunkDuration, taskRepeat, isBacklog } = req.body;

        if (!title || !duration || !startDate) {
            return res.send(returnFailure('Title, duration, and start date are required'));
        }

        if (breakUpTask && !breakUpTaskChunkDuration) {
            breakUpTask = false;
        }

        if (!isBacklog && !dueDate) {
            return res.send(returnFailure('Due date is required for non-backlog tasks'));
        }

        try {
            // Make the due date at the end of the specified day:
            let taskDate = dueDate ? new Date(req.body.dueDate) : null;

            // Create the new task
            const task = new TaskDetails({
                title: req.body.title,
                dueDate: taskDate,
                notes: notes,
                duration: req.body.duration,
                startDate: startDate,
                userRef: user._id,
                breakUpTask: breakUpTask,
                breakUpTaskChunkDuration: breakUpTaskChunkDuration,
                repeat: taskRepeat,
                isBacklog: isBacklog || false,
            });
            await task.save();
            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.id);

            return res.json({ success: true, taskList: returnTaskList });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.post('/editTask', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        try {
            let { task } = req.body;
            let actualTask = await TaskDetails.findByIdAndUpdate(task._id, task);
            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.post('/deleteTask', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

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
            await task.remove();
            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.id);
            return res.json({ success: true, taskList: returnTaskList });
        } catch (err) {
            res.send(returnFailure('Error deleting task'));
        }
    });

    router.post('/completeTask', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

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
            const returnTaskList = await getTaskListFromUsername(req.user.id);
            return res.json({ success: true, taskList: returnTaskList });
        } catch (err) {
            res.send(returnFailure('Error deleting task'));
        }
    });

    router.post('/completeTaskChunk', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

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

        const returnTaskList = await getTaskListFromUsername(req.user.id);
        return res.json({ success: true, taskList: returnTaskList });
    });

    router.get('/getUserTasks', authenticateToken, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }
            const returnTaskList = await getTaskListFromUsername(req.user.id);
            return res.json({ success: true, taskList: returnTaskList });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.get('/getCompletedTasks', authenticateToken, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            // Parse pagination parameters
            const limit = req.query.limit ? parseInt(req.query.limit) : 20;
            const skip = req.query.skip ? parseInt(req.query.skip) : 0;
            
            const result = await getCompletedTasksFromUsername(req.user.id, limit, skip);
            return res.json({ 
                success: true, 
                taskList: result.tasks,
                totalCount: result.totalCount,
                hasMore: (skip + result.tasks.length) < result.totalCount
            });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.get('/searchCompletedTasks', authenticateToken, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            const searchQuery = req.query.q || '';
            
            // Search in both title and notes
            const tasks = await TaskDetails.find({
                userRef: user._id,
                completed: true,
                $or: [
                    { title: { $regex: searchQuery, $options: 'i' } },
                    { notes: { $regex: searchQuery, $options: 'i' } }
                ]
            }).sort({ completedDate: -1 }).limit(100); // Limit search results to 100

            return res.json({ 
                success: true, 
                taskList: tasks
            });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.get('/getTaskStatistics', authenticateToken, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

            if (!req.user || !user) {
                return res.send(returnFailure('Not logged in'));
            }

            // Get all tasks for the user
            const allTasks = await TaskDetails.find({ userRef: user._id });
            
            // Calculate statistics
            const completedTasks = allTasks.filter(t => t.completed);
            const incompleteTasks = allTasks.filter(t => !t.completed);
            
            // Tasks completed by day
            const tasksByDay = {};
            completedTasks.forEach(task => {
                if (task.completedDate) {
                    const dateKey = task.completedDate.toISOString().split('T')[0];
                    if (!tasksByDay[dateKey]) {
                        tasksByDay[dateKey] = 0;
                    }
                    tasksByDay[dateKey]++;
                }
            });

            // Total time spent (sum of completed task durations)
            const totalTimeSpent = completedTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
            
            // Average task duration
            const avgTaskDuration = completedTasks.length > 0 
                ? totalTimeSpent / completedTasks.length 
                : 0;

            // Tasks by type
            const regularTasks = incompleteTasks.filter(t => !t.isBacklog).length;
            const backlogTasks = incompleteTasks.filter(t => t.isBacklog).length;

            // Repeating tasks count
            const repeatingTasks = allTasks.filter(t => t.repeat && !t.completed).length;

            return res.json({ 
                success: true, 
                statistics: {
                    totalTasks: allTasks.length,
                    completedTasksCount: completedTasks.length,
                    incompleteTasksCount: incompleteTasks.length,
                    tasksByDay,
                    totalTimeSpent,
                    avgTaskDuration,
                    regularTasks,
                    backlogTasks,
                    repeatingTasks
                }
            });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.post('/setFollowUp', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { title, followUpDate, taskID } = req.body;
        if (!title || !followUpDate) {
            return res.send(returnFailure('Title, and followUpDate are required'));
        }

        try {
            // If taskID exists get task and complete it
            if (taskID) {
                let inputTask = await TaskDetails.findOne({ _id: taskID });

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
                dueDate: followUpDate,
                notes: "",
                duration: 20,
                startDate: followUpDate,
                userRef: user._id,
                breakUpTask: false,
                breakUpTaskChunkDuration: null,
                repeat: null,
            });
            let saveResult = await task.save();
            // Return the updated task list
            const returnTaskList = await getTaskListFromUsername(req.user.id);

            return res.json({ success: true, taskList: returnTaskList });
        } catch (error) {
            console.error(error);
            return res.json({ success: false });
        }
    });

    router.get('/scheduletasks', authenticateToken, async (req, res) => {
        try {
            let user = await UserDetails.findOne({ username: req.user.id });

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
