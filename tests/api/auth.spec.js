const { test, expect, baseURL } = require('../fixtures');

test.describe('auth', () => {
    test('login and registration handle success and duplicate credentials', async ({ seed, apiAnon }) => {
        await seed();

        const login = await apiAnon.post('/api/login', {
            data: { username: 'testuser', password: 'testpassword' },
        });
        const loginBody = await login.json();

        expect(loginBody.success).toBe(true);
        expect(loginBody.token).toBeTruthy();
        expect(loginBody.user.username).toBe('testuser');

        const wrongPassword = await apiAnon.post('/api/login', {
            data: { username: 'testuser', password: 'wrong' },
        });
        expect((await wrongPassword.json()).success).toBe(false);

        const unknownUser = await apiAnon.post('/api/login', {
            data: { username: 'nobody', password: 'testpassword' },
        });
        expect((await unknownUser.json()).success).toBe(false);

        const register = await apiAnon.post('/api/register', {
            data: {
                username: 'brandnew',
                email: 'brandnew@example.com',
                password: 'hunter2hunter2',
                timeZone: 'Asia/Kathmandu',
            },
        });
        const registerBody = await register.json();

        expect(registerBody.success).toBe(true);
        expect(registerBody.user.username).toBe('brandnew');

        const brandnewLogin = await apiAnon.post('/api/login', {
            data: { username: 'brandnew', password: 'hunter2hunter2' },
        });
        expect((await brandnewLogin.json()).success).toBe(true);

        const duplicate = await apiAnon.post('/api/register', {
            data: {
                username: 'testuser',
                email: 'dupe@example.com',
                password: 'somepassword',
                timeZone: 'UTC',
            },
        });
        const duplicateBody = await duplicate.json();

        expect(duplicateBody.success).toBe(false);
        expect(duplicateBody.log).toContain('already exists');
    });

    test('protected endpoints reject missing and invalid tokens', async ({ seed, apiAnon, playwright }) => {
        await seed();

        const anonymous = await apiAnon.get('/api/getUserTasks');
        expect(anonymous.status()).toBe(401);

        const context = await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: { Authorization: 'not-a-real-token' },
        });
        const garbage = await context.get('/api/getUserTasks');
        await context.dispose();

        expect(garbage.status()).toBe(401);
    });

    test('updateuserinfo validates and persists working hours and timezone', async ({ seed, api }) => {
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

        const update = await api.post('/api/updateuserinfo', {
            data: {
                workingStartTime: '09:30',
                workingEndTime: '17:30',
                workingDays: ['Monday', 'Wednesday', 'Friday'],
                timeZone: 'Asia/Kathmandu',
                selectedCalendars: [],
            },
        });
        const updateBody = await update.json();

        expect(updateBody.success).toBe(true);
        expect(updateBody.user.workingStartTime).toBe('09:30');
        expect(updateBody.user.workingEndTime).toBe('17:30');
        expect(updateBody.user.workingStartMinutes).toBe(570);
        expect(updateBody.user.workingEndMinutes).toBe(1050);
        expect(updateBody.user.timeZone).toBe('Asia/Kathmandu');
        expect(updateBody.user.workingDays).toEqual(['Monday', 'Wednesday', 'Friday']);
    });
});
