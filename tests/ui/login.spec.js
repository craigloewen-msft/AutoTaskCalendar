const { test, expect } = require('../fixtures');

test.describe('login page', () => {
    test('logs in and out through the real auth flow', async ({ seed, page }) => {
        const data = await seed();

        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');
        await page.waitForFunction(() => !!localStorage.getItem('token'));
        await expect(page).toHaveURL(new RegExp(`#/user/${data.primary.username}$`));

        await page.goto('/#/logout');
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('token'))).toBeFalsy();
    });

    test('redirects anonymous visitors away from protected pages', async ({ seed, page }) => {
        await seed();

        await page.goto('/#/calendar');

        await expect(page).toHaveURL(/#\/login/);
    });
});
