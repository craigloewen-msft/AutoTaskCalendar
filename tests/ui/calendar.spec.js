const { test, expect, withDb } = require('../fixtures');

test.describe('calendar page', () => {
    test('renders the seeded tasks in the sidebar', async ({ seed, loggedInPage: page }) => {
        const data = await seed();

        await page.goto('/#/calendar');

        await expect(page.locator('.task-item').first()).toBeVisible();
        await expect(page.locator('.task-list')).toContainText(data.named.proposal.title);
    });

    test('marks backlog tasks with a badge', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');

        await expect(page.locator('.task-badge', { hasText: 'BACKLOG' }).first()).toBeVisible();
    });

    test('creates a task through the modal', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');

        await page.fill('#task-title', 'Task created from the UI');
        await page.fill('#task-due-date', isoDay(3));
        await page.fill('#task-duration', '45');
        await page.click('.modal-footer button:has-text("OK")');

        await expect(page.locator('.task-list')).toContainText('Task created from the UI');
    });

    test('keeps a task civil date in a non-UTC browser', async ({ nonUtcPage: page }) => {
        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.fill('#task-title', 'Non UTC task');
        await page.fill('#task-due-date', '2030-03-10');
        await page.fill('#task-duration', '30');
        await page.click('.modal-footer button:has-text("OK")');

        const task = page.locator('.task-item', { hasText: 'Non UTC task' }).first();
        await expect(task).toBeVisible();
        await task.click();
        await expect(page.locator('#task-due-date')).toHaveValue('2030-03-10');
    });

    test('refuses to create a task with no title', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.fill('#task-duration', '45');
        await page.click('.modal-footer button:has-text("OK")');

        // The modal stays open and explains itself.
        await expect(page.locator('#task-modal')).toContainText('Need task title');
    });

    test('completes a task from the edit modal', async ({ seed, loggedInPage: page }) => {
        const data = await seed();
        const title = data.named.proposal.title;

        await page.goto('/#/calendar');
        await page.locator('.task-item', { hasText: title }).first().click();
        await page.click('button:has-text("Complete")');

        await expect(page.locator('.task-list')).not.toContainText(title);
    });

    test('schedules tasks and draws them on the calendar', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Schedule Tasks")');

        // DayPilot renders each scheduled block as an event div.
        await expect(page.locator('.calendar_default_event').first()).toBeVisible();
    });

    test('renders a known timed instant at browser-local wall time', async ({ seed, nonUtcPage: page }) => {
        const data = seed.last();
        await page.goto('/#/calendar');
        const event = page.locator('.calendar_default_event', { hasText: data.named.meeting.title });
        await expect(event).toBeVisible();
        const expected = await page.evaluate((iso) => {
            const date = new Date(iso);
            const pad = (value) => String(value).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
                `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        }, data.named.meeting.startDate.toISOString());
        await expect(event).toHaveAttribute('data-event-start', expected);
    });

    test('renders synced all-day events in the all-day row', async ({ seed, loggedInPage: page }) => {
        const data = await seed();
        const { EventDetails } = require('../../models');
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
        const allDay = page.locator('.all-day-event', { hasText: 'All-day timezone test' });
        await expect(allDay).toBeVisible();
        await expect(allDay).toHaveAttribute('data-event-date', date);
        await expect(allDay).toHaveAttribute('data-event-end', end);
    });

    test('never renders an "Invalid Date" group header', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await expect(page.locator('.task-item').first()).toBeVisible();

        // Unschedulable tasks have no scheduledDate; formatting one used to produce the
        // literal string "Invalid Date" as a sidebar heading.
        await expect(page.locator('.task-date-header', { hasText: 'Invalid Date' })).toHaveCount(0);
        await expect(page.locator('.task-date-header', { hasText: 'UNSCHEDULED' })).toBeVisible();
    });

    test('creates a weekly task on chosen weekdays through the modal', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');

        await page.fill('#task-title', 'Mon and Tue only');
        await page.fill('#task-due-date', isoDay(3));
        await page.fill('#task-duration', '30');

        await page.click('.advanced-options-toggle');
        await page.selectOption('#task-repeat', 'weekly');

        // Start from a known state: clear whatever day defaulted on, then pick Mon + Tue.
        const selected = page.locator('.weekday-pill.selected');
        await expect(selected).toHaveCount(1);

        await page.click('.weekday-pill[data-day="Monday"]');
        await page.click('.weekday-pill[data-day="Tuesday"]');
        const initial = await selected.first().getAttribute('data-day');
        if (initial !== 'Monday' && initial !== 'Tuesday') {
            await page.click(`.weekday-pill[data-day="${initial}"]`);
        }

        await expect(page.locator('[data-test=repeat-summary]')).toContainText(
            'Every week on Monday and Tuesday'
        );

        await page.click('.modal-footer button:has-text("OK")');

        // Occurrences appear immediately, without pressing "Schedule Tasks" first.
        await expect(page.locator('.task-list')).toContainText('Mon and Tue only');
        await expect(
            page.locator('.task-item', { hasText: 'Mon and Tue only' }).first().locator('.recurring-icon')
        ).toBeVisible();
    });

    test('shows a recurrence cutoff on the selected civil date west of UTC', async ({ nonUtcPage: page }) => {
        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.click('.advanced-options-toggle');
        await page.selectOption('#task-repeat', 'daily');
        await page.check('#repeat-ends-on');
        await page.fill('#repeat-ends-on-date', '2030-03-31');
        await expect(page.locator('[data-test=repeat-summary]')).toContainText('until 31 Mar 2030');
    });

    test('warns when a chosen day is not a working day, but still saves', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');

        await page.fill('#task-title', 'Weekend chore');
        await page.fill('#task-due-date', isoDay(3));
        await page.fill('#task-duration', '30');

        await page.click('.advanced-options-toggle');
        await page.selectOption('#task-repeat', 'weekly');

        // The seeded user works Monday to Friday, so Saturday is flagged before you pick it.
        await expect(page.locator('.weekday-pill[data-day="Saturday"]')).toHaveClass(/non-working/);
        await expect(page.locator('[data-test=repeat-warning]')).toHaveCount(0);

        await page.click('.weekday-pill[data-day="Saturday"]');

        await expect(page.locator('[data-test=repeat-warning]')).toContainText(
            'Saturday is not among your working days'
        );

        // A warning, not a validation error: the rule still saves.
        await page.click('.modal-footer button:has-text("OK")');
        await expect(page.locator('.task-list')).toContainText('Weekend chore');
    });

    test('shows the series banner and the rule when opening an occurrence', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Schedule Tasks")');

        const occurrence = page.locator('.task-item', { hasText: 'Team standup' }).first();
        await expect(occurrence).toBeVisible();
        await occurrence.click();

        await expect(page.locator('[data-test=series-banner]')).toContainText('repeating series');
        // The occurrence carries no rule of its own, so this proves the series' rule is
        // surfaced rather than the editor claiming the task does not repeat.
        await expect(page.locator('#task-repeat')).toHaveValue('weekly');
        await expect(page.locator('[data-test=repeat-summary]')).toContainText(
            'Every week on Monday and Tuesday'
        );
    });
});

// A yyyy-mm-dd string N days from today, which is what <input type="date"> expects.
function isoDay(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}
