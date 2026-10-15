const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
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

// Unauthenticated liveness probe, used by the test runner to wait for the server.
app.get('/api/health', (req, res) => res.json({ success: true }));

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

// SPA fallback. The client router owns real paths like /about, so a cold load or refresh
// of one must return HTML rather than 404. Mounted last, after /api and after
// express.static, so it can never shadow an endpoint or a built asset.
//
// Public pages are prerendered at build time (see webinterface/build/PrerenderPlugin.js)
// and are served as themselves. Everything else gets `app.html`, the neutral shell:
// serving the prerendered home page here would give every private URL home's title,
// description and canonical until the app booted.
const distDir = path.join(__dirname, 'dist');

function prerenderedPageFor(urlPath) {
    const route = urlPath.replace(/\/+$/, '') || '/';
    if (route === '/') {
        const home = path.join(distDir, 'index.html');
        return fs.existsSync(home) ? home : null;
    }

    // Resolve before comparing: a path only looks safe until '..' has been collapsed.
    const file = path.resolve(distDir, `${route.replace(/^\/+/, '')}.html`);
    if (!file.startsWith(distDir + path.sep)) return null;

    return fs.existsSync(file) ? file : null;
}

app.get('*', (req, res, next) => {
    // An unmatched /api path is a missing endpoint, not a page; let it 404 as itself.
    if (req.path.startsWith('/api/')) return next();
    // Anything with a file extension is a missing asset; serving HTML for it would hide
    // the error and break module/image loading with a confusing MIME type.
    if (path.extname(req.path)) return next();

    const prerendered = prerenderedPageFor(req.path);
    if (prerendered) return res.sendFile(prerendered);

    const shell = path.join(distDir, 'app.html');
    // app.html exists only when the build prerendered; otherwise index.html is the shell.
    return res.sendFile(fs.existsSync(shell) ? shell : path.join(distDir, 'index.html'));
});

async function start() {
    await mongoose.connect(mongooseConnectionString, {
        // Many agents share one mongod; the default 100-connection pool per process is far
        // more than any single stack needs.
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
    });
    await migrateGoogleCredentials(config);
    await GoogleOAuthStateDetails.init();

    // Listen only after credential migration, so plaintext is never served.
    const server = app.listen(hostPort, '0.0.0.0', () => {
        if (process.env.NODE_ENV == 'production') {
            console.log(`App listening on port ${hostPort} on all interfaces`);
        } else {
            console.log(`App listening on port ${hostPort} (db "${instance.dbName}")`);
        }
    });

    // EADDRINUSE says nothing about who owns the port, which is the useful part.
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(
                `\nPort ${hostPort} is already in use, so the app cannot start.\n` +
                'Every stack uses this fixed port; another copy of the app is probably ' +
                'already running here. Stop it, or pin a different port with ' +
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
