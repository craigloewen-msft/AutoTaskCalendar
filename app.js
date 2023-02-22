const axios = require('axios');
const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo')
const express = require('express');
const jwt = require('jsonwebtoken');
const connectEnsureLogin = require('connect-ensure-login');
// Custom requires
// Get config
const config = fs.existsSync('./config.js') ? require('./config') : require('./defaultconfig');

// Configure Vue Specific set up
const app = express();
app.use(express.static(__dirname + "/dist"));

// Set up Dev or Production
let mongooseConnectionString = '';
let hostPort = 3000;

if (process.env.NODE_ENV == 'production') {
    mongooseConnectionString = process.env.prodMongoDBConnectionString;
    config.secret = process.env.secret;
    config.sessionSecret = process.env.sessionSecret;
    hostPort = 8080;
} else {
    mongooseConnectionString = config.devMongoDBConnectionString;
    hostPort = 3000;
}

// Set up Mongoose connection
const Schema = mongoose.Schema;

const UserDetail = new Schema({
    username: { type: String, index: true },
    password: String,
    email: String,
    lastLoginDate: Date,
    workingStartTime: Date,
    workingEndTime: Date,
    workingDays: [String],
}, { collection: 'usercollection' });

UserDetail.virtual('taskList', {
    ref: 'taskInfo',
    localField: '_id',
    foreignField: 'userRef'
});

UserDetail.virtual('eventList', {
    ref: 'eventInfo',
    localField: '_id',
    foreignField: 'userRef'
});

const TaskDetail = new Schema({
    title: String,
    dueDate: Date,
    notes: String,
    duration: Number,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
})

// Add a new schema for events
const EventDetail = new Schema({
    title: String,
    startDate: Date,
    endDate: Date,
    notes: String,
    type: String,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
});

mongoose.connect(mongooseConnectionString, { useNewUrlParser: true, useUnifiedTopology: true });

UserDetail.plugin(passportLocalMongoose);
const UserDetails = mongoose.model('userInfo', UserDetail, 'userInfo');
const TaskDetails = mongoose.model('taskInfo', TaskDetail, 'taskInfo');
const EventDetails = mongoose.model('eventInfo', EventDetail, 'eventInfo');

const JWTTimeout = 4 * 604800; // 28 Days

// App set up

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: MongoStore.create({
        mongoUrl: mongooseConnectionString,
        ttl: 24 * 60 * 60 * 1000,
        autoRemove: 'interval',
        autoRemoveInterval: 60 * 24 * 7 // Once a week
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7 * 2 // 2 weeks
    }
}));

const port = hostPort;
app.listen(port, () => console.log('App listening on port ' + port));

const passport = require('passport');
const { application } = require('express');
const { stringify } = require('querystring');

app.use(passport.initialize());
app.use(passport.session());

// Passport local authentication

passport.use(UserDetails.createStrategy());

passport.serializeUser(UserDetails.serializeUser());
passport.deserializeUser(UserDetails.deserializeUser());

// Helper Functions

function returnFailure(messageString) {
    return { success: false, log: messageString };
}

async function returnBasicUserInfo(inputUser) {
    inputUser = await inputUser.populate('taskList');
    return { username: inputUser.username, email: inputUser.email, _id: inputUser._id, taskList: inputUser.taskList, workingStartTime: inputUser.workingStartTime, workingEndTime: inputUser.workingEndTime, workingDays: inputUser.workingDays };
}

// Middleware function

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization']
    const token = authHeader

    if (token == null) return res.sendStatus(401)

    jwt.verify(token, config.secret, (err, user) => {
        if (err) return res.sendStatus(401)
        req.user = user
        next()
    });
}

/* ROUTES */


// User management routes

app.post('/api/login', (req, res, next) => {
    passport.authenticate('local',
        (err, user, info) => {
            if (err) {
                return res.json(returnFailure('Server error while authenticating'));
            }

            if (!user) {
                return res.json(returnFailure('Failure to login'));
            }

            req.logIn(user, async function (err) {
                if (err) {
                    return res.json(returnFailure('Failure to login'));
                }

                await UserDetails.updateOne({ "username": user.username }, { "lastLoginDate": new Date() });

                let token = jwt.sign({ id: user.username }, config.secret, { expiresIn: JWTTimeout });

                let returnUserInfo = await returnBasicUserInfo(user);

                let response = { success: true, auth: true, token: token, user: returnUserInfo };
                return res.json(response);
            });

        })(req, res, next);
});

app.get('/api/user/:username/', authenticateToken, (req, res) => {
    try {
        UserDetails.find({ username: req.params.username }).populate('repos').exec(function (err, docs) {
            if (err) {
                return res.json(returnFailure('Server error'));
            } else {
                if (!docs[0]) {
                    return res.json(returnFailure("Error while obtaining user"));
                } else {
                    var returnValue = {
                        success: true, auth: true,
                        user: {
                            username: docs[0].username, email: docs[0].email
                        }
                    };
                    res.json(returnValue);
                }
            }
        });
    } catch (error) {
        let errorToString = error.toString();
        return res.json(returnFailure(error));
    }
});

app.get('/api/logout', function (req, res) {
    req.logout();
    res.redirect('/api/');
});

app.post('/api/register', async function (req, res) {
    try {
        let doesUserExist = await UserDetails.exists({ username: req.body.username });

        if (doesUserExist) {
            return res.json(returnFailure("GitGudIssues username already exists"));
        }

        // TODO: Fix this to be accurate to the user's timezone
        let nowDate = new Date();
        let startDate = new Date(nowDate.setHours(14, 0, 0, 0));
        let endDate = new Date(nowDate.setHours(23, 0, 0, 0));

        let registeredUser = await UserDetails.register({ username: req.body.username, email: req.body.email, workingStartTime: startDate, workingEndTime: endDate, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }, req.body.password);

        let token = jwt.sign({ id: req.body.username }, config.secret, { expiresIn: JWTTimeout });

        let returnUserInfo = await returnBasicUserInfo(registeredUser);

        let response = { success: true, auth: true, token: token, user: returnUserInfo };
        return res.json(response);
    }
    catch (error) {
        return res.json(returnFailure(error));
    }
});

app.post('/api/setuserworkinghours', authenticateToken, async function (req, res) {
    try {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { workingStartTime, workingEndTime, workingDays, timeZoneOffset } = req.body;

        let timeZoneDifferenceMins = timeZoneOffset;

        // Update user object
        let startDate = new Date();
        startDate.setHours(
            Number(workingStartTime.split(':')[0]) + (timeZoneDifferenceMins / 60),
            Number(workingStartTime.split(':')[1]),
            0,
            0
        );
        let endDate = new Date();
        endDate.setHours(
            Number(workingEndTime.split(':')[0]) + (timeZoneDifferenceMins / 60),
            Number(workingEndTime.split(':')[1]),
            0,
            0
        );


        user.workingStartTime = startDate;
        user.workingEndTime = endDate;
        user.workingDays = workingDays;

        // Save the updated user object
        let savedUser = await user.save();

        let response = { success: true, user: savedUser };
        return res.json(response);
    }
    catch (error) {
        return res.json(returnFailure(error));
    }
});

// Task management routes

// - Helper functions
async function getTaskListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate('taskList');
    return user.taskList;
}

app.post('/api/createTask', authenticateToken, async (req, res) => {
    // Check if user is logged in

    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { title, dueDate, notes, duration } = req.body;
    if (!title || !dueDate || !duration) {
        return res.send(returnFailure('Title, duration, and due date are required'));
    }

    try {
        // Make the due date at the end of the specified day:
        let taskDate = new Date(req.body.dueDate);
        taskDate.setUTCHours(23, 59, 59, 999);

        // Create the new task
        const task = new TaskDetails({
            title: req.body.title,
            dueDate: taskDate,
            notes: req.body.notes,
            duration: req.body.duration,
            userRef: user._id
        });
        await task.save();
        // Return the updated task list
        const returnTaskList = await getTaskListFromUsername(req.user.id);

        await generateTaskEvents(user);

        return res.json({ success: true, taskList: returnTaskList });
    } catch (error) {
        console.error(error);
        return res.json({ success: false });
    }
});

app.post('/api/updateTask', authenticateToken, async (req, res) => {
    // Check if user is logged in

    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { taskId, title, dueDate, notes } = req.body;
    if (!taskId) {
        return res.send(returnFailure('Task id is required'));
    }

    try {
        const task = await TaskDetails.findOne({ _id: taskId, userRef: user._id });
        if (!task) {
            return res.send(returnFailure('Task not found'));
        }
        if (title) {
            task.title = title;
        }
        if (dueDate) {
            task.dueDate = dueDate;
        }
        if (notes) {
            task.notes = notes;
        }

        await task.save();
        res.send({ success: true, task: task });
    } catch (err) {
        res.send(returnFailure('Error updating task'));
    }
});

app.post('/api/deleteTask', authenticateToken, async (req, res) => {
    // Check if user is logged in
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

app.get("/api/getUserTasks", authenticateToken, async (req, res) => {
    try {
        // Return the updated task list
        const returnTaskList = await getTaskListFromUsername(req.user.id);
        return res.json({ success: true, taskList: returnTaskList });
    } catch (error) {
        console.error(error);
        return res.json({ success: false });
    }
});

// Event management routes

// - Helper function
async function getEventListFromUsername(inUsername) {
    let user = await UserDetails.findOne({ username: inUsername }).populate('eventList');
    return user.eventList;
}


async function createEvent(userId, title, startDate, endDate, notes, type) {
    try {
        // Create the new event
        const event = new EventDetails({
            title: title,
            startDate: startDate,
            endDate: endDate,
            notes: notes,
            type: type,
            userRef: userId
        });
        await event.save();
        return event;
    } catch (error) {
        console.error(error);
        throw new Error("Error creating event");
    }
}

async function updateEvent(eventId, userId, title, startDate, endDate, notes) {
    try {
        const event = await EventDetails.findOne({ _id: eventId, userRef: userId });
        if (!event) {
            throw new Error("Event not found");
        }
        if (title) {
            event.title = title;
        }
        if (startDate) {
            event.startDate = startDate;
        }
        if (endDate) {
            event.endDate = endDate;
        }
        if (notes) {
            event.notes = notes;
        }

        await event.save();
        return event;
    } catch (err) {
        throw new Error("Error updating event");
    }
}

async function deleteEvent(eventId, userId) {
    try {
        const event = await EventDetails.findOne({ _id: eventId, userRef: userId });
        if (!event) {
            throw new Error("Event not found");
        }
        await event.remove();
    } catch (err) {
        throw new Error("Error deleting event");
    }
}

// Event management routes

app.post('/api/createEvent', authenticateToken, async (req, res) => {
    // Check if user is logged in

    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { title, startDate, endDate, notes } = req.body;
    if (!title || !startDate || !endDate) {
        return res.send(returnFailure('Title, start date, and end date are required'));
    }

    try {
        const event = await createEvent(user._id, title, startDate, endDate, notes, 'calendar');
        return res.json({ success: true, event });
    } catch (error) {
        console.error(error);
        return res.json({ success: false });
    }
});

app.post('/api/updateEvent', authenticateToken, async (req, res) => {
    // Check if user is logged in
    let user = await UserDetails.findOne({ username: req.user.id });

    if (!user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { eventId, title, startDate, endDate, notes } = req.body;
    if (!eventId) {
        return res.send(returnFailure('Event id is required'));
    }

    try {
        const event = await updateEvent(eventId, user._id, title, startDate, endDate, notes);
        res.send({ success: true, event });
    } catch (err) {
        res.send(returnFailure(err.message));
    }
});

app.post('/api/deleteEvent', authenticateToken, async (req, res) => {
    // Check if user is logged in
    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { eventId } = req.body;
    if (!eventId) {
        return res.send(returnFailure('Event id is required'));
    }

    try {
        await deleteEvent(eventId, user._id);
        // Return the updated event list
        const returnEventList = await getEventListFromUsername(req.user.id);
        return res.json({ success: true, eventList: returnEventList });
    } catch (err) {
        res.send(returnFailure(err.message));
    }
});

app.get("/api/getUserEvents/:date", authenticateToken, async (req, res) => {
    // Check if user is logged in
    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }
    try {
        const date = new Date(req.params.date);
        const startOfWeek = new Date(date);
        startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
        startOfWeek.setUTCHours(0, 0, 0);
        const endOfWeek = new Date(date);
        endOfWeek.setUTCDate(endOfWeek.getUTCDate() + (7 - endOfWeek.getUTCDay()));
        endOfWeek.setUTCHours(23, 59, 59);
        const events = await EventDetails.find({
            userRef: user._id,
            startDate: { $gte: startOfWeek, $lt: endOfWeek }
        });
        return res.json({ success: true, events });
    } catch (err) {
        console.error(err);
        return res.send(returnFailure(err.message));
    }
});

// Event-task management functions

async function generateTaskEvents(inUser) {
    const currentTime = new Date();
    // Clear out old events
    await EventDetails.deleteMany({ userRef: inUser._id, type: 'task' });

    // Get the TaskDetails sorted in order of their deadlines, earliest first. Only get tasks that have deadlines less than 2 weeks from now
    const twoWeeksFromNow = new Date(currentTime.getTime() + 14 * 24 * 60 * 60 * 1000);
    const sortedTasks = await TaskDetails.find({
        userRef: inUser._id,
    }).sort({ dueDate: 1 });

    // Query the EventDetails sorted in order of when they appear, up to 2 weeks from now
    const sortedEvents = await EventDetails.find({
        userRef: inUser._id,
        startDate: { $lte: twoWeeksFromNow },
        endDate: { $gte: currentTime }
    }).sort({ startDate: 1 });

    // Start organizing the tasks into events:
    let currentExaminedTime = currentTime;
    let eventIndex = 0;
    while (sortedTasks.length > 0) {
        let nextEvent = null;
        try {
            nextEvent = sortedEvents[eventIndex];
        } catch {
            nextEvent = null;
        }

        // Get the amount of time between the current examined time and the next event
        let timeBetween = 999 * 24 * 60 * 60 * 1000;
        if (nextEvent) {
            timeBetween = nextEvent.startDate.getTime() - currentExaminedTime.getTime();
        }
        // Determine if a task can fit into that timeslot (Starting with the earliest tasks first)
        let insertedTask = false;
        for (let k = 0; k < sortedTasks.length; k++) {
            const task = sortedTasks[k];
            const taskDuration = task.duration * 60 * 1000;
            if (timeBetween > taskDuration) {
                // Create a new task event from the task
                const taskEvent = new EventDetails({
                    title: task.title,
                    startDate: currentExaminedTime,
                    endDate: new Date(currentExaminedTime.getTime() + taskDuration),
                    notes: task.notes,
                    type: 'task',
                    userRef: inUser._id,
                });
                await taskEvent.save();

                // Remove the task from the list
                sortedTasks.splice(k, 1);

                // Set the examined time to the endDate of this last task
                currentExaminedTime = taskEvent.endDate;
                insertedTask = true;
                break;
            }
        }

        if (!insertedTask) {
            // Set the examined time to be the next event's end time
            currentExaminedTime = new Date(nextEvent.endDate)
            eventIndex++;
        }

        // Hnadle case of no more events. What if there are multiple tasks?
    }

    return;
}