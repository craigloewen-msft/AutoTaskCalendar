'use strict';

/**
 * The calendar's Repeating tasks drawer, and the hints that explain a moved or early
 * occurrence. See docs/RECURRING_TASKS.md and docs/CALENDAR_TASK_LIST.md.
 */

const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, EventDetails, UserDetails } = require('../../models');
const { addDateOnlyDays, parseDateOnly, todayInZone, zonedDateTime } = require('../../utils/temporal');

async function login(page, username, password) {
    await page.goto('/login');
    await page.locator('input[type=text]').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/user\//);
}

test.describe('calendar repeating tasks drawer', () => {
    test('lists each series under intentions, explains moved occurrences, and opens the editor', async ({ page, seed }) => {
        const data = await seed();
        const userId = data.recurring.user._id;
        const today = todayInZone('UTC');
        const occurrenceDay = addDateOnlyDays(today, 2);
        const movedTo = addDateOnlyDays(today, 4);

        const { series, occurrence } = await withDb(async () => {
            await Promise.all([
                TaskDetails.deleteMany({ userRef: userId }),
                EventDetails.deleteMany({ userRef: userId }),
                UserDetails.updateOne({ _id: userId }, { $set: { timeZone: 'UTC' } }),
            ]);
            const template = await TaskDetails.create({
                title: 'Make slides',
                duration: 30,
                startDate: parseDateOnly(occurrenceDay).date,
                dueDate: parseDateOnly(occurrenceDay).date,
                recurrence: { freq: 'monthly', interval: 1, whenUnschedulableBehavior: 'next-available' },
                userRef: userId,
            });
            // A future occurrence the scheduler moved two days later, as on a full day.
            const pending = await TaskDetails.create({
                title: 'Make slides',
                duration: 30,
                seriesRef: template._id,
                occurrenceDate: parseDateOnly(occurrenceDay).date,
                startDate: parseDateOnly(occurrenceDay).date,
                dueDate: parseDateOnly(occurrenceDay).date,
                scheduledDate: zonedDateTime(movedTo, 10 * 60, 'UTC'),
                completed: false,
                isBacklog: false,
                userRef: userId,
            });
            return { series: template, occurrence: pending };
        });

        await login(page, data.recurring.username, data.recurring.password);
        await page.goto('/calendar');

        // The sidebar row says which occurrence it is, and that ticking it now is early.
        const row = page.locator(`[data-test=task-item-${occurrence._id}]`);
        await expect(row).toBeVisible();
        await expect(page.locator(`[data-test=task-occurrence-${occurrence._id}]`)).toContainText('↻ for');
        await expect(page.locator(`[data-test=quick-complete-${occurrence._id}]`))
            .toHaveAttribute('aria-label', /occurrence of Make slides early/);

        // The drawer starts collapsed, then shows the rule and where its next one landed.
        const drawer = page.locator('[data-test=calendar-recurring-series]');
        await expect(drawer).toBeVisible();
        await expect(drawer).not.toHaveAttribute('open', '');
        const item = page.locator(`[data-test=series-item-${series._id}]`);
        await expect(item).toBeHidden();
        await drawer.locator('summary').click();
        await expect(item).toContainText('Make slides');
        await expect(item).toContainText('If no time: next available');
        await expect(page.locator(`[data-test=series-next-${series._id}]`)).toContainText('→');

        // A row opens the series editor on its next occurrence.
        await item.click();
        await expect(page.locator('[data-test=series-banner]')).toBeVisible();
        await expect(page.locator('[data-test=task-complete-button]')).toHaveText('Complete early');
    });
});
