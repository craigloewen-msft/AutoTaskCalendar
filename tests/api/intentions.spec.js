const { test, expect, withDb } = require('../fixtures');
const { EventDetails, RoleDetails, TaskDetails, UserDetails } = require('../../models');
const { mondayWeekBounds, parseDateOnly, todayInZone } = require('../../utils/temporal');

/**
 * Intentions. See docs/INTENTIONS.md.
 *
 * Being an intention is DERIVED from the role, never stored, so these specs mostly check
 * that the derivation holds from every direction -- including after a role changes.
 */

function currentWeek(timeZone = 'UTC') {
    return mondayWeekBounds(todayInZone(timeZone), timeZone);
}

async function taskList(api) {
    return (await (await api.get('/api/getUserTasks')).json()).taskList;
}

function byTitle(list, title) {
    return list.find((task) => task.title === title);
}

async function createTask(api, data) {
    return (await api.post('/api/createTask', { data })).json();
}

test.describe('intentions', () => {
    test('a task under a personal project is an intention, due that Sunday', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        const body = await createTask(api, {
            title: 'Call Mum this week',
            startDate: week.startDate,
            dueDate: week.startDate,
            projectRef: String(data.named.weekendProject._id),
        });
        expect(body.success).toBe(true);

        const created = byTitle(body.taskList, 'Call Mum this week');
        expect(created.isIntention).toBe(true);
        // The requested Monday is overridden: an intention is a whole-week commitment.
        expect(created.dueDate).toBe(week.endDate);
        // No duration was sent, so it takes the 30-minute default.
        expect(created.duration).toBe(30);
    });

    test('a task under a work project is not an intention and keeps its due date', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        const body = await createTask(api, {
            title: 'Write the runbook',
            startDate: week.startDate,
            dueDate: week.startDate,
            duration: 45,
            projectRef: String(data.named.migrationProject._id),
        });

        const created = byTitle(body.taskList, 'Write the runbook');
        expect(created.isIntention).toBe(false);
        expect(created.dueDate).toBe(week.startDate);
    });

    test('duration is still the author\'s when they give one', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        const body = await createTask(api, {
            title: 'Long run',
            startDate: week.startDate,
            duration: 90,
            projectRef: String(data.named.trainingProject._id),
        });

        const created = byTitle(body.taskList, 'Long run');
        expect(created.duration).toBe(90);
        // The default applies only when no duration is given; it is still an intention.
        expect(created.isIntention).toBe(true);
    });

    test('backlog and repeating tasks are never intentions', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();
        const personal = String(data.named.weekendProject._id);

        const backlog = await createTask(api, {
            title: 'Someday: learn piano',
            startDate: week.startDate,
            duration: 60,
            isBacklog: true,
            projectRef: personal,
        });
        expect(backlog.success).toBe(true);
        expect(byTitle(backlog.taskList, 'Someday: learn piano').isIntention).toBe(false);

        const repeating = await createTask(api, {
            title: 'Weekly tidy',
            startDate: week.startDate,
            dueDate: week.endDate,
            duration: 30,
            recurrence: { freq: 'weekly', interval: 1 },
            projectRef: personal,
        });
        expect(repeating.success).toBe(true);
        // The template is hidden from the task list, so the series' occurrences answer for it:
        // a repeating personal task is a series, never an intention.
        const occurrences = (await taskList(api)).filter((task) => task.title === 'Weekly tidy');
        expect(occurrences.length).toBeGreaterThan(0);
        for (const occurrence of occurrences) expect(occurrence.isIntention).toBe(false);
    });

    test('a quick-add with no due date lands on the week\'s Sunday', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        // Weekly Plan's quick-add sends no due date for a personal project: the server owns it.
        const body = await createTask(api, {
            title: 'Phone a friend',
            startDate: week.startDate,
            dueDate: null,
            duration: 20,
            projectRef: String(data.named.weekendProject._id),
        });
        expect(body.success).toBe(true);

        const created = byTitle(body.taskList, 'Phone a friend');
        expect(created.isIntention).toBe(true);
        expect(created.dueDate).toBe(week.endDate);
        // A duration that was given is kept; only the date is the server's to decide.
        expect(created.duration).toBe(20);
    });

    test('the scheduler never gives an intention a slot', async ({ seed, api }) => {
        const data = await seed();
        const user = data.primary.user;

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);

        const intention = await withDb(() => TaskDetails.findById(data.named.intentionOpen._id));
        expect(intention.scheduledDate).toBeFalsy();

        const blocks = await withDb(() => EventDetails.find({
            userRef: user._id,
            taskRef: intention._id,
        }));
        expect(blocks).toHaveLength(0);

        // Ordinary work around it still schedules, so the exclusion is not over-broad.
        const ordinary = await withDb(() => TaskDetails.findById(data.named.weekOpen._id));
        expect(ordinary.scheduledDate).toBeTruthy();
    });

    test('a task written straight to the database under a personal project is still never scheduled', async ({ seed, api }) => {
        const data = await seed();
        const user = data.primary.user;
        const week = currentWeek();

        // Bypasses createTask entirely, so nothing forced the Sunday due date -- the task is an
        // intention purely by its role. Both of the scheduler's defences (the query clauses and
        // the in-memory `taskIsIntention` check) must agree for this to stay unplaced.
        const raw = await withDb(() => TaskDetails.create({
            title: 'Smuggled in behind createTask',
            userRef: user._id,
            projectRef: data.named.weekendProject._id,
            startDate: parseDateOnly(week.startDate).date,
            dueDate: parseDateOnly(week.startDate).date,
            duration: 60,
            isBacklog: false,
            priority: 100,
        }));

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);

        const after = await withDb(() => TaskDetails.findById(raw._id));
        expect(after.scheduledDate).toBeFalsy();
        const blocks = await withDb(() => EventDetails.find({
            userRef: user._id,
            taskRef: raw._id,
        }));
        expect(blocks).toHaveLength(0);
    });

    test('a scheduled task edited into a personal project loses its slot', async ({ seed, api }) => {
        const data = await seed();
        const user = data.primary.user;

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);
        const placed = await withDb(() => TaskDetails.findById(data.named.weekOpen._id));
        expect(placed.scheduledDate).toBeTruthy();

        const body = await (await api.post('/api/editTask', {
            data: {
                task: {
                    _id: String(placed._id),
                    projectRef: String(data.named.weekendProject._id),
                },
            },
        })).json();
        expect(body.success).toBe(true);

        // The slot goes at once, not at the next schedule run.
        const after = await withDb(() => TaskDetails.findById(placed._id));
        expect(after.scheduledDate).toBeFalsy();
        const blocks = await withDb(() => EventDetails.find({
            userRef: user._id,
            taskRef: placed._id,
        }));
        expect(blocks).toHaveLength(0);
    });

    test('flipping a role to personal takes back its tasks\' slots', async ({ seed, api }) => {
        const data = await seed();
        const user = data.primary.user;

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);
        const placed = await withDb(() => TaskDetails.findById(data.named.weekOpen._id));
        expect(placed.scheduledDate).toBeTruthy();

        const body = await (await api.post('/api/editRole', {
            data: { id: String(data.named.engineerRole._id), context: 'personal' },
        })).json();
        expect(body.success).toBe(true);

        const after = await withDb(() => TaskDetails.findById(placed._id));
        expect(after.scheduledDate).toBeFalsy();
        const blocks = await withDb(() => EventDetails.find({
            userRef: user._id,
            taskRef: placed._id,
        }));
        expect(blocks).toHaveLength(0);
    });

    test('assigning a scheduled task to a personal project takes back its slot', async ({ seed, api }) => {
        const data = await seed();
        const user = data.primary.user;

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);
        const placed = await withDb(() => TaskDetails.findById(data.named.weekOpen._id));
        expect(placed.scheduledDate).toBeTruthy();

        const body = await (await api.post('/api/setTaskProject', {
            data: {
                taskId: String(placed._id),
                projectId: String(data.named.weekendProject._id),
            },
        })).json();
        expect(body.success).toBe(true);

        const after = await withDb(() => TaskDetails.findById(placed._id));
        expect(after.scheduledDate).toBeFalsy();
        const blocks = await withDb(() => EventDetails.find({
            userRef: user._id,
            taskRef: placed._id,
        }));
        expect(blocks).toHaveLength(0);
    });

    test('flipping the role to work makes its tasks schedulable, with no task write', async ({ seed, api }) => {
        const data = await seed();
        const fatherRole = data.named.fatherRole;

        let list = await taskList(api);
        expect(byTitle(list, 'One evening with no laptop').isIntention).toBe(true);

        await withDb(() => RoleDetails.updateOne(
            { _id: fatherRole._id },
            { $set: { context: 'work' } }
        ));

        // Nothing on the task changed -- only the role did.
        list = await taskList(api);
        expect(byTitle(list, 'One evening with no laptop').isIntention).toBe(false);

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);
        const task = await withDb(() => TaskDetails.findById(data.named.intentionOpen._id));
        expect(task.scheduledDate).toBeTruthy();
    });

    test('an intention is not committable work', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        const res = await api.post('/api/commitWeeklyPlan', {
            data: {
                weekStart: week.startDate,
                taskIds: [String(data.named.intentionOpen._id)],
            },
        });
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.log).toContain('intention');
    });

    test('committing everything in the week leaves intentions out', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        const body = await (await api.post('/api/commitWeeklyPlan', {
            data: { weekStart: week.startDate },
        })).json();
        expect(body.success).toBe(true);

        const items = body.plans[0].items;
        const titles = items.map((item) => item.title);
        expect(titles).not.toContain('One evening with no laptop');
        expect(titles).not.toContain('Call Mum');
        // Added after the seed's own commit, so its arrival proves work was swept in and the
        // absences above are a real exclusion rather than an empty amendment.
        expect(titles).toContain('Handle the rollback question');
    });

    test('moving a task into a personal project makes it an intention and moves it to Sunday', async ({ seed, api }) => {
        const data = await seed();

        const before = byTitle(await taskList(api), 'Write the cutover runbook');
        expect(before.isIntention).toBe(false);

        const body = await (await api.post('/api/editTask', {
            data: {
                task: {
                    _id: String(before._id),
                    projectRef: String(data.named.weekendProject._id),
                },
            },
        })).json();
        expect(body.success).toBe(true);

        // editTask returns only a status, so re-read the list.
        const after = byTitle(await taskList(api), 'Write the cutover runbook');
        expect(after.isIntention).toBe(true);
        expect(after.dueDate).toBe(currentWeek().endDate);
    });

    test('a legacy repeat string is never an intention', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        // Older data repeats through a plain string rather than a recurrence rule. It is
        // still a series, so it must never be treated as an intention.
        const legacy = await withDb(() => TaskDetails.create({
            title: 'Legacy weekly personal task',
            duration: 30,
            startDate: parseDateOnly(week.startDate).date,
            dueDate: parseDateOnly(week.endDate).date,
            completed: false,
            isBacklog: false,
            repeat: 'weekly',
            userRef: data.primary.user._id,
            projectRef: data.named.weekendProject._id,
        }));

        const found = byTitle(await taskList(api), 'Legacy weekly personal task');
        expect(found).toBeTruthy();
        expect(found.isIntention).toBe(false);

        const items = (await (await api.get(
            `/api/getIntentions?from=${week.startDate}&to=${week.endDate}`
        )).json()).items;
        expect(items.map((item) => item.title)).not.toContain('Legacy weekly personal task');

        await withDb(() => TaskDetails.deleteOne({ _id: legacy._id }));
    });

    test('a malformed project id fails cleanly rather than throwing', async ({ seed, api }) => {
        await seed();
        const week = currentWeek();

        const body = await createTask(api, {
            title: 'Bad project',
            startDate: week.startDate,
            dueDate: week.endDate,
            duration: 30,
            projectRef: 'not-an-object-id',
        });
        expect(body.success).toBe(false);
        expect(body.log).toBe('Invalid project');
    });

    test('a title-only edit keeps an intention on its own week\'s Sunday', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();

        // Anchoring on the stored UTC marker used to land west-of-UTC users on the
        // previous week's Sunday, before the task's own start date.
        const body = await (await api.post('/api/editTask', {
            data: { task: { _id: String(data.named.intentionOpen._id), title: 'Renamed' } },
        })).json();
        expect(body.success).toBe(true);

        const after = byTitle(await taskList(api), 'Renamed');
        expect(after.isIntention).toBe(true);
        expect(after.dueDate).toBe(week.endDate);
    });
});

/**
 * Roles saved before `context` existed store no value at all. Mongoose reads them back as
 * `personal` through the schema default, which is what the UI shows, but a raw query or lean
 * read does not apply defaults. Every server path must still treat them as personal.
 */
test.describe('intentions under a role with no stored context', () => {
    // Strip the field on the raw collection, exactly as a pre-feature role looks on disk.
    async function makeLegacy(role) {
        await withDb(() => RoleDetails.collection.updateOne(
            { _id: role._id },
            { $unset: { context: '' } }
        ));
        const raw = await withDb(() => RoleDetails.collection.findOne({ _id: role._id }));
        expect(raw).not.toHaveProperty('context');
    }

    test('quick-add with no due date files an intention rather than failing', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();
        await makeLegacy(data.named.fatherRole);

        // The exact payload Weekly Plan sends for a project it shows as personal.
        const body = await createTask(api, {
            title: 'Legacy quick-add',
            startDate: week.startDate,
            dueDate: null,
            duration: 30,
            projectRef: String(data.named.weekendProject._id),
            isBacklog: false,
            recurrence: null,
        });
        expect(body.log).toBeUndefined();
        expect(body.success).toBe(true);

        const created = byTitle(body.taskList, 'Legacy quick-add');
        expect(created.isIntention).toBe(true);
        expect(created.dueDate).toBe(week.endDate);
    });

    test('its tasks are never scheduled, appear in the band, and are not committable', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();
        await makeLegacy(data.named.fatherRole);

        expect(byTitle(await taskList(api), 'One evening with no laptop').isIntention).toBe(true);

        expect((await (await api.get('/api/scheduletasks')).json()).success).toBe(true);
        const task = await withDb(() => TaskDetails.findById(data.named.intentionOpen._id));
        expect(task.scheduledDate).toBeNull();
        const blocks = await withDb(() => EventDetails.find({
            userRef: data.primary.user._id,
            taskRef: task._id,
        }));
        expect(blocks).toHaveLength(0);

        const items = (await (await api.get(
            `/api/getIntentions?from=${week.startDate}&to=${week.endDate}`
        )).json()).items;
        expect(items.map((item) => item.title)).toContain('One evening with no laptop');

        const commit = await (await api.post('/api/commitWeeklyPlan', {
            data: { weekStart: week.startDate, taskIds: [String(task._id)] },
        })).json();
        expect(commit.success).toBe(false);
        expect(commit.log).toContain('intention');
    });

    test('editing a task into a legacy personal project moves it to Sunday', async ({ seed, api }) => {
        const data = await seed();
        const week = currentWeek();
        await makeLegacy(data.named.fatherRole);

        const body = await (await api.post('/api/editTask', {
            data: { task: {
                _id: String(data.named.weekOpen._id),
                projectRef: String(data.named.weekendProject._id),
            } },
        })).json();
        expect(body.success).toBe(true);

        const moved = byTitle(await taskList(api), data.named.weekOpen.title);
        expect(moved.isIntention).toBe(true);
        expect(moved.dueDate).toBe(week.endDate);
    });
});
