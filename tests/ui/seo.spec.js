'use strict';

/**
 * The public pages carry their own, correct SEO metadata.
 *
 * This exists because they once did not. Seven views declared a `metaInfo` option, which
 * is the vue-meta 2.x API; this app uses @vueuse/head, which ignores it entirely. Every
 * one of those titles and descriptions was dead code, and the only description that
 * actually reached the page was leftover boilerplate advertising a GitHub issue tracker.
 * Nothing failed, because nothing was asserting on the rendered head.
 *
 * See docs/SEO.md.
 */

const { test, expect } = require('../fixtures');

const content = (page, selector) =>
    page.locator(selector).first().getAttribute('content');

// Route components are lazy-loaded, so the head is only final once one has mounted.
// Waiting on the heading is the readiness signal; reading sooner catches the shell.
async function gotoSettled(page, path) {
    const response = await page.goto(path);
    await page.locator('h1').first().waitFor({ state: 'visible' });
    return response;
}

test.describe('public page SEO', () => {
    test('home and about each carry their own title, description and canonical', async ({ page }) => {
        await gotoSettled(page, '/');

        const homeTitle = await page.title();
        const homeDescription = await content(page, 'meta[name=description]');

        expect(homeTitle).toContain('AutoTaskCalendar');
        expect(homeDescription).toBeTruthy();
        // The bug that prompted this spec: boilerplate from an unrelated template.
        expect(homeDescription.toLowerCase()).not.toContain('github');
        expect(homeDescription.length).toBeGreaterThan(50);

        // Every page once shared one hardcoded title, which is why this is asserted.
        expect(homeTitle).toContain('scheduling');

        // A page with no <h1> gives search engines and screen readers nothing to anchor on.
        await expect(page.locator('h1')).toHaveCount(1);

        expect(await page.locator('link[rel=canonical]').first().getAttribute('href'))
            .toMatch(/\/$/);
        expect(await content(page, 'meta[property="og:image"]')).toMatch(/\.png$/);
        expect(await content(page, 'meta[name=robots]')).toContain('index');

        await gotoSettled(page, '/about');

        const aboutTitle = await page.title();
        const aboutDescription = await content(page, 'meta[name=description]');

        await expect(page.locator('h1')).toHaveCount(1);
        expect(aboutDescription.toLowerCase()).not.toContain('github issue');
        expect(aboutTitle).toContain('About');

        // Distinct pages must not share one title and description, or they compete.
        expect(aboutTitle).not.toBe(homeTitle);
        expect(aboutDescription).not.toBe(homeDescription);

        expect(await page.locator('link[rel=canonical]').first().getAttribute('href'))
            .toMatch(/\/about$/);
        expect(await content(page, 'meta[property="og:url"]')).toMatch(/\/about$/);
    });

    test('private pages ask not to be indexed', async ({ page }) => {
        await gotoSettled(page, '/login');
        expect(await content(page, 'meta[name=robots]')).toContain('noindex');
        // Claiming a canonical URL for a page that must not be indexed is contradictory.
        await expect(page.locator('link[rel=canonical]')).toHaveCount(0);
    });

    test('/about is a real URL that survives a reload', async ({ page }) => {
        // Hash routing made every page look like "/" to a crawler. These paths must be
        // served by the app itself, not just reachable by clicking through the SPA.
        const response = await gotoSettled(page, '/about');
        expect(response.status()).toBe(200);

        await page.reload();
        await expect(page.locator('h1')).toBeVisible();
        expect(page.url()).toMatch(/\/about$/);
    });

    test('a crawler that runs no JavaScript still gets the page', async ({ request }) => {
        // The public pages are prerendered, so the HTML itself must carry the content and
        // the metadata. Most link-preview bots never execute JavaScript.
        const html = await (await request.get('/about')).text();

        expect(html).toContain('<title>About | AutoTaskCalendar</title>');
        expect(html).toContain('Scheduling that respects the time you actually have');
        expect(html).toMatch(/<meta[^>]+property="og:image"[^>]+content="[^"]+\.png"/);
    });

    test('the SPA fallback cannot be walked out of the build directory', async ({ request }) => {
        // The fallback maps a URL path to a file on disk, so it must refuse to leave dist/.
        const attempts = [
            '/../../../../etc/passwd',
            '/%2e%2e/%2e%2e/etc/passwd',
            '/....//....//etc/passwd',
            '/../app.js',
        ];

        for (const attempt of attempts) {
            const response = await request.get(attempt, { maxRedirects: 0 });
            const body = await response.text();
            // Either refused outright, or harmlessly handed the SPA shell. Never a file.
            expect(body).not.toContain('root:x:');
            expect(body).not.toContain('mongooseConnectionString');
        }
    });

    test('a legacy hash link still reaches the page it named', async ({ page }) => {
        // Links shared before the switch to real paths arrive as "/#/about".
        await page.goto('/#/about');
        await expect(page).toHaveURL(/\/about$/);
        await expect(page.locator('h1')).toBeVisible();
    });
});
