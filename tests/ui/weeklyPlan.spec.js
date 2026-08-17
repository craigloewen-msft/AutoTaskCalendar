const { test, expect, withDb, baseURL } = require('../fixtures');
const { TaskDetails } = require('../../models');
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
    return `${start} – ${end}`;
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

        const engineer = page.locator('.role-card', { hasText: 'Engineer' });
        await expect(engineer).toContainText('Build and ship good software');
        await expect(engineer).toContainText('Ship v2 by June');

        const experiment = page.locator(`[data-project-id="${data.named.emptyProject._id}"]`);
        await expect(experiment).toContainText('Current weekly experiment');
        await expect(experiment.locator('.project-total')).toContainText('1 task · 1h 15m');
        const laterTask = experiment.locator('.other-tasks .task-row', {
            hasText: 'Later experiment work',
        });
        await expect(laterTask).toBeHidden();
        await experiment.locator('.other-tasks summary').click();
        await expect(laterTask).toBeVisible();

        const projectId = String(data.named.emptyProject._id);
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
        const week = currentWeek();
        const friday = addDateOnlyDays(week.startDate, 4);

        await openPlan(page);

        const projectId = String(data.named.migrationProject._id);
        const form = page.locator(`[data-test="quick-task-${projectId}"]`);
        await expect(form.locator('input[type=date]')).toHaveValue(friday);
        await form.locator('input[type=text]').fill('Plan migration rehearsal');
        await form.locator('input[type=number]').fill('35');
        await form.locator('input[type=date]').fill(week.startDate);
        await form.getByRole('button', { name: 'Add task' }).click();

        await expect(page.locator(`[data-test="quick-status-${projectId}"]`)).toContainText(
            'Task added to this week'
        );
        await expect(form.locator('input[type=date]')).toHaveValue(friday);
        const project = page.locator(`[data-project-id="${data.named.migrationProject._id}"]`);
        await expect(project.locator(`[data-test="week-tasks-${projectId}"]`)).toContainText(
            'Plan migration rehearsal'
        );

        await project.getByRole('button', { name: /Plan migration rehearsal/ }).click();
        const editor = page.locator('[data-test=task-editor]');
        await expect(editor).toBeVisible();
        await editor.locator('#task-title').fill('Edited from Weekly Plan');
        await editor.locator('#task-duration').fill('55');
        await editor.locator('#task-due-date').fill(week.nextStartDate);
        await editor.getByRole('button', { name: 'Save changes' }).click();

        await expect(editor).toHaveCount(0);
        await expect(project.getByRole('button', { name: /Edited from Weekly Plan/ })).toHaveCount(0);
        await project.locator('.other-tasks summary').click();
        await expect(project.getByRole('button', { name: /Edited from Weekly Plan/ })).toBeVisible();

        const saved = await withDb(() => TaskDetails.findOne({
            title: 'Edited from Weekly Plan',
            userRef: data.primary.user._id,
        }));
        expect(saved.duration).toBe(55);
        expect(saved.dueDate.toISOString().slice(0, 10)).toBe(week.nextStartDate);
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
        await page.waitForFunction(() => !!localStorage.getItem('token'));
        await page.clock.install({ time: fixedNow });
        await openPlan(page);

        await expect(page.locator('[data-test=week-range]')).toHaveAttribute('data-week-start', week.startDate);
        const mobileProjectId = String(data.named.migrationProject._id);
        const form = page.locator(`[data-test="quick-task-${mobileProjectId}"]`);
        await form.scrollIntoViewIfNeeded();
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
});
