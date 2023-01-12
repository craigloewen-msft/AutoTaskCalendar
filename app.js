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
    return { username: inputUser.username, email: inputUser.email, _id: inputUser._id, taskList: inputUser.taskList };
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

        let registeredUser = await UserDetails.register({ username: req.body.username, email: req.body.email }, req.body.password);

        let token = jwt.sign({ id: req.body.username }, config.secret, { expiresIn: JWTTimeout });

        let returnUserInfo = await returnBasicUserInfo(registeredUser);

        let response = { success: true, auth: true, token: token, user: returnUserInfo };
        return res.json(response);
    }
    catch (error) {
        return res.json(returnFailure(error));
    }
});

// Task management routes

// - Helper functions
async function getTaskListFromUserID(inUserID) {
    let user = await UserDetails.findById(inUserID).populate('taskList');
    return user.taskList;
}

app.post('/api/createTask', async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
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
            userRef: req.user._id
        });
        await task.save();
        // Return the updated task list
        const returnTaskList = await getTaskListFromUserID(req.user._id);
        return res.json({success: true, taskList: returnTaskList});
    } catch (error) {
        console.error(error);
        return res.json({ success: false });
    }
});

app.post('/api/updateTask', async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { taskId, title, dueDate, notes } = req.body;
    if (!taskId) {
        return res.send(returnFailure('Task id is required'));
    }

    try {
        const task = await TaskDetails.findOne({ _id: taskId, userRef: req.user._id });
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

app.post('/api/deleteTask', async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { taskId } = req.body;
    if (!taskId) {
        return res.send(returnFailure('Task id is required'));
    }

    try {
        const task = await TaskDetails.findOne({ _id: taskId, userRef: req.user._id });
        if (!task) {
            return res.send(returnFailure('Task not found'));
        }
        await task.remove();
        // Return the updated task list
        const returnTaskList = await getTaskListFromUserID(req.user._id);
        return res.json({success: true, taskList: returnTaskList});
    } catch (err) {
        res.send(returnFailure('Error deleting task'));
    }
});

app.get("/api/getUserTasks", async (req, res) => {
    try {
        // Return the updated task list
        const returnTaskList = await getTaskListFromUserID(req.user._id);
        return res.json({success: true, taskList: returnTaskList});
    } catch (error) {
        console.error(error);
        return res.json({ success: false });
    }
});

// Event management routes

// - Helper function
async function getEventListFromUserID(inUserID) {
    let user = await UserDetails.findById(inUserID).populate('eventList');
    return user.eventList;
}


async function createEvent(userId, title, startDate, endDate, notes) {
    try {
        // Create the new event
        const event = new EventDetails({
            title: title,
            startDate: startDate,
            endDate: endDate,
            notes: notes,
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

app.post('/api/createEvent', async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { title, startDate, endDate, notes } = req.body;
    if (!title || !startDate || !endDate) {
        return res.send(returnFailure('Title, start date, and end date are required'));
    }

    try {
        const event = await createEvent(req.user._id, title, startDate, endDate, notes);
        return res.json({success: true, event});
    } catch (error) {
        console.error(error);
        return res.json({ success: false });
    }
});

app.post('/api/updateEvent', async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { eventId, title, startDate, endDate, notes } = req.body;
    if (!eventId) {
        return res.send(returnFailure('Event id is required'));
    }

    try {
        const event = await updateEvent(eventId, req.user._id, title, startDate, endDate, notes);
        res.send({ success: true, event });
    } catch (err) {
        res.send(returnFailure(err.message));
    }
});

app.post('/api/deleteEvent', async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
        return res.send(returnFailure('Not logged in'));
    }

    const { eventId } = req.body;
    if (!eventId) {
        return res.send(returnFailure('Event id is required'));
    }

    try {
        await deleteEvent(eventId, req.user._id);
        // Return the updated event list
        const returnEventList = await getEventListFromUserID(req.user._id);
        return res.json({success: true, eventList: returnEventList});
    } catch (err) {
        res.send(returnFailure(err.message));
    }
});

app.get("/api/getUserEvents/:date", async (req, res) => {
    // Check if user is logged in
    if (!req.user) {
        return res.send(returnFailure('Not logged in'));
    }
    try {
        const date = new Date(req.params.date);
        const startOfWeek = new Date(date);
        startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
        startOfWeek.setUTCHours(0,0,0);
        const endOfWeek = new Date(date);
        endOfWeek.setUTCDate(endOfWeek.getUTCDate() + (7 - endOfWeek.getUTCDay()));
        endOfWeek.setUTCHours(23,59,59);
        const events = await EventDetails.find({
            userRef: req.user._id,
            startDate: {$gte: startOfWeek, $lt: endOfWeek}
        });
        return res.json({ success: true, events });
    } catch (err) {
        console.error(err);
        return res.send(returnFailure(err.message));
    }
});
