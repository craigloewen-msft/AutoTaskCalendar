const { test, expect } = require('../fixtures');

test.describe('events', () => {
    test('creates an event', async ({ seed, api }) => {
        await seed();

        const start = new Date(Date.now() + 86400000);
        const end = new Date(start.getTime() + 3600000);

        const res = await api.post('/api/createEvent', {
            data: {
                title: 'Planning session',
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                notes: 'Quarterly planning',
            },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.event.title).toBe('Planning session');
        expect(body.event.type).toBe('calendar');
    });

    test('requires a title and both dates', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createEvent', { data: { title: 'Only a title' } });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('required');
    });

    test('rejects invalid or inverted event timestamps', async ({ seed, api }) => {
        await seed();
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
    });

    test('updates an event', async ({ seed, api }) => {
        const data = await seed();
        const event = data.named.meeting;

        const res = await api.post('/api/updateEvent', {
            data: { eventId: event._id.toString(), title: 'Renamed meeting' },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.event.title).toBe('Renamed meeting');
    });

    test('deletes an event', async ({ seed, api }) => {
        const data = await seed();
        const event = data.named.clientCall;

        const res = await api.post('/api/deleteEvent', {
            data: { eventId: event._id.toString() },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.eventList.map((e) => e._id)).not.toContain(event._id.toString());
    });

    test('returns events overlapping exactly the requested local week', async ({ seed, api }) => {
        const data = await seed();
        const { EventDetails } = require('../../models');
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

        const body = await (await api.get(`/api/getUserEvents/${anchor}`)).json();
        expect(body.success).toBe(true);
        expect(body.events.some((event) => event._id === spanning._id.toString())).toBe(true);
        expect(body.events.some((event) => event._id === following._id.toString())).toBe(false);
    });

    test('never returns another user\'s events', async ({ seed, api }) => {
        const data = await seed();

        const res = await api.get(`/api/getUserEvents/${data.anchor.format('YYYY-MM-DD')}`);
        const body = await res.json();

        expect(body.events.some((e) => e.title.includes('OTHER USER SECRET'))).toBe(false);
    });

    test('parses Google wall timestamps using their source timezone', () => {
        const { transformGoogleEventData } = require('../../controllers/eventController');
        const timed = transformGoogleEventData({
            start: { dateTime: '2024-03-10T09:00:00', timeZone: 'America/New_York' },
            end: { dateTime: '2024-03-10T10:00:00', timeZone: 'America/New_York' },
        }, 'UTC');
        expect(timed.startDate.toISOString()).toBe('2024-03-10T13:00:00.000Z');
        expect(timed.endDate.toISOString()).toBe('2024-03-10T14:00:00.000Z');
    });

    test('preserves Google all-day dates and exclusive end', () => {
        const { transformGoogleEventData } = require('../../controllers/eventController');
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

    test('rejects an unparseable date instead of leaking a cast error', async ({ seed, api }) => {
        await seed();

        const res = await api.get('/api/getUserEvents/not-a-date');
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('valid date');
        // The raw Mongoose failure must never reach the caller.
        expect(body.log).not.toContain('Cast to date');
    });
});
