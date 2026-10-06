'use strict';

/**
 * Creating an intention from Weekly Plan.
 *
 * Adding a task to a project under a personal role files it as an intention: due Sunday,
 * never scheduled, and never part of the week's commitment. The regression this covers is
 * that an intention in the week used to be sent with the commitment, which the server
 * rejects -- making the whole week uncommittable. See docs/INTENTIONS.md.
 */

const { test, expect } = require('../fixtures');
const { mondayWeekBounds, todayInZone } = require('../../utils/temporal');

async function login(page, username, password) {
    await page.goto('/#/login');
    await page.locator('input[type=text]').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/#\/user\//);
}

// The titles in this week's committed snapshot.
async function committedTitles(api, week) {
    const body = await (await api.get('/api/getWeeklyPlans', {
        params: { from: week.startDate, to: week.startDate },
    })).json();
    expect(body.success).toBe(true);
    const plan = (body.plans || []).find((entry) => entry.weekStart === week.startDate);
    expect(plan).toBeTruthy();
    return plan.items.map((item) => item.title);
}

test.describe('weekly plan intentions', () => {
    test('a task added to a personal project is filed as an intention, and the week still commits', async ({ page, seed, api }) => {
        const data = await seed();
        const week = mondayWeekBounds(todayInZone('UTC'), 'UTC');
        const projectId = String(data.named.weekendProject._id);

        await login(page, data.primary.username, data.primary.password);
        await page.goto('/#/weekly-plan');
        await expect(page.locator('[data-test=week-range]')).toBeVisible();

        const card = page.locator(`[data-test=quick-task-${projectId}]`);
        // The filing decision is named before the click, not inferred after it.
        const trigger = page.locator(`[data-test=quick-add-open-${projectId}]`);
        await expect(trigger).toHaveText(/Add an intention/);
        await trigger.click();

        // No day to choose: the server owns the Sunday.
        await expect(card.locator('.day-chips')).toHaveCount(0);
        await expect(page.locator(`[data-test=quick-intention-note-${projectId}]`))
            .toContainText('never scheduled');

        await page.locator(`#quick-title-${projectId}`).fill('Swim on Saturday');
        await page.getByRole('button', { name: 'Add intention' }).click();

        await expect(page.locator(`[data-test=quick-status-${projectId}]`))
            .toHaveText(/Added as an intention/);

        // Filed correctly: an intention, due this week's Sunday, with no slot.
        const tasks = (await (await api.get('/api/getUserTasks')).json()).taskList;
        const created = tasks.find((task) => task.title === 'Swim on Saturday');
        expect(created.isIntention).toBe(true);
        expect(created.dueDate).toBe(week.endDate);
        expect(created.scheduledDate).toBeFalsy();

        // The regression: the new intention must not be swept into the commitment. The seeded
        // week is already committed, so this is an amendment -- and an amendment carrying an
        // intention is refused by the server, which used to make the whole week uncommittable.
        const before = await committedTitles(api, week);
        // 'Handle the rollback question' is seeded AFTER the seed's own commit, so it is the
        // one title whose arrival proves this amendment actually landed.
        expect(before).not.toContain('Handle the rollback question');

        await page.locator('[data-test=commit-week]').click();
        // Wait for the amendment to be visible in the snapshot before judging it, so neither
        // assertion below can be satisfied by the page's pre-request state.
        await expect.poll(() => committedTitles(api, week))
            .toContain('Handle the rollback question');
        await expect(page.locator('[data-test=commit-error]')).toHaveCount(0);

        // The intention was left out of the very commit that succeeded.
        expect(await committedTitles(api, week)).not.toContain('Swim on Saturday');
    });
});
