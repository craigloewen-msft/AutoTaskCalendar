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
 *   seed()          rebuild this test's tenant, returns the created data
 *   seed.clearTasks()  wipe the primary user's tasks/events, for empty-state tests
 *   api             request context authenticated as the seeded primary user
 *   apiAnon         request context with no credentials, for auth-failure tests
 *   loginAs(u, p)   build an authenticated request context for any user
 *   loggedInPage    a browser page already logged in as the primary user
 *   nonUtcPage      logged-in page in America/Los_Angeles
 *
 * Reading the database directly? Wrap it in `withDb` (re-exported here) so the connection
 * is established first.
 */

const base = require('@playwright/test');
const { createHash } = require('crypto');

const { runSeed, wipeNamespace } = require('../../seed');
const {
    TaskDetails,
    EventDetails,
    TaskSlipForecastDetails,
    UserDetails,
} = require('../../models');
const instance = require('../../instance');
const { withDb } = require('./db');

const baseURL = process.env.AUTOTASKCALENDAR_BASE_URL || `http://127.0.0.1:${instance.apiPort}`;

function testNamespace(testInfo) {
    const identity = [testInfo.testId, testInfo.retry, testInfo.repeatEachIndex].join(':');
    const hash = createHash('sha1').update(identity).digest('hex').slice(0, 12);
    return `pw-${process.pid}-${testInfo.workerIndex}-${hash}`;
}

/**
 * One mongoose connection per worker, reused by every seed call in that worker.
 *
 * It is deliberately never closed by a hook: `test.afterAll` runs once per spec FILE, so
 * closing there would pull the connection out from under later files. Playwright tears the
 * worker process down at the end of the run, which closes it for us.
 *
 * Connection handling and transient-error retries live in ./db.js.
 */

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
     * Rebuild this test's tenant. Concurrent workers keep their own data.
     */
    seed: async ({}, use, testInfo) => {
        let lastResult = null;
        let seedInFlight = null;
        const namespace = testNamespace(testInfo);

        const seed = async (options = {}) => {
            if (!seedInFlight) {
                seedInFlight = withDb(() => runSeed({
                    ...options,
                    mongoUrl: instance.mongoUrl,
                    namespace,
                }));
            }

            try {
                lastResult = await seedInFlight;
                return lastResult;
            } finally {
                seedInFlight = null;
            }
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

            await withDb(async () => {
                await TaskDetails.deleteMany({ userRef: userId });
                await EventDetails.deleteMany({ userRef: userId });
                await TaskSlipForecastDetails.deleteMany({ userRef: userId });
            });

            return result;
        };

        try {
            await use(seed);
        } finally {
            await withDb(() => wipeNamespace(namespace));
        }
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

    nonUtcPage: async ({ browser, seed }, use) => {
        const data = seed.last() || await seed();

        await withDb(() => UserDetails.updateOne(
            { _id: data.primary.user._id },
            { $set: { timeZone: 'America/Los_Angeles' } }
        ));
        const context = await browser.newContext({
            baseURL,
            timezoneId: 'America/Los_Angeles',
        });
        const page = await context.newPage();
        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');
        await page.waitForFunction(() => !!localStorage.getItem('token'));
        await use(page);
        await context.close();
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
     * A request context authenticated as this test's primary user.
     */
    api: async ({ playwright, seed }, use) => {
        const data = seed.last() || await seed();

        const { context } = await createAuthedContext(
            playwright,
            data.primary.username,
            data.primary.password
        );
        await use(context);
        await context.dispose();
    },

    /**
     * A browser page already logged in as this test's primary user.
     *
     * This drives the real login form rather than planting localStorage, because the app
     * only installs the axios Authorization header during the login dispatch.
     */
    loggedInPage: async ({ page, seed }, use) => {
        const data = seed.last() || await seed();

        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');

        // The app redirects home once the store has the token.
        await page.waitForFunction(() => !!localStorage.getItem('token'));

        await use(page);
    },
});

module.exports = { test, expect: base.expect, baseURL, testNamespace, withDb };
