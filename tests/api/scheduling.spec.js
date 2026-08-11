const mongoose = require('mongoose');
const moment = require('moment');

const { test, expect, withDb } = require('../fixtures');
const { EventDetails, TaskDetails, UserDetails } = require('../../models');
const {
    getWorkingHoursForDay,
    isWorkingDay,
    SCHEDULING_HORIZON_DAYS,
} = require('../../controllers/scheduling');
const { taskEligibleInstant } = require('../../utils/temporal');

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
    return withDb(() => UserDetails.findOne({ username }));
}

async function taskEvents(user) {
    return withDb(() =>
        EventDetails.find({
            userRef: user._id,
            type: { $in: ['task', 'task-chunk'] },
        }).sort({ startDate: 1 })
    );
}

async function calendarEvents(user) {
    return withDb(() =>
        EventDetails.find({ userRef: user._id, type: 'calendar' }).sort({ startDate: 1 })
    );
}

function dayName(date) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function nextWorkingDate(user, minimumDays = 1) {
    let day = moment.utc().add(minimumDays, 'days').startOf('day');
    while (!user.workingDays.includes(day.format('dddd'))) {
        day.add(1, 'day');
    }
    return day;
}

async function createAvailabilitySeries(user, title, occurrenceDay, unavailableBehavior, overrides = {}) {
    return TaskDetails.create({
        title,
        duration: 30,
        userRef: user._id,
        startDate: occurrenceDay.toDate(),
        dueDate: occurrenceDay.toDate(),
        recurrence: {
            freq: 'weekly',
            interval: 1,
            byWeekday: [occurrenceDay.day()],
            unavailableBehavior,
        },
        ...overrides,
    });
}

async function blockWorkingDay(user, occurrenceDay, title = 'Unavailable all day') {
    return EventDetails.create({
        title,
        startDate: occurrenceDay.clone().startOf('day').toDate(),
        endDate: occurrenceDay.clone().add(1, 'day').startOf('day').toDate(),
        type: 'calendar',
        userRef: user._id,
    });
}

test.describe('scheduling', () => {
    test('schedules tasks only inside working hours on working days', async ({ seed, api }) => {
        await seed();
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        expect(events.length).toBeGreaterThan(0);

        for (const event of events) {
            expect(isWorkingDay(event.startDate, user.workingDays, user.timeZone)).toBe(true);

            const { start, end } = getWorkingHoursForDay(
                event.startDate,
                user.workingStartMinutes,
                user.workingEndMinutes,
                user.timeZone
            );
            expect(event.startDate.getTime()).toBeGreaterThanOrEqual(start.getTime());
            expect(event.endDate.getTime()).toBeLessThanOrEqual(end.getTime());
        }
    });

    test('builds wall-clock work windows across DST and non-hour zones', () => {
        const spring = getWorkingHoursForDay(
            new Date('2024-03-10T12:00:00Z'),
            0,
            8 * 60,
            'America/New_York'
        );
        expect(spring.start.toISOString()).toBe('2024-03-10T05:00:00.000Z');
        expect(spring.end.toISOString()).toBe('2024-03-10T12:00:00.000Z');

        const fall = getWorkingHoursForDay(
            new Date('2024-11-03T12:00:00Z'),
            0,
            8 * 60,
            'America/New_York'
        );
        expect(fall.start.toISOString()).toBe('2024-11-03T04:00:00.000Z');
        expect(fall.end.toISOString()).toBe('2024-11-03T13:00:00.000Z');

        const kathmandu = getWorkingHoursForDay(
            new Date('2024-01-15T12:00:00Z'),
            9 * 60 + 30,
            17 * 60 + 30,
            'Asia/Kathmandu'
        );
        expect(kathmandu.start.toISOString()).toBe('2024-01-15T03:45:00.000Z');
    });

    test('never overlaps an existing calendar event', async ({ seed, api }) => {
        await seed();
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
        await seed();
        await schedule(api);

        const user = await loadUser();

        // Zero-length blocks (from the zero-duration task) occupy no time, so they cannot
        // overlap anything. Including them would flag a shared instant as a collision.
        const events = (await taskEvents(user)).filter(
            (e) => e.endDate.getTime() > e.startDate.getTime()
        );

        // Sort by start, then end, so equal start times compare deterministically.
        events.sort(
            (a, b) =>
                a.startDate.getTime() - b.startDate.getTime() ||
                a.endDate.getTime() - b.endDate.getTime()
        );

        for (let i = 1; i < events.length; i++) {
            expect(
                events[i].startDate.getTime(),
                `"${events[i].title}" starts before "${events[i - 1].title}" ends`
            ).toBeGreaterThanOrEqual(events[i - 1].endDate.getTime());
        }
    });

    test('never schedules a task before its dependency', async ({ seed, api }) => {
        const data = await seed();
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
        await seed();
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
            ).toBeGreaterThanOrEqual(taskEligibleInstant(task.startDate, user.timeZone).getTime());
        }
    });

    test('broken up tasks emit chunks that never exceed the total duration', async ({ seed, api }) => {
        await seed();
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
        await seed();
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
        await seed();

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
        await seed();

        const user = await loadUser();
        const before = await calendarEvents(user);

        await schedule(api);

        const after = await calendarEvents(user);
        expect(after.map((e) => e._id.toString())).toEqual(before.map((e) => e._id.toString()));
    });

    test('survives the hostile edge scenario without hanging', async ({ seed, api }) => {
        await seed();

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
        const data = await seed();
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
        await seed.clearTasks();
        await schedule(api);

        const user = await loadUser();
        expect(await taskEvents(user)).toHaveLength(0);
    });

    test('never overlaps a calendar event beyond the old 14 day horizon', async ({ seed, api }) => {
        const data = await seed();

        // Regression: the events query used a 14 day horizon while the scheduling loop was
        // unbounded, so anything scheduled past day 14 was placed with no knowledge of the
        // user's real calendar and could sit straight on top of it.
        const far = moment().add(30, 'days').startOf('day').hour(10);
        const farEvent = await EventDetails.create({
            title: 'Far future all-hands',
            startDate: far.toDate(),
            endDate: far.clone().add(2, 'hours').toDate(),
            type: 'calendar',
            userRef: data.primary.user._id,
        });

        await schedule(api);

        const user = await loadUser();
        const scheduled = await taskEvents(user);

        for (const task of scheduled) {
            const overlaps =
                task.startDate.getTime() < farEvent.endDate.getTime() &&
                task.endDate.getTime() > farEvent.startDate.getTime();

            expect(overlaps, `"${task.title}" overlaps "${farEvent.title}"`).toBe(false);
        }
    });

    test('an occurrence is never scheduled before its occurrence date', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);

        const occurrences = await TaskDetails.find({
            seriesRef: data.named.weekdaysSeries._id,
        });
        expect(occurrences.length).toBeGreaterThan(0);
        const byId = new Map(occurrences.map((o) => [o._id.toString(), o]));

        // The scheduler is best-effort on deadlines: a busy day pushes work later, exactly
        // as it does for any overdue task. What it must never do is schedule an occurrence
        // EARLY, before the day it is for.
        for (const event of events) {
            const occurrence = byId.get(event.taskRef?.toString());
            if (!occurrence) continue;

            expect(
                event.startDate.getTime(),
                `"${occurrence.title}" was scheduled before its occurrence date`
            ).toBeGreaterThanOrEqual(
                taskEligibleInstant(occurrence.occurrenceDate, user.timeZone).getTime()
            );
        }
    });

    test('recurring occurrences land on their chosen weekdays when the calendar has room', async ({ seed, api }) => {
        const data = await seed();

        // The seeded dataset deliberately overloads the calendar, which makes every task
        // slip. Start from an empty account so this measures the recurrence rule rather
        // than contention with 90 other tasks.
        await seed.clearTasks();

        const template = await TaskDetails.create({
            title: 'Mondays and Tuesdays only',
            duration: 30,
            userRef: data.primary.user._id,
            startDate: moment().startOf('day').toDate(),
            dueDate: moment().endOf('day').toDate(),
            recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2] },
        });

        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        const occurrenceDays = new Map(
            (await TaskDetails.find({ seriesRef: template._id }))
                .map((o) => [o._id.toString(), o.occurrenceDate])
        );

        // Today's own occurrence is excluded deliberately. Run this after working hours
        // and there is no slot left today, so the scheduler moves it to the next working
        // day -- correct behaviour, but it would make the assertion depend on the clock.
        const todayStart = moment().startOf('day').valueOf();
        const seriesEvents = events.filter((e) => {
            const occurrenceDate = e.taskRef && occurrenceDays.get(e.taskRef.toString());
            return occurrenceDate && occurrenceDate.getTime() > todayStart;
        });

        expect(seriesEvents.length).toBeGreaterThan(0);
        for (const event of seriesEvents) {
            const day = dayName(event.startDate);

            expect(['Monday', 'Tuesday']).toContain(day);
            // Stronger than the rule alone: each occurrence keeps its own weekday rather
            // than sliding onto the other one.
            expect(day).toBe(dayName(occurrenceDays.get(event.taskRef.toString())));
        }
    });

    test('default recurring behavior skips a blocked occurrence and clears stale placement', async ({ seed, api }) => {
        const data = await seed();
        await seed.clearTasks();
        const user = await loadUser();
        const occurrenceDay = nextWorkingDate(user, 2);
        const template = await createAvailabilitySeries(
            user,
            'Skip blocked occurrence',
            occurrenceDay,
            undefined
        );

        await schedule(api);
        let target = await TaskDetails.findOne({
            seriesRef: template._id,
            occurrenceDate: occurrenceDay.toDate(),
        });
        expect(target.scheduledDate).not.toBeNull();

        await blockWorkingDay(user, occurrenceDay);
        await schedule(api);

        target = await TaskDetails.findById(target._id);
        const events = await taskEvents(user);
        expect(target.scheduledDate).toBeNull();
        expect(events.some((event) => event.taskRef?.equals(target._id))).toBe(false);
    });

    test('next-available recurring behavior carries a blocked occurrence later', async ({ seed, api }) => {
        const data = await seed();
        await seed.clearTasks();
        const user = await loadUser();
        const occurrenceDay = nextWorkingDate(user, 2);
        const template = await createAvailabilitySeries(
            user,
            'Defer blocked occurrence',
            occurrenceDay,
            'next-available'
        );
        await blockWorkingDay(user, occurrenceDay);

        await schedule(api);

        const target = await TaskDetails.findOne({
            seriesRef: template._id,
            occurrenceDate: occurrenceDay.toDate(),
        });
        const event = (await taskEvents(user)).find((candidate) => candidate.taskRef?.equals(target._id));
        const nextDayStart = occurrenceDay.clone().add(1, 'day').startOf('day');

        expect(event).toBeTruthy();
        expect(event.startDate.getTime()).toBeGreaterThanOrEqual(nextDayStart.valueOf());
        expect(isWorkingDay(event.startDate, user.workingDays, user.timeZone)).toBe(true);
        expect(target.occurrenceDate.getTime()).toBe(occurrenceDay.valueOf());
    });

    test('a skipped chunked occurrence never spills chunks into another day', async ({ seed, api }) => {
        const data = await seed();
        await seed.clearTasks();
        const user = await loadUser();
        const occurrenceDay = nextWorkingDate(user, 2);
        const template = await createAvailabilitySeries(
            user,
            'Chunk only today',
            occurrenceDay,
            'skip',
            {
                duration: 120,
                breakUpTask: true,
                breakUpTaskChunkDuration: 30,
            }
        );
        const workStart = occurrenceDay.clone().startOf('day').add(user.workingStartMinutes, 'minutes');
        await EventDetails.create({
            title: 'Busy after first chunk',
            startDate: workStart.clone().add(30, 'minutes').toDate(),
            endDate: occurrenceDay.clone().add(1, 'day').startOf('day').toDate(),
            type: 'calendar',
            userRef: user._id,
        });

        await schedule(api);

        const target = await TaskDetails.findOne({
            seriesRef: template._id,
            occurrenceDate: occurrenceDay.toDate(),
        });
        const mine = (await taskEvents(user)).filter((event) => event.taskRef?.equals(target._id));
        const nextDayStart = occurrenceDay.clone().add(1, 'day').startOf('day').valueOf();

        expect(mine).toHaveLength(1);
        expect(mine.every((event) => event.startDate.getTime() < nextDayStart)).toBe(true);
        expect(target.scheduledDate).toBeNull();
    });

    test('next-available placement stops at the known calendar horizon', async ({ seed, api }) => {
        expect(Number.isInteger(SCHEDULING_HORIZON_DAYS)).toBe(true);
        const data = await seed();
        await seed.clearTasks();
        const user = await loadUser();
        const occurrenceDay = moment.utc().add(SCHEDULING_HORIZON_DAYS, 'days').startOf('day');
        const template = await createAvailabilitySeries(
            user,
            'Deferred beyond known calendar',
            occurrenceDay,
            'next-available'
        );
        await EventDetails.create({
            title: 'Blocked through the horizon',
            startDate: occurrenceDay.toDate(),
            endDate: occurrenceDay.clone().add(2, 'days').toDate(),
            type: 'calendar',
            userRef: user._id,
        });

        await schedule(api);

        const target = await TaskDetails.findOne({
            seriesRef: template._id,
            occurrenceDate: occurrenceDay.toDate(),
        });
        const mine = (await taskEvents(user)).filter((event) => event.taskRef?.equals(target._id));
        expect(mine).toHaveLength(0);
        expect(target.scheduledDate).toBeNull();
    });

    test('a daily series across the horizon does not trip the iteration guard', async ({ seed, api }) => {
        const data = await seed();

        // A daily series over a 60 day horizon is the worst realistic case for the
        // scheduling loop; the suite timeout is the real assertion.
        await TaskDetails.create({
            title: 'Daily grind',
            duration: 30,
            userRef: data.primary.user._id,
            startDate: moment().startOf('day').toDate(),
            dueDate: moment().endOf('day').toDate(),
            recurrence: { freq: 'daily', interval: 1 },
        });

        await schedule(api);

        const user = await loadUser();
        const events = await taskEvents(user);
        for (const event of events) {
            expect(user.workingDays).toContain(dayName(event.startDate));
        }
    });
});
