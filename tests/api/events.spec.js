const { createHash } = require('crypto');
const { test, expect, withDb } = require('../fixtures');
const { transformGoogleEventData } = require('../../controllers/eventController');
const { EventDetails, GoogleOAuthStateDetails, UserDetails } = require('../../models');
const { migrateGoogleCredentials } = require('../../utils/googleCredentialMigration');
const { decryptGoogleCredential, writeGoogleCredentials } = require('../../utils/googleCredentials');

function stateFrom(authUrl) {
    return new URL(authUrl).searchParams.get('state');
}

function stateDigest(state) {
    return createHash('sha256').update(state).digest('hex');
}

test.describe('events', () => {
    test('createEvent validates inputs and persists a calendar event', async ({ seed, api }) => {
        await seed();

        const missingFields = await api.post('/api/createEvent', { data: { title: 'Only a title' } });
        const missingFieldsBody = await missingFields.json();
        expect(missingFieldsBody.success).toBe(false);
        expect(missingFieldsBody.log).toContain('required');

        const invalid = await api.post('/api/createEvent', {
            data: { title: 'Bad', startDate: '2024-01-01', endDate: 'not-a-date' },
        });
        expect((await invalid.json()).success).toBe(false);

        const inverted = await api.post('/api/createEvent', {
            data: {
                title: 'Backwards',
                startDate: '2024-01-01T12:00:00Z',
                endDate: '2024-01-01T11:00:00Z',
            },
        });
        expect((await inverted.json()).log).toContain('after start');

        const start = new Date(Date.now() + 86400000);
        const end = new Date(start.getTime() + 3600000);
        const created = await api.post('/api/createEvent', {
            data: {
                title: 'Planning session',
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                notes: 'Quarterly planning',
            },
        });
        const createdBody = await created.json();

        expect(createdBody.success).toBe(true);
        expect(createdBody.event.title).toBe('Planning session');
        expect(createdBody.event.type).toBe('calendar');
    });

    test('event listing is week-scoped, user-scoped, and rejects bad dates', async ({ seed, api }) => {
        const data = await seed();
        const anchor = data.anchor.format('YYYY-MM-DD');
        const sunday = data.anchor.clone().startOf('week');

        const spanning = await EventDetails.create({
            title: 'Spans into week',
            startDate: sunday.clone().subtract(1, 'hour').toDate(),
            endDate: sunday.clone().add(1, 'hour').toDate(),
            userRef: data.primary.user._id,
            type: 'calendar',
        });
        const following = await EventDetails.create({
            title: 'Following Sunday',
            startDate: sunday.clone().add(7, 'days').add(1, 'hour').toDate(),
            endDate: sunday.clone().add(7, 'days').add(2, 'hours').toDate(),
            userRef: data.primary.user._id,
            type: 'calendar',
        });

        const listed = await (await api.get(`/api/getUserEvents/${anchor}`)).json();
        expect(listed.success).toBe(true);
        expect(listed.events.some((event) => event._id === spanning._id.toString())).toBe(true);
        expect(listed.events.some((event) => event._id === following._id.toString())).toBe(false);
        expect(listed.events.some((event) => event.title.includes('OTHER USER SECRET'))).toBe(false);

        const badDate = await (await api.get('/api/getUserEvents/not-a-date')).json();
        expect(badDate.success).toBe(false);
        expect(badDate.log).toContain('valid date');
        expect(badDate.log).not.toContain('Cast to date');
    });

    test('OAuth state is session-bound and does not expose account selection', async ({ seed, api, apiAnon, loginAs }) => {
        const data = await seed();
        const other = await loginAs(data.other.username, data.other.password);
        const connected = await (await api.get('/api/connectGoogle')).json();
        const state = stateFrom(connected.authUrl);

        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(connected.authUrl).not.toContain(data.primary.user._id.toString());

        const anonymous = await apiAnon.get(
            `/api/connectGoogleCallback?state=${state}&error=denied`,
            { maxRedirects: 0 }
        );
        const borrowed = await other.get(
            `/api/connectGoogleCallback?state=${state}&error=denied`,
            { maxRedirects: 0 }
        );
        expect(anonymous.headers().location).toContain('error=invalid_state');
        expect(borrowed.headers().location).toContain('error=invalid_state');

        const owner = await api.get(
            `/api/connectGoogleCallback?state=${state}&error=denied`,
            { maxRedirects: 0 }
        );
        expect(owner.headers().location).toBe(
            `${process.env.AUTOTASKCALENDAR_BASE_URL}?error=oauth_error`
        );

        const replay = await api.get(
            `/api/connectGoogleCallback?state=${state}&error=denied`,
            { maxRedirects: 0 }
        );
        const objectIdState = await api.get(
            `/api/connectGoogleCallback?state=${data.other.user._id}&error=denied`,
            { maxRedirects: 0 }
        );
        expect(replay.headers().location).toContain('error=invalid_state');
        expect(objectIdState.headers().location).toContain('error=invalid_state');
    });

    test('OAuth state expires and concurrent callbacks consume it once', async ({ seed, api }) => {
        await seed();
        const first = await (await api.get('/api/connectGoogle')).json();
        const expiredState = stateFrom(first.authUrl);
        await withDb(() => GoogleOAuthStateDetails.updateOne(
            { stateDigest: stateDigest(expiredState) },
            { $set: { expiresAt: new Date(Date.now() - 1000) } }
        ));

        const expired = await api.get(
            `/api/connectGoogleCallback?state=${expiredState}`,
            { maxRedirects: 0 }
        );
        expect(expired.headers().location).toContain('error=invalid_state');

        const second = await (await api.get('/api/connectGoogle')).json();
        const state = stateFrom(second.authUrl);
        const callbacks = await Promise.all([
            api.get(`/api/connectGoogleCallback?state=${state}`, { maxRedirects: 0 }),
            api.get(`/api/connectGoogleCallback?state=${state}`, { maxRedirects: 0 }),
        ]);
        const locations = callbacks.map((response) => response.headers().location).sort();
        expect(locations.filter((location) => location.includes('error=missing_code'))).toHaveLength(1);
        expect(locations.filter((location) => location.includes('error=invalid_state'))).toHaveLength(1);
    });

    test('migrates Google credentials to authenticated ciphertext and rejects tampering', async ({ seed }) => {
        const data = await seed();
        const accessToken = 'access-token-plaintext';
        const refreshToken = 'refresh-token-plaintext';
        await withDb(() => UserDetails.collection.updateOne(
            { _id: data.primary.user._id },
            { $set: { googleAccessToken: accessToken, googleRefreshToken: refreshToken } }
        ));

        await withDb(() => UserDetails.collection.updateOne(
            { _id: data.other.user._id },
            { $set: { googleRefreshToken: 'partial-refresh-token' } }
        ));
        await withDb(() => migrateGoogleCredentials({ secret: 'mysecret' }));
        const raw = await withDb(() => UserDetails.collection.findOne({ _id: data.primary.user._id }));
        const partial = await withDb(() => UserDetails.collection.findOne({ _id: data.other.user._id }));

        expect(raw.googleAccessToken).toBeUndefined();
        expect(raw.googleRefreshToken).toBeUndefined();
        expect(raw.googleAccessTokenEncrypted).not.toContain(accessToken);
        expect(raw.googleRefreshTokenEncrypted).not.toContain(refreshToken);
        expect(decryptGoogleCredential(raw.googleAccessTokenEncrypted, 'mysecret')).toBe(accessToken);
        expect(decryptGoogleCredential(raw.googleRefreshTokenEncrypted, 'mysecret')).toBe(refreshToken);
        expect(partial.googleAccessTokenEncrypted).toBeUndefined();
        expect(partial.googleRefreshToken).toBeUndefined();
        expect(decryptGoogleCredential(partial.googleRefreshTokenEncrypted, 'mysecret'))
            .toBe('partial-refresh-token');
        const partialUser = await withDb(() => UserDetails.findById(data.other.user._id));
        writeGoogleCredentials(partialUser, { secret: 'mysecret' }, { refreshToken: null });
        expect(partialUser.googleRefreshTokenEncrypted).toBe(partial.googleRefreshTokenEncrypted);

        const envelopeParts = raw.googleAccessTokenEncrypted.split('.');
        envelopeParts[2] = `${envelopeParts[2][0] === 'A' ? 'B' : 'A'}${envelopeParts[2].slice(1)}`;
        expect(() => decryptGoogleCredential(envelopeParts.join('.'), 'mysecret')).toThrow('Could not decrypt');

        await withDb(() => migrateGoogleCredentials({ secret: 'mysecret' }));
        const rerun = await withDb(() => UserDetails.collection.findOne({ _id: data.primary.user._id }));
        expect(rerun.googleAccessTokenEncrypted).toBe(raw.googleAccessTokenEncrypted);
    });

    test('update, delete, and Google event transforms preserve intended event semantics', async ({ seed, api }) => {
        const data = await seed();

        const updated = await api.post('/api/updateEvent', {
            data: { eventId: data.named.meeting._id.toString(), title: 'Renamed meeting' },
        });
        const updatedBody = await updated.json();
        expect(updatedBody.success).toBe(true);
        expect(updatedBody.event.title).toBe('Renamed meeting');

        const deleted = await api.post('/api/deleteEvent', {
            data: { eventId: data.named.clientCall._id.toString() },
        });
        const deletedBody = await deleted.json();
        expect(deletedBody.success).toBe(true);
        expect(deletedBody.eventList.map((event) => event._id)).not.toContain(data.named.clientCall._id.toString());

        const foreignEvent = await withDb(() => EventDetails.findOne({
            userRef: data.other.user._id,
        }));
        const foreignUpdate = await api.post('/api/updateEvent', {
            data: { eventId: foreignEvent._id.toString(), title: 'Hijacked event' },
        });
        const foreignDelete = await api.post('/api/deleteEvent', {
            data: { eventId: foreignEvent._id.toString() },
        });
        const unchangedForeignEvent = await withDb(() => EventDetails.findById(foreignEvent._id));

        expect((await foreignUpdate.json()).success).toBe(false);
        expect((await foreignDelete.json()).success).toBe(false);
        expect(unchangedForeignEvent.title).toBe(foreignEvent.title);

        const timed = transformGoogleEventData({
            start: { dateTime: '2024-03-10T09:00:00', timeZone: 'America/New_York' },
            end: { dateTime: '2024-03-10T10:00:00', timeZone: 'America/New_York' },
        }, 'UTC');
        expect(timed.startDate.toISOString()).toBe('2024-03-10T13:00:00.000Z');
        expect(timed.endDate.toISOString()).toBe('2024-03-10T14:00:00.000Z');

        const allDay = transformGoogleEventData(
            { start: { date: '2024-03-10' }, end: { date: '2024-03-11' } },
            'America/New_York'
        );
        expect(allDay.allDay).toBe(true);
        expect(allDay.allDayStart).toBe('2024-03-10');
        expect(allDay.allDayEnd).toBe('2024-03-11');
        expect(allDay.startDate.toISOString()).toBe('2024-03-10T05:00:00.000Z');
        expect(allDay.endDate.toISOString()).toBe('2024-03-11T04:00:00.000Z');

        const sourceZone = transformGoogleEventData(
            { start: { date: '2024-03-10' }, end: { date: '2024-03-11' } },
            'Pacific/Auckland'
        );
        expect(sourceZone.startDate.toISOString()).toBe('2024-03-09T11:00:00.000Z');
    });
});
