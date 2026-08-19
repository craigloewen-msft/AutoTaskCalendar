const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, WeeklyPlanDetails } = require('../../models');
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

// A project-linked task inside the given week.
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

// The seeded account ships a committed week; these specs drive the commit themselves.
async function clearPlans(data) {
    await withDb(() => WeeklyPlanDetails.deleteMany({ userRef: data.primary.user._id }));
}

test.describe('weekly plan commitments', () => {
    test('derives each committed item\'s status from its live task', async ({ seed, api }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();

        const open = await weekTask(data, week, { title: 'Still open' });
        const done = await weekTask(data, week, { title: 'Will be finished' });
        const moved = await weekTask(data, week, { title: 'Will be pushed out' });
        const removed = await weekTask(data, week, { title: 'Will be deleted' });

        const committed = await commit(
            api,
            week.startDate,
            [open, done, moved, removed].map((t) => String(t._id))
        );
        expect(committed.success).toBe(true);
        expect(committed.plans[0].weekStart).toBe(week.startDate);

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

        const body = await (await api.get(
            `/api/getWeeklyPlans?from=${week.startDate}&to=${week.startDate}`
        )).json();
        const plan = body.plans[0];

        expect(itemFor(plan, open._id).status).toBe('open');
        expect(itemFor(plan, done._id).status).toBe('done');
        expect(itemFor(plan, moved._id).status).toBe('moved');
        expect(itemFor(plan, moved._id).liveDueDate).toBe(addDateOnlyDays(week.endDate, 14));

        // The whole point of storing the snapshot: dropped work stays visible, with the
        // title and duration it had when it was promised.
        const removedItem = itemFor(plan, removed._id);
        expect(removedItem.status).toBe('removed');
        expect(removedItem.title).toBe('Will be deleted');
        expect(removedItem.duration).toBe(60);

        // Cross-tenant boundary: another user's task can never enter a plan.
        const theirs = await withDb(() => TaskDetails.create({
            title: 'THEIR SECRET TASK',
            duration: 30,
            startDate: parseDateOnly(week.startDate).date,
            dueDate: parseDateOnly(week.endDate).date,
            completed: false,
            userRef: data.other.user._id,
        }));
        const rejected = await commit(api, week.startDate, [String(theirs._id)]);
        expect(rejected.success).toBe(false);
        expect(rejected.log).toContain('not found');
    });

    test('amending only ever adds, so a promise is never erased', async ({ seed, api }) => {
        const data = await seed();
        await clearPlans(data);
        const week = currentWeek();

        const promised = await weekTask(data, week, { title: 'Promised then deleted' });
        const first = await commit(api, week.startDate, [String(promised._id)]);
        expect(first.plans[0].amendedAt).toBeFalsy();
        const committedAt = first.plans[0].committedAt;
        const originalAddedAt = first.plans[0].items[0].addedAt;

        await withDb(() => TaskDetails.deleteOne({ _id: promised._id }));

        const later = await weekTask(data, week, { title: 'Thought of later' });
        const amended = await commit(api, week.startDate, [String(later._id)]);
        expect(amended.success).toBe(true);

        // Adding work must not quietly drop the promise that was not kept.
        const plan = amended.plans[0];
        expect(plan.items).toHaveLength(2);
        expect(itemFor(plan, promised._id).status).toBe('removed');
        expect(itemFor(plan, later._id).status).toBe('open');

        // Amending keeps the one week rather than restarting or duplicating it.
        expect(plan.committedAt).toBe(committedAt);
        expect(plan.amendedAt).toBeTruthy();
        expect(itemFor(plan, later._id).addedAt).not.toBe(originalAddedAt);
        const stored = await withDb(() => WeeklyPlanDetails.find({
            userRef: data.primary.user._id,
            weekStart: parseDateOnly(week.startDate).date,
        }));
        expect(stored).toHaveLength(1);

        // Only the current week exists to be committed, which is what keeps the rollover
        // time-based and last week's record permanent.
        const past = await commit(api, addDateOnlyDays(week.startDate, -7), []);
        expect(past.success).toBe(false);
        expect(past.log).toContain('current week');
    });
});
