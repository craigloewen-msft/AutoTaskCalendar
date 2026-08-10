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

    test('creates a role through the drawer', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/compass');
        await page.click('button:has-text("+ Role")');

        await page.fill('#compass-title', 'Neighbour');
        await page.fill('#compass-start', '2024-02-01');
        await page.click('.drawer-footer button:has-text("Save")');

        await expect(page.locator('.role-title', { hasText: 'Neighbour' })).toBeVisible();
    });

    test('offers projects grouped by role and goal on the task modal', async ({
        seed,
        loggedInPage: page,
    }) => {
        await seed();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        await page.click('button:has-text("Advanced Options")');

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

        await page.click('button:has-text("Advanced Options")');
        await page.selectOption('#task-project', { label: 'Migration plan' });
        await page.click('.modal-footer button:has-text("OK")');

        // The Compass page counts it against that project.
        await page.goto('/#/compass');
        const migration = page.locator('.project-row', { hasText: 'Migration plan' });
        await expect(migration.locator('.project-count')).toContainText('active');
        await expect(page.locator('.project-row', { hasText: 'Migration plan' })).toBeVisible();
    });
});
