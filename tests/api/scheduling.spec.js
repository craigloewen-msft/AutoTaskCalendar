const moment = require('moment');

const { test, expect, withDb } = require('../fixtures');
const { EventDetails, TaskDetails, UserDetails } = require('../../models');
const { getWorkingHoursForDay, isWorkingDay } = require('../../controllers/scheduling');
const { taskEligibleInstant } = require('../../utils/temporal');

const MS_PER_MINUTE = 60 * 1000;

async function schedule(api) {
    const res = await api.get('/api/scheduletasks');
    expect((await res.json()).success).toBe(true);
}

async function loadUser(seed) {
    return withDb(() => UserDetails.findById(seed.last().primary.user._id));
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

test.describe('scheduling', () => {
    test('keeps scheduled work inside working windows without overlapping calendar events or other tasks', async ({
        seed,
        api,
    }) => {
        await seed();
        await schedule(api);

        const user = await loadUser(seed);
        const scheduled = await taskEvents(user);
        const existing = await calendarEvents(user);

        expect(scheduled.length).toBeGreaterThan(0);

        for (const event of scheduled) {
            expect(isWorkingDay(event.startDate, user.workingDays, user.timeZone)).toBe(true);

            const { start, end } = getWorkingHoursForDay(
                event.startDate,
                user.workingStartMinutes,
                user.workingEndMinutes,
                user.timeZone
            );
            expect(event.startDate.getTime()).toBeGreaterThanOrEqual(start.getTime());
            expect(event.endDate.getTime()).toBeLessThanOrEqual(end.getTime());

            for (const busy of existing) {
                const overlapsCalendar =
                    event.startDate.getTime() < busy.endDate.getTime()
                    && event.endDate.getTime() > busy.startDate.getTime();
                expect(overlapsCalendar, `"${event.title}" overlaps the calendar event "${busy.title}"`).toBe(false);
            }
        }

        const nonZero = scheduled.filter((event) => event.endDate.getTime() > event.startDate.getTime());
        nonZero.sort(
            (a, b) =>
                a.startDate.getTime() - b.startDate.getTime()
                || a.endDate.getTime() - b.endDate.getTime()
        );

        for (let i = 1; i < nonZero.length; i++) {
            expect(
                nonZero[i].startDate.getTime(),
                `"${nonZero[i].title}" starts before "${nonZero[i - 1].title}" ends`
            ).toBeGreaterThanOrEqual(nonZero[i - 1].endDate.getTime());
        }
    });

    test('respects task eligibility, dependencies, and chunk duration limits', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const user = await loadUser(seed);
        const events = await taskEvents(user);
        const tasks = await TaskDetails.find({ userRef: user._id });
        const byId = new Map(tasks.map((task) => [task._id.toString(), task]));

        for (const event of events) {
            const task = byId.get(event.taskRef?.toString());
            if (!task) continue;

            expect(
                event.startDate.getTime(),
                `"${task.title}" was scheduled before its start date`
            ).toBeGreaterThanOrEqual(taskEligibleInstant(task.startDate, user.timeZone).getTime());
        }

        const firstStartFor = (taskId) => {
            const matches = events.filter((event) => event.taskRef && event.taskRef.toString() === taskId);
            return matches.length ? Math.min(...matches.map((event) => event.startDate.getTime())) : null;
        };

        const research = firstStartFor(data.named.research._id.toString());
        const draft = firstStartFor(data.named.draft._id.toString());
        const publish = firstStartFor(data.named.publish._id.toString());
        if (research !== null && draft !== null) {
            expect(draft).toBeGreaterThanOrEqual(research);
        }
        if (draft !== null && publish !== null) {
            expect(publish).toBeGreaterThanOrEqual(draft);
        }

        const blockerScheduled = events.some(
            (event) => event.taskRef && event.taskRef.equals(data.named.blocker._id)
        );
        const blockedScheduled = events.some(
            (event) => event.taskRef && event.taskRef.equals(data.named.blocked._id)
        );
        if (!blockerScheduled) {
            expect(blockedScheduled).toBe(false);
        }

        for (const task of tasks.filter((task) => task.breakUpTask)) {
            const mine = events.filter((event) => event.taskRef && event.taskRef.equals(task._id));
            if (mine.length === 0) continue;

            const scheduledMinutes = mine.reduce(
                (sum, event) => sum + (event.endDate.getTime() - event.startDate.getTime()) / MS_PER_MINUTE,
                0
            );
            expect(scheduledMinutes).toBeLessThanOrEqual(task.duration);
        }
    });

    test('is idempotent, preserves calendar events, and never schedules completed tasks', async ({
        seed,
        api,
    }) => {
        await seed();

        const user = await loadUser(seed);
        const beforeCalendar = await calendarEvents(user);

        await schedule(api);
        const first = await taskEvents(user);
        const completedIds = (
            await TaskDetails.find({ userRef: user._id, completed: true }, '_id')
        ).map((task) => task._id.toString());

        for (const event of first) {
            expect(completedIds).not.toContain(event.taskRef?.toString());
        }

        await schedule(api);
        const second = await taskEvents(user);
        const afterCalendar = await calendarEvents(user);

        expect(second).toHaveLength(first.length);
        expect(second.map((event) => event.title)).toEqual(first.map((event) => event.title));
        expect(afterCalendar.map((event) => event._id.toString())).toEqual(
            beforeCalendar.map((event) => event._id.toString())
        );
    });

    test('survives hostile and dense recurring scenarios without breaking scheduling invariants', async ({
        seed,
        api,
    }) => {
        const data = await seed();

        await TaskDetails.create({
            title: 'Daily grind',
            duration: 30,
            userRef: data.primary.user._id,
            startDate: moment().startOf('day').toDate(),
            dueDate: moment().endOf('day').toDate(),
            recurrence: { freq: 'daily', interval: 1 },
        });

        await schedule(api);

        const user = await loadUser(seed);
        const events = await taskEvents(user);

        for (const event of events) {
            expect(user.workingDays).toContain(dayName(event.startDate));
            expect(event.endDate.getTime()).toBeGreaterThanOrEqual(event.startDate.getTime());
        }
    });

    test('avoids far-future calendar conflicts beyond the old 14 day horizon', async ({ seed, api }) => {
        const data = await seed();
        const far = moment().add(30, 'days').startOf('day').hour(10);
        const farEvent = await EventDetails.create({
            title: 'Far future all-hands',
            startDate: far.toDate(),
            endDate: far.clone().add(2, 'hours').toDate(),
            type: 'calendar',
            userRef: data.primary.user._id,
        });

        await schedule(api);

        const user = await loadUser(seed);
        const scheduled = await taskEvents(user);

        for (const task of scheduled) {
            const overlaps =
                task.startDate.getTime() < farEvent.endDate.getTime()
                && task.endDate.getTime() > farEvent.startDate.getTime();
            expect(overlaps, `"${task.title}" overlaps "${farEvent.title}"`).toBe(false);
        }
    });

    test('materialises recurring work on its chosen weekdays and handles DST-shaped work windows', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        await seed.clearTasks();

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

        const template = await TaskDetails.create({
            title: 'Mondays and Tuesdays only',
            duration: 30,
            userRef: data.primary.user._id,
            startDate: moment().startOf('day').toDate(),
            dueDate: moment().endOf('day').toDate(),
            recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2] },
        });

        await schedule(api);

        const user = await loadUser(seed);
        const events = await taskEvents(user);
        const occurrenceDays = new Map(
            (await TaskDetails.find({ seriesRef: template._id }))
                .map((occurrence) => [occurrence._id.toString(), occurrence.occurrenceDate])
        );
        const todayStart = moment().startOf('day').valueOf();
        const seriesEvents = events.filter((event) => {
            const occurrenceDate = event.taskRef && occurrenceDays.get(event.taskRef.toString());
            return occurrenceDate && occurrenceDate.getTime() > todayStart;
        });

        expect(seriesEvents.length).toBeGreaterThan(0);
        for (const event of seriesEvents) {
            const day = dayName(event.startDate);
            expect(['Monday', 'Tuesday']).toContain(day);
            expect(day).toBe(dayName(occurrenceDays.get(event.taskRef.toString())));
            expect(event.startDate.getTime()).toBeGreaterThanOrEqual(
                taskEligibleInstant(occurrenceDays.get(event.taskRef.toString()), user.timeZone).getTime()
            );
        }
    });

    test('analyzes blocked slots on demand without drifting from the cached forecast', async ({
        seed,
        api,
        loginAs,
    }) => {
        const data = await seed();
        const slipApi = await loginAs(data.slip.username, data.slip.password);
        const [first, , third] = data.slip.capacityTasks;

        // Before any scheduling run there is no baseline to replay, so say so.
        const unscheduled = await slipApi.post('/api/analyzeBlockedSlots', {
            data: { taskIds: [first._id.toString()] },
        });
        expect((await unscheduled.json()).success).toBe(false);

        await schedule(slipApi);

        // One id through the endpoint must equal that task's cached chip exactly.
        const single = await slipApi.post('/api/analyzeBlockedSlots', {
            data: { taskIds: [first._id.toString()] },
        });
        const { forecast } = await single.json();
        const cached = await withDb(async () => {
            const task = await TaskDetails.findById(first._id);
            return {
                movedCount: task.slipForecast.movedCount,
                newlyLateCount: task.slipForecast.newlyLateCount,
                affected: task.slipForecast.affected.map((impact) => ({
                    taskId: impact.taskId.toString(),
                    forecastStart: impact.forecastStart?.toISOString() || null,
                    forecastEnd: impact.forecastEnd?.toISOString() || null,
                    newlyLate: impact.newlyLate,
                })),
            };
        });
        expect(forecast.movedCount).toBe(cached.movedCount);
        expect(forecast.newlyLateCount).toBe(cached.newlyLateCount);
        expect(forecast.affected.map(({ taskId, forecastStart, forecastEnd, newlyLate }) => ({
            taskId,
            forecastStart,
            forecastEnd,
            newlyLate,
        }))).toEqual(cached.affected);

        // Two lost slots in a week with no slack are worse than either one alone.
        const combined = await slipApi.post('/api/analyzeBlockedSlots', {
            data: { taskIds: [first._id.toString(), third._id.toString()] },
        });
        const combinedForecast = (await combined.json()).forecast;
        expect(combinedForecast.newlyLateCount).toBeGreaterThan(cached.newlyLateCount);

        // Another user's task id is ignored, so it cannot reach their schedule.
        const foreign = await api.post('/api/analyzeBlockedSlots', {
            data: { taskIds: [first._id.toString()] },
        });
        expect((await foreign.json()).success).toBe(false);

        const empty = await slipApi.post('/api/analyzeBlockedSlots', { data: { taskIds: [] } });
        expect((await empty.json()).success).toBe(false);
    });
});
