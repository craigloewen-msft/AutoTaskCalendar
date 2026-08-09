'use strict';

/**
 * Shared Playwright fixtures. Specs should stay short by leaning on these.
 *
 *   const { test, expect } = require('../fixtures');
 *
 *   test('does a thing', async ({ seed, api }) => {
 *     const data = await seed();
 *     const res = await api.get('/api/getUserTasks');
 *     ...
 *   });
 *
 * Fixtures available:
 *   seed()          reseed the database, returns the created data
 *   seed.clearTasks()  wipe the primary user's tasks/events, for empty-state tests
 *   api             request context authenticated as the seeded primary user
 *   apiAnon         request context with no credentials, for auth-failure tests
 *   loginAs(u, p)   build an authenticated request context for any user
 *   loggedInPage    a browser page already logged in as the primary user
 */

const base = require('@playwright/test');
const mongoose = require('mongoose');

const { runSeed } = require('../../seed');
const { TaskDetails, EventDetails } = require('../../models');
const instance = require('../../instance');

const baseURL = process.env.AUTOTASKCALENDAR_BASE_URL || `http://127.0.0.1:${instance.apiPort}`;

/**
 * One mongoose connection per worker, reused by every seed call in that worker.
 *
 * It is deliberately never closed by a hook: `test.afterAll` runs once per spec FILE, so
 * closing there would pull the connection out from under later files. Playwright tears the
 * worker process down at the end of the run, which closes it for us.
 *
 * The connection sits idle for long stretches (a whole project's worth of API tests can
 * pass without a reseed), and idle TCP sockets to the container get dropped. `maxIdleTimeMS`
 * retires pooled sockets before they can go stale, which is what stops the driver handing
 * out a dead one and throwing MongoPoolClearedError mid-seed.
 */
const CONNECT_OPTIONS = {
    maxIdleTimeMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    heartbeatFrequencyMS: 5_000,
};

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
 * Log in over the real API and return a request context that carries the JWT, exactly
 * like the front end does.
 */
async function createAuthedContext(playwright, username, password) {
    const anon = await playwright.request.newContext({ baseURL });
    const response = await anon.post('/api/login', { data: { username, password } });
    const body = await response.json();
    await anon.dispose();

    if (!body.success) {
        throw new Error(`Could not log in as "${username}": ${body.log || 'unknown error'}`);
    }

    const context = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: body.token },
    });

    return { context, token: body.token, user: body.user };
}

/**
 * Transient infrastructure failures, as opposed to genuine test failures.
 *
 * The MongoDB container is reached through a wslc port-forward, which can briefly refuse
 * connections when the host is busy. Match on the error NAME as well as the message:
 * MongooseServerSelectionError's message is just "connect ECONNREFUSED ...", so matching
 * message text alone misses it.
 */
function isTransientDbError(error) {
    const name = error?.name || '';
    const message = error?.message || '';

    return (
        /MongoNetworkError|MongoPoolCleared|ServerSelection|MongoTopologyClosed/i.test(name) ||
        /pool|closed|topology|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|server selection/i.test(message)
    );
}

const test = base.test.extend({
    /**
     * Reseed the database. Call it first in any test that depends on data.
     */
    seed: async ({}, use) => {
        let lastResult = null;

        const seed = async () => {
            // The container is reached through a port-forward that can flap when the host
            // is busy, so retry with backoff rather than failing a test for an
            // infrastructure hiccup.
            let lastError = null;

            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    await ensureConnected();
                    lastResult = await runSeed({ mongoUrl: instance.mongoUrl });
                    return lastResult;
                } catch (error) {
                    lastError = error;

                    if (!isTransientDbError(error)) {
                        throw error;
                    }

                    // Tear the connection down so the next attempt builds a clean pool.
                    await mongoose.connection.close().catch(() => {});
                    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
                }
            }

            throw lastError;
        };

        // Let other fixtures see whether this test already seeded.
        seed.last = () => lastResult;

        /**
         * Delete the primary user's tasks and events, leaving the account intact.
         *
         * Lets a test set up an empty-state precondition for itself.
         */
        seed.clearTasks = async () => {
            const result = lastResult || (await seed());
            const userId = result.primary.user._id;

            await TaskDetails.deleteMany({ userRef: userId });
            await EventDetails.deleteMany({ userRef: userId });

            return result;
        };

        await use(seed);
    },

    /**
     * An unauthenticated request context, for testing that endpoints reject anonymous
     * callers.
     */
    apiAnon: async ({ playwright }, use) => {
        const context = await playwright.request.newContext({ baseURL });
        await use(context);
        await context.dispose();
    },

    /**
     * Log in as an arbitrary user. Returns a request context you must dispose yourself.
     */
    loginAs: async ({ playwright }, use) => {
        const contexts = [];

        await use(async (username, password = 'testpassword') => {
            const { context } = await createAuthedContext(playwright, username, password);
            contexts.push(context);
            return context;
        });

        await Promise.all(contexts.map((c) => c.dispose()));
    },

    /**
     * A request context authenticated as `testuser`. Seeds first if the test has not
     * already done so.
     */
    api: async ({ playwright, seed }, use) => {
        if (!seed.last()) {
            await seed();
        }

        const { context } = await createAuthedContext(playwright, 'testuser', 'testpassword');
        await use(context);
        await context.dispose();
    },

    /**
     * A browser page already logged in as `testuser`.
     *
     * This drives the real login form rather than planting localStorage, because the app
     * only installs the axios Authorization header during the login dispatch.
     */
    loggedInPage: async ({ page, seed }, use) => {
        if (!seed.last()) {
            await seed();
        }

        await page.goto('/#/login');
        await page.fill('input[name="username"]', 'testuser');
        await page.fill('input[name="password"]', 'testpassword');
        await page.click('button:has-text("Sign in")');

        // The app redirects home once the store has the token.
        await page.waitForFunction(() => !!localStorage.getItem('token'));

        await use(page);
    },
});

module.exports = { test, expect: base.expect, baseURL };
