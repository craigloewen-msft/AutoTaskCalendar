module.exports = {
    'devMongoDBConnectionString': 'mongodb://db/GithubIssueManagement',
    // secret is for jwt
    'secret': 'mysecret',
    // https://www.npmjs.com/package/express-session#user-content-secret
    'sessionSecret': 'somesessionsecret',
    // Google Analytics Measurement ID (optional, set to null to disable)
    // Format: G-XXXXXXXXXX
    'devGaMeasurementId': null
};
