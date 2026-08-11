const { test, expect } = require('../fixtures');

test.describe('compass page', () => {
    test('lists roles with their goals and projects nested beneath them', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await page.goto('/#/compass');

        // Role, then a goal inside it, then a project inside that goal.
        const engineer = page.locator('.role-block', { hasText: 'Engineer' });
        await expect(engineer.locator('.role-title')).toHaveText('Engineer');

        const shipV2 = engineer.locator('.goal-block', { hasText: 'Ship v2 by June' });
        await expect(shipV2.locator('.goal-title')).toHaveText('Ship v2 by June');
        await expect(shipV2.locator('.project-title', { hasText: 'Migration plan' })).toBeVisible();
    });

    test('parks projects with no start date under Someday', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/compass');

        const someday = page.locator('details', { hasText: 'Someday' });
        await expect(someday).toContainText('Rewrite the CLI');
    });

    test('hides ended items until the archive drawer is opened', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await page.goto('/#/compass');
        await expect(page.locator('.role-title').first()).toBeVisible();

        // The ended role is summarised, not rendered, until the drawer asks for it.
        await expect(page.locator('.role-title', { hasText: 'Volunteer board member' })).toHaveCount(0);

        const archive = page.locator('details', { hasText: 'Archive' });
        await expect(archive).toContainText('1 ended roles');

        await archive.locator('summary').click();
        await expect(archive.locator('.project-title', { hasText: 'Volunteer board member' })).toBeVisible();
    });

    test('will not let a role or goal be ended while it still has live children', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await page.goto('/#/compass');

        // Engineer has live goals beneath it.
        const engineer = page.locator('.role-block', { hasText: 'Engineer' });
        await engineer.locator('.role-row .link-btn').click();

        await expect(page.locator('.drawer-title')).toHaveText('Edit role');
        await expect(page.locator('.drawer-footer button:has-text("End role")')).toBeDisabled();
        // The checkbox is the other route to the same outcome, so it is guarded too.
        await expect(page.locator('.compass-active-toggle input')).toBeDisabled();
        await expect(page.locator('.compass-blocked-hint')).toContainText('active goal');

        await page.click('.drawer-close');

        // Same rule one level down: a goal that still has projects.
        const shipV2 = engineer.locator('.goal-block', { hasText: 'Ship v2 by June' });
        await shipV2.locator('.goal-row .link-btn').click();

        await expect(page.locator('.drawer-title')).toHaveText('Edit goal');
        await expect(page.locator('.drawer-footer button:has-text("End goal")')).toBeDisabled();
        await expect(page.locator('.compass-blocked-hint')).toContainText('active project');
    });

    test('allows ending a leaf project', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/compass');

        const project = page.locator('.project-row', { hasText: 'Migration plan' });
        await project.locator('.link-btn').click();

        await expect(page.locator('.drawer-title')).toHaveText('Edit project');
        // Projects have no children in the hierarchy, so ending one is always allowed.
        await expect(page.locator('.drawer-footer button:has-text("End project")')).toBeEnabled();
        await expect(page.locator('.compass-blocked-hint')).toHaveCount(0);
    });

    test('creates a role through the drawer', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/compass');
        await page.click('button:has-text("+ Role")');

        await page.fill('#compass-title', 'Neighbour');
        await page.fill('#compass-start', '2024-02-01');
        await page.click('.drawer-footer button:has-text("Save")');

        await expect(page.locator('.role-title', { hasText: 'Neighbour' })).toBeVisible();
    });

    test('defaults a new project start date to today in the user timezone', async ({
        nonUtcPage: page,
    }) => {
        await page.clock.setFixedTime(new Date('2024-03-01T00:30:00Z'));
        await page.goto('/#/compass');

        const goal = page.locator('.goal-block', { hasText: 'Ship v2 by June' });
        await goal.locator('button:has-text("+ Project")').click();

        await expect(page.locator('.drawer-title')).toHaveText('New project');
        await expect(page.locator('#compass-start')).toHaveValue('2024-02-29');
    });

    test('keeps Compass civil dates stable in a non-UTC browser', async ({ nonUtcPage: page }) => {
        await page.goto('/#/compass');
        await page.click('button:has-text("+ Role")');
        await page.fill('#compass-title', 'Timezone role');
        await page.fill('#compass-start', '2024-03-01');
        await page.click('.drawer-footer button:has-text("Save")');

        const role = page.locator('.role-block', { hasText: 'Timezone role' });
        await expect(role).toContainText('Mar 2024');
        await role.locator('.role-row .link-btn').click();
        await expect(page.locator('#compass-start')).toHaveValue('2024-03-01');
    });

    test('offers projects grouped by role and goal in the shared task editor', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        const select = page.locator('#task-project');
        await expect(select).toBeVisible();

        // Groups are labelled with the whole ladder above the project.
        await expect(select.locator('optgroup[label="Engineer \u2192 Ship v2 by June"]')).toHaveCount(1);
        await expect(
            select.locator('optgroup[label="Engineer \u2192 Ship v2 by June"] option', {
                hasText: 'Migration plan',
            })
        ).toHaveCount(1);
    });

    test('links a new task to a project', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');

        await page.fill('#task-title', 'Task with a project');
        await page.fill('#task-duration', '30');
        await page.fill('#task-due-date', '2030-01-15');

        await page.selectOption('#task-project', { label: 'Migration plan' });
        await page.getByRole('button', { name: 'Add task', exact: true }).click();

        // The Compass page counts it against that project.
        await page.goto('/#/compass');
        const migration = page.locator('.project-row', { hasText: 'Migration plan' });
        await expect(migration.locator('.project-count')).toContainText('active');
        await expect(page.locator('.project-row', { hasText: 'Migration plan' })).toBeVisible();
    });
});
