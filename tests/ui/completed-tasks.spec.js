const { test, expect } = require('../fixtures');

test.describe('completed tasks page', () => {
    test('shows the empty state when nothing is completed', async ({ seed, loggedInPage: page }) => {
        await seed.clearTasks();

        await page.goto('/#/completed');

        await expect(page.locator('text=No completed tasks yet')).toBeVisible();
    });

    test('lists the first page of completed tasks', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/completed');

        await expect(page.locator('.task-card').first()).toBeVisible();
        // The page requests 20 at a time.
        await expect(page.locator('.task-card')).toHaveCount(20);
    });

    test('loads more when asked', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/completed');
        await expect(page.locator('.task-card')).toHaveCount(20);

        await page.click('button:has-text("Load More")');

        await expect(page.locator('.task-card')).toHaveCount(40);
    });

    test('searches completed tasks', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/completed');
        // The unfiltered first page is already on screen, so wait for it before searching;
        // otherwise the assertions below can read the pre-search list.
        await expect(page.locator('.task-card')).toHaveCount(20);

        await page.fill('.search-input', 'quarterly');

        // The search box is debounced by 500ms, then re-queries the API. Poll until every
        // visible card matches, rather than asserting a fixed count, so this survives
        // changes to how many quarterly reports the dataset happens to contain.
        await expect
            .poll(async () => {
                const titles = await page.locator('.task-card .task-title').allTextContents();
                return titles.length > 0 && titles.every((t) => /quarterly/i.test(t));
            })
            .toBe(true);
    });
});
