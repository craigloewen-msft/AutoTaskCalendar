const { test, expect } = require('../fixtures');

test.describe('login page', () => {
    test('logs in and out through the real auth flow', async ({ seed, page }) => {
        const data = await seed();

        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');
        await expect(page).toHaveURL(new RegExp(`#/user/${data.primary.username}$`));
        expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();

        await page.reload();
        await expect(page).toHaveURL(new RegExp(`#/user/${data.primary.username}$`));
        await expect(page.locator('nav')).toContainText(data.primary.username);

        await page.goto('/#/logout');
        await expect(page).toHaveURL(/#\/$/);
        expect(await page.evaluate(() => ({
            token: localStorage.getItem('token'),
            user: localStorage.getItem('user'),
            lastLoginDate: localStorage.getItem('lastLoginDate'),
        }))).toEqual({ token: null, user: null, lastLoginDate: null });

        await page.goto('/#/calendar');
        await expect(page).toHaveURL(/#\/login/);
    });

    test('removes legacy browser auth state', async ({ seed, page }) => {
        await seed();
        await page.addInitScript(() => {
            localStorage.setItem('token', 'legacy-token');
            localStorage.setItem('user', JSON.stringify({ username: 'legacy-user' }));
            localStorage.setItem('lastLoginDate', new Date().toISOString());
        });

        await page.goto('/#/');

        expect(await page.evaluate(() => [
            localStorage.getItem('token'),
            localStorage.getItem('user'),
            localStorage.getItem('lastLoginDate'),
        ])).toEqual([null, null, null]);
    });

    test('redirects anonymous visitors away from protected pages', async ({ seed, page }) => {
        await seed();

        await page.goto('/#/calendar');

        await expect(page).toHaveURL(/#\/login/);
    });

    test('returns to the page that required a login', async ({ seed, page }) => {
        const data = await seed();

        await page.goto('/#/weekly-plan');
        await expect(page).toHaveURL(/next=\/weekly-plan/);

        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');

        await expect(page).toHaveURL(/#\/weekly-plan$/);
    });

    test('ignores an off-site next target', async ({ seed, page }) => {
        const data = await seed();

        await page.goto('/#/login?next=//evil.example.com');
        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');

        await expect(page).toHaveURL(new RegExp(`#/user/${data.primary.username}$`));
    });
});
