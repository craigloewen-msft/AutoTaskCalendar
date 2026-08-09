const { test, expect } = require('../fixtures');

test.describe('events', () => {
    test('creates an event', async ({ seed, api }) => {
        await seed('empty');

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
        await seed('empty');

        const res = await api.post('/api/createEvent', { data: { title: 'Only a title' } });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('required');
    });

    test('updates an event', async ({ seed, api }) => {
        const data = await seed('basic');
        const event = data.named.meeting;

        const res = await api.post('/api/updateEvent', {
            data: { eventId: event._id.toString(), title: 'Renamed meeting' },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.event.title).toBe('Renamed meeting');
    });

    test('deletes an event', async ({ seed, api }) => {
        const data = await seed('basic');
        const event = data.named.clientCall;

        const res = await api.post('/api/deleteEvent', {
            data: { eventId: event._id.toString() },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.eventList.map((e) => e._id)).not.toContain(event._id.toString());
    });

    test('returns only events in the requested week', async ({ seed, api }) => {
        const data = await seed('basic');

        const anchor = new Date(data.anchor);
        const res = await api.get(`/api/getUserEvents/${anchor.toISOString()}`);
        const body = await res.json();

        expect(body.success).toBe(true);

        // Every returned event must fall inside the surrounding week window.
        const start = new Date(anchor);
        start.setUTCDate(start.getUTCDate() - start.getUTCDay());
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(anchor);
        end.setUTCDate(end.getUTCDate() + (7 - end.getUTCDay()));
        end.setUTCHours(23, 59, 59, 999);

        for (const event of body.events) {
            const eventStart = new Date(event.startDate);
            expect(eventStart.getTime()).toBeGreaterThanOrEqual(start.getTime());
            expect(eventStart.getTime()).toBeLessThanOrEqual(end.getTime());
        }
    });

    test('never returns another user\'s events', async ({ seed, api }) => {
        const data = await seed('full');

        const res = await api.get(`/api/getUserEvents/${new Date(data.anchor).toISOString()}`);
        const body = await res.json();

        expect(body.events.some((e) => e.title.includes('OTHER USER SECRET'))).toBe(false);
    });
});
