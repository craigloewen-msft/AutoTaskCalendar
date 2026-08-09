// Copy this file to config.js and fill in real values for local development.
// config.js is gitignored and takes precedence over this file.
//
// The dev MongoDB connection string is NOT configured here -- it is derived per instance
// from AUTOTASKCALENDAR_INSTANCE. See instance.js, or run `npm run db:status`.
// In production these are all supplied as environment variables instead (see AGENTS.md).
module.exports = {
    // secret is for jwt
    'secret': 'mysecret',
    // https://www.npmjs.com/package/express-session#user-content-secret
    'sessionSecret': 'somesessionsecret',
    // Google Calendar integration. Leave blank to run without calendar sync.
    'googleOAuthClientID': '',
    'googleOAuthClientSecret': '',
    // Public URL of the app. Overridden automatically in development.
    'appUrl': ''
};
