const mongoose = require('mongoose');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo')
const express = require('express');
const passport = require('passport');

// Custom requires
const { UserDetails, TaskDetails, EventDetails, GoogleOAuthStateDetails } = require('./models');
const { authenticateSession, requireSameOrigin, requireAdmin } = require('./middleware/auth');
const { migrateGoogleCredentials } = require('./utils/googleCredentialMigration');
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
    app.set('trust proxy', 1);
    // Azure App Service and most PaaS hosts inject the port to bind on.
    hostPort = parseInt(process.env.PORT, 10) || 8080;
    sessionCookieName = 'connect.sid';
} else {
    // Derived per instance so multiple instances can run side by side. See instance.js.
    mongooseConnectionString = instance.mongoUrl;
    config.appUrl = process.env.AUTOTASKCALENDAR_BASE_URL
        || `http://localhost:${instance.webPort}`;
    config.googleOAuthClientID = process.env.AUTOTASKCALENDAR_GOOGLE_OAUTH_CLIENT_ID
        || config.googleOAuthClientID;
    config.googleOAuthClientSecret = process.env.AUTOTASKCALENDAR_GOOGLE_OAUTH_CLIENT_SECRET
        || config.googleOAuthClientSecret;
}

const sessionCookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
};
config.sessionCookieName = sessionCookieName;
config.sessionCookieOptions = sessionCookieOptions;

// App set up
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: MongoStore.create({
        mongoUrl: mongooseConnectionString,
        ttl: 14 * 24 * 60 * 60,
        autoRemove: 'interval',
        autoRemoveInterval: 60 * 24 * 7 // Once a week
    }),
    // Cookies are scoped by host and ignore the port, so each instance needs its own.
    name: sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        ...sessionCookieOptions,
        maxAge: 1000 * 60 * 60 * 24 * 7 * 2
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport local authentication
passport.use(UserDetails.createStrategy());
passport.serializeUser(UserDetails.serializeUser());
passport.deserializeUser(UserDetails.deserializeUser());

// Import and use routes
const authRoutes = require('./routes/auth')(
    config,
    authenticateSession(config),
    requireSameOrigin(config)
);
const taskRoutes = require('./routes/tasks')(config, authenticateSession(config));
const eventRoutes = require('./routes/events')(config, authenticateSession(config));
const compassRoutes = require('./routes/compass')(config, authenticateSession(config));
const weeklyPlanRoutes = require('./routes/weeklyPlan')(config, authenticateSession(config));
const adminRoutes = require('./routes/admin')(config, authenticateSession(config), requireAdmin);

app.use('/api', authRoutes);
app.use('/api', taskRoutes);
app.use('/api', eventRoutes);
app.use('/api', compassRoutes);
app.use('/api', weeklyPlanRoutes);
app.use('/api', adminRoutes);

async function start() {
    await mongoose.connect(mongooseConnectionString);
    await migrateGoogleCredentials(config);
    await GoogleOAuthStateDetails.init();

    // Listen only after credential migration, so plaintext is never served.
    const server = app.listen(hostPort, '0.0.0.0', () => {
        if (process.env.NODE_ENV == 'production') {
            console.log(`App listening on port ${hostPort} on all interfaces`);
        } else {
            console.log(
                `App listening on port ${hostPort} (instance "${instance.name}", db "${instance.dbName}")`
            );
        }
    });

    // EADDRINUSE alone does not say which instance owns the port, which is the useful part.
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(
                `\nPort ${hostPort} is already in use, so instance "${instance.name}" cannot start.\n` +
                'Another instance almost certainly owns it. Start the stack with `npm run dev`, ' +
                'which probes for free ports at startup, or pin one with ' +
                'AUTOTASKCALENDAR_API_PORT.\n'
            );
        } else {
            console.error(`Server failed to start: ${error.message}`);
        }
        process.exit(1);
    });
}

start().catch((error) => {
    console.error(`Server failed to start: ${error.message}`);
    process.exit(1);
});
