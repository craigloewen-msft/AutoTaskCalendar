const moment = require('moment');

const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, UserDetails } = require('../../models');
const {
    occurrenceDatesBetween,
    describeRecurrence,
    validateRecurrence,
} = require('../../controllers/recurrence');

/**
 * Recurrence has two halves, tested differently:
 *
 *   1. The generator is pure, so it is asserted against exact dates.
 *   2. Expansion touches the database and the clock, so it is asserted through the API
 *      as INVARIANTS (idempotence, pruning, history) rather than fixed timestamps.
 */

async function schedule(api) {
    const res = await api.get('/api/scheduletasks');
    expect((await res.json()).success).toBe(true);
}

async function loadUser(username = 'testuser') {
    return withDb(() => UserDetails.findOne({ username }));
}

async function occurrencesOf(template) {
    return withDb(() => TaskDetails.find({ seriesRef: template._id }).sort({ occurrenceDate: 1 }));
}

// A Monday, so weekday expectations read clearly.
const MONDAY = moment('2024-01-01').toDate();
const days = (dates) => dates.map((d) => moment(d).format('YYYY-MM-DD'));
const dateOnly = (offset = 0) => moment.utc().add(offset, 'days').format('YYYY-MM-DD');

test.describe('recurrence rules', () => {
    test('weekly byWeekday generates only the chosen days', () => {
        const dates = occurrenceDatesBetween(
            { freq: 'weekly', interval: 1, byWeekday: [1, 2] },
            MONDAY,
            moment('2024-01-16').toDate(),
            MONDAY
        );

        expect(days(dates)).toEqual([
            '2024-01-01', '2024-01-02',
            '2024-01-08', '2024-01-09',
            '2024-01-15', '2024-01-16',
        ]);
        expect(dates.every((d) => [1, 2].includes(moment(d).day()))).toBe(true);
    });

    test('interval skips periods', () => {
        const fortnightly = occurrenceDatesBetween(
            { freq: 'weekly', interval: 2, byWeekday: [1] },
            MONDAY,
            moment('2024-02-12').toDate(),
            MONDAY
        );
        expect(days(fortnightly)).toEqual(['2024-01-01', '2024-01-15', '2024-01-29', '2024-02-12']);

        const everyThirdDay = occurrenceDatesBetween(
            { freq: 'daily', interval: 3 },
            MONDAY,
            moment('2024-01-10').toDate(),
            MONDAY
        );
        expect(days(everyThirdDay)).toEqual(['2024-01-01', '2024-01-04', '2024-01-07', '2024-01-10']);
    });

    test('monthly byMonthDay 31 simply skips short months', () => {
        const dates = occurrenceDatesBetween(
            { freq: 'monthly', interval: 1, byMonthDay: [31] },
            MONDAY,
            moment('2024-06-30').toDate(),
            MONDAY
        );

        // February, April and June have no 31st, so the rule does not fire. It must never
        // roll over into the 1st of the next month.
        expect(days(dates)).toEqual(['2024-01-31', '2024-03-31', '2024-05-31']);
    });

    test('monthly -1 means the last day, including in a leap February', () => {
        const dates = occurrenceDatesBetween(
            { freq: 'monthly', interval: 1, byMonthDay: [-1] },
            MONDAY,
            moment('2024-04-30').toDate(),
            MONDAY
        );

        expect(days(dates)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
    });

    test('endsOn and endsAfter stop generation', () => {
        const until = occurrenceDatesBetween(
            { freq: 'daily', interval: 1, endsOn: moment('2024-01-04').toDate() },
            MONDAY,
            moment('2024-01-31').toDate(),
            MONDAY
        );
        expect(days(until)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']);

        const counted = occurrenceDatesBetween(
            { freq: 'daily', interval: 1, endsAfter: 3 },
            MONDAY,
            moment('2024-01-31').toDate(),
            MONDAY
        );
        expect(days(counted)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    });

    test('endsAfter counts from the series start, not from the window', () => {
        // Three occurrences ever, all before this window, so the window yields nothing.
        const dates = occurrenceDatesBetween(
            { freq: 'daily', interval: 1, endsAfter: 3 },
            moment('2024-01-10').toDate(),
            moment('2024-01-31').toDate(),
            MONDAY
        );

        expect(dates).toHaveLength(0);
    });

    test('a weekly series keeps its weekday across a DST boundary', () => {
        // 10 March 2024 is the US DST switch; 31 March is the EU one.
        const dates = occurrenceDatesBetween(
            { freq: 'weekly', interval: 1, byWeekday: [1] },
            moment('2024-03-04').toDate(),
            moment('2024-04-08').toDate(),
            moment('2024-03-04').toDate()
        );

        expect(dates).toHaveLength(6);
        expect(dates.every((d) => moment(d).day() === 1)).toBe(true);
        // Local midnight, not 23:00 the day before: proof the walk is not using fixed ms.
        expect(dates.every((d) => moment(d).hour() === 0)).toBe(true);
    });

    test('keeps recurrence dates stable across the fall DST transition', () => {
        const dates = occurrenceDatesBetween(
            { freq: 'weekly', interval: 1, byWeekday: [0] },
            '2024-10-27',
            '2024-11-10',
            '2024-10-27'
        );
        expect(days(dates)).toEqual(['2024-10-27', '2024-11-03', '2024-11-10']);
        expect(dates.every((date) => date.getUTCHours() === 0)).toBe(true);
    });

    test('generates current occurrences for series older than the iteration guard', () => {
        const dates = occurrenceDatesBetween(
            { freq: 'daily', interval: 1 },
            '2026-01-01',
            '2026-01-03',
            '2010-01-01'
        );
        expect(days(dates)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    });

    test('a weekly rule with no chosen weekday repeats weekly, not daily', () => {
        // A legacy `repeat: 'weekly'` string carries no byWeekday, and "no days" must not
        // mean "every day".
        const rule = { freq: 'weekly', interval: 1, byWeekday: [] };
        const dates = occurrenceDatesBetween(rule, MONDAY, moment(MONDAY).add(20, 'days').toDate(), MONDAY);

        expect(days(dates)).toEqual(['2024-01-01', '2024-01-08', '2024-01-15']);
    });

    test('a weekly rule with no chosen weekday follows its own start day', () => {
        // Anchored on a Wednesday, so the fallback cannot accidentally be "Monday".
        const wednesday = moment('2024-01-03').toDate();
        const rule = { freq: 'weekly', interval: 1, byWeekday: [] };
        const dates = occurrenceDatesBetween(rule, wednesday, moment(wednesday).add(20, 'days').toDate(), wednesday);

        expect(days(dates)).toEqual(['2024-01-03', '2024-01-10', '2024-01-17']);
        expect(dates.every((d) => moment(d).day() === 3)).toBe(true);
    });

    test('describes a rule in plain English', () => {
        expect(describeRecurrence({ freq: 'weekly', interval: 1, byWeekday: [1, 2] }))
            .toBe('Every week on Monday and Tuesday');
        expect(describeRecurrence({ freq: 'weekly', interval: 2, byWeekday: [1] }))
            .toBe('Every 2 weeks on Monday');
        expect(describeRecurrence({ freq: 'monthly', interval: 1, byMonthDay: [-1] }))
            .toBe('Every month on the last day');
        expect(describeRecurrence({ freq: 'daily', interval: 1, endsAfter: 5 }))
            .toBe('Every day, 5 times');
        expect(describeRecurrence(null)).toBe('Does not repeat');
    });

    test('validation accepts good rules and rejects bad ones', () => {
        expect(validateRecurrence(null)).toBeNull();
        expect(validateRecurrence({ freq: 'weekly', interval: 1, byWeekday: [0, 6] })).toBeNull();
        expect(validateRecurrence({ freq: 'daily', unavailableBehavior: 'skip' })).toBeNull();
        expect(validateRecurrence({ freq: 'daily', unavailableBehavior: 'next-available' })).toBeNull();

        expect(validateRecurrence({ freq: 'fortnightly' })).toContain('frequency');
        expect(validateRecurrence({ freq: 'daily', interval: 0 })).toContain('interval');
        expect(validateRecurrence({ freq: 'weekly', byWeekday: [9] })).toContain('byWeekday');
        expect(validateRecurrence({ freq: 'monthly', byMonthDay: [0] })).toContain('byMonthDay');
        expect(validateRecurrence({ freq: 'daily', endsAfter: 0 })).toContain('endsAfter');
        expect(validateRecurrence({ freq: 'daily', unavailableBehavior: 'later' }))
            .toContain('unavailableBehavior');
    });
});

test.describe('recurrence expansion', () => {
    test('materialises occurrences on the intended weekdays', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const occurrences = await occurrencesOf(data.named.weekdaysSeries);

        expect(occurrences.length).toBeGreaterThan(0);
        expect(
            occurrences.every((o) => [1, 2].includes(moment(o.occurrenceDate).day()))
        ).toBe(true);
    });

    test('expansion is idempotent', async ({ seed, api }) => {
        const data = await seed();

        await schedule(api);
        const first = await occurrencesOf(data.named.weekdaysSeries);

        await schedule(api);
        const second = await occurrencesOf(data.named.weekdaysSeries);

        // Same count AND the same documents: a re-run must not churn identities.
        expect(second).toHaveLength(first.length);
        expect(second.map((o) => o._id.toString())).toEqual(first.map((o) => o._id.toString()));
    });

    test('each occurrence carries its own canonical due day', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const occurrences = await occurrencesOf(data.named.weekdaysSeries);

        for (const occurrence of occurrences) {
            expect(occurrence.dueDate.getTime()).toBe(occurrence.occurrenceDate.getTime());
            expect(occurrence.dueDate.getUTCHours()).toBe(0);
        }
    });

    test('the series template is never listed and never scheduled', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const templateId = data.named.weekdaysSeries._id.toString();

        const list = await (await api.get('/api/getUserTasks')).json();
        expect(list.taskList.some((t) => t._id === templateId)).toBe(false);

        const user = await loadUser();
        const { EventDetails } = require('../../models');
        const events = await EventDetails.find({
            userRef: user._id,
            type: { $in: ['task', 'task-chunk'] },
        });
        expect(events.some((e) => e.taskRef && e.taskRef.toString() === templateId)).toBe(false);
    });

    test('completing occurrences leaves one record per completion', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const occurrences = await occurrencesOf(data.named.weekdaysSeries);
        const [first, second] = occurrences;

        await api.post('/api/completeTask', { data: { taskId: first._id.toString() } });
        await api.post('/api/completeTask', { data: { taskId: second._id.toString() } });

        const completed = await TaskDetails.find({
            seriesRef: data.named.weekdaysSeries._id,
            completed: true,
        });

        // Two ticks, two permanent records, each with its own completion date.
        expect(completed).toHaveLength(2);
        expect(completed.every((c) => !!c.completedDate)).toBe(true);
        expect(new Set(completed.map((c) => c._id.toString())).size).toBe(2);
    });

    test('a completed occurrence is never regenerated', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const [first] = await occurrencesOf(data.named.weekdaysSeries);
        await api.post('/api/completeTask', { data: { taskId: first._id.toString() } });

        await schedule(api);

        // Exactly one document still occupies that date, and it is the completed one.
        const sameDate = await TaskDetails.find({
            seriesRef: data.named.weekdaysSeries._id,
            occurrenceDate: first.occurrenceDate,
        });
        expect(sameDate).toHaveLength(1);
        expect(sameDate[0]._id.toString()).toBe(first._id.toString());
        expect(sameDate[0].completed).toBe(true);
    });

    test('editing the rule prunes future occurrences but keeps completed history', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const [first] = await occurrencesOf(data.named.weekdaysSeries);
        await api.post('/api/completeTask', { data: { taskId: first._id.toString() } });

        // Mondays and Tuesdays become Fridays only.
        await api.post('/api/editTask', {
            data: {
                task: {
                    _id: data.named.weekdaysSeries._id.toString(),
                    recurrence: { freq: 'weekly', interval: 1, byWeekday: [5] },
                },
            },
        });
        await schedule(api);

        const after = await occurrencesOf(data.named.weekdaysSeries);

        // Every surviving incomplete occurrence obeys the new rule...
        expect(
            after.filter((o) => !o.completed).every((o) => moment(o.occurrenceDate).day() === 5)
        ).toBe(true);
        // ...and the completed one is untouched, even though it no longer fits the rule.
        expect(after.some((o) => o.completed && o._id.equals(first._id))).toBe(true);
    });

    test('deleting a series removes its incomplete occurrences and keeps completed ones', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const occurrences = await occurrencesOf(data.named.weekdaysSeries);
        const [first] = occurrences;
        await api.post('/api/completeTask', { data: { taskId: first._id.toString() } });

        // Deleting through an occurrence deletes the whole series.
        const target = occurrences[1];
        const res = await api.post('/api/deleteTask', { data: { taskId: target._id.toString() } });
        expect((await res.json()).success).toBe(true);

        const remaining = await occurrencesOf(data.named.weekdaysSeries);
        expect(remaining.every((o) => o.completed)).toBe(true);
        expect(remaining.some((o) => o._id.equals(first._id))).toBe(true);

        // The template itself is gone.
        expect(await TaskDetails.findById(data.named.weekdaysSeries._id)).toBeNull();
    });

    test('legacy repeat strings still produce occurrences', async ({ seed, api }) => {
        await seed();
        await schedule(api);

        const user = await loadUser();
        const legacy = await TaskDetails.findOne({
            userRef: user._id,
            title: 'Recurring weekly check-in',
        });

        // The old string was promoted to a rule in place, and it now drives occurrences.
        expect(legacy.recurrence.freq).toBe('weekly');
        expect(legacy.recurrence.unavailableBehavior).toBe('skip');
        expect((await occurrencesOf(legacy)).length).toBeGreaterThan(0);
    });

    test('past incomplete occurrences are pruned', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        // Plant a missed occurrence from last week.
        const stale = await TaskDetails.create({
            title: 'Missed standup',
            duration: 15,
            userRef: data.primary.user._id,
            seriesRef: data.named.weekdaysSeries._id,
            occurrenceDate: moment().startOf('day').subtract(7, 'days').toDate(),
            dueDate: moment().subtract(7, 'days').endOf('day').toDate(),
            startDate: moment().startOf('day').subtract(7, 'days').toDate(),
            completed: false,
        });

        await schedule(api);

        expect(await TaskDetails.findById(stale._id)).toBeNull();
    });

    test('a next-available occurrence survives after its occurrence day', async ({ seed, api }) => {
        const data = await seed();
        await seed.clearTasks();

        const template = await TaskDetails.create({
            title: 'Deferred standup',
            duration: 15,
            userRef: data.primary.user._id,
            startDate: moment.utc().subtract(7, 'days').startOf('day').toDate(),
            dueDate: moment.utc().subtract(7, 'days').startOf('day').toDate(),
            recurrence: {
                freq: 'weekly',
                interval: 1,
                unavailableBehavior: 'next-available',
            },
        });
        const deferred = await TaskDetails.create({
            title: template.title,
            duration: template.duration,
            userRef: data.primary.user._id,
            seriesRef: template._id,
            occurrenceDate: moment.utc().subtract(1, 'day').startOf('day').toDate(),
            dueDate: moment.utc().subtract(1, 'day').startOf('day').toDate(),
            startDate: moment.utc().subtract(1, 'day').startOf('day').toDate(),
            completed: false,
        });

        await schedule(api);

        const kept = await TaskDetails.findById(deferred._id);
        const { EventDetails } = require('../../models');
        const event = await EventDetails.findOne({ taskRef: deferred._id });
        expect(kept).not.toBeNull();
        expect(kept.scheduledDate).not.toBeNull();
        expect(event).not.toBeNull();

        await TaskDetails.updateOne(
            { _id: template._id },
            { $set: { 'recurrence.unavailableBehavior': 'skip' } }
        );
        await schedule(api);
        expect(await TaskDetails.findById(deferred._id)).toBeNull();
    });

    test('a past COMPLETED occurrence survives pruning', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        await TaskDetails.updateOne(
            { _id: data.named.weekdaysSeries._id },
            { $set: { 'recurrence.unavailableBehavior': 'next-available' } }
        );

        const done = await TaskDetails.create({
            title: 'Standup last week',
            duration: 15,
            userRef: data.primary.user._id,
            seriesRef: data.named.weekdaysSeries._id,
            occurrenceDate: moment().startOf('day').subtract(7, 'days').toDate(),
            dueDate: moment().subtract(7, 'days').endOf('day').toDate(),
            startDate: moment().startOf('day').subtract(7, 'days').toDate(),
            completed: true,
            completedDate: moment().subtract(7, 'days').toDate(),
        });

        await schedule(api);

        // History is never swept away, however old it gets.
        expect(await TaskDetails.findById(done._id)).not.toBeNull();
    });

    test('occurrenceDate is identity, scheduledDate is placement', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const occurrences = await occurrencesOf(data.named.weekdaysSeries);
        expect(occurrences.length).toBeGreaterThan(0);

        // occurrenceDate is a canonical UTC civil-date marker; scheduledDate is an instant.
        for (const occurrence of occurrences) {
            expect(occurrence.occurrenceDate.getUTCHours()).toBe(0);
            expect(occurrence.occurrenceDate.getUTCMinutes()).toBe(0);
        }

        // Scheduling sets placement but must never rewrite identity. Were these one field,
        // every run would re-key the series and expansion would duplicate it.
        const identityBefore = occurrences.map((o) => o.occurrenceDate.getTime());

        await schedule(api);

        const after = await occurrencesOf(data.named.weekdaysSeries);
        expect(after.map((o) => o.occurrenceDate.getTime())).toEqual(identityBefore);
    });

    test('an occurrence reports the rule its series is running on', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const list = await (await api.get('/api/getUserTasks')).json();
        const occurrence = list.taskList.find(
            (t) => t.seriesRef === data.named.weekdaysSeries._id.toString()
        );

        // Without this the edit modal shows "Does not repeat" for a task it is
        // simultaneously labelling as part of a series.
        expect(occurrence).toBeTruthy();
        expect(occurrence.seriesRecurrence).toBeTruthy();
        expect(occurrence.seriesRecurrence.freq).toBe('weekly');
        expect(occurrence.seriesRecurrence.byWeekday).toEqual([1, 2]);
        expect(occurrence.seriesRecurrence.unavailableBehavior).toBe('skip');
    });

    test('serializes an attached series cutoff as a civil date', async ({ seed, api }) => {
        const data = await seed();
        await TaskDetails.updateOne(
            { _id: data.named.weekdaysSeries._id },
            { $set: { 'recurrence.endsOn': moment.utc().add(30, 'days').startOf('day').toDate() } }
        );
        await schedule(api);
        const list = await (await api.get('/api/getUserTasks')).json();
        const occurrence = list.taskList.find(
            (task) => task.seriesRef === data.named.weekdaysSeries._id.toString()
        );
        expect(occurrence.seriesRecurrence.endsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('an old rule without a stored policy is reported as skip', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);
        await TaskDetails.updateOne(
            { _id: data.named.weekdaysSeries._id },
            { $unset: { 'recurrence.unavailableBehavior': 1 } }
        );

        const list = await (await api.get('/api/getUserTasks')).json();
        const occurrence = list.taskList.find(
            (task) => task.seriesRef === data.named.weekdaysSeries._id.toString()
        );
        expect(occurrence.seriesRecurrence.unavailableBehavior).toBe('skip');
    });

    test('editing policy through an occurrence preserves its identity', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);
        const [occurrence] = await occurrencesOf(data.named.weekdaysSeries);
        const identity = occurrence.occurrenceDate.getTime();

        const res = await api.post('/api/editTask', {
            data: {
                task: {
                    _id: occurrence._id.toString(),
                    recurrence: {
                        freq: 'weekly',
                        interval: 1,
                        byWeekday: [1, 2],
                        unavailableBehavior: 'next-available',
                    },
                },
            },
        });
        expect((await res.json()).success).toBe(true);

        const template = await TaskDetails.findById(data.named.weekdaysSeries._id);
        const kept = await TaskDetails.findById(occurrence._id);
        expect(template.recurrence.unavailableBehavior).toBe('next-available');
        expect(kept.occurrenceDate.getTime()).toBe(identity);
    });

    test('editing an occurrence does not corrupt its template', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const occurrences = await occurrencesOf(data.named.weekdaysSeries);
        const occurrence = occurrences[0];

        // Post the occurrence back nearly verbatim, exactly as the edit modal does.
        const res = await api.post('/api/editTask', {
            data: {
                task: {
                    _id: occurrence._id.toString(),
                    title: 'Renamed through an occurrence',
                    duration: 25,
                    seriesRef: occurrence.seriesRef.toString(),
                    occurrenceDate: occurrence.occurrenceDate,
                    completed: false,
                    scheduledDate: occurrence.scheduledDate,
                },
            },
        });
        expect((await res.json()).success).toBe(true);

        const template = await TaskDetails.findById(data.named.weekdaysSeries._id);

        // The edit lands on the template, but the occurrence's identity fields must not:
        // copying them would make the template an occurrence of itself and break expansion.
        expect(template.title).toBe('Renamed through an occurrence');
        expect(template.duration).toBe(25);
        expect(template.seriesRef).toBeNull();
        expect(template.occurrenceDate).toBeNull();
        expect(template.recurrence.freq).toBe('weekly');

        // And the series still expands.
        await schedule(api);
        expect((await occurrencesOf(data.named.weekdaysSeries)).length).toBeGreaterThan(0);
    });

    test('a completed repeating task keeps repeating weekly instead of daily', async ({ seed, api }) => {
        await seed();

        // The legacy shape: a repeating task that IS the template, then ticked off.
        // Completing it clones the series forward, which is intended; expanding to every
        // day is not.
        const created = await (await api.post('/api/createTask', {
            data: {
                title: 'Weekly report',
                duration: 30,
                startDate: dateOnly(),
                dueDate: dateOnly(1),
                repeat: 'weekly',
            },
        })).json();
        const task = created.taskList.find((t) => t.title === 'Weekly report');
        const startedOn = moment.utc(task.startDate, 'YYYY-MM-DD').day();

        await api.post('/api/completeTask', { data: { taskId: task._id } });
        await schedule(api);

        const list = await (await api.get('/api/getUserTasks')).json();
        const remaining = list.taskList.filter((t) => t.title === 'Weekly report');

        // One per week over the 60 day horizon, not one per day.
        expect(remaining.length).toBeLessThanOrEqual(10);
        expect(remaining.every((t) => moment.utc(t.occurrenceDate, 'YYYY-MM-DD').day() === startedOn)).toBe(true);
    });

    test('a completed task with a rule generates nothing itself', async ({ seed, api }) => {
        await seed();

        const created = await (await api.post('/api/createTask', {
            data: {
                title: 'Retired series',
                duration: 30,
                startDate: dateOnly(),
                dueDate: dateOnly(1),
                recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
            },
        })).json();
        const template = created.taskList.find((t) => t.title === 'Retired series');
        const seriesId = template.seriesRef;

        // Complete the template itself: it is history now, not a live rule.
        await withDb(() => TaskDetails.updateOne(
            { _id: seriesId },
            { $set: { completed: true, completedDate: new Date() } }
        ));
        await schedule(api);

        const pending = await withDb(() => TaskDetails.find({
            seriesRef: seriesId,
            $or: [{ completed: false }, { completed: null }],
        }));
        expect(pending).toHaveLength(0);
    });

    test('pending occurrences of a completed series are cleaned up', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const template = data.named.weekdaysSeries;
        expect((await occurrencesOf(template)).length).toBeGreaterThan(0);

        // Complete the template directly, the state older data can already be in.
        await withDb(() => TaskDetails.updateOne(
            { _id: template._id },
            { $set: { completed: true, completedDate: new Date() } }
        ));
        await schedule(api);

        const pending = await withDb(() => TaskDetails.find({
            seriesRef: template._id,
            $or: [{ completed: false }, { completed: null }],
        }));
        expect(pending).toHaveLength(0);
    });

    test('completed occurrences survive their series being completed', async ({ seed, api }) => {
        const data = await seed();
        await schedule(api);

        const template = data.named.weekdaysSeries;
        const [first] = await occurrencesOf(template);
        await api.post('/api/completeTask', { data: { taskId: first._id.toString() } });

        await withDb(() => TaskDetails.updateOne(
            { _id: template._id },
            { $set: { completed: true, completedDate: new Date() } }
        ));
        await schedule(api);

        // Cleanup must never eat completion history.
        const kept = await withDb(() => TaskDetails.findById(first._id));
        expect(kept).not.toBeNull();
        expect(kept.completed).toBe(true);
    });

    test('a new series shows its occurrences without scheduling first', async ({ seed, api }) => {
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

        // The response itself must already contain the occurrences, otherwise a new
        // repeating task looks like it silently vanished until "Schedule Tasks" is pressed.
        const mine = body.taskList.filter((t) => t.title === 'Instant series');
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((t) => !!t.seriesRef)).toBe(true);
    });
});

test.describe('recurrence validation through the API', () => {
    const base = () => ({
        title: 'Repeating thing',
        duration: 30,
        startDate: dateOnly(),
        dueDate: dateOnly(1),
    });

    test('creates a task with a recurrence rule', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: { ...base(), recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2] } },
        });
        expect((await res.json()).success).toBe(true);

        const user = await loadUser();
        const created = await TaskDetails.findOne({ userRef: user._id, title: 'Repeating thing' });
        expect(created.recurrence.freq).toBe('weekly');
        expect(created.recurrence.byWeekday).toEqual([1, 2]);
        expect(created.recurrence.unavailableBehavior).toBe('skip');
    });

    test('persists an explicit next-available policy', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: {
                ...base(),
                title: 'Deferred repeating thing',
                recurrence: {
                    freq: 'daily',
                    unavailableBehavior: 'next-available',
                },
            },
        });
        const body = await res.json();
        expect(body.success).toBe(true);
        const occurrence = body.taskList.find((task) => task.title === 'Deferred repeating thing');
        expect(occurrence.seriesRecurrence.unavailableBehavior).toBe('next-available');

        const user = await loadUser();
        const created = await TaskDetails.findOne({
            userRef: user._id,
            title: 'Deferred repeating thing',
        });
        expect(created.recurrence.unavailableBehavior).toBe('next-available');
    });

    test('rejects an impossible recurrence cutoff', async ({ seed, api }) => {
        await seed();
        const res = await api.post('/api/createTask', {
            data: { ...base(), recurrence: { freq: 'daily', endsOn: '2024-02-31' } },
        });
        expect((await res.json()).success).toBe(false);
    });

    test('createTask persists a plain repeat string', async ({ seed, api }) => {
        await seed();

        // Regression: the route read `taskRepeat` while the UI posted `repeat`, so
        // recurrence was silently dropped on create.
        const res = await api.post('/api/createTask', {
            data: { ...base(), title: 'Weekly by string', repeat: 'weekly' },
        });
        expect((await res.json()).success).toBe(true);

        const user = await loadUser();
        const created = await TaskDetails.findOne({ userRef: user._id, title: 'Weekly by string' });
        expect(created.repeat).toBe('weekly');
    });

    test('rejects malformed rules', async ({ seed, api }) => {
        await seed();

        const bad = [
            { freq: 'fortnightly' },
            { freq: 'daily', interval: 0 },
            { freq: 'weekly', byWeekday: [9] },
            { freq: 'monthly', byMonthDay: [0] },
            { freq: 'daily', unavailableBehavior: 'later' },
        ];

        for (const recurrence of bad) {
            const res = await api.post('/api/createTask', { data: { ...base(), recurrence } });
            const body = await res.json();
            expect(body.success, `should reject ${JSON.stringify(recurrence)}`).toBe(false);
        }
    });

    test('rejects a repeating backlog task', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: {
                title: 'Repeating backlog',
                duration: 30,
                startDate: dateOnly(),
                isBacklog: true,
                recurrence: { freq: 'weekly', interval: 1 },
            },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('backlog task cannot repeat');
    });
});

test.describe('scheduling a recurring series', () => {
    test('a weekly Monday series is scheduled once per Monday', async ({ seed, api }) => {
        const data = await seed();

        // recurruser holds one weekly-Monday series and three one-off tasks, so a
        // duplicate shows up as an arithmetic difference.
        const res = await api.post('/api/login', {
            data: { username: 'recurruser', password: 'testpassword', timeZone: 'UTC' },
        });
        const token = (await res.json()).token;
        const asRecurruser = { headers: { Authorization: token } };

        const scheduled = await api.get('/api/scheduletasks', asRecurruser);
        expect((await scheduled.json()).success).toBe(true);

        const user = await loadUser('recurruser');
        const { EventDetails } = require('../../models');
        const events = await withDb(() => EventDetails.find({
            userRef: user._id,
            title: data.named.mondaySeries.title,
        }));

        expect(events.length).toBeGreaterThan(0);

        // Every block lands on a Monday, and no day carries two of them.
        const perDay = new Map();
        for (const event of events) {
            const day = moment.utc(event.startDate).format('YYYY-MM-DD');
            expect(moment.utc(day, 'YYYY-MM-DD').day()).toBe(1);
            perDay.set(day, (perDay.get(day) || 0) + 1);
        }
        expect([...perDay.values()].every((count) => count === 1)).toBe(true);
    });
});
