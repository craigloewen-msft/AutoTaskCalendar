const { test, expect } = require('../fixtures');

test.describe('admin dashboard', () => {
    test('shows site metrics and searches the user table', async ({ seed, adminPage: page }) => {
        const data = seed.last();

        await page.goto('/#/admin');

        await expect(page.locator('[data-test=admin-overview]')).toBeVisible();
        await expect(page.locator('[data-test=admin-metric-users] .metric-value')).not.toBeEmpty();
        await expect(page.locator('[data-test=admin-metric-completion] .metric-value'))
            .toContainText('%');
        // One bar group per day of the 30-day window.
        await expect(page.locator('[data-test=admin-trends] .trend-day')).toHaveCount(30);

        await expect(page.locator('[data-test=admin-user-row]').first()).toBeVisible();
        await page.fill('[data-test=admin-user-search]', data.primary.username);

        const rows = page.locator('[data-test=admin-user-row]');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText(data.primary.username);
    });

    test('keeps the page and its nav link away from ordinary users', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await expect(page.locator('.navbar a[href="#/admin"]')).toHaveCount(0);

        await page.goto('/#/admin');

        // The guard redirects Home; the dashboard never renders.
        await expect(page).toHaveURL(/#\/$/);
        await expect(page.locator('[data-test=admin-overview]')).toHaveCount(0);
    });
});
