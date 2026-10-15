'use strict';

/**
 * The calendar sidebar names each task's project.
 *
 * Short titles are the point: "Update deck" is readable because the row says which project
 * it belongs to. See docs/CALENDAR_TASK_LIST.md.
 */

const { test, expect } = require('../fixtures');

async function login(page, username, password) {
    await page.goto('/login');
    await page.locator('input[type=text]').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/user\//);
}

test.describe('calendar sidebar project labels', () => {
    test('a project-linked task shows its project, and an unassigned one shows none', async ({ page, seed }) => {
        const data = await seed();
        const proposalId = String(data.named.proposal._id);
        const backlogId = String(data.named.backlogIdea._id);

        await login(page, data.primary.username, data.primary.password);
        await page.goto('/calendar');

        const proposalRow = page.locator(`[data-test=task-item-${proposalId}]`);
        await expect(proposalRow).toBeVisible();

        // The title itself is untouched; the project rides alongside it.
        await expect(proposalRow.locator('.task-title')).toContainText('Complete project proposal');
        const label = page.locator(`[data-test=task-project-${proposalId}]`);
        await expect(label).toHaveText('Perf pass');
        await expect(label).toHaveAttribute('aria-label', 'Project: Perf pass');

        // Unassigned work says nothing rather than claiming a project.
        await expect(page.locator(`[data-test=task-item-${backlogId}]`)).toBeVisible();
        await expect(page.locator(`[data-test=task-project-${backlogId}]`)).toHaveCount(0);
    });

    test('an intention shows its personal project too', async ({ page, seed }) => {
        const data = await seed();
        const intentionId = String(data.named.intentionShort._id);

        await login(page, data.primary.username, data.primary.password);
        await page.goto('/calendar');

        await page.locator('[data-test=calendar-intentions] summary').click();
        await expect(page.locator(`[data-test=task-item-${intentionId}]`)).toBeVisible();
        await expect(page.locator(`[data-test=task-project-${intentionId}]`))
            .toHaveText('Weekend adventures');
    });

    test('the label stays inside its row on a narrow viewport', async ({ page, seed }) => {
        const data = await seed();
        const proposalId = String(data.named.proposal._id);

        await login(page, data.primary.username, data.primary.password);
        await page.setViewportSize({ width: 480, height: 900 });
        await page.goto('/calendar');

        const row = page.locator(`[data-test=task-item-${proposalId}]`);
        await expect(row).toBeVisible();
        const rowBox = await row.boundingBox();
        const labelBox = await page.locator(`[data-test=task-project-${proposalId}]`).boundingBox();

        expect(labelBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
        expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    });
});
