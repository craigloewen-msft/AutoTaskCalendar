const { test, expect } = require('../fixtures');

test.describe('user working preferences', () => {
    test('round-trips minute-precision working hours and timezone', async ({ loggedInPage: page }) => {
        await page.goto('/#/user/testuser');
        await page.fill('#startTime', '09:30');
        await page.fill('#endTime', '17:30');
        await page.fill('#timeZone', 'Asia/Kathmandu');
        await page.click('button:has-text("Save Changes")');
        await expect.poll(async () =>
            page.evaluate(() => JSON.parse(localStorage.getItem('user')).workingStartMinutes)
        ).toBe(570);

        await expect(page.locator('#startTime')).toHaveValue('09:30');
        await expect(page.locator('#endTime')).toHaveValue('17:30');
        await expect(page.locator('#timeZone')).toHaveValue('Asia/Kathmandu');

        await page.goto('/#/calendar');
        await expect(page.locator('.calendar_default_cell_business').first()).toBeVisible();

        await page.goto('/#/user/testuser');
        await expect(page.locator('#startTime')).toHaveValue('09:30');
        await expect(page.locator('#endTime')).toHaveValue('17:30');
        await expect(page.locator('#timeZone')).toHaveValue('Asia/Kathmandu');
    });
});
