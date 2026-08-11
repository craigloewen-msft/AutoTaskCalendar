const { test, expect, withDb } = require('../fixtures');
const { EventDetails, TaskDetails } = require('../../models');
const { addDateOnlyDays, parseDateOnly, todayInZone, zonedDateTime } = require('../../utils/temporal');

async function createQuickCompleteFixture(data) {
    const today = todayInZone('UTC');

    return withDb(async () => {
        for (let index = 0; index < 2; index++) {
            const occurrence = await TaskDetails.create({
                title: 'Quick recurring task',
                duration: 30,
                startDate: parseDateOnly(addDateOnlyDays(today, index)).date,
                dueDate: parseDateOnly(addDateOnlyDays(today, index)).date,
                scheduledDate: zonedDateTime(today, (10 + index) * 60, 'UTC'),
                completed: false,
                isBacklog: false,
                seriesRef: data.named.weekdaysSeries._id,
                occurrenceDate: parseDateOnly(addDateOnlyDays(today, index)).date,
                userRef: data.primary.user._id,
            });

            await EventDetails.create({
                title: occurrence.title,
                startDate: zonedDateTime(today, (10 + index) * 60, 'UTC'),
                endDate: zonedDateTime(today, (10 + index) * 60 + 30, 'UTC'),
                type: 'task',
                taskRef: occurrence._id,
                userRef: data.primary.user._id,
            });
        }
    });
}

test.describe('calendar page', () => {
    test('creates and completes tasks through the shared editor', async ({ seed, loggedInPage: page }) => {
        const data = await seed();
        const createdTitle = 'Task created from the UI';

        await page.goto('/#/calendar');
        await expect(page.locator('.task-list')).toContainText(data.named.proposal.title);

        await page.click('button:has-text("Add Task")');
        await expect(page.locator('[data-test=task-editor]')).toBeVisible();
        await page.fill('#task-title', createdTitle);
        await page.fill('#task-due-date', isoDay(3));
        await page.fill('#task-duration', '45');
        await page.getByRole('button', { name: 'Add task', exact: true }).click();

        const createdTask = page.locator('.task-item', { hasText: createdTitle }).first();
        await expect(createdTask).toBeVisible();
        await page.click('button:has-text("Schedule Tasks")');
        await expect(page.locator('.calendar_default_event').first()).toBeVisible();

        await createdTask.click();
        await page.getByRole('button', { name: 'Complete', exact: true }).click();
        await expect(page.locator('.task-list')).not.toContainText(createdTitle);
    });

    test('keeps a recurring occurrence when quick completion fails', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await createQuickCompleteFixture(data);
        let releaseResponse;
        let requestCount = 0;
        const responseGate = new Promise((resolve) => {
            releaseResponse = resolve;
        });

        await page.route('**/api/completeTask', async (route) => {
            requestCount++;
            await responseGate;
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ success: false, log: 'Could not complete occurrence.' }),
            });
        });
        await page.goto('/#/calendar');

        const row = page.locator('.task-item', { hasText: 'Quick recurring task' }).first();
        const button = row.getByRole('button', {
            name: 'Complete recurring task: Quick recurring task',
        });
        await button.click();
        await expect(button).toBeDisabled();
        await button.evaluate((element) => element.click());
        expect(requestCount).toBe(1);
        releaseResponse();

        await expect(page.locator('[data-test=quick-complete-error]')).toContainText(
            'Could not complete occurrence.'
        );
        await expect(row).toBeVisible();
    });

    test('creates weekly recurring tasks through the shared editor', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.fill('#task-title', 'Mon and Tue only');
        await page.fill('#task-due-date', isoDay(3));
        await page.fill('#task-duration', '30');
        await page.selectOption('#task-repeat', 'weekly');

        for (const day of ['Monday', 'Tuesday']) {
            const pill = page.locator(`.weekday-pill[data-day="${day}"]`);
            if (!(await pill.evaluate((element) => element.classList.contains('selected')))) {
                await pill.click();
            }
        }
        for (const day of ['Sunday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
            const pill = page.locator(`.weekday-pill[data-day="${day}"]`);
            if (await pill.evaluate((element) => element.classList.contains('selected'))) {
                await pill.click();
            }
        }

        await expect(page.locator('[data-test=repeat-summary]')).toContainText(
            'Every week on Monday and Tuesday'
        );
        await page.getByRole('button', { name: 'Add task', exact: true }).click();

        const recurringTask = page.locator('.task-item', { hasText: 'Mon and Tue only' }).first();
        await expect(recurringTask).toBeVisible();
        await expect(recurringTask.locator('.recurring-icon')).toBeVisible();
    });

    test('keeps civil dates stable and renders all-day events in a non-UTC browser', async ({
        seed,
        nonUtcPage: page,
    }) => {
        const data = seed.last();
        const date = data.anchor.format('YYYY-MM-DD');
        const end = data.anchor.clone().add(1, 'day').format('YYYY-MM-DD');
        await withDb(() => EventDetails.create({
            title: 'All-day timezone test',
            allDay: true,
            allDayStart: date,
            allDayEnd: end,
            startDate: data.anchor.toDate(),
            endDate: data.anchor.clone().add(1, 'day').toDate(),
            type: 'google',
            userRef: data.primary.user._id,
        }));

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.fill('#task-title', 'Non UTC task');
        await page.fill('#task-due-date', '2030-03-10');
        await page.fill('#task-duration', '30');
        await page.getByRole('button', { name: 'Add task', exact: true }).click();

        const task = page.locator('.task-item', { hasText: 'Non UTC task' }).first();
        await expect(task).toBeVisible();
        await task.click();
        await expect(page.locator('#task-due-date')).toHaveValue('2030-03-10');

        const allDay = page.locator('.all-day-event', { hasText: 'All-day timezone test' });
        await expect(allDay).toBeVisible();
        await expect(allDay).toHaveAttribute('data-event-date', date);
        await expect(allDay).toHaveAttribute('data-event-end', end);
    });
});

function isoDay(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}
