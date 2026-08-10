'use strict';

/**
 * Runs once before the whole suite.
 *
 * A freshly started MongoDB container accepts TCP connections slightly before it can serve
 * queries. Without this wait the first test of a run reliably ate that gap and failed with
 * MongoPoolClearedError, which looks like a real regression and costs a full re-run.
 */

const { waitForDatabase, disconnect } = require('./fixtures/db');
const instance = require('../instance');

module.exports = async () => {
    const startedAt = Date.now();
    await waitForDatabase();
    const ms = Date.now() - startedAt;

    console.log(`\nDatabase ready at ${instance.mongoUrl} (${ms}ms)`);

    // The suite opens its own per-worker connections; this one has done its job.
    await disconnect();
};
