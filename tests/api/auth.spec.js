const { test, expect } = require('../fixtures');

test.describe('auth', () => {
    test('logs in with the seeded credentials', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.post('/api/login', {
            data: { username: 'testuser', password: 'testpassword' },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.token).toBeTruthy();
        expect(body.user.username).toBe('testuser');
    });

    test('rejects a wrong password', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.post('/api/login', {
            data: { username: 'testuser', password: 'wrong' },
        });

        // API errors come back as HTTP 200 with success: false.
        expect((await res.json()).success).toBe(false);
    });

    test('rejects an unknown user', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.post('/api/login', {
            data: { username: 'nobody', password: 'testpassword' },
        });

        expect((await res.json()).success).toBe(false);
    });

    test('registers a new user and returns a usable token', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.post('/api/register', {
            data: {
                username: 'brandnew',
                email: 'brandnew@example.com',
                password: 'hunter2hunter2',
                timeZone: 'Asia/Kathmandu',
            },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.user.username).toBe('brandnew');

        const login = await apiAnon.post('/api/login', {
            data: { username: 'brandnew', password: 'hunter2hunter2' },
        });
        expect((await login.json()).success).toBe(true);
    });

    test('refuses to register a duplicate username', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.post('/api/register', {
            data: {
                username: 'testuser',
                email: 'dupe@example.com',
                password: 'somepassword',
                timeZone: 'UTC',
            },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('already exists');
    });

    test('protected endpoints reject requests with no token', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.get('/api/getUserTasks');
        expect(res.status()).toBe(401);
    });

    test('protected endpoints reject a garbage token', async ({ seed, playwright }) => {
        await seed();

        const context = await playwright.request.newContext({
            baseURL: require('../fixtures').baseURL,
            extraHTTPHeaders: { Authorization: 'not-a-real-token' },
        });
        const res = await context.get('/api/getUserTasks');
        await context.dispose();

        expect(res.status()).toBe(401);
    });

    test('rejects invalid timezone and overnight working hours', async ({ seed, api }) => {
        await seed();

        const badZone = await api.post('/api/updateuserinfo', {
            data: {
                workingStartTime: '09:00',
                workingEndTime: '17:00',
                workingDays: ['Monday'],
                timeZone: 'Mars/Olympus',
                selectedCalendars: [],
            },
        });
        expect((await badZone.json()).success).toBe(false);

        const overnight = await api.post('/api/updateuserinfo', {
            data: {
                workingStartTime: '17:00',
                workingEndTime: '09:00',
                workingDays: ['Monday'],
                timeZone: 'UTC',
                selectedCalendars: [],
            },
        });
        expect((await overnight.json()).log).toContain('after start');
    });

    test('updates working hours and days', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/updateuserinfo', {
            data: {
                workingStartTime: '09:30',
                workingEndTime: '17:30',
                workingDays: ['Monday', 'Wednesday', 'Friday'],
                timeZone: 'Asia/Kathmandu',
                selectedCalendars: [],
            },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.user.workingStartTime).toBe('09:30');
        expect(body.user.workingEndTime).toBe('17:30');
        expect(body.user.workingStartMinutes).toBe(570);
        expect(body.user.workingEndMinutes).toBe(1050);
        expect(body.user.timeZone).toBe('Asia/Kathmandu');
        expect(body.user.workingDays).toEqual(['Monday', 'Wednesday', 'Friday']);
    });
});
