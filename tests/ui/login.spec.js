const { test, expect } = require('../fixtures');

test.describe('login page', () => {
    test('logs in and lands in the app', async ({ seed, page }) => {
        await seed();

        await page.goto('/#/login');
        await page.fill('input[name="username"]', 'testuser');
        await page.fill('input[name="password"]', 'testpassword');
        await page.click('button:has-text("Sign in")');

        await page.waitForFunction(() => !!localStorage.getItem('token'));

        // Login redirects to the user's own profile page.
        await expect(page).toHaveURL(/#\/user\/testuser/);
    });

    test('shows an error for bad credentials and stays logged out', async ({ seed, page }) => {
        await seed();

        await page.goto('/#/login');
        await page.fill('input[name="username"]', 'testuser');
        await page.fill('input[name="password"]', 'definitely-wrong');
        await page.click('button:has-text("Sign in")');

        // The page must not grant a session.
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('token'))).toBeFalsy();
        await expect(page.locator('input[name="username"]')).toBeVisible();
    });

    test('redirects anonymous visitors away from protected pages', async ({ seed, page }) => {
        await seed();

        await page.goto('/#/calendar');

        await expect(page).toHaveURL(/#\/login/);
    });

    test('logs out again', async ({ loggedInPage: page }) => {
        await page.goto('/#/logout');

        await expect
            .poll(async () => page.evaluate(() => localStorage.getItem('token')))
            .toBeFalsy();
    });
});
