const { test, expect, baseURL } = require('../fixtures');

// Requests a desktop client would make: a bearer token, from a foreign origin.
async function tokenClient(playwright, token) {
    return playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${token}`,
            Origin: 'https://elsewhere.example',
            'Sec-Fetch-Site': 'cross-site',
        },
    });
}

async function createToken(api, name = 'Desktop') {
    const body = await (await api.post('/api/apiTokens', { data: { name } })).json();
    expect(body.success).toBe(true);
    return body;
}

test.describe('personal API tokens', () => {
    test('a token files a task cross-origin and stops working once revoked', async ({
        seed,
        api,
        playwright,
    }) => {
        const data = await seed();
        const { token, apiToken } = await createToken(api);
        expect(token).toMatch(/^atc_[A-Za-z0-9_-]{43}$/);
        expect(token.startsWith(apiToken.prefix)).toBe(true);

        const listed = await (await api.get('/api/apiTokens')).json();
        expect(listed.apiTokens.map((t) => t._id)).toEqual([apiToken._id]);
        expect(JSON.stringify(listed)).not.toContain(token);

        const client = await tokenClient(playwright, token);
        try {
            const projects = await (await client.get('/api/projects')).json();
            const titles = projects.projects.map((p) => p.title);
            expect(titles).toContain('Migration plan');
            expect(titles).not.toContain('v1 security patches');
            const migration = projects.projects.find((p) => p.title === 'Migration plan');
            expect(migration).toMatchObject({
                _id: String(data.named.migrationProject._id),
                label: 'Engineer \u2192 Ship v2 by June',
                context: 'work',
            });

            const suggest = await (await client.post('/api/recommendTaskProject', {
                data: { title: 'Review migration cutover', candidateProjectIds: [migration._id] },
            })).json();
            expect(suggest.success).toBe(true);

            const created = await (await client.post('/api/createTask', {
                data: {
                    title: 'Filed from the desktop',
                    duration: 30,
                    startDate: '2030-01-01',
                    dueDate: '2030-01-08',
                    projectRef: migration._id,
                },
            })).json();
            expect(created.success).toBe(true);
            const task = created.taskList.find((t) => t.title === 'Filed from the desktop');
            expect(String(task.projectRef)).toBe(migration._id);

            const revoked = await (await api.delete(`/api/apiTokens/${apiToken._id}`)).json();
            expect(revoked.success).toBe(true);
            expect((await client.get('/api/projects')).status()).toBe(401);
        } finally {
            await client.dispose();
        }
    });

    test('tokens cannot manage tokens, and a bad token never falls back to the session', async ({
        seed,
        api,
        playwright,
    }) => {
        await seed();
        const { token } = await createToken(api);

        const client = await tokenClient(playwright, token);
        try {
            expect((await client.get('/api/apiTokens')).status()).toBe(403);
            expect((await client.post('/api/apiTokens', { data: { name: 'More' } })).status()).toBe(403);
            expect((await client.get('/api/admin/overview')).status()).toBe(403);
        } finally {
            await client.dispose();
        }

        const forged = `atc_${'A'.repeat(43)}`;
        const withSession = await api.get('/api/user', {
            headers: { Authorization: `Bearer ${forged}` },
        });
        expect(withSession.status()).toBe(401);
        expect((await api.get('/api/user', { headers: { Authorization: 'Bearer nope' } })).status()).toBe(401);
    });
});
