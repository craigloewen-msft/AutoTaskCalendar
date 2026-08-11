'use strict';

/** Wait for the database before the first spec runs, so a cold start is not a failure. */

const { waitForDatabase, disconnect } = require('./fixtures/db');

module.exports = async () => {
    await waitForDatabase();
    await disconnect();
};
