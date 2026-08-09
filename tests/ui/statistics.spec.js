const { test, expect } = require('../fixtures');

test.describe('statistics page', () => {
    test('renders the summary numbers and charts without console errors', async ({
        seed,
        loggedInPage: page,
    }) => {
        const errors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        page.on('pageerror', (err) => errors.push(err.message));

        await seed('full');
        await page.goto('/#/statistics');

        // Charts are canvases drawn by chart.js.
        await expect(page.locator('canvas').first()).toBeVisible();
        await expect(page.locator('body')).toContainText('70');

        expect(errors).toEqual([]);
    });

    test('survives a user with no data', async ({ seed, loggedInPage: page }) => {
        await seed('empty');

        await page.goto('/#/statistics');

        await expect(page.locator('h1, h2').first()).toBeVisible();
    });
});
