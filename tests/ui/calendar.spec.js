const { test, expect } = require('../fixtures');

test.describe('calendar page', () => {
    test('renders the seeded tasks in the sidebar', async ({ seed, loggedInPage: page }) => {
        const data = await seed('basic');

        await page.goto('/#/calendar');

        await expect(page.locator('.task-item').first()).toBeVisible();
        await expect(page.locator('.task-list')).toContainText(data.named.proposal.title);
    });

    test('marks backlog tasks with a badge', async ({ seed, loggedInPage: page }) => {
        await seed('basic');

        await page.goto('/#/calendar');

        await expect(page.locator('.task-badge', { hasText: 'BACKLOG' }).first()).toBeVisible();
    });

    test('creates a task through the modal', async ({ seed, loggedInPage: page }) => {
        await seed('empty');

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');

        await page.fill('#task-title', 'Task created from the UI');
        await page.fill('#task-due-date', isoDay(3));
        await page.fill('#task-duration', '45');
        await page.click('.modal-footer button:has-text("OK")');

        await expect(page.locator('.task-list')).toContainText('Task created from the UI');
    });

    test('refuses to create a task with no title', async ({ seed, loggedInPage: page }) => {
        await seed('empty');

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.fill('#task-duration', '45');
        await page.click('.modal-footer button:has-text("OK")');

        // The modal stays open and explains itself.
        await expect(page.locator('#task-modal')).toContainText('Need task title');
    });

    test('completes a task from the edit modal', async ({ seed, loggedInPage: page }) => {
        const data = await seed('basic');
        const title = data.named.proposal.title;

        await page.goto('/#/calendar');
        await page.locator('.task-item', { hasText: title }).first().click();
        await page.click('button:has-text("Complete")');

        await expect(page.locator('.task-list')).not.toContainText(title);
    });

    test('schedules tasks and draws them on the calendar', async ({ seed, loggedInPage: page }) => {
        await seed('basic');

        await page.goto('/#/calendar');
        await page.click('button:has-text("Schedule Tasks")');

        // DayPilot renders each scheduled block as an event div.
        await expect(page.locator('.calendar_default_event').first()).toBeVisible();
    });
});

// A yyyy-mm-dd string N days from today, which is what <input type="date"> expects.
function isoDay(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}
