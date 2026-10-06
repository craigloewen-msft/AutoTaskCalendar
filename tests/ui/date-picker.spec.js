'use strict';

/**
 * The shared DateField picker, exercised on the Compass screen.
 *
 * Compass is where the picker was introduced; the same component backs the task editor,
 * the repeat editor and the completed-task export, so covering it here covers all of them.
 */

const { test, expect } = require('../fixtures');

/** Log in through the real form, which is the only way to get a session cookie in the page. */
async function login(page, username, password) {
    await page.goto('/#/login');
    await page.locator('input[type=text]').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/#\/user\//);
}

/** Open the "add role" drawer on Compass. */
async function openRoleDrawer(page) {
    await page.goto('/#/compass');
    await page.getByRole('button', { name: '+ Role' }).first().click();
    await expect(page.locator('#compass-start')).toBeVisible();
}

test.describe('date picker', () => {
    test('picks a date from the calendar and saves it as a civil date', async ({ page, seed, api }) => {
        const data = await seed();
        await login(page, data.primary.username, data.primary.password);
        await openRoleDrawer(page);

        await page.locator('#compass-title').fill('Picker spec role');

        // Opening the input shows our picker, not the browser's native one.
        await page.locator('#compass-start').click();
        const menu = page.locator('.dp--menu');
        await expect(menu).toBeVisible();

        // Pick the 15th of whatever month is shown.
        await menu.locator('.dp--cell-inner:not(.dp--cell-offset)', { hasText: /^15$/ }).first().click();
        await expect(menu).toBeHidden();
        await expect(page.locator('#compass-start')).toHaveValue(/15 \w{3} \d{4}/);

        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Picker spec role')).toBeVisible();

        // The API stores and returns the day that was clicked, as a plain civil date.
        const response = await api.get('/api/getCompass');
        const body = await response.json();
        const role = body.roles.find((r) => r.title === 'Picker spec role');

        expect(role).toBeTruthy();
        expect(role.startDate).toMatch(/^\d{4}-\d{2}-15$/);
    });

    test('accepts a typed date and closes on Escape', async ({ page, seed }) => {
        const data = await seed();
        await login(page, data.primary.username, data.primary.password);
        await openRoleDrawer(page);

        const input = page.locator('#compass-start');
        await input.fill('2027-03-09');
        await page.keyboard.press('Enter');
        await expect(input).toHaveValue('09 Mar 2027');

        await input.click();
        await expect(page.locator('.dp--menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.dp--menu')).toBeHidden();
    });

    test('end date stays disabled while the item is marked still active', async ({ page, seed }) => {
        const data = await seed();
        await login(page, data.primary.username, data.primary.password);
        await openRoleDrawer(page);

        // A new role is active by default, so its end date is not editable yet.
        await expect(page.locator('#compass-end')).toBeDisabled();

        await page.locator('.compass-active-toggle input[type=checkbox]').uncheck();
        await expect(page.locator('#compass-end')).toBeEnabled();
    });
});
