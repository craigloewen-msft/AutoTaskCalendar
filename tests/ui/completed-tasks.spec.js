const { test, expect } = require('../fixtures');

test.describe('completed tasks page', () => {
    test('shows the empty state when nothing is completed', async ({ seed, loggedInPage: page }) => {
        await seed('empty');

        await page.goto('/#/completed');

        await expect(page.locator('text=No completed tasks yet')).toBeVisible();
    });

    test('lists the first page of completed tasks', async ({ seed, loggedInPage: page }) => {
        await seed('full'); // 70 completed tasks, page size 20

        await page.goto('/#/completed');

        await expect(page.locator('.task-card').first()).toBeVisible();
        await expect(page.locator('.task-card')).toHaveCount(20);
    });

    test('loads more when asked', async ({ seed, loggedInPage: page }) => {
        await seed('full');

        await page.goto('/#/completed');
        await expect(page.locator('.task-card')).toHaveCount(20);

        await page.click('button:has-text("Load More")');

        await expect(page.locator('.task-card')).toHaveCount(40);
    });

    test('searches completed tasks', async ({ seed, loggedInPage: page }) => {
        await seed('full');

        await page.goto('/#/completed');
        await page.fill('.search-input', 'quarterly');

        // The search box is debounced by 500ms, then re-queries the API.
        await expect(page.locator('.task-card')).toHaveCount(7);
        await expect(page.locator('.tasks-grid')).toContainText('quarterly');
    });
});
