const { test, expect, withDb } = require('../fixtures');
const { EventDetails, TaskDetails, UserDetails } = require('../../models');
const {
    addDateOnlyDays,
    mondayWeekBounds,
    parseDateOnly,
    todayInZone,
    zonedDateTime,
} = require('../../utils/temporal');

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
    test('shows the deadline cascade if one of ten Friday tasks slips a day', async ({
        seed,
        loggedInPage: page,
    }, testInfo) => {
        const data = seed.last();
        const week = mondayWeekBounds(todayInZone('UTC'), 'UTC');
        const monday = week.nextStartDate;
        const friday = addDateOnlyDays(monday, 4);
        const followingMonday = addDateOnlyDays(monday, 7);
        const bufferedTuesday = addDateOnlyDays(monday, 8);
        const bufferedFriday = addDateOnlyDays(monday, 11);

        const tasks = await withDb(async () => {
            await Promise.all([
                TaskDetails.deleteMany({ userRef: data.primary.user._id }),
                EventDetails.deleteMany({ userRef: data.primary.user._id }),
                UserDetails.updateOne({ _id: data.primary.user._id }, {
                    $set: {
                        timeZone: 'UTC',
                        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                        workingStartMinutes: 9 * 60,
                        workingEndMinutes: 17 * 60,
                    },
                }),
            ]);
            const common = {
                completed: false,
                isBacklog: false,
                breakUpTask: false,
                dependsOn: [],
                projectRef: data.named.migrationProject._id,
                userRef: data.primary.user._id,
            };
            const launchTasks = Array.from({ length: 10 }, (_, index) => ({
                ...common,
                title: `Friday launch ${String(index + 1).padStart(2, '0')}`,
                duration: 4 * 60,
                startDate: parseDateOnly(monday).date,
                dueDate: parseDateOnly(friday).date,
                priority: index + 1,
            }));
            const bufferedTasks = Array.from({ length: 2 }, (_, index) => ({
                ...common,
                title: `Buffered follow-up ${String(index + 1).padStart(2, '0')}`,
                duration: 60,
                startDate: parseDateOnly(bufferedTuesday).date,
                dueDate: parseDateOnly(bufferedFriday).date,
                priority: 100 + index,
            }));
            return TaskDetails.insertMany([...launchTasks, ...bufferedTasks]);
        });

        await page.setViewportSize({ width: 1440, height: 1600 });
        await page.clock.install({ time: new Date(`${monday}T08:00:00.000Z`) });
        await page.goto('/#/weekly-plan');
        const overview = page.locator('[data-test=weekly-overview]');
        await expect(overview).toContainText('10 tasks');
        await expect(overview).toContainText('40h due this week');
        await expect(page.locator(`[data-test="week-tasks-${data.named.migrationProject._id}"] li`)).toHaveCount(10);

        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Schedule tasks' }).click();

        const launchTasks = tasks.slice(0, 10);
        const bufferedTasks = tasks.slice(10);
        const firstTask = launchTasks[0];
        const chip = page.locator(`[data-test="slip-impact-chip-${firstTask._id}"]`);
        await expect(chip).toHaveText('+1 day → 2 late');
        for (const task of bufferedTasks) {
            const safeChip = page.locator(`[data-test="slip-impact-chip-${task._id}"]`);
            await expect(safeChip).toHaveText('+1 day → safe');
            await expect(safeChip).toHaveClass(/safe/);
        }
        const baselineRows = page.locator('.task-controls');
        await testInfo.attach('one-day-slip-at-a-glance', {
            body: await baselineRows.screenshot(),
            contentType: 'image/png',
        });

        const before = await withDb(async () => {
            const taskEvents = await EventDetails.find({
                userRef: data.primary.user._id,
                type: { $in: ['task', 'task-chunk'] },
            }).sort({ startDate: 1 });
            return {
                tasks: (await TaskDetails.find({ userRef: data.primary.user._id }).sort({ priority: 1 }))
                    .map((task) => [
                        task._id.toString(),
                        task.scheduledDate?.toISOString(),
                        task.slipForecast?.calculatedAt?.toISOString(),
                    ].join(':')),
                events: taskEvents.map(
                    (event) => `${event._id}:${event.taskRef}:${event.startDate.toISOString()}:${event.endDate.toISOString()}`
                ),
                eventDates: taskEvents.map((event) => event.startDate.toISOString().slice(0, 10)),
            };
        });
        expect(before.events).toHaveLength(12);
        expect(before.tasks.filter((task) => !task.endsWith(':'))).toHaveLength(12);
        expect(before.eventDates).toEqual([
            ...Array.from({ length: 5 }, (_, index) => {
                return [addDateOnlyDays(monday, index), addDateOnlyDays(monday, index)];
            }).flat(),
            bufferedTuesday,
            bufferedTuesday,
        ]);

        await chip.click();
        const panel = page.locator('[data-test=slip-forecast-panel]');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Let “Friday launch 01” slip one day');
        const summary = panel.locator('[data-test=slip-forecast-summary]');
        await expect(summary).toContainText('10 tasks move later');
        await expect(summary).toContainText('2 newly miss deadlines');
        const impacts = panel.locator('[data-test^=slip-impact-]');
        await expect(impacts).toHaveCount(10);

        for (const task of launchTasks.slice(8)) {
            const impact = panel.locator(`[data-test="slip-impact-${task._id}"]`);
            await expect(impact).toHaveAttribute('data-baseline-date', friday);
            await expect(impact).toHaveAttribute('data-forecast-date', followingMonday);
            await expect(impact).toContainText('Late');
            await expect(page.locator('.task-item', { hasText: task.title })).toHaveClass(
                /forecast-newly-late-task/
            );
        }
        await expect(page.locator('.task-item', { hasText: firstTask.title })).toHaveClass(
            /forecast-selected-task/
        );
        for (const task of bufferedTasks) {
            await expect(panel).not.toContainText(task.title);
            await expect(page.locator('.task-item', { hasText: task.title })).not.toHaveClass(
                /forecast-moved-task/
            );
        }
        await testInfo.attach('one-day-slip-expanded-cascade', {
            body: await panel.screenshot(),
            contentType: 'image/png',
        });

        await page.reload();
        await expect(page.locator(`[data-test="slip-impact-chip-${firstTask._id}"]`)).toHaveText(
            '+1 day → 2 late'
        );

        const after = await withDb(async () => {
            const taskEvents = await EventDetails.find({
                userRef: data.primary.user._id,
                type: { $in: ['task', 'task-chunk'] },
            }).sort({ startDate: 1 });
            return {
                tasks: (await TaskDetails.find({ userRef: data.primary.user._id }).sort({ priority: 1 }))
                    .map((task) => [
                        task._id.toString(),
                        task.scheduledDate?.toISOString(),
                        task.slipForecast?.calculatedAt?.toISOString(),
                    ].join(':')),
                events: taskEvents.map(
                    (event) => `${event._id}:${event.taskRef}:${event.startDate.toISOString()}:${event.endDate.toISOString()}`
                ),
                eventDates: taskEvents.map((event) => event.startDate.toISOString().slice(0, 10)),
            };
        });
        expect(after).toEqual(before);
    });

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
        await expect(page.locator('[data-test=task-editor-error]')).toHaveText(
            'Choose a project or Unassigned.'
        );
        await expect(page.locator('#task-project')).toBeFocused();
        await page.selectOption('#task-project', { label: 'Unassigned' });
        await page.getByRole('button', { name: 'Add task', exact: true }).click();

        const createdTask = page.locator('.task-item', { hasText: createdTitle }).first();
        await expect(createdTask).toBeVisible();
        const saved = await withDb(() => TaskDetails.findOne({
            userRef: data.primary.user._id,
            title: createdTitle,
        }));
        expect(saved.projectRef).toBeNull();
        await page.click('button:has-text("Schedule Tasks")');
        await expect(page.locator('.calendar_default_event').first()).toBeVisible();

        await createdTask.click();
        await page.getByRole('button', { name: 'Complete', exact: true }).click();
        await expect(page.locator('.task-list')).not.toContainText(createdTitle);
    });

    test('offers but does not silently apply a project recommendation', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await page.route('**/api/recommendTaskProject', async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    recommendation: {
                        projectId: String(data.named.migrationProject._id),
                        confidence: 'high',
                        evidenceCount: 2,
                    },
                }),
            });
        });

        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Add new task' }).click();
        await page.fill('#task-title', 'Ask Priyanka about rehearsal');

        const suggestion = page.locator('[data-test=project-recommendation]');
        await expect(suggestion).toContainText('Migration plan');
        await expect(page.locator('#task-project').locator('option:checked')).toHaveText(
            'Choose a project or Unassigned…'
        );

        await suggestion.getByRole('button', { name: 'Use this project' }).click();
        await expect(page.locator('#task-project')).toHaveValue(String(data.named.migrationProject._id));
    });

    test('requires an explicit project choice for a standalone follow-up', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Add follow up' }).click();
        await page.fill('#task-title', 'Standalone follow-up');
        await page.fill('#task-duration', '2');
        await page.locator('#followup-modal .modal-footer .btn-primary').click();
        await expect(page.locator('#followup-modal-body')).toContainText(
            'Choose a project or Unassigned.'
        );
        await expect(page.locator('#followup-project')).toBeFocused();

        await page.selectOption('#followup-project', { label: 'Unassigned' });
        await page.locator('#followup-modal .modal-footer .btn-primary').click();
        await expect(page.locator('#followup-modal')).not.toBeVisible();
        const saved = await withDb(() => TaskDetails.findOne({
            userRef: data.primary.user._id,
            title: 'Standalone follow-up',
        }));
        expect(saved.projectRef).toBeNull();
    });

    test('keeps one-off and unscheduled tasks visible without expanding the recurring window', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await seed.clearTasks();
        const today = todayInZone('UTC');
        const later = addDateOnlyDays(today, 20);

        await withDb(async () => {
            const series = await TaskDetails.create({
                title: 'Future recurring series',
                duration: 30,
                startDate: parseDateOnly(today).date,
                dueDate: parseDateOnly(today).date,
                recurrence: { freq: 'daily', interval: 1 },
                completed: false,
                userRef: data.primary.user._id,
            });
            await TaskDetails.insertMany([
                {
                    title: 'Later one-off task',
                    duration: 30,
                    startDate: parseDateOnly(today).date,
                    dueDate: parseDateOnly(later).date,
                    scheduledDate: zonedDateTime(later, 10 * 60, 'UTC'),
                    completed: false,
                    isBacklog: false,
                    userRef: data.primary.user._id,
                },
                {
                    title: 'Task that needs time',
                    duration: 30,
                    startDate: parseDateOnly(today).date,
                    dueDate: parseDateOnly(later).date,
                    scheduledDate: null,
                    completed: false,
                    isBacklog: false,
                    userRef: data.primary.user._id,
                },
                {
                    title: 'Later recurring occurrence',
                    duration: 30,
                    startDate: parseDateOnly(later).date,
                    dueDate: parseDateOnly(later).date,
                    scheduledDate: zonedDateTime(later, 11 * 60, 'UTC'),
                    completed: false,
                    isBacklog: false,
                    seriesRef: series._id,
                    occurrenceDate: parseDateOnly(later).date,
                    userRef: data.primary.user._id,
                },
            ]);
        });

        await page.goto('/#/calendar');

        await expect(page.locator('.task-item', { hasText: 'Later one-off task' })).toBeVisible();
        await expect(page.locator('.task-item', { hasText: 'Later recurring occurrence' })).toHaveCount(0);
        await expect(page.locator('.task-date-header').first()).toHaveText('Unscheduled');
        const unscheduled = page.locator('.task-item', { hasText: 'Task that needs time' });
        await expect(unscheduled).toBeVisible();
        await expect(unscheduled.locator('.unscheduled-badge')).toHaveText('NEEDS TIME');
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
        await page.selectOption('#task-project', { label: 'Unassigned' });

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
        await page.selectOption('#task-project', { label: 'Unassigned' });
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
