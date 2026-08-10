'use strict';

/**
 * Shared MongoDB access for tests.
 *
 * The database is reached through a wslc port-forward that can drop pooled connections
 * when the host is busy. That surfaces as MongoPoolClearedError / MongoNetworkError in
 * whichever test happens to be running, which is a lie: the code under test is fine.
 *
 * Everything here exists to make that noise invisible:
 *   waitForDatabase()  block until the connection is genuinely usable (global setup)
 *   ensureConnected()  reconnect if the pool went stale
 *   withDb(fn)         run a query, retrying transient failures
 */

const mongoose = require('mongoose');
const instance = require('../../instance');

// Retire pooled sockets before the port-forward can drop them underneath us.
const CONNECT_OPTIONS = {
    maxIdleTimeMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    heartbeatFrequencyMS: 5_000,
    retryReads: true,
    retryWrites: true,
};

/**
 * Transient infrastructure failures, as opposed to genuine test failures.
 *
 * Match on the error NAME as well as the message: MongooseServerSelectionError's message
 * is just "connect ECONNREFUSED ...", so matching message text alone misses it.
 */
function isTransientDbError(error) {
    const name = error?.name || '';
    const message = error?.message || '';

    return (
        /MongoNetworkError|MongoPoolCleared|ServerSelection|MongoTopologyClosed|MongoNotConnected/i.test(name) ||
        /pool|closed|topology|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|server selection/i.test(message)
    );
}

async function ensureConnected() {
    if (mongoose.connection.readyState === 1) {
        try {
            await mongoose.connection.db.admin().ping();
            return;
        } catch {
            // Stale pool: fall through and rebuild the connection.
        }
    }

    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close().catch(() => {});
    }

    await mongoose.connect(instance.mongoUrl, CONNECT_OPTIONS);
}

/**
 * Run a database operation, retrying transient connection failures.
 *
 * Wrap every direct model call a spec makes. Without this a dropped socket fails whichever
 * test was unlucky, and the failure looks like a real regression.
 */
async function withDb(fn, { attempts = 4 } = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            await ensureConnected();
            return await fn();
        } catch (error) {
            lastError = error;

            if (!isTransientDbError(error)) {
                throw error;
            }

            // Rebuild the pool from scratch on the next attempt.
            await mongoose.connection.close().catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
    }

    throw lastError;
}

/**
 * Block until the database answers a real query, not just a TCP connect.
 *
 * Called once from global setup. A freshly started container accepts connections slightly
 * before it can serve them, and under load the port-forward can refuse a probe spuriously,
 * so this keeps trying rather than failing the run on one bad reading.
 */
async function waitForDatabase({ timeoutMs = 60_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    let consecutiveSuccesses = 0;

    while (Date.now() < deadline) {
        try {
            await ensureConnected();
            // A real round trip through the pool, which a bare connect does not prove.
            await mongoose.connection.db.admin().ping();
            await mongoose.connection.db.listCollections().toArray();

            // Two clean round trips in a row, so we do not start on a lucky one.
            consecutiveSuccesses++;
            if (consecutiveSuccesses >= 2) return;
            await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (error) {
            lastError = error;
            consecutiveSuccesses = 0;
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

module.exports = {
    CONNECT_OPTIONS,
    isTransientDbError,
    ensureConnected,
    withDb,
    waitForDatabase,
    disconnect,
};
