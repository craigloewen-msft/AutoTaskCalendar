'use strict';

/**
 * Events leave a thin right gutter so a new event can be dragged over a busy slot.
 * See docs/CALENDAR_TASK_LIST.md.
 */

const { test, expect } = require('../fixtures');

async function login(page, username, password) {
    await page.goto('/login');
    await page.locator('input[type=text]').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/user\//);
}

test('dragging in the gutter beside an event starts a new event', async ({ page, seed }) => {
    const data = await seed();
    await login(page, data.primary.username, data.primary.password);
    await page.goto('/calendar');

    const event = page.locator('.calendar_default_event', { hasText: 'Lunch day 1' });
    await event.scrollIntoViewIfNeeded();
    await expect(event).toBeVisible();
    const box = await event.boundingBox();

    // Start just right of the event, still inside its day column.
    const x = box.x + box.width + 6;
    const y = box.y + Math.min(10, box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByText('Create a new event:')).toBeVisible();
});
