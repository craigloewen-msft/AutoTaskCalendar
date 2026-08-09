const mongoose = require('mongoose');

const { test, expect } = require('../fixtures');
const { EventDetails, TaskDetails, UserDetails } = require('../../models');

const MS_PER_MINUTE = 60 * 1000;

/**
 * Scheduling is inherently time-dependent, so these tests assert INVARIANTS rather than
 * exact timestamps. That keeps them meaningful without making them brittle.
 */

async function schedule(api) {
    const res = await api.get('/api/scheduletasks');
    expect((await res.json()).success).toBe(true);
}

async function loadUser(username = 'testuser') {
    return UserDetails.findOne({ username });
}

async function taskEvents(user) {
    return EventDetails.find({
        userRef: user._id,
        type: { $in: ['task', 'task-chunk'] },
    }).sort({ startDate: 1 });
}

async function calendarEvents(user) {
    return EventDetails.find({ userRef: user._id, type: 'calendar' }).sort({ startDate: 1 });
}

function dayName(date) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
}

test.describe('scheduling', () => {
    test('schedules tasks only inside working hours on working days', async ({ seed, api }) => {
        await seed('full');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        expect(events.length).toBeGreaterThan(0);

        const startHour = user.workingStartTime.getHours();
        const startMinute = user.workingStartTime.getMinutes();

        for (const event of events) {
            expect(user.workingDays).toContain(dayName(event.startDate));

            const dayStart = new Date(event.startDate);
            dayStart.setHours(startHour, startMinute, 0, 0);
            const dayEnd = new Date(dayStart.getTime() + user.workingDuration * 60 * MS_PER_MINUTE);

            expect(event.startDate.getTime()).toBeGreaterThanOrEqual(dayStart.getTime());
            expect(event.endDate.getTime()).toBeLessThanOrEqual(dayEnd.getTime());
        }
    });

    test('never overlaps an existing calendar event', async ({ seed, api }) => {
        await seed('full');
        await schedule(api);

        const user = await loadUser();
        const scheduled = await taskEvents(user);
        const existing = await calendarEvents(user);

        for (const task of scheduled) {
            for (const busy of existing) {
                const overlaps =
                    task.startDate.getTime() < busy.endDate.getTime() &&
                    task.endDate.getTime() > busy.startDate.getTime();

                expect(
                    overlaps,
                    `"${task.title}" overlaps the calendar event "${busy.title}"`
                ).toBe(false);
            }
        }
    });

    test('never overlaps another scheduled task', async ({ seed, api }) => {
        await seed('full');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);

        for (let i = 1; i < events.length; i++) {
            expect(
                events[i].startDate.getTime(),
                `"${events[i].title}" starts before "${events[i - 1].title}" ends`
            ).toBeGreaterThanOrEqual(events[i - 1].endDate.getTime());
        }
    });

    test('never schedules a task before its dependency', async ({ seed, api }) => {
        const data = await seed('full');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);

        const firstStartFor = (taskId) => {
            const matches = events.filter((e) => e.taskRef && e.taskRef.toString() === taskId);
            return matches.length ? Math.min(...matches.map((e) => e.startDate.getTime())) : null;
        };

        const research = firstStartFor(data.named.research._id.toString());
        const draft = firstStartFor(data.named.draft._id.toString());
        const publish = firstStartFor(data.named.publish._id.toString());

        // Only compare the ones that actually got scheduled within the horizon.
        if (research !== null && draft !== null) {
            expect(draft).toBeGreaterThanOrEqual(research);
        }
        if (draft !== null && publish !== null) {
            expect(publish).toBeGreaterThanOrEqual(draft);
        }
    });

    test('never schedules a task before its start date', async ({ seed, api }) => {
        await seed('full');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        const tasks = await TaskDetails.find({ userRef: user._id });
        const byId = new Map(tasks.map((t) => [t._id.toString(), t]));

        for (const event of events) {
            const task = byId.get(event.taskRef?.toString());
            if (!task) continue;

            expect(
                event.startDate.getTime(),
                `"${task.title}" was scheduled before its start date`
            ).toBeGreaterThanOrEqual(task.startDate.getTime());
        }
    });

    test('broken up tasks emit chunks that never exceed the total duration', async ({ seed, api }) => {
        await seed('full');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        const chunked = await TaskDetails.find({ userRef: user._id, breakUpTask: true });

        for (const task of chunked) {
            const mine = events.filter((e) => e.taskRef && e.taskRef.equals(task._id));
            if (mine.length === 0) continue;

            const scheduledMinutes = mine.reduce(
                (sum, e) => sum + (e.endDate.getTime() - e.startDate.getTime()) / MS_PER_MINUTE,
                0
            );

            expect(scheduledMinutes).toBeLessThanOrEqual(task.duration);
        }
    });

    test('completed tasks are never scheduled', async ({ seed, api }) => {
        await seed('full');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        const completedIds = (
            await TaskDetails.find({ userRef: user._id, completed: true }, '_id')
        ).map((t) => t._id.toString());

        for (const event of events) {
            expect(completedIds).not.toContain(event.taskRef?.toString());
        }
    });

    test('re-running the scheduler is idempotent', async ({ seed, api }) => {
        await seed('full');

        await schedule(api);
        const user = await loadUser();
        const first = await taskEvents(user);

        await schedule(api);
        const second = await taskEvents(user);

        // Same number of blocks, same titles in the same order: no drift, no duplicates.
        expect(second).toHaveLength(first.length);
        expect(second.map((e) => e.title)).toEqual(first.map((e) => e.title));
    });

    test('scheduling does not touch the user\'s own calendar events', async ({ seed, api }) => {
        await seed('full');

        const user = await loadUser();
        const before = await calendarEvents(user);

        await schedule(api);

        const after = await calendarEvents(user);
        expect(after.map((e) => e._id.toString())).toEqual(before.map((e) => e._id.toString()));
    });

    test('survives the hostile edge scenario without hanging', async ({ seed, api }) => {
        await seed('edge');

        // The suite's 30s timeout is the real assertion here: a scheduler that deadlocks on
        // an unschedulable task or an unmet dependency fails this test.
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);

        for (const event of events) {
            expect(user.workingDays).toContain(dayName(event.startDate));
            expect(event.endDate.getTime()).toBeGreaterThanOrEqual(event.startDate.getTime());
        }
    });

    test('does not schedule a task whose dependency is unschedulable', async ({ seed, api }) => {
        const data = await seed('edge');
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);

        const blockerScheduled = events.some(
            (e) => e.taskRef && e.taskRef.equals(data.named.blocker._id)
        );
        const blockedScheduled = events.some(
            (e) => e.taskRef && e.taskRef.equals(data.named.blocked._id)
        );

        // The blocker cannot fit in a working day, so the task waiting on it must not run.
        if (!blockerScheduled) {
            expect(blockedScheduled).toBe(false);
        }
    });

    test('an empty task list produces no scheduled events', async ({ seed, api }) => {
        await seed('empty');
        await schedule(api);

        const user = await loadUser();
        expect(await taskEvents(user)).toHaveLength(0);
    });
});
