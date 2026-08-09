'use strict';

/**
 * Shared Playwright fixtures. Specs should stay short by leaning on these.
 *
 *   const { test, expect } = require('../fixtures');
 *
 *   test('does a thing', async ({ seed, api }) => {
 *     const data = await seed('full');
 *     const res = await api.get('/api/getUserTasks');
 *     ...
 *   });
 *
 * Fixtures available:
 *   seed(scenario)  reseed the database, returns the created data
 *   api             request context authenticated as the seeded primary user
 *   apiAnon         request context with no credentials, for auth-failure tests
 *   loginAs(u, p)   build an authenticated request context for any user
 *   loggedInPage    a browser page already logged in as the primary user
 */

const base = require('@playwright/test');
const mongoose = require('mongoose');

const { runSeed } = require('../../seed');
const instance = require('../../instance');

const baseURL = process.env.AUTOTASKCALENDAR_BASE_URL || `http://127.0.0.1:${instance.apiPort}`;

/**
 * One mongoose connection per worker, reused by every seed call in that worker.
 *
 * It is deliberately never closed by a hook: `test.afterAll` runs once per spec FILE, so
 * closing there would pull the connection out from under later files. Playwright tears the
 * worker process down at the end of the run, which closes it for us.
 *
 * The pool can still go stale across the long gap between projects, so we ping before
 * reusing it and reconnect if the ping fails.
 */
async function ensureConnected() {
    if (mongoose.connection.readyState === 1) {
        try {
            await mongoose.connection.db.admin().ping();
            return;
        } catch {
            // Stale pool: fall through and rebuild the connection.
            await mongoose.connection.close().catch(() => {});
        }
    }

    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close().catch(() => {});
    }

    await mongoose.connect(instance.mongoUrl);
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

const test = base.test.extend({
    /**
     * Reseed the database. Call it first in any test that depends on data.
     * Defaults to the `basic` scenario when called with no argument.
     */
    seed: async ({}, use, testInfo) => {
        let lastResult = null;

        const seed = async (scenario = 'basic') => {
            // One retry: a pool that went stale between projects surfaces as a transient
            // network error on the first write, and is healthy again once reconnected.
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    await ensureConnected();
                    lastResult = await runSeed({ scenario, mongoUrl: instance.mongoUrl });
                    return lastResult;
                } catch (error) {
                    const transient = /pool|closed|topology|ECONNRESET/i.test(error.message);
                    if (attempt === 1 || !transient) {
                        throw error;
                    }
                    await mongoose.connection.close().catch(() => {});
                }
            }
        };

        // Expose the most recent seed to other fixtures in the same test.
        seed.last = () => lastResult;
        testInfo.__seed = seed;

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
     * A request context authenticated as `testuser`. The database must already be seeded,
     * so call `seed(...)` before touching `api` (Playwright builds fixtures lazily, and
     * this one asserts the user exists).
     */
    api: async ({ playwright, seed }, use) => {
        if (!seed.last()) {
            await seed('basic');
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
            await seed('basic');
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
