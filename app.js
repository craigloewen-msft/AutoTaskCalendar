const axios = require('axios');
const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo')
const express = require('express');
const jwt = require('jsonwebtoken');
const connectEnsureLogin = require('connect-ensure-login');
const { google } = require('googleapis');
const process = require('process');
const moment = require('moment');
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
    config.googleOAuthClientID = process.env.googleOAuthClientID;
    config.googleOAuthClientSecret = process.env.googleOAuthClientSecret;
    config.appUrl = process.env.appUrl;
    hostPort = 8080;
} else {
    mongooseConnectionString = config.devMongoDBConnectionString;
    config.appUrl = "http://localhost:3000";
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
    workingDuration: Number,
    workingDays: [String],
    googleAccessToken: String,
    googleRefreshToken: String,
    selectedCalendars: [String],
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
    startDate: Date,
    breakUpTask: Boolean,
    breakUpTaskChunkDuration: Number,
    completed: Boolean,
    scheduledDate: Date,
    repeat: String,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
})

// Add a new schema for events
const EventDetail = new Schema({
    title: String,
    startDate: Date,
    endDate: Date,
    notes: String,
    type: String,
    externalEventID: String,
    userRef: { type: Schema.Types.ObjectId, ref: 'userInfo' },
    taskRef: { type: Schema.Types.ObjectId, ref: 'taskInfo' },
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
    return {
        username: inputUser.username, email: inputUser.email, _id: inputUser._id, workingStartTime: inputUser.workingStartTime,
        workingDuration: inputUser.workingDuration, workingDays: inputUser.workingDays, selectedCalendars: inputUser.selectedCalendars
    };
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


// 
app.post('/api/login', (req, res, next) => {
    // 
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

// Add new user function



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
            return res.json(returnFailure("Username already exists"));
        }

        // TODO: Fix this to be accurate to the user's timezone
        let nowDate = new Date();
        let startDate = new Date(nowDate.setHours(14, 0, 0, 0));

        let registeredUser = await UserDetails.register({ username: req.body.username, email: req.body.email, workingStartTime: startDate, workingDuration: 8, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }, req.body.password);

        let token = jwt.sign({ id: req.body.username }, config.secret, { expiresIn: JWTTimeout });

        let returnUserInfo = await returnBasicUserInfo(registeredUser);

        let response = { success: true, auth: true, token: token, user: returnUserInfo };
        return res.json(response);
    }
    catch (error) {
        return res.json(returnFailure(error));
    }
});

app.post('/api/updateuserinfo', authenticateToken, async function (req, res) {
    try {
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }

        const { workingStartTime, workingEndTime, workingDays, timeZoneOffset, selectedCalendars } = req.body;

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

        // workingDuration is hours between start date and end date
        let workingDuration = (endDate.getTime() - startDate.getTime()) / 1000 / 60 / 60;


        user.workingStartTime = startDate;
        user.workingDuration = workingDuration;
        user.workingDays = workingDays;
        user.selectedCalendars = selectedCalendars;

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
    let user = await UserDetails.findOne({ username: inUsername }).populate({
        path: 'taskList',
        match: { $or: [{ completed: false }, { completed: null }] },
        options: { sort: { dueDate: 1 } },
    });

    return user.taskList;
}

async function refreshGoogleCalendarAccessToken(inUser) {
    // Refresh Google Calendar access token
    const oauth2Client = new google.auth.OAuth2(
        config.googleOAuthClientID,
        config.googleOAuthClientSecret,
    );
    oauth2Client.setCredentials({
        refresh_token: inUser.googleRefreshToken
    });

    const tokens = await oauth2Client.refreshAccessToken();
    inUser.googleAccessToken = tokens.credentials.access_token;
    await inUser.save();

    return true;
}

app.post('/api/createTask', authenticateToken, async (req, res) => {
    // Check if user is logged in

    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { title, dueDate, notes, duration, startDate, breakUpTask, breakUpTaskChunkDuration, taskRepeat } = req.body;
    if (!title || !dueDate || !duration || !startDate || breakUpTask ? !breakUpTaskChunkDuration : false) {
        return res.send(returnFailure('Title, duration, and due date are required'));
    }

    try {
        // Make the due date at the end of the specified day:
        let taskDate = new Date(req.body.dueDate);

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

app.post('/api/editTask', authenticateToken, async (req, res) => {

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

app.post('/api/completeTask', authenticateToken, async (req, res) => {
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
        task.completed = true;
        await task.save();

        // Check if task is a repeating task
        if (task.repeat) {
            // Create a new task based on the completed task
            const newTask = new TaskDetails({
                // Copy all properties of the original task
                ...task._doc,
                // Set the new task as not completed
                completed: false,
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

        // Return the updated task list
        const returnTaskList = await getTaskListFromUsername(req.user.id);
        return res.json({ success: true, taskList: returnTaskList });
    } catch (err) {
        res.send(returnFailure('Error deleting task'));
    }
});

app.get("/api/getUserTasks", authenticateToken, async (req, res) => {
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

app.get("/api/scheduletasks", authenticateToken, async (req, res) => {
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

async function syncCalendarsToDatabase(inUser, startPeriod, endPeriod) {

    try {

        // Check if user has a Google Calendar access token
        if (!inUser.googleAccessToken) {
            return false;
        }

        // Sync Google Calendar events to events database
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({
            access_token: inUser.googleAccessToken,
            refresh_token: inUser.googleRefreshToken
        });

        const calendar = google.calendar({ version: "v3", auth: oauth2Client });

        // const eventsResponse = await calendar.events.list({
        //     calendarId: "primary",
        //     timeMin: startOfWeek.toISOString(),
        //     timeMax: endOfWeek.toISOString(),
        //     maxResults: 2500,
        //     singleEvents: true,
        //     orderBy: "startTime"
        // });

        // Array of calendar IDs
        const calendarIds = inUser.selectedCalendars;

        // Array of promises that get events for each calendar
        const eventsPromises = calendarIds.map(async (calendarId) => {
            const eventsResponse = await calendar.events.list({
                calendarId,
                timeMin: startPeriod.toISOString(),
                timeMax: endPeriod.toISOString(),
                maxResults: 2500,
                singleEvents: true,
                orderBy: "startTime",
            });
            return eventsResponse.data.items;
        });

        // Wait for all promises to resolve
        const eventsResults = await Promise.all(eventsPromises);

        // Merge events from all calendars into one array
        const eventsResponse = eventsResults.reduce((accumulator, currentValue) => {
            return [...accumulator, ...currentValue];
        }, []);

        const eventsData = eventsResponse;

        const events = await Promise.all(
            eventsData.map(async (eventData) => {
                let event = await EventDetails.findOne({
                    externalEventID: eventData.id,
                    userRef: inUser._id
                });

                if (!event) {
                    event = new EventDetails({
                        externalEventID: eventData.id,
                        userRef: inUser._id,
                        title: eventData.summary,
                        startDate: eventData.start.dateTime || eventData.start.date,
                        endDate: eventData.end.dateTime || eventData.end.date,
                        notes: eventData.description,
                        type: "google"
                    });
                    await event.save();
                }

                return event;
            })
        );

        let eventIds = events.map((event) => event._id);

        // Delete all events that are not in the Google Calendar
        let deleteResult = await EventDetails.deleteMany({
            userRef: inUser._id,
            type: "google",
            _id: { $nin: eventIds }
        });

        return true;

    } catch (err) {
        console.error(err);

        if (err.code == 401) {

            await refreshGoogleCalendarAccessToken(inUser);

            // Try again
            return syncCalendarsToDatabase(inUser, startPeriod, endPeriod);
        }

        return false;
    }
}

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

        // Sync calendars
        // await syncCalendarsToDatabase(user, startOfWeek, endOfWeek);

        // Get the user's events from the database
        const events = await EventDetails.find({
            userRef: user._id,
            startDate: { $gte: startOfWeek, $lt: endOfWeek },
        });

        return res.json({ success: true, events });
    } catch (err) {
        console.error(err);
        return res.send(returnFailure(err.message));
    }
});


// Google Calendar API functions

app.get('/api/connectGoogle', authenticateToken, async (req, res) => {
    // Check if user is logged in
    let user = await UserDetails.findOne({ username: req.user.id });

    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }

    // Generate a URL for the user to connect their Google account
    const oauth2Client = new google.auth.OAuth2(
        config.googleOAuthClientID,
        config.googleOAuthClientSecret,
        `${config.appUrl}/api/connectGoogleCallback`
    );

    const scopes = [
        'https://www.googleapis.com/auth/calendar.readonly',
    ];

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        state: user._id.toString(),
        prompt: 'consent',
    });

    return res.send({ authUrl });
});

app.get('/api/connectGoogleCallback', async (req, res) => {
    // Get the user's ID from the state parameter
    const userId = req.query.state;

    // Check if user is logged in
    let user = await UserDetails.findById(userId);

    if (!user) {
        return res.send(returnFailure('User not found'));
    }

    // Exchange the authorization code for an access token
    const oauth2Client = new google.auth.OAuth2(
        config.googleOAuthClientID,
        config.googleOAuthClientSecret,
        `${config.appUrl}/api/connectGoogleCallback`
    );

    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);

        // Save the access and refresh tokens in the user's document
        user.googleAccessToken = tokens.access_token;
        user.googleRefreshToken = tokens.refresh_token;
        await user.save();

        return res.redirect(`${config.appUrl}`);
    } catch (err) {
        console.error(err);
        return res.send(returnFailure('Failed to connect Google account'));
    }
});

app.get("/api/getCalendars", authenticateToken, async (req, res) => {
    try {
        const user = await UserDetails.findOne({ username: req.user.id });
        if (!user || !user.googleAccessToken) {
            return res.send(returnFailure('User is not authenticated with Google'));
        }

        const { google } = require('googleapis');
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: user.googleAccessToken });
        const calendar = google.calendar({ version: 'v3', auth });

        let calendarListResponse = null;
        try {
            calendarListResponse = await calendar.calendarList.list();
        } catch (err) {
            if (err.code == 401) {
                await refreshGoogleCalendarAccessToken(user);
                calendarListResponse = await calendar.calendarList.list();
            }
        }
        const calendars = calendarListResponse.data.items;

        return res.json({ success: true, calendars });
    } catch (err) {
        console.error(err);
        return res.send(returnFailure(err.message));
    }
});

app.get("/api/synccalendar", authenticateToken, async (req, res) => {
    try {
        // Check if user is logged in
        let user = await UserDetails.findOne({ username: req.user.id });

        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }


        let now = new Date();

        // Get 
        let twoWeeksBefore = new Date(now.getTime() - 12096e5);
        let monthAfter = new Date(now.getTime() + 2629800000);

        await syncCalendarsToDatabase(user, twoWeeksBefore, monthAfter);

        return res.send({ success: true });
    } catch (err) {
        console.error(err);
        return res.send(returnFailure(err.message));
    }

});

// Event-task management functions

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
    const sortedTasks = await TaskDetails.find({
        userRef: inUser._id,
        $or: [{ completed: false }, { completed: null }],
    }).sort({ dueDate: 1 });

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

    let eventIndex = 0;
    while (sortedTasks.length > 0) {
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
                        const taskDuration = task.duration * 60 * 1000;
                        const breakUpTaskChunkDuration = task.breakUpTask ? task.breakUpTaskChunkDuration * 60 * 1000 : 0;
                        if (currentExaminedTime.getTime() > task.startDate.getTime()) {
                            if (timeBetween >= taskDuration) {
                                // Create a new task event from the task

                                if (task.chunkNumber) {
                                    task.chunkNumber++;
                                }

                                const taskEvent = new EventDetails({
                                    title: task.chunkNumber ? task.title + " (" + task.chunkNumber + ")" : task.title,
                                    startDate: currentExaminedTime,
                                    endDate: new Date(currentExaminedTime.getTime() + taskDuration),
                                    notes: task.notes,
                                    type: 'task',
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
                                task.chunkNumber = task.chunkNumber ? task.chunkNumber + 1 : 1;
                                task.duration = task.duration - chunkDurationMins;

                                const taskEvent = new EventDetails({
                                    title: task.title + " (" + task.chunkNumber + ")",
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
    }

    return;
}