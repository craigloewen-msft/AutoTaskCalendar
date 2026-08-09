const express = require('express');
const router = express.Router();
const { UserDetails, TaskDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');
const { getTaskListFromUsername, getCompletedTasksFromUsername, completeTask, generateTaskEvents } = require('../controllers/taskController');

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

function createTaskRoutes(config, authenticateToken) {

    router.post('/createTask', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        let { title, dueDate, notes, duration, startDate, breakUpTask, breakUpTaskChunkDuration, taskRepeat, isBacklog, dependsOn, priority } = req.body;

        if (!title || !duration || !startDate) {
            return res.send(returnFailure('Title, duration, and start date are required'));
        }

        if (breakUpTask && !breakUpTaskChunkDuration) {
            breakUpTask = false;
        }

        if (!isBacklog && !dueDate) {
            return res.send(returnFailure('Due date is required for non-backlog tasks'));
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
                dependsOn: dependsOn || [],
                priority: priority != null ? priority : 100,
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
