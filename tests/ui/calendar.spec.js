const { test, expect, withDb } = require('../fixtures');
const {
    EventDetails,
    TaskDetails,
    ProjectDetails,
    GoalDetails,
    RoleDetails,
} = require('../../models');
const {
    addDateOnlyDays,
    dateOnlyFromMarker,
    dateOnlyInZone,
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

function placementSummaries(events) {
    const summaries = new Map();
    for (const event of events) {
        const current = summaries.get(event.taskId) || {
            first: event.startDate,
            last: event.endDate,
        };
        if (event.startDate < current.first) current.first = event.startDate;
        if (event.endDate > current.last) current.last = event.endDate;
        summaries.set(event.taskId, current);
    }
    return summaries;
}

function isLate(summary, dueDate) {
    return !!summary && dateOnlyInZone(summary.last, 'UTC') > dateOnlyFromMarker(dueDate);
}

test.describe('calendar page', () => {
    test('shows only downstream deadline risk in the mixed-capacity calendar', async ({
        seed,
        page,
    }, testInfo) => {
        const data = await seed();
        const { capacityTasks, capacityEvents, isolatedTask, project, dates } = data.slip;
        const { capacityMonday, capacityFriday, recoveryMonday, recoveryFriday } = dates;

        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.slip.username);
        await page.fill('input[name="password"]', data.slip.password);
        await page.click('button:has-text("Sign in")');
        await page.waitForURL(/#\/user\//);
        await page.setViewportSize({ width: 1440, height: 1600 });
        await page.clock.install({ time: new Date(`${capacityMonday}T08:00:00.000Z`) });

        await page.goto('/#/weekly-plan');
        const overview = page.locator('[data-test=weekly-overview]');
        await expect(overview).toContainText('10 tasks');
        await expect(overview).toContainText('35h selected');
        await expect(page.locator(`[data-test="week-tasks-${project._id}"] li`)).toHaveCount(10);

        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Schedule tasks' }).click();

        const firstTask = capacityTasks[0];
        const lastCapacityTask = capacityTasks.at(-1);
        const chip = page.locator(`[data-test="slip-impact-chip-${firstTask._id}"]`);
        const lastCapacityChip = page.locator(
            `[data-test="slip-impact-chip-${lastCapacityTask._id}"]`
        );
        const isolatedChip = page.locator(`[data-test="slip-impact-chip-${isolatedTask._id}"]`);
        await expect(chip).toHaveText('slot blocked → 1 late');
        const titleBox = await page
            .locator(`[data-test="task-item-${firstTask._id}"] .task-primary-row`)
            .boundingBox();
        const chipBox = await chip.boundingBox();
        expect(titleBox).not.toBeNull();
        expect(chipBox).not.toBeNull();
        expect(chipBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
        await expect(lastCapacityChip).toHaveCount(0);
        await expect(isolatedChip).toHaveCount(0);
        await testInfo.attach('blocked-slot-at-a-glance', {
            body: await page.locator('.task-controls').screenshot(),
            contentType: 'image/png',
        });

        const snapshot = async () => withDb(async () => {
            const events = await EventDetails.find({ userRef: data.slip.user._id })
                .sort({ startDate: 1, title: 1 });
            const tasks = await TaskDetails.find({ userRef: data.slip.user._id }).sort({ priority: 1 });
            return {
                tasks: tasks.map((task) => [
                    task._id.toString(),
                    task.scheduledDate?.toISOString(),
                    task.slipForecast?.calculatedAt?.toISOString(),
                ].join(':')),
                events: events.map(
                    (event) => `${event._id}:${event.taskRef || ''}:${event.startDate.toISOString()}:${event.endDate.toISOString()}`
                ),
                fixedEvents: events.filter((event) => event.type === 'calendar').map((event) => ({
                    id: event._id.toString(),
                    date: event.startDate.toISOString().slice(0, 10),
                    start: event.startDate.toISOString().slice(11, 16),
                    end: event.endDate.toISOString().slice(11, 16),
                })),
                taskEvents: events.filter((event) => event.type.includes('task')).map((event) => ({
                    taskId: event.taskRef.toString(),
                    startDate: event.startDate.toISOString(),
                    endDate: event.endDate.toISOString(),
                    date: event.startDate.toISOString().slice(0, 10),
                    start: event.startDate.toISOString().slice(11, 16),
                    end: event.endDate.toISOString().slice(11, 16),
                })),
            };
        });
        const before = await snapshot();
        expect(before.taskEvents).toHaveLength(11);
        expect(before.tasks.filter((task) => !task.endsWith(':'))).toHaveLength(11);
        expect(before.fixedEvents).toEqual(capacityEvents.map((event, index) => ({
            id: event._id.toString(),
            date: addDateOnlyDays(capacityMonday, index),
            start: '09:00',
            end: '10:00',
        })));
        expect(before.taskEvents.map((event) => event.date)).toEqual([
            ...Array.from({ length: 5 }, (_, index) => {
                return [addDateOnlyDays(capacityMonday, index), addDateOnlyDays(capacityMonday, index)];
            }).flat(),
            recoveryFriday,
        ]);
        expect(before.taskEvents.slice(0, 10).map(({ start, end }) => `${start}-${end}`)).toEqual(
            Array.from({ length: 5 }, () => ['10:00-13:30', '13:30-17:00']).flat()
        );
        expect(before.taskEvents.at(-1)).toMatchObject({
            taskId: isolatedTask._id.toString(),
            date: recoveryFriday,
            start: '09:00',
            end: '10:00',
        });

        await chip.focus();
        await expect(chip).toBeFocused();
        await page.keyboard.press('Enter');
        const panel = page.locator('[data-test=slip-forecast-panel]');
        await expect(panel).toBeVisible();
        await expect(chip).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('button', { name: 'Close blocked-slot forecast' })).toBeVisible();
        await expect(panel).toContainText('“Friday launch 01” misses its planned slot');
        const summary = panel.locator('[data-test=slip-forecast-summary]');
        await expect(summary).toContainText('9 downstream tasks move later');
        await expect(summary).toContainText('1 newly misses its deadline');
        const impacts = panel.locator('[data-test^=slip-impact-]');
        await expect(impacts).toHaveCount(9);
        await expect(panel.locator(`[data-test="slip-impact-${firstTask._id}"]`)).toHaveCount(0);

        const nextDayOnTimeImpact = panel.locator(
            `[data-test="slip-impact-${capacityTasks[1]._id}"]`
        );
        await expect(nextDayOnTimeImpact).toHaveAttribute('data-baseline-date', capacityMonday);
        await expect(nextDayOnTimeImpact).toHaveAttribute(
            'data-forecast-date',
            addDateOnlyDays(capacityMonday, 1)
        );
        await expect(nextDayOnTimeImpact).not.toContainText('Late');

        const penultimateImpact = panel.locator(
            `[data-test="slip-impact-${capacityTasks.at(-2)._id}"]`
        );
        await expect(penultimateImpact).toHaveAttribute('data-baseline-date', capacityFriday);
        await expect(penultimateImpact).toHaveAttribute('data-forecast-date', capacityFriday);
        await expect(penultimateImpact).not.toContainText('Late');

        const finalImpact = panel.locator(`[data-test="slip-impact-${lastCapacityTask._id}"]`);
        await expect(finalImpact).toHaveAttribute('data-baseline-date', capacityFriday);
        await expect(finalImpact).toHaveAttribute('data-forecast-date', recoveryMonday);
        await expect(finalImpact).toContainText('Late');
        await expect(page.locator('.task-item', { hasText: lastCapacityTask.title })).toHaveClass(
            /forecast-newly-late-task/
        );
        const selectedTask = page.locator('.task-item', { hasText: firstTask.title });
        await expect(selectedTask).toHaveClass(/forecast-selected-task/);
        await expect(selectedTask).not.toHaveClass(/forecast-moved-task/);
        await expect(panel).not.toContainText(isolatedTask.title);
        await expect(page.locator('.task-item', { hasText: isolatedTask.title })).not.toHaveClass(
            /forecast-moved-task/
        );
        await testInfo.attach('blocked-slot-expanded-cascade', {
            body: await panel.screenshot(),
            contentType: 'image/png',
        });

        await withDb(() => TaskDetails.updateOne(
            { _id: lastCapacityTask._id },
            { $set: { 'slipForecast.movedCount': 1 } }
        ));
        await page.reload();
        await expect(lastCapacityChip).toHaveText('slot blocked → safe');

        await withDb(() => TaskDetails.updateOne(
            { _id: lastCapacityTask._id },
            { $set: { 'slipForecast.movedCount': 0 } }
        ));
        await page.reload();
        await expect(page.locator(`[data-test="slip-impact-chip-${firstTask._id}"]`)).toHaveText(
            'slot blocked → 1 late'
        );
        await expect(lastCapacityChip).toHaveCount(0);
        await expect(isolatedChip).toHaveCount(0);
        expect(await snapshot()).toEqual(before);

        const oracle = await withDb(async () => {
            const task = await TaskDetails.findById(firstTask._id);
            return {
                affected: task.slipForecast.affected.map((impact) => ({
                    taskId: impact.taskId.toString(),
                    baselineStart: impact.baselineStart.toISOString(),
                    baselineEnd: impact.baselineEnd.toISOString(),
                    forecastStart: impact.forecastStart?.toISOString() || null,
                    forecastEnd: impact.forecastEnd?.toISOString() || null,
                    newlyLate: impact.newlyLate,
                })),
                movedCount: task.slipForecast.movedCount,
                newlyLateCount: task.slipForecast.newlyLateCount,
            };
        });
        expect(oracle.movedCount).toBe(9);
        expect(oracle.newlyLateCount).toBe(1);
        expect(oracle.affected.map(({ taskId }) => taskId)).not.toContain(firstTask._id.toString());

        const baselinePlacements = placementSummaries(before.taskEvents);
        const selectedSlot = before.taskEvents.find(
            (event) => event.taskId === firstTask._id.toString()
        );
        const blockerResponse = await page.request.post('/api/createEvent', {
            data: {
                title: 'Unexpected blocked task slot',
                startDate: selectedSlot.startDate,
                endDate: selectedSlot.endDate,
            },
        });
        const blockerResult = await blockerResponse.json();
        expect(blockerResult.success).toBe(true);
        expect(new Date(blockerResult.event.startDate).toISOString()).toBe(selectedSlot.startDate);
        expect(new Date(blockerResult.event.endDate).toISOString()).toBe(selectedSlot.endDate);

        await Promise.all([
            page.waitForResponse((response) => response.url().includes('/api/scheduletasks')),
            page.getByRole('button', { name: 'Schedule tasks' }).click(),
        ]);
        const actual = await snapshot();
        const actualPlacements = placementSummaries(actual.taskEvents);
        const blockerStart = new Date(selectedSlot.startDate).getTime();
        const blockerEnd = new Date(selectedSlot.endDate).getTime();
        for (const event of actual.taskEvents) {
            const overlaps = new Date(event.startDate).getTime() < blockerEnd
                && new Date(event.endDate).getTime() > blockerStart;
            expect(overlaps, `${event.taskId} overlaps the blocked slot`).toBe(false);
        }

        const actualMovedIds = [...baselinePlacements.keys()]
            .filter((taskId) => taskId !== firstTask._id.toString())
            .filter((taskId) => {
                const baseline = baselinePlacements.get(taskId);
                const rescheduled = actualPlacements.get(taskId);
                return !rescheduled
                    || rescheduled.first !== baseline.first
                    || rescheduled.last !== baseline.last;
            })
            .sort();
        expect(actualMovedIds).toEqual(oracle.affected.map(({ taskId }) => taskId).sort());

        for (const impact of oracle.affected) {
            const rescheduled = actualPlacements.get(impact.taskId);
            expect(rescheduled?.first || null).toBe(impact.forecastStart);
            expect(rescheduled?.last || null).toBe(impact.forecastEnd);
        }

        const taskById = new Map(capacityTasks.map((task) => [task._id.toString(), task]));
        const actualNewlyLateIds = actualMovedIds.filter((taskId) => {
            const task = taskById.get(taskId);
            return task
                && !isLate(baselinePlacements.get(taskId), task.dueDate)
                && isLate(actualPlacements.get(taskId), task.dueDate);
        }).sort();
        const forecastNewlyLateIds = oracle.affected
            .filter((impact) => impact.newlyLate)
            .map((impact) => impact.taskId)
            .sort();
        expect(actualNewlyLateIds).toEqual(forecastNewlyLateIds);
        expect(actualNewlyLateIds).toEqual([lastCapacityTask._id.toString()]);

        const baselineSelected = baselinePlacements.get(firstTask._id.toString());
        const baselineSecond = baselinePlacements.get(capacityTasks[1]._id.toString());
        const actualSelected = actualPlacements.get(firstTask._id.toString());
        expect(actualSelected.first).not.toBe(baselineSelected.first);
        expect(actualSelected).toEqual(baselineSecond);
        expect(actual.fixedEvents).toContainEqual({
            id: blockerResult.event._id,
            date: capacityMonday,
            start: '10:00',
            end: '13:30',
        });
        expect(oracle.affected.map(({ taskId }) => taskId)).not.toContain(firstTask._id.toString());
    });

    test('counts only downstream tasks scheduled past their due dates as late', async ({
        seed,
        page,
    }, testInfo) => {
        const data = await seed();
        const {
            tasks,
            selectedTask,
            downstreamTasks,
            dates,
        } = data.slipBoundary;

        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.slipBoundary.username);
        await page.fill('input[name="password"]', data.slipBoundary.password);
        await page.click('button:has-text("Sign in")');
        await page.waitForURL(/#\/user\//);
        await page.setViewportSize({ width: 1440, height: 1600 });
        await page.clock.install({ time: new Date(`${dates.monday}T08:00:00.000Z`) });
        await page.goto('/#/calendar');
        await Promise.all([
            page.waitForResponse((response) => response.url().includes('/api/scheduletasks')),
            page.getByRole('button', { name: 'Schedule tasks' }).click(),
        ]);

        const snapshot = async () => withDb(async () => {
            const events = await EventDetails.find({
                userRef: data.slipBoundary.user._id,
                type: { $in: ['task', 'task-chunk'] },
            }).sort({ startDate: 1 });
            return events.map((event) => ({
                taskId: event.taskRef.toString(),
                startDate: event.startDate.toISOString(),
                endDate: event.endDate.toISOString(),
                date: dateOnlyInZone(event.startDate, 'UTC'),
                start: event.startDate.toISOString().slice(11, 16),
                end: event.endDate.toISOString().slice(11, 16),
            }));
        });

        const baselineEvents = await snapshot();
        expect(baselineEvents.map(({ taskId }) => taskId)).toEqual(
            tasks.map((task) => task._id.toString())
        );
        expect(baselineEvents.map(({ date }) => date)).toEqual([
            dates.monday,
            dates.monday,
            dates.tuesday,
            dates.tuesday,
            dates.tuesday,
            dates.tuesday,
        ]);
        expect(baselineEvents.map(({ start, end }) => `${start}-${end}`)).toEqual([
            '09:00-15:00',
            '15:00-17:00',
            '09:00-11:00',
            '11:00-13:00',
            '13:00-15:00',
            '15:00-17:00',
        ]);

        await expect(page.locator(`[data-test="task-item-${selectedTask._id}"]`)).toBeVisible();
        await testInfo.attach('due-boundary-baseline-calendar', {
            body: await page.locator('.calendar-page').screenshot(),
            contentType: 'image/png',
        });

        const chip = page.locator(`[data-test="slip-impact-chip-${selectedTask._id}"]`);
        await expect(chip).toBeVisible();
        await chip.click();
        const panel = page.locator('[data-test=slip-forecast-panel]');
        await expect(panel).toBeVisible();
        await testInfo.attach('due-boundary-blocked-slot-forecast', {
            body: await page.locator('.calendar-page').screenshot(),
            contentType: 'image/png',
        });

        const oracle = await withDb(async () => {
            const task = await TaskDetails.findById(selectedTask._id);
            return {
                affected: task.slipForecast.affected.map((impact) => ({
                    taskId: impact.taskId.toString(),
                    forecastStart: impact.forecastStart?.toISOString() || null,
                    forecastEnd: impact.forecastEnd?.toISOString() || null,
                    newlyLate: impact.newlyLate,
                    unscheduled: impact.unscheduled,
                })),
                movedCount: task.slipForecast.movedCount,
                newlyLateCount: task.slipForecast.newlyLateCount,
            };
        });
        const expectedMovedIds = downstreamTasks.slice(1).map((task) => task._id.toString());
        const expectedUnscheduledIds = downstreamTasks.slice(2).map((task) => task._id.toString());

        expect(oracle.movedCount).toBe(4);
        expect(oracle.newlyLateCount).toBe(0);
        expect(oracle.affected.map(({ taskId }) => taskId)).toEqual(expectedMovedIds);
        expect(
            oracle.affected.filter(({ unscheduled }) => unscheduled).map(({ taskId }) => taskId)
        ).toEqual(expectedUnscheduledIds);
        expect(oracle.affected.filter(({ newlyLate }) => newlyLate)).toEqual([]);
        await expect(chip).toHaveText('slot blocked → safe');
        await expect(panel.locator('[data-test=slip-forecast-summary]')).toContainText(
            '4 downstream tasks move later'
        );
        await expect(panel.locator('[data-test=slip-forecast-summary]')).toContainText(
            '0 newly miss deadlines'
        );

        const unscheduledRows = expectedUnscheduledIds.map(
            (taskId) => panel.locator(`[data-test="slip-impact-${taskId}"]`)
        );
        for (const row of unscheduledRows) {
            await expect(row).toHaveAttribute('data-forecast-date', 'unscheduled');
            await expect(row).toContainText('Unscheduled');
            await expect(row).not.toContainText('Late');
        }
        const placedImpact = panel.locator(
            `[data-test="slip-impact-${downstreamTasks[1]._id}"]`
        );
        await expect(placedImpact).toHaveAttribute('data-baseline-date', dates.tuesday);
        await expect(placedImpact).toHaveAttribute('data-forecast-date', dates.tuesday);
        await expect(placedImpact).not.toContainText('Late');

        const baselinePlacements = placementSummaries(baselineEvents);
        const selectedSlot = baselinePlacements.get(selectedTask._id.toString());
        const blockerResponse = await page.request.post('/api/createEvent', {
            data: {
                title: 'Blocked selected task slot',
                startDate: selectedSlot.first,
                endDate: selectedSlot.last,
            },
        });
        expect((await blockerResponse.json()).success).toBe(true);

        await Promise.all([
            page.waitForResponse((response) => response.url().includes('/api/scheduletasks')),
            page.getByRole('button', { name: 'Schedule tasks' }).click(),
        ]);
        const actualEvents = await snapshot();
        await expect(page.locator('.task-list')).toContainText('NEEDS TIME');
        await testInfo.attach('due-boundary-after-block-reschedule-calendar', {
            body: await page.locator('.calendar-page').screenshot(),
            contentType: 'image/png',
        });

        const actualPlacements = placementSummaries(actualEvents);
        const actualMovedIds = [...baselinePlacements.keys()]
            .filter((taskId) => taskId !== selectedTask._id.toString())
            .filter((taskId) => {
                const baseline = baselinePlacements.get(taskId);
                const actual = actualPlacements.get(taskId);
                return !actual || actual.first !== baseline.first || actual.last !== baseline.last;
            });
        expect(actualMovedIds).toEqual(expectedMovedIds);
        expect(actualMovedIds).toEqual(oracle.affected.map(({ taskId }) => taskId));

        for (const impact of oracle.affected) {
            const actual = actualPlacements.get(impact.taskId);
            expect(actual?.first || null).toBe(impact.forecastStart);
            expect(actual?.last || null).toBe(impact.forecastEnd);
        }
        expect(
            tasks.filter((task) => !actualPlacements.has(task._id.toString()))
                .map((task) => task._id.toString())
        ).toEqual(expectedUnscheduledIds);

        const actualNewlyLateIds = tasks
            .filter((task) => !isLate(baselinePlacements.get(task._id.toString()), task.dueDate)
                && isLate(actualPlacements.get(task._id.toString()), task.dueDate))
            .map((task) => task._id.toString());
        const forecastNewlyLateIds = oracle.affected
            .filter(({ newlyLate }) => newlyLate)
            .map(({ taskId }) => taskId);
        expect(actualNewlyLateIds).toEqual([]);
        expect(actualNewlyLateIds).toEqual(forecastNewlyLateIds);

        const actualSelected = actualPlacements.get(selectedTask._id.toString());
        expect(actualSelected.first).not.toBe(selectedSlot.first);
        expect(dateOnlyInZone(actualSelected.first, 'UTC')).toBe(dates.tuesday);
        expect(oracle.affected.map(({ taskId }) => taskId)).not.toContain(
            selectedTask._id.toString()
        );
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

    test('confirms deletion in the page rather than a browser dialog', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const title = data.named.proposal.title;

        // A native confirm() would hang the run instead of being answered in the DOM.
        page.on('dialog', () => { throw new Error('unexpected browser dialog'); });

        await page.goto('/#/calendar');
        await page.locator('.task-item', { hasText: title }).first().click();

        const editor = page.locator('[data-test=task-editor]');
        await editor.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.locator('[data-test=task-delete-confirm-button]').click();

        await expect(page.locator('.task-list')).not.toContainText(title);
    });

    test('offers every strong project recommendation without applying one', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await page.route('**/api/recommendTaskProject', async (route) => {
            const recommendations = [
                {
                    projectId: String(data.named.migrationProject._id),
                    confidence: 'high',
                    evidenceCount: 2,
                },
                {
                    projectId: String(data.named.hiringProject._id),
                    confidence: 'high',
                    evidenceCount: 2,
                },
            ];
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    recommendations,
                }),
            });
        });

        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Add new task' }).click();
        await page.fill('#task-title', 'Ask Priyanka about rehearsal');

        const suggestion = page.locator('[data-test=project-recommendation]');
        const options = suggestion.locator('[data-test=project-recommendation-option]');
        await expect(options).toHaveCount(2);
        await expect(options.first()).toContainText('Migration plan');
        await expect(options.nth(1)).toContainText('Hiring loop');
        await expect(page.locator('#task-project').locator('option:checked')).toHaveText(
            'Choose a project or Unassigned…'
        );

        // Any offered project can be taken, not just the top one.
        await options.nth(1).click();
        await expect(page.locator('#task-project')).toHaveValue(String(data.named.hiringProject._id));
        await expect(suggestion).toHaveCount(0);
    });

    test('offers a single recommendation when only one project is strong', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await page.route('**/api/recommendTaskProject', async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    recommendations: [{
                        projectId: String(data.named.migrationProject._id),
                        confidence: 'high',
                        evidenceCount: 2,
                    }],
                }),
            });
        });

        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Add new task' }).click();
        await page.fill('#task-title', 'Ask Priyanka about rehearsal');

        const options = page.locator(
            '[data-test=project-recommendation] [data-test=project-recommendation-option]'
        );
        await expect(options).toHaveCount(1);
        await expect(options.first()).toContainText('Migration plan');
        await expect(page.locator('#task-project').locator('option:checked')).toHaveText(
            'Choose a project or Unassigned…'
        );

        await options.first().click();
        await expect(page.locator('#task-project')).toHaveValue(
            String(data.named.migrationProject._id)
        );
    });

    test('keeps a very long recommendation inside the editor', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const longName = 'Extraordinarily long name that would overflow the modal if left unwrapped';
        await withDb(async () => {
            const project = await ProjectDetails.findById(data.named.migrationProject._id);
            const goal = await GoalDetails.findById(project.goalRef);
            await RoleDetails.updateOne({ _id: goal.roleRef }, { title: `Role ${longName}` });
            await GoalDetails.updateOne({ _id: goal._id }, { title: `Goal ${longName}` });
            await ProjectDetails.updateOne({ _id: project._id }, { title: `Project ${longName}` });
        });

        await page.route('**/api/recommendTaskProject', async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    recommendations: [{
                        projectId: String(data.named.migrationProject._id),
                        confidence: 'high',
                        evidenceCount: 2,
                    }],
                }),
            });
        });

        await page.goto('/#/calendar');
        await page.getByRole('button', { name: 'Add new task' }).click();
        await page.fill('#task-title', 'Ask Priyanka about rehearsal');

        const option = page.locator('[data-test=project-recommendation-option]').first();
        await expect(option).toBeVisible();

        // The suggestion must wrap inside the form rather than spilling past the project select.
        const optionBox = await option.boundingBox();
        const formBox = await page.locator('#task-project').boundingBox();
        expect(optionBox.x).toBeGreaterThanOrEqual(formBox.x - 1);
        expect(optionBox.x + optionBox.width).toBeLessThanOrEqual(formBox.x + formBox.width + 1);
        expect(optionBox.height).toBeGreaterThan(24);
    });

    test('completes a task and creates its follow-up in the same project', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const source = await withDb(() => TaskDetails.create({
            title: 'Source task awaiting follow up',
            duration: 30,
            startDate: parseDateOnly('2030-01-01').date,
            dueDate: parseDateOnly('2030-01-02').date,
            completed: false,
            isBacklog: false,
            userRef: data.primary.user._id,
            projectRef: data.named.migrationProject._id,
        }));

        await page.goto('/#/calendar');
        await page.locator('.task-item', { hasText: 'Source task awaiting follow up' })
            .first()
            .click();
        await page.getByRole('button', { name: 'Follow up', exact: true }).click();

        // A derived follow-up inherits its project, so it offers no project choice.
        const panel = page.locator('[data-test=follow-up-panel]');
        await expect(panel).toBeVisible();
        await expect(page.locator('[data-test=project-recommendation]')).toHaveCount(0);

        await page.fill('#task-follow-up-days', '3');
        await page.getByRole('button', { name: 'Create follow up' }).click();
        await expect(page.locator('.task-editor')).toHaveCount(0);

        const followUp = await withDb(() => TaskDetails.findOne({
            userRef: data.primary.user._id,
            title: 'Source task awaiting follow up',
            _id: { $ne: source._id },
        }));
        expect(String(followUp.projectRef)).toBe(String(data.named.migrationProject._id));

        const completed = await withDb(() => TaskDetails.findById(source._id));
        expect(completed.completed).toBe(true);
    });

    test('keeps one-off and unscheduled tasks visible without expanding the recurring window', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await seed.clearTasks();
        const today = todayInZone('UTC');
        const later = addDateOnlyDays(today, 22);
        await page.clock.install({ time: new Date(`${today}T12:00:00.000Z`) });

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
                    title: 'Scheduled recurring occurrence',
                    duration: 30,
                    startDate: parseDateOnly(today).date,
                    dueDate: parseDateOnly(today).date,
                    scheduledDate: zonedDateTime(today, 11 * 60, 'UTC'),
                    completed: false,
                    isBacklog: false,
                    seriesRef: series._id,
                    occurrenceDate: parseDateOnly(today).date,
                    userRef: data.primary.user._id,
                },
                {
                    title: 'Unscheduled recurring occurrence',
                    duration: 30,
                    startDate: parseDateOnly(today).date,
                    dueDate: parseDateOnly(today).date,
                    scheduledDate: null,
                    completed: false,
                    isBacklog: false,
                    seriesRef: series._id,
                    occurrenceDate: parseDateOnly(addDateOnlyDays(today, 1)).date,
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
        await expect(page.locator('.task-item', { hasText: 'Scheduled recurring occurrence' })).toBeVisible();
        await expect(page.locator('.task-item', { hasText: 'Unscheduled recurring occurrence' })).toHaveCount(0);
        await expect(page.locator('.task-item', { hasText: 'Later recurring occurrence' })).toHaveCount(0);
        await expect(page.locator('.task-date-header').first()).toHaveText('Unscheduled');
        const unscheduled = page.locator('.task-item', { hasText: 'Task that needs time' });
        await expect(unscheduled).toBeVisible();
        await expect(unscheduled.locator('.unscheduled-badge')).toHaveText('NEEDS TIME');
        await expect(unscheduled.locator('.slip-impact-row')).toHaveCount(0);
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
        await expect(recurringTask).toHaveCount(0);

        await page.getByRole('button', { name: 'Schedule tasks' }).click();
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
