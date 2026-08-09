const mongoose = require('mongoose');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo')
const express = require('express');
const passport = require('passport');

// Custom requires
const { UserDetails, TaskDetails, EventDetails } = require('./models');
const { authenticateToken } = require('./middleware/auth');
const instance = require('./instance');

// Get config
const config = fs.existsSync('./config.js') ? require('./config') : require('./defaultconfig');

// Configure Vue Specific set up
const app = express();
app.use(express.static(__dirname + "/dist"));

// Set up Dev or Production
let mongooseConnectionString = '';
let hostPort = instance.apiPort;
let sessionCookieName = instance.sessionCookieName;

if (process.env.NODE_ENV == 'production') {
    mongooseConnectionString = process.env.prodMongoDBConnectionString;
    config.secret = process.env.secret;
    config.sessionSecret = process.env.sessionSecret;
    config.googleOAuthClientID = process.env.googleOAuthClientID;
    config.googleOAuthClientSecret = process.env.googleOAuthClientSecret;
    config.appUrl = process.env.appUrl;
    // Azure App Service (and most PaaS hosts) inject the port to bind on.
    hostPort = parseInt(process.env.PORT, 10) || 8080;
    sessionCookieName = 'connect.sid';
} else {
    // Dev: every value is derived from AUTOTASKCALENDAR_INSTANCE so that multiple
    // instances can run side by side. See instance.js.
    mongooseConnectionString = instance.mongoUrl;
    // The browser talks to the Vue dev server, which proxies /api back to this process.
    config.appUrl = `http://localhost:${instance.webPort}`;
}

// Set up Mongoose connection
mongoose.connect(mongooseConnectionString);

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
    // Cookies are scoped by host and ignore the port, so parallel dev instances on
    // localhost need distinct cookie names to avoid clobbering each other's sessions.
    name: sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7 * 2 // 2 weeks
    }
}));

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

// Start listening only once every route and auth handler is registered, so no request
// can ever hit a half-configured app.
app.listen(hostPort, '0.0.0.0', () => {
    if (process.env.NODE_ENV == 'production') {
        console.log(`App listening on port ${hostPort} on all interfaces`);
    } else {
        console.log(
            `App listening on port ${hostPort} (instance "${instance.name}", db "${instance.dbName}")`
        );
    }
});
