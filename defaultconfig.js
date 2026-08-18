// Copy this file to config.js to override these locally; config.js is gitignored and
// takes precedence. In production these come from environment variables instead.
module.exports = {
    // Used to derive application encryption keys.
    'secret': 'mysecret',
    // https://www.npmjs.com/package/express-session#user-content-secret
    'sessionSecret': 'somesessionsecret',
    // Google Calendar integration. Leave blank to run without calendar sync.
    'googleOAuthClientID': '',
    'googleOAuthClientSecret': '',
    // Public URL of the app. Overridden automatically in development.
    'appUrl': ''
};
