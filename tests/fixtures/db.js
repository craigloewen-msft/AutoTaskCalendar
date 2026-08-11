'use strict';

/**
 * Shared MongoDB access for tests.
 *
 *   waitForDatabase()  block until the database can serve queries (global setup)
 *   withDb(fn)         run a query against the test database
 */

const mongoose = require('mongoose');
const instance = require('../../instance');

async function ensureConnected() {
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(instance.mongoUrl);
    }
}

/** Run a database operation against the test database. */
async function withDb(fn) {
    await ensureConnected();

    return fn();
}

/** A freshly started container accepts connections slightly before it can serve them. */
async function waitForDatabase({ timeoutMs = 30_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            await ensureConnected();
            await mongoose.connection.db.admin().ping();
            return;
        } catch (error) {
            lastError = error;
            await mongoose.connection.close().catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    throw new Error(
        `Database at ${instance.mongoUrl} was not ready within ${timeoutMs}ms: ${lastError?.message}`
    );
}

async function disconnect() {
    await mongoose.connection.close().catch(() => {});
}

module.exports = { ensureConnected, withDb, waitForDatabase, disconnect };
