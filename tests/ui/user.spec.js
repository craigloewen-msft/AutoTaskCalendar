const { test, expect } = require('../fixtures');
const { todayInZone } = require('../../utils/temporal');

test.describe('user working preferences', () => {
    test('round-trips minute-precision working hours and timezone', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = seed.last();
        await page.goto(`/#/user/${data.primary.username}`);
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

        await page.goto(`/#/user/${data.primary.username}`);
        await expect(page.locator('#startTime')).toHaveValue('09:30');
        await expect(page.locator('#endTime')).toHaveValue('17:30');
        await expect(page.locator('#timeZone')).toHaveValue('Asia/Kathmandu');
    });

    test('downloads a year-to-date completed task Markdown report', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = seed.last();
        const today = todayInZone(data.primary.user.timeZone);
        const from = `${today.slice(0, 4)}-01-01`;
        await page.goto(`/#/user/${data.primary.username}`);

        const card = page.locator('[data-test=completed-task-export]');
        await expect(card).toBeVisible();
        await expect(card.locator('#completedExportFrom')).toHaveValue(from);
        await expect(card.locator('#completedExportTo')).toHaveValue(today);

        await card.locator('#completedExportFrom').fill(today);
        await card.locator('#completedExportTo').fill(from);
        await card.locator('[data-test=download-completed-tasks]').click();
        await expect(card.locator('[data-test=completed-task-export-status]')).toContainText(
            'From must be on or before To'
        );

        await card.locator('#completedExportFrom').fill(from);
        await card.locator('#completedExportTo').fill(today);
        const requestPromise = page.waitForRequest('**/api/exportCompletedTasks**');
        const downloadPromise = page.waitForEvent('download');
        await card.locator('[data-test=download-completed-tasks]').click();
        const [request, download] = await Promise.all([requestPromise, downloadPromise]);
        expect(download.suggestedFilename()).toBe(`completed-tasks-${from}-to-${today}.md`);
        const stream = await download.createReadStream();
        let content = '';
        for await (const chunk of stream) content += chunk.toString();
        expect(content).toContain('# Completed task report');
        expect(content).toContain('## Completed work');
        expect(request.url()).toContain(`completedFrom=${from}`);
        expect(request.url()).toContain(`completedTo=${today}`);
        await expect(card.locator('[data-test=completed-task-export-status]')).toContainText(
            'Markdown report downloaded'
        );
    });

    test('shows export failures, recovers, and remains usable on a narrow screen', async ({
        seed,
        loggedInPage: page,
    }) => {
        const data = seed.last();
        let attempts = 0;
        await page.setViewportSize({ width: 375, height: 780 });
        await page.route('**/api/exportCompletedTasks**', async (route) => {
            attempts += 1;
            if (attempts === 1) {
                await route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify({ success: false, log: 'Export unavailable for now' }),
                });
                return;
            }
            await route.fulfill({ contentType: 'text/markdown', body: '# Recovered export\n' });
        });
        await page.goto(`/#/user/${data.primary.username}`);

        const card = page.locator('[data-test=completed-task-export]');
        await card.scrollIntoViewIfNeeded();
        const button = card.locator('[data-test=download-completed-tasks]');
        await button.click();
        await expect(card.locator('[data-test=completed-task-export-status]')).toContainText(
            'Export unavailable for now'
        );
        await expect(button).toBeEnabled();

        const downloadPromise = page.waitForEvent('download');
        await button.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(
            /^completed-tasks-\d{4}-01-01-to-\d{4}-\d{2}-\d{2}\.md$/
        );
        await expect(card.locator('[data-test=completed-task-export-status]')).toContainText(
            'Markdown report downloaded'
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
});
