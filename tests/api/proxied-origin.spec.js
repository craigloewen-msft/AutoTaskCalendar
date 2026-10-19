const { test, expect, baseURL } = require('../fixtures');

/**
 * Reaching a stack through a forwarded port, as an agent container or network namespace
 * does: the browser's origin is some outer port the app never knew about. The app derives
 * its own origin per request, so it still recognises itself. See docs/PROXIED_ACCESS.md.
 */
test.describe('proxied origin', () => {
    const forwardedHost = 'localhost:43371';
    const forwardedOrigin = `http://${forwardedHost}`;

    test('accepts requests whose Origin matches the forwarded host', async ({ seed, playwright }) => {
        const data = await seed();
        const context = await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Origin: forwardedOrigin,
                'X-Forwarded-Host': forwardedHost,
                'X-Forwarded-Proto': 'http',
            },
        });

        const login = await context.post('/api/login', {
            data: { username: data.primary.username, password: data.primary.password },
        });
        expect(login.status()).toBe(200);
        expect((await login.json()).success).toBe(true);

        // The session works for authenticated reads too, not just the login itself.
        const tasks = await context.get('/api/getUserTasks');
        expect(tasks.status()).toBe(200);

        await context.dispose();
    });

    test('still rejects an Origin that is not the forwarded host', async ({ seed, playwright }) => {
        const data = await seed();
        const context = await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: {
                Origin: 'https://attacker.example',
                'X-Forwarded-Host': forwardedHost,
                'X-Forwarded-Proto': 'http',
            },
        });

        const login = await context.post('/api/login', {
            data: { username: data.primary.username, password: data.primary.password },
        });
        expect(login.status()).toBe(403);

        await context.dispose();
    });

    test('redirects back to the forwarded host rather than the internal port', async ({ playwright }) => {
        const context = await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: {
                'X-Forwarded-Host': forwardedHost,
                'X-Forwarded-Proto': 'http',
            },
        });

        // Unauthenticated, so this takes the invalid-state redirect.
        const response = await context.get('/api/connectGoogleCallback?error=x', {
            maxRedirects: 0,
        });

        expect(response.status()).toBe(302);
        expect(response.headers()['location']).toBe(`${forwardedOrigin}?error=invalid_state`);

        await context.dispose();
    });
});

test('an api path nested under a page path is a 404, not the app shell', async ({ request }) => {
    const res = await request.get('/user/api/connectGoogle');
    expect(res.status()).toBe(404);
});
