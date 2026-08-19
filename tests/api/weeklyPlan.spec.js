const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, UserDetails, WeeklyPlanDetails } = require('../../models');
const {
    addDateOnlyDays,
    mondayWeekBounds,
    parseDateOnly,
    todayInZone,
} = require('../../utils/temporal');

function currentWeek(timeZone = 'UTC') {
    return mondayWeekBounds(todayInZone(timeZone), timeZone);
}

async function commit(api, weekStart, taskIds) {
    const res = await api.post('/api/commitWeeklyPlan', { data: { weekStart, taskIds } });
    return res.json();
}

async function read(api, from, to) {
    const res = await api.get(`/api/getWeeklyPlans?from=${from}&to=${to}`);
    return res.json();
}

// A fresh project-linked task inside the given week.
async function weekTask(data, week, overrides = {}) {
    return withDb(() => TaskDetails.create({
        title: 'Committed task',
        duration: 60,
        startDate: parseDateOnly(week.startDate).date,
        dueDate: parseDateOnly(week.endDate).date,
        completed: false,
        isBacklog: false,
        priority: 100,
        userRef: data.primary.user._id,
        projectRef: data.named.migrationProject._id,
        ...overrides,
    }));
}

function itemFor(plan, taskId) {
    return plan.items.find((item) => item.taskRef === String(taskId));
}

// The seeded account deliberately ships a committed current week. Tests that assert on a
// first-ever commit start from a clean slate instead.
async function clearPlans(data) {
    await withDb(() => WeeklyPlanDetails.deleteMany({ userRef: data.primary.user._id }));
}

test.describe('weekly plan commitments', () => {
    test('commits a week, then amends it without duplicating or resetting it', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const first = await weekTask(data, week, { title: 'First commitment' });
        const second = await weekTask(data, week, { title: 'Second commitment' });

        const initial = await commit(api, week.startDate, [String(first._id)]);
        expect(initial.success).toBe(true);
        expect(initial.plans).toHaveLength(1);
        expect(initial.plans[0].weekStart).toBe(week.startDate);
        expect(initial.plans[0].weekEnd).toBe(week.endDate);
        expect(initial.plans[0].items).toHaveLength(1);
        expect(initial.plans[0].amendedAt).toBeFalsy();
        const committedAt = initial.plans[0].committedAt;
        const originalAddedAt = initial.plans[0].items[0].addedAt;

        const amended = await commit(api, week.startDate, [
            String(first._id),
            String(second._id),
        ]);
        expect(amended.success).toBe(true);
        expect(amended.plans).toHaveLength(1);
        expect(amended.plans[0].items).toHaveLength(2);

        // Amending must not restart the week or relabel work as newly added.
        expect(amended.plans[0].committedAt).toBe(committedAt);
        expect(amended.plans[0].amendedAt).toBeTruthy();
        expect(itemFor(amended.plans[0], first._id).addedAt).toBe(originalAddedAt);
        const stored = await withDb(() => WeeklyPlanDetails.find({
            userRef: data.primary.user._id,
            weekStart: parseDateOnly(week.startDate).date,
        }));
        expect(stored).toHaveLength(1);
    });

    test('derives open, done, moved, and removed from the live task', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        const open = await weekTask(data, week, { title: 'Still open' });
        const done = await weekTask(data, week, { title: 'Will be finished' });
        const moved = await weekTask(data, week, { title: 'Will be pushed out' });
        const removed = await weekTask(data, week, { title: 'Will be deleted' });

        await commit(api, week.startDate, [open, done, moved, removed].map((t) => String(t._id)));

        await withDb(async () => {
            await TaskDetails.updateOne(
                { _id: done._id },
                { $set: { completed: true, completedDate: new Date() } }
            );
            await TaskDetails.updateOne(
                { _id: moved._id },
                { $set: { dueDate: parseDateOnly(addDateOnlyDays(week.endDate, 14)).date } }
            );
            await TaskDetails.deleteOne({ _id: removed._id });
        });

        const body = await read(api, week.startDate, week.startDate);
        const plan = body.plans[0];

        expect(itemFor(plan, open._id).status).toBe('open');
        expect(itemFor(plan, done._id).status).toBe('done');
        expect(itemFor(plan, done._id).completedDate).toBeTruthy();
        expect(itemFor(plan, moved._id).status).toBe('moved');
        expect(itemFor(plan, moved._id).liveDueDate).toBe(addDateOnlyDays(week.endDate, 14));

        // The whole point of storing the snapshot: dropped work stays visible.
        const removedItem = itemFor(plan, removed._id);
        expect(removedItem.status).toBe('removed');
        expect(removedItem.title).toBe('Will be deleted');
        expect(removedItem.duration).toBe(60);
    });

    test('refuses another user\'s task and never returns another user\'s plan', async ({
        seed,
        api,
        loginAs,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const mine = await weekTask(data, week, { title: 'Mine' });

        const theirs = await withDb(() => TaskDetails.create({
            title: 'THEIR SECRET TASK',
            duration: 30,
            startDate: parseDateOnly(week.startDate).date,
            dueDate: parseDateOnly(week.endDate).date,
            completed: false,
            isBacklog: false,
            userRef: data.other.user._id,
        }));

        const rejected = await commit(api, week.startDate, [String(theirs._id)]);
        expect(rejected.success).toBe(false);
        expect(rejected.log).toContain('not found');

        // A rejected commit must not have half-written a plan.
        const afterReject = await withDb(() => WeeklyPlanDetails.findOne({
            userRef: data.primary.user._id,
        }));
        expect(afterReject).toBeNull();

        await commit(api, week.startDate, [String(mine._id)]);

        const otherApi = await loginAs(data.other.username, data.other.password);
        const theirBody = await read(otherApi, week.startDate, week.startDate);
        expect(theirBody.success).toBe(true);
        expect(theirBody.plans).toHaveLength(0);
    });

    test('accepts only the current week', async ({ seed, api }) => {
        await seed();
        const week = currentWeek();

        const past = await commit(api, addDateOnlyDays(week.startDate, -7), []);
        expect(past.success).toBe(false);
        expect(past.log).toContain('current week');

        const future = await commit(api, addDateOnlyDays(week.startDate, 7), []);
        expect(future.success).toBe(false);
        expect(future.log).toContain('current week');

        // A mid-week date is not a week identity, even for the right week.
        const notMonday = await commit(api, addDateOnlyDays(week.startDate, 2), []);
        expect(notMonday.success).toBe(false);
        expect(notMonday.log).toContain('Monday');
    });

    test('rejects a task that is not due during the week', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();
        const outside = await weekTask(data, week, {
            title: 'Due next month',
            dueDate: parseDateOnly(addDateOnlyDays(week.endDate, 30)).date,
        });

        const body = await commit(api, week.startDate, [String(outside._id)]);
        expect(body.success).toBe(false);
        expect(body.log).toContain('not due during this week');
    });

    test('validates the read range', async ({ seed, api }) => {
        await seed();
        const week = currentWeek();

        const missing = await (await api.get('/api/getWeeklyPlans')).json();
        expect(missing.success).toBe(false);
        expect(missing.log).toContain('required');

        const backwards = await read(api, week.startDate, addDateOnlyDays(week.startDate, -7));
        expect(backwards.success).toBe(false);

        const tooWide = await read(api, week.startDate, addDateOnlyDays(week.startDate, 70));
        expect(tooWide.success).toBe(false);
        expect(tooWide.log).toContain('at most');

        const notMonday = await read(api, addDateOnlyDays(week.startDate, 1), week.startDate);
        expect(notMonday.success).toBe(false);
        expect(notMonday.log).toContain('Monday');
    });

    test('uses the saved timezone to decide which week is current', async ({
        seed,
        loginAs,
    }) => {
        const data = await seed();
        await clearPlans(data);

        // Pacific is behind UTC, so late on a UTC Monday it is still the previous Sunday
        // there. The week identity must follow the saved zone, not the server clock.
        await withDb(() => UserDetails.updateOne(
            { _id: data.primary.user._id },
            { $set: { timeZone: 'America/Los_Angeles' } }
        ));

        const api = await loginAs(data.primary.username, data.primary.password);
        const pacificWeek = currentWeek('America/Los_Angeles');
        const utcWeek = currentWeek('UTC');

        const body = await commit(api, pacificWeek.startDate, []);
        expect(body.success).toBe(true);
        expect(body.plans[0].weekStart).toBe(pacificWeek.startDate);
        expect(body.plans[0].timeZone).toBe('America/Los_Angeles');

        // On the days the two zones disagree, the UTC Monday must be refused.
        if (utcWeek.startDate !== pacificWeek.startDate) {
            const wrong = await commit(api, utcWeek.startDate, []);
            expect(wrong.success).toBe(false);
        }
    });

    test('snapshots every project-linked task in the week when no ids are given', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const inWeek = await weekTask(data, week, { title: 'Inside the week' });
        const unaligned = await weekTask(data, week, {
            title: 'No project',
            projectRef: null,
        });
        const outside = await weekTask(data, week, {
            title: 'Outside the week',
            dueDate: parseDateOnly(addDateOnlyDays(week.endDate, 10)).date,
        });

        const res = await api.post('/api/commitWeeklyPlan', {
            data: { weekStart: week.startDate },
        });
        const body = await res.json();
        expect(body.success).toBe(true);

        const titles = body.plans[0].items.map((item) => item.title);
        expect(titles).toContain('Inside the week');
        expect(titles).not.toContain('No project');
        expect(titles).not.toContain('Outside the week');
        expect(itemFor(body.plans[0], inWeek._id)).toBeTruthy();
        expect(itemFor(body.plans[0], unaligned._id)).toBeFalsy();
        expect(itemFor(body.plans[0], outside._id)).toBeFalsy();
    });

    test('amending never erases work that was already promised', async ({ seed, api }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();

        const deleted = await weekTask(data, week, { title: 'Promised then deleted' });
        const moved = await weekTask(data, week, { title: 'Promised then moved' });
        await commit(api, week.startDate, [String(deleted._id), String(moved._id)]);

        await withDb(async () => {
            await TaskDetails.deleteOne({ _id: deleted._id });
            await TaskDetails.updateOne(
                { _id: moved._id },
                { $set: { dueDate: parseDateOnly(addDateOnlyDays(week.endDate, 21)).date } }
            );
        });

        // Adding later work must not quietly drop the two records above.
        const later = await weekTask(data, week, { title: 'Thought of later' });
        const amended = await commit(api, week.startDate, [String(later._id)]);

        expect(amended.success).toBe(true);
        const plan = amended.plans[0];
        expect(plan.items).toHaveLength(3);
        expect(itemFor(plan, deleted._id).status).toBe('removed');
        expect(itemFor(plan, moved._id).status).toBe('moved');
        expect(itemFor(plan, later._id).status).toBe('open');
    });

    test('re-sending an already committed task is a no-op', async ({ seed, api }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();
        const task = await weekTask(data, week, { title: 'Committed once' });

        const first = await commit(api, week.startDate, [String(task._id)]);
        const addedAt = first.plans[0].items[0].addedAt;

        const again = await commit(api, week.startDate, [String(task._id)]);
        expect(again.plans[0].items).toHaveLength(1);
        // No duplicate, and the item keeps when it actually entered the plan.
        expect(again.plans[0].items[0].addedAt).toBe(addedAt);
        expect(again.plans[0].amendedAt).toBeFalsy();
    });

    test('rejects anonymous callers', async ({ apiAnon }) => {
        const week = currentWeek();
        const read = await apiAnon.get(
            `/api/getWeeklyPlans?from=${week.startDate}&to=${week.startDate}`
        );
        expect(read.status()).toBe(401);

        const write = await apiAnon.post('/api/commitWeeklyPlan', {
            data: { weekStart: week.startDate, taskIds: [] },
        });
        expect(write.status()).toBe(401);
    });
});
