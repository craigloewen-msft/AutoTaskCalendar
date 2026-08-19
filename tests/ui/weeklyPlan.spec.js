const { test, expect, withDb, baseURL } = require('../fixtures');
const { TaskDetails, WeeklyPlanDetails } = require('../../models');
const { addDateOnlyDays, mondayWeekBounds, parseDateOnly, todayInZone } = require('../../utils/temporal');

function currentWeek(timeZone = 'UTC') {
    return mondayWeekBounds(todayInZone(timeZone), timeZone);
}

function previousWeek(timeZone = 'UTC') {
    const week = currentWeek(timeZone);
    return {
        startDate: addDateOnlyDays(week.startDate, -7),
        endDate: addDateOnlyDays(week.startDate, -1),
    };
}

function formatCivil(value, options) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', options).format(new Date(year, month - 1, day));
}

function previousRangeLabel(week) {
    const start = formatCivil(week.startDate, { month: 'short', day: 'numeric' });
    const end = formatCivil(week.endDate, { month: 'short', day: 'numeric' });
    return `${start} \u2013 ${end}`;
}

async function createTask(data, overrides) {
    return withDb(() => TaskDetails.create({
        title: 'Weekly plan task',
        duration: 45,
        startDate: parseDateOnly(overrides.startDate).date,
        dueDate: overrides.dueDate ? parseDateOnly(overrides.dueDate).date : null,
        completed: false,
        isBacklog: false,
        priority: 100,
        userRef: data.primary.user._id,
        projectRef: overrides.projectRef ?? data.named.migrationProject._id,
        ...overrides,
    }));
}

// The seeded account ships a committed week. Most specs want to drive the commit themselves.
async function clearPlans(data) {
    await withDb(() => WeeklyPlanDetails.deleteMany({ userRef: data.primary.user._id }));
}

async function openPlan(page) {
    await page.goto('/#/weekly-plan');
    await expect(page.locator('[data-test=weekly-hierarchy]')).toBeVisible();
}

test.describe('weekly plan page', () => {
    test('reviews the weekly hierarchy and last-week completions', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const lastWeek = previousWeek();
        const current = currentWeek();

        await createTask(data, {
            title: 'Current weekly experiment',
            duration: 75,
            startDate: week.startDate,
            dueDate: week.endDate,
            projectRef: data.named.emptyProject._id,
        });
        await createTask(data, {
            title: 'Later experiment work',
            startDate: week.startDate,
            dueDate: week.nextStartDate,
            projectRef: data.named.emptyProject._id,
        });
        const older = await createTask(data, {
            title: 'Document completed context',
            dueDate: current.endDate,
            completed: true,
            completedDate: new Date(`${lastWeek.startDate}T12:00:00.000Z`),
            projectRef: data.named.emptyProject._id,
        });
        const newer = await createTask(data, {
            title: 'Validate completed context',
            dueDate: current.endDate,
            completed: true,
            completedDate: new Date(`${lastWeek.endDate}T18:00:00.000Z`),
            seriesRef: data.named.weekdaysSeries._id,
            projectRef: data.named.emptyProject._id,
        });

        await openPlan(page);

        const range = page.locator('[data-test=week-range]');
        await expect(range).toHaveAttribute('data-week-start', week.startDate);
        await expect(range).toHaveAttribute('data-week-end', week.endDate);

        const engineer = page.locator('[data-test=role-section]', { hasText: 'Engineer' });
        await expect(engineer).toContainText('Build and ship good software');
        await expect(engineer).toContainText('Ship v2 by June');

        const projectId = String(data.named.emptyProject._id);
        const experiment = page.locator(`[data-project-id="${projectId}"]`);
        await expect(experiment).toContainText('Current weekly experiment');
        await expect(page.locator(`[data-test="project-total-${projectId}"]`)).toContainText(
            '1 task \u00b7 1h 15m'
        );
        const laterTask = experiment.locator(`[data-test="other-tasks-${projectId}"] .task-row`, {
            hasText: 'Later experiment work',
        });
        await expect(laterTask).toBeHidden();
        await experiment.locator(`[data-test="other-tasks-${projectId}"] summary`).click();
        await expect(laterTask).toBeVisible();

        const history = page.locator(`[data-test="completed-last-week-${projectId}"]`);
        await expect(history).toBeVisible();
        await expect(history).toHaveAttribute('data-completed-from', lastWeek.startDate);
        await expect(history).toHaveAttribute('data-completed-to', lastWeek.endDate);
        await expect(history.locator('summary')).toContainText('2 tasks completed last week');
        await expect(history.locator('summary')).toContainText(previousRangeLabel(lastWeek));
        await history.locator('summary').click();
        const rows = history.locator('[data-test^="completed-last-week-row-"]');
        await expect(rows).toHaveCount(2);
        expect(await rows.locator('strong').allTextContents()).toEqual([
            'Validate completed context',
            'Document completed context',
        ]);
        const completedOn = formatCivil(lastWeek.endDate, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
        await expect(history.locator(`[data-test="completed-last-week-row-${newer._id}"]`)).toContainText(
            `Completed ${completedOn}`
        );
        await expect(history.locator(`[data-test="completed-last-week-row-${newer._id}"] .task-marker`)).toBeVisible();
        await expect(history.locator(`[data-test="completed-last-week-row-${older._id}"]`)).toBeVisible();
    });

    test('quick-adds and edits a task without leaving Weekly Plan', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const friday = addDateOnlyDays(week.startDate, 4);

        await openPlan(page);

        const projectId = String(data.named.migrationProject._id);
        const form = page.locator(`[data-test="quick-task-${projectId}"]`);

        // Quick add is collapsed until asked for, then defaults to Friday.
        await expect(form.locator('input[type=text]')).toHaveCount(0);
        await form.locator(`[data-test="quick-add-open-${projectId}"]`).click();
        await expect(form.locator('input[type=date]')).toHaveValue(friday);

        await form.locator('input[type=text]').fill('Plan migration rehearsal');
        await form.locator('input[type=number]').fill('35');
        // Choosing a day chip drives the same civil date the native control holds.
        await form.locator('.day-chip', { hasText: 'Mon' }).first().click();
        await expect(form.locator('input[type=date]')).toHaveValue(week.startDate);
        await form.getByRole('button', { name: 'Add task' }).click();

        await expect(page.locator(`[data-test="quick-status-${projectId}"]`)).toContainText(
            'Task added to this week'
        );
        const project = page.locator(`[data-project-id="${projectId}"]`);
        await expect(project.locator(`[data-test="week-tasks-${projectId}"]`)).toContainText(
            'Plan migration rehearsal'
        );

        // The form resets to Friday for the next task.
        await form.locator(`[data-test="quick-add-open-${projectId}"]`).click();
        await expect(form.locator('input[type=date]')).toHaveValue(friday);

        await project.getByRole('button', { name: /Plan migration rehearsal/ }).click();
        const editor = page.locator('[data-test=task-editor]');
        await expect(editor).toBeVisible();
        await editor.locator('#task-title').fill('Edited from Weekly Plan');
        await editor.locator('#task-duration').fill('55');
        await editor.locator('#task-due-date').fill(week.nextStartDate);
        await editor.getByRole('button', { name: 'Save changes' }).click();

        await expect(editor).toHaveCount(0);
        await expect(project.getByRole('button', { name: /Edited from Weekly Plan/ })).toHaveCount(0);
        await project.locator(`[data-test="other-tasks-${projectId}"] summary`).click();
        await expect(project.getByRole('button', { name: /Edited from Weekly Plan/ })).toBeVisible();

        const saved = await withDb(() => TaskDetails.findOne({
            title: 'Edited from Weekly Plan',
            userRef: data.primary.user._id,
        }));
        expect(saved.duration).toBe(55);
        expect(saved.dueDate.toISOString().slice(0, 10)).toBe(week.nextStartDate);
    });

    test('commits the week and then reviews progress against it', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const projectId = String(data.named.migrationProject._id);

        const keep = await createTask(data, {
            title: 'Committed and open',
            startDate: week.startDate,
            dueDate: week.endDate,
        });
        const finish = await createTask(data, {
            title: 'Committed and finished',
            startDate: week.startDate,
            dueDate: week.endDate,
        });
        const drop = await createTask(data, {
            title: 'Deliberately excluded',
            startDate: week.startDate,
            dueDate: week.endDate,
        });

        await openPlan(page);

        // The button says what committing does before it is pressed.
        await expect(page.locator('[data-test=commit-note]')).toContainText('not un-promise');

        // Unchecking excludes work from the commitment without changing the task.
        await page.locator(`[data-test="select-task-${drop._id}"] input`).uncheck();
        await page.locator('[data-test=commit-week]').click();

        const commitment = page.locator(`[data-test="commitment-${projectId}"]`);
        await expect(commitment).toBeVisible();
        await expect(page.locator('[data-test=commit-week]')).toContainText('Update commitment');
        await expect(commitment.locator(`[data-test="commitment-item-${keep._id}"]`)).toHaveAttribute(
            'data-status',
            'open'
        );
        await expect(
            commitment.locator(`[data-test="commitment-item-${drop._id}"]`)
        ).toHaveCount(0);

        const stored = await withDb(() => WeeklyPlanDetails.findOne({
            userRef: data.primary.user._id,
            weekStart: parseDateOnly(week.startDate).date,
        }));
        // The commitment covers the whole week, but the unchecked task is not in it.
        const storedIds = stored.items.map((item) => String(item.taskRef));
        expect(storedIds).toContain(String(keep._id));
        expect(storedIds).toContain(String(finish._id));
        expect(storedIds).not.toContain(String(drop._id));

        // Completing committed work updates the review immediately.
        await commitment.getByRole('button', { name: /Committed and finished/ }).click();
        const editor = page.locator('[data-test=task-editor]');
        await editor.getByRole('button', { name: 'Complete' }).click();
        await expect(editor).toHaveCount(0);
        await expect(
            commitment.locator(`[data-test="commitment-item-${finish._id}"]`)
        ).toHaveAttribute('data-status', 'done');

        // Moving committed work out of the week is reported, not silently forgotten.
        await commitment.getByRole('button', { name: /Committed and open/ }).click();
        await editor.locator('#task-due-date').fill(addDateOnlyDays(week.endDate, 14));
        await editor.getByRole('button', { name: 'Save changes' }).click();
        await expect(editor).toHaveCount(0);
        await expect(
            commitment.locator(`[data-test="commitment-item-${keep._id}"]`)
        ).toHaveAttribute('data-status', 'moved');

        // A moved task is reported once, not also as anonymous "other active" work.
        await expect(
            page.locator(`[data-test="other-tasks-${projectId}"] .task-row`, {
                hasText: keep.title,
            })
        ).toHaveCount(0);
    });

    test('folds work added after the commitment into it', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const projectId = String(data.named.migrationProject._id);

        await createTask(data, {
            title: 'Originally committed',
            startDate: week.startDate,
            dueDate: week.endDate,
        });

        await openPlan(page);
        await page.locator('[data-test=commit-week]').click();
        const commitment = page.locator(`[data-test="commitment-${projectId}"]`);
        await expect(commitment).toBeVisible();

        // Adding a task after committing is normal, and lands in its own section.
        const form = page.locator(`[data-test="quick-task-${projectId}"]`);
        await form.locator(`[data-test="quick-add-open-${projectId}"]`).click();
        await form.locator('input[type=text]').fill('Thought of later');
        await form.getByRole('button', { name: 'Add task' }).click();
        await expect(page.locator(`[data-test="quick-status-${projectId}"]`)).toContainText(
            'Task added since commit'
        );

        const added = commitment.locator('[data-test^="added-item-"]', {
            hasText: 'Thought of later',
        });
        await expect(added).toBeVisible();

        await commitment.locator(`[data-test="fold-in-${projectId}"]`).click();
        await expect(commitment.locator('[data-test^="added-item-"]')).toHaveCount(0);
        await expect(
            commitment.locator('[data-test^="commitment-item-"]', { hasText: 'Thought of later' })
        ).toBeVisible();

        const stored = await withDb(() => WeeklyPlanDetails.findOne({
            userRef: data.primary.user._id,
            weekStart: parseDateOnly(week.startDate).date,
        }));
        expect(stored.items.map((item) => item.title)).toContain('Thought of later');
        // Amending keeps the one week, rather than starting a second one.
        expect(stored.amendedAt).toBeTruthy();
        const plans = await withDb(() => WeeklyPlanDetails.find({
            userRef: data.primary.user._id,
            weekStart: parseDateOnly(week.startDate).date,
        }));
        expect(plans).toHaveLength(1);
    });

    test('recaps the previous week from its stored commitment', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();

        await openPlan(page);

        // The seed commits last week with one finished task and one that was deleted.
        const recap = page.locator('[data-test=previous-week-recap]');
        await expect(recap).toBeVisible();
        await expect(recap.locator('summary')).toContainText('committed 2');
        await expect(recap.locator('summary')).toContainText('finished 1');
        await expect(recap.locator('summary')).toContainText('1 slipped');

        await recap.locator('summary').click();
        await expect(recap.getByText('Draft the migration plan')).toBeVisible();
        // A deleted task still appears: the snapshot is the record it was promised.
        const dropped = recap.locator('.recap-row', { hasText: 'Spike the rollback tooling' });
        await expect(dropped).toHaveAttribute('data-status', 'removed');
    });

    test('uses the saved timezone and stays usable on a narrow screen', async ({ seed, browser }) => {
        const data = await seed();
        const fixedNow = new Date('2026-08-17T01:00:00.000Z');
        const week = mondayWeekBounds('2026-08-17', 'UTC');
        const lastWeek = {
            startDate: addDateOnlyDays(week.startDate, -7),
            endDate: addDateOnlyDays(week.startDate, -1),
        };
        await createTask(data, {
            title: 'Mobile completion context',
            completed: true,
            completedDate: new Date(`${lastWeek.endDate}T01:00:00.000Z`),
            projectRef: data.named.emptyProject._id,
        });
        const context = await browser.newContext({
            baseURL,
            timezoneId: 'America/Los_Angeles',
            viewport: { width: 375, height: 780 },
        });
        const page = await context.newPage();
        await page.goto('/#/login');
        await page.fill('input[name="username"]', data.primary.username);
        await page.fill('input[name="password"]', data.primary.password);
        await page.click('button:has-text("Sign in")');
        await page.waitForURL(/#\/user\//);
        await page.clock.install({ time: fixedNow });
        await openPlan(page);

        await expect(page.locator('[data-test=week-range]')).toHaveAttribute('data-week-start', week.startDate);
        const mobileProjectId = String(data.named.migrationProject._id);
        const form = page.locator(`[data-test="quick-task-${mobileProjectId}"]`);
        await form.scrollIntoViewIfNeeded();
        await form.locator(`[data-test="quick-add-open-${mobileProjectId}"]`).click();
        await expect(form.locator('input[type=text]')).toBeVisible();
        await expect(form.getByRole('button', { name: 'Add task' })).toBeVisible();
        const history = page.locator(`[data-test="completed-last-week-${data.named.emptyProject._id}"]`);
        await history.scrollIntoViewIfNeeded();
        await history.locator('summary').click();
        await expect(history.getByText('Mobile completion context')).toBeVisible();
        await expect(history).toContainText('Completed Sun, Aug 16');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await context.close();
    });

    test('keeps the hierarchy usable when the commitment cannot be read', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await page.route('**/api/getWeeklyPlans*', (route) => route.abort());
        await openPlan(page);

        // A failed read must not present a committed week as uncommitted.
        await expect(page.locator('[data-test=weekly-plans-error]')).toBeVisible();
        await expect(page.locator('[data-test=weekly-hierarchy]')).toBeVisible();
        await expect(page.locator('[data-test=weekly-hierarchy]')).toContainText('Migration plan');
    });
});
