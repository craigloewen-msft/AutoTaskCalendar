const { test, expect, withDb, baseURL } = require('../fixtures');
const { TaskDetails } = require('../../models');
const { mondayWeekBounds, parseDateOnly, todayInZone } = require('../../utils/temporal');

function currentWeek(timeZone = 'UTC') {
    return mondayWeekBounds(todayInZone(timeZone), timeZone);
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
    test('reviews the Compass hierarchy in a Monday–Sunday week', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const week = currentWeek();

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

        await openPlan(page);

        await expect(page.getByRole('link', { name: 'Weekly Plan' })).toBeVisible();
        const range = page.locator('[data-test=week-range]');
        await expect(range).toHaveAttribute('data-week-start', week.startDate);
        await expect(range).toHaveAttribute('data-week-end', week.endDate);

        const engineer = page.locator('.role-card', { hasText: 'Engineer' });
        await expect(engineer).toContainText('Build and ship good software');
        await expect(engineer).toContainText('Ship v2 by June');

        const experiment = page.locator(`[data-project-id="${data.named.emptyProject._id}"]`);
        await expect(experiment).toContainText('Current weekly experiment');
        await expect(experiment.locator('.project-total')).toContainText('1 task · 1h 15m');
        await expect(page.locator('[data-test=weekly-overview]')).toContainText('due this week');

        const laterTask = experiment.locator('.other-tasks .task-row', {
            hasText: 'Later experiment work',
        });
        await expect(laterTask).toBeHidden();
        await experiment.locator('.other-tasks summary').click();
        await expect(laterTask).toBeVisible();
    });

    test('opens and edits a task without leaving Weekly Plan', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const week = currentWeek();
        const task = await createTask(data, {
            title: 'Edit this weekly task',
            duration: 40,
            startDate: week.startDate,
            dueDate: week.endDate,
            projectRef: data.named.emptyProject._id,
        });

        await openPlan(page);
        const project = page.locator(`[data-project-id="${data.named.emptyProject._id}"]`);
        await project.getByRole('button', { name: /Edit this weekly task/ }).click();

        const editor = page.locator('[data-test=task-editor]');
        await expect(editor).toBeVisible();
        await expect(editor.locator('#task-title')).toHaveValue('Edit this weekly task');
        await expect(editor.locator('#task-duration')).toHaveValue('40');

        await editor.locator('#task-title').fill('Edited from Weekly Plan');
        await editor.locator('#task-duration').fill('55');
        await editor.locator('#task-due-date').fill(week.nextStartDate);
        await editor.getByRole('button', { name: 'Save changes' }).click();

        await expect(editor).toHaveCount(0);
        await expect(project.locator('[data-test^="week-tasks-"]')).toHaveCount(0);
        await project.locator('.other-tasks summary').click();
        await expect(project.getByRole('button', { name: /Edited from Weekly Plan/ })).toBeVisible();

        const saved = await withDb(() => TaskDetails.findById(task._id));
        expect(saved.title).toBe('Edited from Weekly Plan');
        expect(saved.duration).toBe(55);
        expect(saved.dueDate.toISOString().slice(0, 10)).toBe(week.nextStartDate);
    });

    test('completes a task from its Weekly Plan editor', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const week = currentWeek();
        const task = await createTask(data, {
            title: 'Complete from Weekly Plan',
            startDate: week.startDate,
            dueDate: week.endDate,
            projectRef: data.named.emptyProject._id,
        });

        await openPlan(page);
        await page.getByRole('button', { name: /Complete from Weekly Plan/ }).click();
        const editor = page.locator('[data-test=task-editor]');
        await editor.getByRole('button', { name: 'Complete', exact: true }).click();

        await expect(editor).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Complete from Weekly Plan/ })).toHaveCount(0);
        const saved = await withDb(() => TaskDetails.findById(task._id));
        expect(saved.completed).toBe(true);
    });

    test('quick-adds an ordinary project task due this week', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const week = currentWeek();
        await openPlan(page);

        const projectId = String(data.named.migrationProject._id);
        const form = page.locator(`[data-test="quick-task-${projectId}"]`);
        await expect(form.locator('input[type=date]')).toHaveValue(week.endDate);
        await expect(form.locator('input[type=date]')).toHaveAttribute('min', week.startDate);
        await expect(form.locator('input[type=date]')).toHaveAttribute('max', week.endDate);

        await form.locator('input[type=text]').fill('Plan migration rehearsal');
        await form.locator('input[type=number]').fill('35');
        await form.locator('input[type=date]').fill(week.startDate);
        await form.getByRole('button', { name: 'Add task' }).click();

        await expect(page.locator(`[data-test="quick-status-${projectId}"]`)).toContainText(
            'Task added to this week'
        );
        await expect(form.locator('input[type=text]')).toHaveValue('');
        await expect(page.locator(`[data-test="week-tasks-${projectId}"]`)).toContainText(
            'Plan migration rehearsal'
        );

        const saved = await withDb(() => TaskDetails.findOne({ title: 'Plan migration rehearsal' }));
        expect(String(saved.projectRef)).toBe(projectId);
        expect(saved.startDate.toISOString().slice(0, 10)).toBe(todayInZone('UTC'));
        expect(saved.dueDate.toISOString().slice(0, 10)).toBe(week.startDate);
        expect(saved.isBacklog).toBe(false);
    });

    test('keeps a quick-task draft when the API rejects it', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        await openPlan(page);
        const projectId = String(data.named.perfProject._id);
        const form = page.locator(`[data-test="quick-task-${projectId}"]`);

        await page.route('**/api/createTask', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, log: 'Deliberate validation failure' }),
        }));
        await form.locator('input[type=text]').fill('Keep this draft');
        await form.locator('input[type=number]').fill('20');
        await form.getByRole('button', { name: 'Add task' }).click();

        await expect(page.locator(`[data-test="quick-status-${projectId}"]`)).toContainText(
            'Deliberate validation failure'
        );
        await expect(form.locator('input[type=text]')).toHaveValue('Keep this draft');
        await expect(form.locator('input[type=number]')).toHaveValue('20');
    });

    test('keeps parked projects separate and optionally aligns unaligned work', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = await seed();
        const week = currentWeek();
        const unaligned = await createTask(data, {
            title: 'Unaligned weekly decision',
            startDate: week.startDate,
            dueDate: week.endDate,
            projectRef: null,
        });
        await createTask(data, {
            title: 'Parked project weekly task',
            startDate: week.startDate,
            dueDate: week.endDate,
            projectRef: data.named.somedayProject._id,
        });

        await openPlan(page);

        const someday = page.locator('[data-test=someday-projects]');
        await someday.locator('summary').click();
        await expect(someday).toContainText('Rewrite the CLI');
        await expect(someday).toContainText('Parked project weekly task');
        await expect(page.locator(`[data-project-id="${data.named.somedayProject._id}"]`)).toHaveCount(0);

        const unalignedSection = page.locator('[data-test=unaligned-tasks]');
        await unalignedSection.locator('summary').click();
        const row = unalignedSection.locator('.unaligned-row', { hasText: 'Unaligned weekly decision' });
        await row.locator('select').selectOption(String(data.named.hiringProject._id));
        await row.getByRole('button', { name: 'Assign' }).click();

        await expect(row).toHaveCount(0);
        const saved = await withDb(() => TaskDetails.findById(unaligned._id));
        expect(String(saved.projectRef)).toBe(String(data.named.hiringProject._id));
    });

    test('uses the saved timezone and stays usable on a narrow screen', async ({
        seed,
        browser,
    }) => {
        const data = await seed();
        const week = currentWeek('UTC');
        const context = await browser.newContext({
            baseURL,
            timezoneId: 'America/Los_Angeles',
            viewport: { width: 375, height: 780 },
        });
        const page = await context.newPage();
        await page.goto('/#/login');
        await page.fill('input[name="username"]', 'testuser');
        await page.fill('input[name="password"]', 'testpassword');
        await page.click('button:has-text("Sign in")');
        await page.waitForFunction(() => !!localStorage.getItem('token'));
        await openPlan(page);

        await expect(page.locator('[data-test=week-range]')).toHaveAttribute(
            'data-week-start',
            week.startDate
        );
        const projectId = String(data.named.migrationProject._id);
        const form = page.locator(`[data-test="quick-task-${projectId}"]`);
        await form.scrollIntoViewIfNeeded();
        await expect(form.locator('input[type=text]')).toBeVisible();
        await expect(form.getByRole('button', { name: 'Add task' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await context.close();
    });
});
