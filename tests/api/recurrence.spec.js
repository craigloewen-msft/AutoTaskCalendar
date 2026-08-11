const moment = require('moment');

const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, UserDetails, EventDetails } = require('../../models');
const {
    occurrenceDatesBetween,
    validateRecurrence,
} = require('../../controllers/recurrence');

async function schedule(api) {
    const res = await api.get('/api/scheduletasks');
    expect((await res.json()).success).toBe(true);
}

async function complete(api, taskId) {
    const res = await api.post('/api/completeTask', { data: { taskId } });
    expect((await res.json()).success).toBe(true);
}

async function loadPrimaryUser(seed) {
    return withDb(() => UserDetails.findById(seed.last().primary.user._id));
}

async function occurrencesOf(template) {
    return withDb(() => TaskDetails.find({ seriesRef: template._id }).sort({ occurrenceDate: 1 }));
}

async function listTasks(api) {
    return (await (await api.get('/api/getUserTasks')).json()).taskList;
}

const MONDAY = moment('2024-01-01').toDate();
const days = (dates) => dates.map((date) => moment(date).format('YYYY-MM-DD'));
const dateOnly = (offset = 0) => moment.utc().add(offset, 'days').format('YYYY-MM-DD');
const baseTask = () => ({
    title: 'Repeating thing',
    duration: 30,
    startDate: dateOnly(),
    dueDate: dateOnly(1),
});

test.describe('recurrence rules', () => {
    test('generator covers daily, weekly, monthly, and DST boundaries', () => {
        const cases = [
            {
                rule: { freq: 'daily', interval: 3 },
                from: MONDAY,
                to: moment('2024-01-10').toDate(),
                anchor: MONDAY,
                expected: ['2024-01-01', '2024-01-04', '2024-01-07', '2024-01-10'],
            },
            {
                rule: { freq: 'weekly', interval: 1, byWeekday: [1, 2] },
                from: MONDAY,
                to: moment('2024-01-16').toDate(),
                anchor: MONDAY,
                expected: [
                    '2024-01-01', '2024-01-02',
                    '2024-01-08', '2024-01-09',
                    '2024-01-15', '2024-01-16',
                ],
            },
            {
                rule: { freq: 'weekly', interval: 1, byWeekday: [] },
                from: '2024-01-03',
                to: '2024-01-17',
                anchor: '2024-01-03',
                expected: ['2024-01-03', '2024-01-10', '2024-01-17'],
            },
            {
                rule: { freq: 'monthly', interval: 1, byMonthDay: [-1] },
                from: MONDAY,
                to: moment('2024-04-30').toDate(),
                anchor: MONDAY,
                expected: ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30'],
            },
        ];

        for (const { rule, from, to, anchor, expected } of cases) {
            expect(days(occurrenceDatesBetween(rule, from, to, anchor))).toEqual(expected);
        }

        for (const { rule, from, to, anchor, expected } of [
            {
                rule: { freq: 'weekly', interval: 1, byWeekday: [1] },
                from: '2024-03-04',
                to: '2024-04-08',
                anchor: '2024-03-04',
                expected: ['2024-03-04', '2024-03-11', '2024-03-18', '2024-03-25', '2024-04-01', '2024-04-08'],
            },
            {
                rule: { freq: 'weekly', interval: 1, byWeekday: [0] },
                from: '2024-10-27',
                to: '2024-11-10',
                anchor: '2024-10-27',
                expected: ['2024-10-27', '2024-11-03', '2024-11-10'],
            },
        ]) {
            const dates = occurrenceDatesBetween(rule, from, to, anchor);
            expect(days(dates)).toEqual(expected);
            expect(dates.every((date) => date.getUTCHours() === 0)).toBe(true);
        }
    });

    test('validation rejects malformed rules and repeating backlogs', async ({ seed, api }) => {
        await seed();

        expect(validateRecurrence({ freq: 'weekly', interval: 1, byWeekday: [1] })).toBeNull();
        expect(validateRecurrence({ freq: 'fortnightly' })).toContain('frequency');
        expect(validateRecurrence({ freq: 'weekly', byWeekday: [9] })).toContain('byWeekday');
        expect(validateRecurrence({ freq: 'monthly', byMonthDay: [0] })).toContain('byMonthDay');

        const invalid = await api.post('/api/createTask', {
            data: { ...baseTask(), recurrence: { freq: 'daily', interval: 0 } },
        });
        expect((await invalid.json()).success).toBe(false);

        const backlog = await api.post('/api/createTask', {
            data: {
                title: 'Repeating backlog',
                duration: 30,
                startDate: dateOnly(),
                isBacklog: true,
                recurrence: { freq: 'weekly', interval: 1 },
            },
        });
        expect((await backlog.json()).success).toBe(false);
    });
});

test.describe('recurrence expansion', () => {
    test('expansion is idempotent and hides templates from task lists', async ({ seed, api }) => {
        const data = await seed();

        await schedule(api);
        const first = await occurrencesOf(data.named.weekdaysSeries);
        expect(first.length).toBeGreaterThan(0);

        const identity = first.map((task) => ({
            id: task._id.toString(),
            occurrenceDate: task.occurrenceDate.getTime(),
        }));

        await schedule(api);
        const second = await occurrencesOf(data.named.weekdaysSeries);
        expect(second.map((task) => ({
            id: task._id.toString(),
            occurrenceDate: task.occurrenceDate.getTime(),
        }))).toEqual(identity);

        const templateId = data.named.weekdaysSeries._id.toString();
        const listed = await listTasks(api);
        expect(listed.some((task) => task._id === templateId)).toBe(false);
        expect(listed.find((task) => task.seriesRef === templateId)?.seriesRecurrence.freq).toBe('weekly');
    });

    test('completion history survives re-expansion and series cleanup', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const [first] = await occurrencesOf(data.named.weekdaysSeries);
        await complete(api, first._id.toString());

        await schedule(api);
        const sameDate = await withDb(() => TaskDetails.findOne({
            seriesRef: data.named.weekdaysSeries._id,
            occurrenceDate: first.occurrenceDate,
        }));
        expect(sameDate._id.toString()).toBe(first._id.toString());
        expect(sameDate.completed).toBe(true);

        const stale = await withDb(() => TaskDetails.create({
            title: 'Missed standup',
            duration: 15,
            userRef: data.primary.user._id,
            seriesRef: data.named.weekdaysSeries._id,
            occurrenceDate: moment().startOf('day').subtract(7, 'days').toDate(),
            dueDate: moment().startOf('day').subtract(7, 'days').toDate(),
            startDate: moment().startOf('day').subtract(7, 'days').toDate(),
            completed: false,
        }));
        const historical = await withDb(() => TaskDetails.create({
            title: 'Completed standup',
            duration: 15,
            userRef: data.primary.user._id,
            seriesRef: data.named.weekdaysSeries._id,
            occurrenceDate: moment().startOf('day').subtract(8, 'days').toDate(),
            dueDate: moment().startOf('day').subtract(8, 'days').toDate(),
            startDate: moment().startOf('day').subtract(8, 'days').toDate(),
            completed: true,
            completedDate: moment().subtract(8, 'days').toDate(),
        }));

        await schedule(api);
        expect(await withDb(() => TaskDetails.findById(stale._id))).toBeNull();
        expect(await withDb(() => TaskDetails.findById(historical._id))).not.toBeNull();

        await withDb(() => TaskDetails.updateOne(
            { _id: data.named.weekdaysSeries._id },
            { $set: { completed: true, completedDate: new Date() } }
        ));
        await schedule(api);

        const pending = await withDb(() => TaskDetails.find({
            seriesRef: data.named.weekdaysSeries._id,
            $or: [{ completed: false }, { completed: null }],
        }));
        expect(pending).toHaveLength(0);
        expect(await withDb(() => TaskDetails.findById(first._id))).not.toBeNull();
    });

    test('editing and deleting a series prune incomplete occurrences but keep history', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const [first] = await occurrencesOf(data.named.weekdaysSeries);
        await complete(api, first._id.toString());

        const editRes = await api.post('/api/editTask', {
            data: {
                task: {
                    _id: data.named.weekdaysSeries._id.toString(),
                    recurrence: { freq: 'weekly', interval: 1, byWeekday: [5] },
                },
            },
        });
        expect((await editRes.json()).success).toBe(true);

        const afterEdit = await occurrencesOf(data.named.weekdaysSeries);
        let pending = afterEdit.filter((task) => !task.completed);
        expect(pending.length).toBeGreaterThan(0);
        expect(pending.every((task) => moment(task.occurrenceDate).day() === 5)).toBe(true);
        expect(afterEdit.some((task) => task._id.equals(first._id) && task.completed)).toBe(true);

        const editOccurrence = await api.post('/api/editTask', {
            data: {
                task: {
                    _id: pending[0]._id.toString(),
                    title: 'Renamed through an occurrence',
                    duration: 25,
                    seriesRef: pending[0].seriesRef.toString(),
                    occurrenceDate: pending[0].occurrenceDate,
                    completed: false,
                    scheduledDate: pending[0].scheduledDate,
                },
            },
        });
        expect((await editOccurrence.json()).success).toBe(true);

        const template = await withDb(() => TaskDetails.findById(data.named.weekdaysSeries._id));
        expect(template.seriesRef).toBeNull();
        expect(template.occurrenceDate).toBeNull();
        expect(template.recurrence.freq).toBe('weekly');

        pending = (await occurrencesOf(data.named.weekdaysSeries)).filter((task) => !task.completed);
        expect(pending.length).toBeGreaterThan(0);

        const deleteRes = await api.post('/api/deleteTask', { data: { taskId: pending[0]._id.toString() } });
        expect((await deleteRes.json()).success).toBe(true);

        const remaining = await occurrencesOf(data.named.weekdaysSeries);
        expect(remaining).toHaveLength(1);
        expect(remaining[0]._id.toString()).toBe(first._id.toString());
        expect(remaining[0].completed).toBe(true);
        expect(await withDb(() => TaskDetails.findById(data.named.weekdaysSeries._id))).toBeNull();
    });

    test('legacy repeat strings still expand through the current recurrence path', async ({ seed, api }) => {
        await seed();
        await schedule(api);

        const user = await loadPrimaryUser(seed);
        const legacy = await withDb(() => TaskDetails.findOne({
            userRef: user._id,
            title: 'Recurring weekly check-in',
        }));
        expect(legacy.recurrence.freq).toBe('weekly');
        expect((await occurrencesOf(legacy)).length).toBeGreaterThan(0);

        const createRes = await api.post('/api/createTask', {
            data: { ...baseTask(), title: 'Weekly by string', repeat: 'weekly' },
        });
        const body = await createRes.json();
        expect(body.success).toBe(true);
        expect(body.taskList.some((task) => task.title === 'Weekly by string' && !!task.seriesRef)).toBe(true);
    });

    test('a new series is visible immediately in the create response', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: {
                title: 'Instant series',
                duration: 30,
                startDate: dateOnly(),
                dueDate: dateOnly(1),
                recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2] },
            },
        });
        const body = await res.json();

        const mine = body.taskList.filter((task) => task.title === 'Instant series');
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((task) => !!task.seriesRef)).toBe(true);
    });
});

test.describe('scheduling a recurring series', () => {
    test('scheduler places a weekly Monday series once per Monday', async ({ seed, loginAs }) => {
        const data = await seed();
        const recurruserApi = await loginAs(data.recurring.username);

        const scheduled = await recurruserApi.get('/api/scheduletasks');
        expect((await scheduled.json()).success).toBe(true);

        const user = await withDb(() => UserDetails.findById(data.recurring.user._id));
        const events = await withDb(() => EventDetails.find({
            userRef: user._id,
            title: data.named.mondaySeries.title,
        }));
        expect(events.length).toBeGreaterThan(0);

        const eventDays = events.map((event) => moment.utc(event.startDate).format('YYYY-MM-DD'));
        expect(eventDays.every((day) => moment.utc(day, 'YYYY-MM-DD').day() === 1)).toBe(true);
        expect(new Set(eventDays).size).toBe(eventDays.length);
    });
});
