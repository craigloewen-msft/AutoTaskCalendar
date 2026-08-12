const { test, expect } = require('../fixtures');

test.describe('compass page', () => {
    test('renders the hierarchy, Someday, and Archive', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/compass');

        const engineer = page.locator('.role-block', { hasText: 'Engineer' });
        await expect(engineer.locator('.role-title')).toHaveText('Engineer');

        const shipV2 = engineer.locator('.goal-block', { hasText: 'Ship v2 by June' });
        await expect(shipV2.locator('.goal-title')).toHaveText('Ship v2 by June');
        await expect(shipV2.locator('.project-title', { hasText: 'Migration plan' })).toBeVisible();

        const someday = page.locator('details', { hasText: 'Someday' });
        await expect(someday).toContainText('Rewrite the CLI');

        await expect(page.locator('.role-title', { hasText: 'Volunteer board member' })).toHaveCount(0);
        const archive = page.locator('details', { hasText: 'Archive' });
        await expect(archive).toContainText('1 ended roles');
        await archive.locator('summary').click();
        await expect(archive.locator('.project-title', { hasText: 'Volunteer board member' })).toBeVisible();
    });

    test('creates a role and links a new task to a project', async ({ seed, loggedInPage: page }) => {
        await seed();

        await page.goto('/#/compass');
        await page.click('button:has-text("+ Role")');
        await page.fill('#compass-title', 'Neighbour');
        await page.fill('#compass-start', '2024-02-01');
        await page.click('.drawer-footer button:has-text("Save")');
        await expect(page.locator('.role-title', { hasText: 'Neighbour' })).toBeVisible();

        await page.goto('/#/calendar');
        await page.click('button:has-text("Add Task")');
        const select = page.locator('#task-project');
        await expect(select.locator('optgroup[label="Engineer → Ship v2 by June"]')).toHaveCount(1);
        await page.fill('#task-title', 'Task with a project');
        await page.fill('#task-duration', '30');
        await page.fill('#task-due-date', '2030-01-15');
        await page.selectOption('#task-project', { label: 'Migration plan' });
        await page.getByRole('button', { name: 'Add task', exact: true }).click();

        await page.goto('/#/compass');
        const migration = page.locator('.project-row', { hasText: 'Migration plan' });
        await expect(migration.locator('.project-count')).toContainText('active');
        await expect(migration).toBeVisible();
    });
});
