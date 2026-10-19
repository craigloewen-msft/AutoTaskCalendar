'use strict';

/**
 * Connecting Google Calendar from the profile page. The page lives at /user/<name>, so a
 * relative "api/..." URL would resolve to /user/api/... and get HTML back.
 */

const { test, expect } = require('../fixtures');

test.describe('google calendar connect', () => {
    test('profile page sends the user to Google consent', async ({ page, seed }) => {
        const data = await seed();
        await page.goto('/login');
        await page.locator('input[type=text]').fill(data.primary.username);
        await page.locator('input[type=password]').fill(data.primary.password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).toHaveURL(/\/user\//);

        // Stop at Google's door; the test only cares that we were sent there.
        let googleUrl = null;
        await page.route('https://accounts.google.com/**', (route) => {
            googleUrl = route.request().url();
            return route.fulfill({ status: 200, body: 'google' });
        });

        const connect = page.waitForResponse((r) => r.url().includes('connectGoogle'));
        await page.getByRole('button', { name: /Connect Google Calendar/ }).click();
        const response = await connect;
        expect(new URL(response.url()).pathname).toBe('/api/connectGoogle');

        await expect.poll(() => googleUrl).not.toBeNull();
        const url = new URL(googleUrl);
        expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/connectGoogleCallback$/);
        expect(url.searchParams.get('state')).toBeTruthy();
    });
});
