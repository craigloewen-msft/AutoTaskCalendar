'use strict';

/**
 * The design system holds together.
 *
 * These guard what a restyle can silently break: a second Bootstrap theme creeping back in,
 * a token a component references but nobody publishes, and focus indicators being styled
 * away. See docs/DESIGN_SYSTEM.md.
 */

const { test, expect } = require('../fixtures');

async function login(page, username, password) {
    await page.goto('/login');
    await page.locator('input[type=text]').fill(username);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/user\//);
}

test.describe('design system', () => {
    test('exactly one Bootstrap theme is loaded', async ({ page }) => {
        await page.goto('/login');

        // Each Bootstrap build defines the palette once, so counting `--bs-blue`
        // declarations counts copies. Works for the dev server's injected <style> tags and
        // for the extracted, minified production bundle alike.
        const copies = await page.evaluate(() => {
            let found = 0;
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.style?.getPropertyValue('--bs-blue')) {
                            found += 1;
                        }
                    }
                } catch {
                    // Cross-origin sheet; not ours.
                }
            }
            return found;
        });

        expect(copies).toBe(1);

        // And the one that survived is ours, built from the tokens.
        const theme = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            return {
                surface: root.getPropertyValue('--surface-0').trim(),
                bootstrapBg: root.getPropertyValue('--bs-body-bg').trim(),
            };
        });

        expect(theme.surface).toBe('#0b0d12');
        expect(theme.bootstrapBg).toBe('#0b0d12');
    });

    test('every token a component uses is published on :root', async ({ page, seed }) => {
        const data = await seed();
        await login(page, data.primary.username, data.primary.password);

        // An undefined var() invalidates the whole declaration, which is how gradient-filled
        // headings turn invisible rather than merely wrong.
        const missing = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const used = new Set();

            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (!rule.style) continue;
                        for (const match of rule.cssText.matchAll(/var\((--[a-z0-9-]+)/gi)) {
                            used.add(match[1]);
                        }
                    }
                } catch {
                    // Cross-origin sheet; not ours.
                }
            }

            // Bootstrap's own --bs-* are defined per-component, and --role-color is set
            // inline per role card. Neither lives on :root.
            return [...used]
                .filter((name) => !name.startsWith('--bs-') && !name.startsWith('--dp-'))
                .filter((name) => name !== '--role-color')
                .filter((name) => root.getPropertyValue(name).trim() === '');
        });

        expect(missing).toEqual([]);
    });

    test('the date picker is themed from our tokens', async ({ page, seed }) => {
        const data = await seed();
        await login(page, data.primary.username, data.primary.password);

        await page.goto('/compass');
        await page.getByRole('button', { name: '+ Role' }).first().click();
        await page.locator('#compass-start').click();

        // The menu teleports to <body>, so the theming has to be global and keyed on the
        // class this version of vue-datepicker emits.
        const menu = page.locator('.dp--menu');
        await expect(menu).toBeVisible();

        const accent = await menu.evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--dp-primary-color').trim());
        expect(accent.toLowerCase()).toBe('#6366f1');
    });

    test('keyboard focus stays visible on the primary action', async ({ page }) => {
        await page.goto('/login');

        const button = page.getByRole('button', { name: 'Sign in' });
        await button.focus();

        const indicator = await button.evaluate((el) => {
            const s = getComputedStyle(el);
            return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow };
        });

        const hasOutline = indicator.outline !== 'none' && parseFloat(indicator.width) > 0;
        const hasRing = indicator.shadow && indicator.shadow !== 'none';

        expect(hasOutline || hasRing).toBe(true);
    });
});
