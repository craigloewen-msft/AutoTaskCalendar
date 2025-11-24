const mongoose = require('mongoose');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo')
const express = require('express');
const passport = require('passport');

// Custom requires
const { UserDetails, TaskDetails, EventDetails } = require('./models');
const { authenticateToken } = require('./middleware/auth');

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
mongoose.connect(mongooseConnectionString, { useNewUrlParser: true, useUnifiedTopology: true });

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
app.listen(port, '0.0.0.0', () => console.log('App listening on port ' + port + ' on all interfaces'));

app.use(passport.initialize());
app.use(passport.session());

// Passport local authentication
passport.use(UserDetails.createStrategy());
passport.serializeUser(UserDetails.serializeUser());
passport.deserializeUser(UserDetails.deserializeUser());

// Import and use routes
const authRoutes = require('./routes/auth')(config, authenticateToken(config));
const taskRoutes = require('./routes/tasks')(config, authenticateToken(config));
const eventRoutes = require('./routes/events')(config, authenticateToken(config));

app.use('/api', authRoutes);
app.use('/api', taskRoutes);
app.use('/api', eventRoutes);
