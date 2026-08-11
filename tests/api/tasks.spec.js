const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, UserDetails, EventDetails } = require('../../models');
const { parseDateOnly, todayInZone } = require('../../utils/temporal');

// The API returns due dates as ISO strings; helper keeps assertions readable.
function titles(taskList) {
    return taskList.map((t) => t.title);
}

function dateOnly(days = 0) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function completedTask(data, overrides) {
    return {
        title: 'Completed project task',
        duration: 30,
        startDate: parseDateOnly('2024-01-01').date,
        dueDate: parseDateOnly('2024-01-02').date,
        completed: true,
        completedDate: new Date('2024-03-06T12:00:00.000Z'),
        isBacklog: false,
        priority: 100,
        userRef: data.primary.user._id,
        projectRef: data.named.migrationProject._id,
        ...overrides,
    };
}

test.describe('tasks', () => {
    test('lists only incomplete tasks for the logged in user', async ({ seed, api }) => {
        const data = await seed();

        const res = await api.get('/api/getUserTasks');
        const body = await res.json();

        expect(body.success).toBe(true);
        // The dataset's completed tasks must not appear in the active list.
        expect(body.taskList.length).toBeGreaterThan(0);
        expect(body.taskList.every((t) => !t.completed)).toBe(true);
        expect(titles(body.taskList)).toContain(data.named.proposal.title);
        expect(titles(body.taskList).some((t) => t.startsWith('Finished task'))).toBe(false);
    });

    test('never leaks another user\'s tasks', async ({ seed, api }) => {
        await seed();

        const res = await api.get('/api/getUserTasks');
        const body = await res.json();

        expect(titles(body.taskList).some((t) => t.includes('OTHER USER SECRET'))).toBe(false);
    });

    test('returns only owned project completions inside the requested completion window', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        await withDb(() => TaskDetails.create([
            completedTask(data, {
                title: 'Completed inside despite later due date',
                dueDate: parseDateOnly('2024-04-20').date,
                completedDate: new Date('2024-03-08T15:00:00.000Z'),
            }),
            completedTask(data, {
                title: 'Due inside but completed outside',
                dueDate: parseDateOnly('2024-03-06').date,
                completedDate: new Date('2024-03-11T12:00:00.000Z'),
            }),
            completedTask(data, {
                title: 'Unaligned completion',
                projectRef: null,
            }),
            completedTask(data, {
                title: 'OTHER USER SECRET COMPLETION',
                userRef: data.other.user._id,
                projectRef: data.named.otherProject._id,
            }),
        ]));

        const res = await api.get(
            '/api/getProjectCompletions?completedFrom=2024-03-04&completedTo=2024-03-10'
        );
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.completedFrom).toBe('2024-03-04');
        expect(body.completedTo).toBe('2024-03-10');
        expect(body.items.map((task) => task.title)).toEqual([
            'Completed inside despite later due date',
        ]);
        expect(Object.keys(body.items[0]).sort()).toEqual(
            ['_id', 'completedDate', 'projectRef', 'seriesRef', 'title'].sort()
        );
    });

    test('returns a genuinely materialised recurring project completion', async ({ seed, api }) => {
        const data = await seed();
        const today = todayInZone('UTC');
        const created = await (await api.post('/api/createTask', {
            data: {
                title: 'Project-linked daily review',
                duration: 20,
                startDate: today,
                dueDate: today,
                projectRef: String(data.named.emptyProject._id),
                recurrence: { freq: 'daily', interval: 1 },
            },
        })).json();
        expect(created.success).toBe(true);

        const occurrence = created.taskList.find((task) => {
            return task.title === 'Project-linked daily review' && task.dueDate === today;
        });
        expect(occurrence).toMatchObject({
            projectRef: String(data.named.emptyProject._id),
        });
        expect(occurrence.seriesRef).toBeTruthy();

        const completion = await api.post('/api/completeTask', {
            data: { taskId: occurrence._id },
        });
        expect((await completion.json()).success).toBe(true);

        const body = await (
            await api.get(
                `/api/getProjectCompletions?completedFrom=${today}&completedTo=${today}`
            )
        ).json();
        const item = body.items.find((task) => task._id === occurrence._id);
        expect(item).toMatchObject({
            title: occurrence.title,
            projectRef: String(data.named.emptyProject._id),
            seriesRef: occurrence.seriesRef,
        });
    });

    test('uses the saved timezone for inclusive completion boundaries across DST', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        await withDb(async () => {
            await UserDetails.updateOne(
                { _id: data.primary.user._id },
                { $set: { timeZone: 'America/New_York' } }
            );
            await TaskDetails.create([
                completedTask(data, {
                    title: 'Before local Monday',
                    completedDate: new Date('2024-03-04T04:59:59.999Z'),
                }),
                completedTask(data, {
                    title: 'At local Monday',
                    completedDate: new Date('2024-03-04T05:00:00.000Z'),
                }),
                completedTask(data, {
                    title: 'Late local Sunday',
                    completedDate: new Date('2024-03-11T03:59:59.999Z'),
                }),
                completedTask(data, {
                    title: 'At next local Monday',
                    completedDate: new Date('2024-03-11T04:00:00.000Z'),
                }),
            ]);
        });

        const body = await (
            await api.get(
                '/api/getProjectCompletions?completedFrom=2024-03-04&completedTo=2024-03-10'
            )
        ).json();

        expect(body.items.map((task) => task.title)).toEqual([
            'Late local Sunday',
            'At local Monday',
        ]);
    });

    test('returns an empty completion window and rejects invalid bounds', async ({ seed, api }) => {
        await seed();

        const empty = await (
            await api.get(
                '/api/getProjectCompletions?completedFrom=2000-01-03&completedTo=2000-01-09'
            )
        ).json();
        expect(empty).toMatchObject({ success: true, items: [] });

        for (const query of [
            '',
            '?completedFrom=2024-03-04&completedTo=not-a-date',
            '?completedFrom=2024-03-11&completedTo=2024-03-10',
        ]) {
            const body = await (await api.get(`/api/getProjectCompletions${query}`)).json();
            expect(body.success).toBe(false);
            expect(body.log).toBeTruthy();
        }
    });

    test('requires authentication for project completion history', async ({ apiAnon }) => {
        const response = await apiAnon.get(
            '/api/getProjectCompletions?completedFrom=2024-03-04&completedTo=2024-03-10'
        );
        expect(response.status()).toBe(401);
    });

    test('creates a task', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: {
                title: 'Write the release notes',
                duration: 45,
                startDate: dateOnly(),
                dueDate: dateOnly(1),
            },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(titles(body.taskList)).toContain('Write the release notes');
    });

    test('keeps task dates stable through create and edit', async ({ seed, api }) => {
        await seed();
        const res = await api.post('/api/createTask', {
            data: { title: 'DST date task', duration: 30, startDate: '2024-03-10', dueDate: '2024-03-10' },
        });
        const created = (await res.json()).taskList.find((task) => task.title === 'DST date task');
        expect(created.startDate).toBe('2024-03-10');
        expect(created.dueDate).toBe('2024-03-10');

        await api.post('/api/editTask', { data: { task: { ...created, notes: 'edited' } } });
        const after = await (await api.get('/api/getUserTasks')).json();
        const edited = after.taskList.find((task) => task._id === created._id);
        expect(edited.startDate).toBe('2024-03-10');
        expect(edited.dueDate).toBe('2024-03-10');
    });

    test('rejects impossible civil dates', async ({ seed, api }) => {
        await seed();
        const res = await api.post('/api/createTask', {
            data: { title: 'Impossible', duration: 30, startDate: '2024-02-31', dueDate: '2024-03-01' },
        });
        expect((await res.json()).success).toBe(false);
    });

    test('rejects a task with no title, duration, or start date', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', { data: { title: 'Missing the rest' } });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('required');
    });

    test('requires a due date for non-backlog tasks', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: { title: 'No due date', duration: 30, startDate: dateOnly() },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('Due date is required');
    });

    test('allows a backlog task with no due date', async ({ seed, api }) => {
        await seed();

        const res = await api.post('/api/createTask', {
            data: {
                title: 'Someday idea',
                duration: 30,
                startDate: dateOnly(),
                isBacklog: true,
            },
        });

        expect((await res.json()).success).toBe(true);
    });

    test('edits a task', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.codeReview;

        const res = await api.post('/api/editTask', {
            data: { task: { _id: task._id.toString(), title: 'Renamed by the test', duration: 90 } },
        });
        expect((await res.json()).success).toBe(true);

        const after = await (await api.get('/api/getUserTasks')).json();
        expect(titles(after.taskList)).toContain('Renamed by the test');
    });

    test('does not allow edits to forge server-owned completion identity', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.proposal;
        const forgedCompletion = new Date('2024-03-06T12:00:00.000Z');

        const response = await api.post('/api/editTask', {
            data: {
                task: {
                    _id: String(task._id),
                    title: 'Legitimate title edit',
                    completed: true,
                    completedDate: forgedCompletion,
                    userRef: data.other.user._id,
                    seriesRef: data.named.weekdaysSeries._id,
                    occurrenceDate: forgedCompletion,
                    scheduledDate: forgedCompletion,
                },
            },
        });
        expect((await response.json()).success).toBe(true);

        const saved = await withDb(() => TaskDetails.findById(task._id));
        expect(saved.title).toBe('Legitimate title edit');
        expect(saved.completed).not.toBe(true);
        expect(saved.completedDate).toBeFalsy();
        expect(String(saved.userRef)).toBe(String(data.primary.user._id));
        expect(saved.seriesRef).toBeNull();
        expect(saved.occurrenceDate).toBeNull();
        expect(saved.scheduledDate).toBeFalsy();
    });

    test('rejects a self-referencing dependency', async ({ seed, api }) => {
        const data = await seed();
        const id = data.named.codeReview._id.toString();

        const res = await api.post('/api/editTask', {
            data: { task: { _id: id, dependsOn: [id] } },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('cannot depend on itself');
    });

    test('rejects a circular dependency', async ({ seed, api }) => {
        const data = await seed();
        // research <- draft <- publish. Making research depend on publish closes the loop.
        const res = await api.post('/api/editTask', {
            data: {
                task: {
                    _id: data.named.research._id.toString(),
                    dependsOn: [data.named.publish._id.toString()],
                },
            },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('Circular dependency');
    });

    test('completes a task and moves it out of the active list', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.proposal;

        const res = await api.post('/api/completeTask', {
            data: { taskId: task._id.toString() },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(titles(body.taskList)).not.toContain(task.title);
    });

    test('completion removes only the task generated calendar events', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.proposal;
        const otherTask = data.named.codeReview;
        const eventFields = {
            title: 'Completion cleanup fixture',
            startDate: new Date('2030-01-01T10:00:00Z'),
            endDate: new Date('2030-01-01T11:00:00Z'),
        };

        const events = await withDb(() => EventDetails.create([
            {
                ...eventFields,
                type: 'task',
                taskRef: task._id,
                userRef: data.primary.user._id,
            },
            {
                ...eventFields,
                type: 'task-chunk',
                taskRef: task._id,
                userRef: data.primary.user._id,
            },
            {
                ...eventFields,
                type: 'calendar',
                taskRef: task._id,
                userRef: data.primary.user._id,
            },
            {
                ...eventFields,
                type: 'task',
                taskRef: otherTask._id,
                userRef: data.primary.user._id,
            },
            {
                ...eventFields,
                type: 'task',
                taskRef: task._id,
                userRef: data.other.user._id,
            },
        ]));

        const res = await api.post('/api/completeTask', {
            data: { taskId: task._id.toString() },
        });
        const body = await res.json();
        const remainingIds = await withDb(async () => {
            const remaining = await EventDetails.find({ _id: { $in: events.map((event) => event._id) } });
            return remaining.map((event) => event._id.toString());
        });

        expect(body.success).toBe(true);
        expect(remainingIds).not.toContain(events[0]._id.toString());
        expect(remainingIds).not.toContain(events[1]._id.toString());
        expect(remainingIds).toHaveLength(3);
        expect(remainingIds).toEqual(expect.arrayContaining(
            events.slice(2).map((event) => event._id.toString())
        ));
    });

    test('completing a legacy repeating task creates the next occurrence', async ({ seed, api }) => {
        await seed();

        const before = await (await api.get('/api/getUserTasks')).json();
        const weekly = before.taskList.find((t) => t.repeat === 'weekly' && !t.completed);
        expect(weekly).toBeTruthy();

        const res = await api.post('/api/completeTask', { data: { taskId: weekly._id } });
        const body = await res.json();

        // A legacy `repeat` string still clones itself forward on completion, so nothing
        // breaks before the scheduler promotes it to a series. Rule-based recurrence is
        // covered by tests/api/recurrence.spec.js instead.
        const successors = body.taskList.filter((t) => t.title === weekly.title);
        expect(successors).toHaveLength(1);
        expect(successors[0]._id).not.toBe(weekly._id);
    });

    test('completing a chunk reduces the remaining duration', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.documentation; // 180 minutes, 60 minute chunks

        const res = await api.post('/api/completeTaskChunk', {
            data: { taskId: task._id.toString(), chunkDuration: 60 },
        });
        const body = await res.json();

        const updated = body.taskList.find((t) => t._id === task._id.toString());
        expect(updated.duration).toBe(120);
    });

    test('completing the final chunk completes the task', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.documentation;

        const res = await api.post('/api/completeTaskChunk', {
            data: { taskId: task._id.toString(), chunkDuration: 180 },
        });
        const body = await res.json();

        expect(body.taskList.find((t) => t._id === task._id.toString())).toBeUndefined();
    });

    test('toggles a task into the backlog', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.codeReview;

        await api.post('/api/editTask', {
            data: { task: { _id: task._id.toString(), isBacklog: true, dueDate: null } },
        });

        const after = await (await api.get('/api/getUserTasks')).json();
        const updated = after.taskList.find((t) => t._id === task._id.toString());
        expect(updated.isBacklog).toBe(true);
    });

    test('creates a follow up and completes the original task', async ({ seed, api }) => {
        const data = await seed();
        const original = data.named.codeReview;

        const res = await api.post('/api/setFollowUp', {
            data: {
                title: 'Follow up on the code review',
                followUpDate: dateOnly(3),
                taskID: original._id.toString(),
            },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(titles(body.taskList)).toContain('Follow up on the code review');
        expect(titles(body.taskList)).not.toContain(original.title);
        const followUp = body.taskList.find(
            (task) => task.title === 'Follow up on the code review'
        );
        expect(followUp.startDate).toBe(dateOnly(3));
        expect(followUp.dueDate).toBe(dateOnly(3));
    });

    test('deletes a task', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.codeReview;

        const res = await api.post('/api/deleteTask', {
            data: { taskId: task._id.toString() },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(titles(body.taskList)).not.toContain(task.title);
    });

    test('refuses to delete a task belonging to another user', async ({ seed, api }) => {
        const data = await seed();

        // Grab one of the other user's tasks straight from the seed result.
        const foreign = data.tasks.find((t) => t.title.includes('OTHER USER SECRET'));
        expect(foreign).toBeTruthy();

        const res = await api.post('/api/deleteTask', {
            data: { taskId: foreign._id.toString() },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('not found');
    });
});
