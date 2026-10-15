'use strict';

/**
 * The shared visual theme: tokens resolve, Bootstrap is built once, the navbar marks the
 * current page, and the main screens fit a phone-width viewport. See docs/STYLE_GUIDE.md.
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

/** Widest right edge of any visible element in the app shell, ignoring scroll containers' contents. */
function widestVisibleRight(page) {
    return page.evaluate(() => {
        let widest = 0;
        for (const el of document.querySelectorAll('#app *')) {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            // Content clipped by an ancestor that scrolls or hides overflow is not page overflow.
            let clipped = false;
            for (let p = el.parentElement; p && p.id !== 'app'; p = p.parentElement) {
                const style = getComputedStyle(p);
                if (/(auto|scroll|hidden)/.test(style.overflowX + style.overflow)) { clipped = true; break; }
            }
            if (!clipped) widest = Math.max(widest, rect.right);
        }
        return Math.round(widest);
    });
}

test.describe('theme', () => {
    test('design tokens resolve and drive the page colours', async ({ page }) => {
        await page.goto('/#/');
        const theme = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            return {
                bg: root.getPropertyValue('--atc-bg').trim(),
                accent: root.getPropertyValue('--atc-accent').trim(),
                text: root.getPropertyValue('--atc-text').trim(),
                bodyBg: getComputedStyle(document.body).backgroundColor,
            };
        });
        expect(theme.bg).toBe('#0b0d12');
        expect(theme.accent).toBe('#6366f1');
        expect(theme.text).toBe('#e6e8ee');
        expect(theme.bodyBg).toBe('rgb(11, 13, 18)');
    });

    test('Bootstrap is compiled once, from the themed Sass build', async ({ page }) => {
        await page.goto('/#/');
        // Each Bootstrap build declares --bs-blue on :root; two copies fight over every variable.
        const builds = await page.evaluate(() => {
            let count = 0;
            for (const sheet of document.styleSheets) {
                let rules;
                try { rules = sheet.cssRules; } catch { continue; }
                for (const rule of rules) {
                    if (rule.style && rule.style.getPropertyValue('--bs-blue')) count++;
                }
            }
            return count;
        });
        expect(builds).toBe(1);
        await expect(page.locator('.btn-primary').first()).toHaveCSS('background-color', 'rgb(99, 102, 241)');
    });

    test('navbar marks the current page', async ({ page, seed }) => {
        const data = await seed();
        await login(page, data.primary.username, data.primary.password);
        await page.goto('/#/calendar');
        const active = page.locator('.atc-navbar .nav-link.active');
        await expect(active).toHaveCount(1);
        await expect(active).toHaveText('Calendar');
        await expect(active).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    });

    test('main screens fit a phone-width viewport', async ({ page, seed }) => {
        const data = await seed();
        await page.setViewportSize({ width: 390, height: 844 });
        await login(page, data.primary.username, data.primary.password);

        for (const [path, ready] of [
            ['/#/', '.home-hero'],
            ['/#/calendar', '.task-controls'],
            ['/#/weekly-plan', '.navbar'],
            ['/#/compass', '.navbar'],
        ]) {
            await page.goto(path);
            await expect(page.locator(ready).first()).toBeVisible();
            expect(await widestVisibleRight(page), `${path} overflows horizontally`).toBeLessThanOrEqual(392);
        }
    });
});
