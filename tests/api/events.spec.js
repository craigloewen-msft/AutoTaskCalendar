const { test, expect, withDb } = require('../fixtures');
const { transformGoogleEventData } = require('../../controllers/eventController');
const { EventDetails } = require('../../models');

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

    test('uses the running Express origin for OAuth callback redirects', async ({ apiAnon }) => {
        const response = await apiAnon.get('/api/connectGoogleCallback?error=denied', {
            maxRedirects: 0,
        });

        expect(response.status()).toBe(302);
        expect(response.headers().location).toBe(
            `${process.env.AUTOTASKCALENDAR_BASE_URL}?error=oauth_error`
        );
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
