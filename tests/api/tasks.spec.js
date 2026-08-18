const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, UserDetails, EventDetails, ProjectDetails } = require('../../models');
const { parseDateOnly } = require('../../utils/temporal');

function titles(taskList) {
    return taskList.map((task) => task.title);
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
    test('lists only the logged-in user\'s active tasks', async ({ seed, api }) => {
        const data = await seed();

        const body = await (await api.get('/api/getUserTasks')).json();
        const taskTitles = titles(body.taskList);

        expect(body.success).toBe(true);
        expect(body.taskList.length).toBeGreaterThan(0);
        expect(body.taskList.every((task) => !task.completed)).toBe(true);
        expect(taskTitles).toContain(data.named.proposal.title);
        expect(taskTitles.some((title) => title.startsWith('Finished task'))).toBe(false);
        expect(taskTitles.some((title) => title.includes('OTHER USER SECRET'))).toBe(false);
    });

    test('creates, edits, and deletes owned tasks without shifting civil dates', async ({ seed, api }) => {
        const data = await seed();

        const createdBody = await (await api.post('/api/createTask', {
            data: {
                title: 'DST date task',
                duration: 30,
                startDate: '2024-03-10',
                dueDate: '2024-03-10',
            },
        })).json();
        const created = createdBody.taskList.find((task) => task.title === 'DST date task');

        expect(createdBody.success).toBe(true);
        expect(created.startDate).toBe('2024-03-10');
        expect(created.dueDate).toBe('2024-03-10');

        const editedTitle = 'DST date task edited';
        expect((await (await api.post('/api/editTask', {
            data: { task: { ...created, title: editedTitle, notes: 'edited' } },
        })).json()).success).toBe(true);

        const afterEdit = await (await api.get('/api/getUserTasks')).json();
        const edited = afterEdit.taskList.find((task) => task._id === created._id);
        expect(edited.title).toBe(editedTitle);
        expect(edited.startDate).toBe('2024-03-10');
        expect(edited.dueDate).toBe('2024-03-10');

        const afterDelete = await (await api.post('/api/deleteTask', {
            data: { taskId: created._id },
        })).json();
        expect(afterDelete.success).toBe(true);
        expect(titles(afterDelete.taskList)).not.toContain(editedTitle);

        const foreign = data.tasks.find((task) => task.title.includes('OTHER USER SECRET'));
        const foreignDelete = await (await api.post('/api/deleteTask', {
            data: { taskId: foreign._id.toString() },
        })).json();
        expect(foreignDelete.success).toBe(false);
        expect(await withDb(() => TaskDetails.findById(foreign._id))).not.toBeNull();
    });

    test('requires a due date for active tasks but allows backlog tasks without one', async ({ seed, api }) => {
        await seed();

        const active = await (await api.post('/api/createTask', {
            data: {
                title: 'No due date',
                duration: 30,
                startDate: dateOnly(),
            },
        })).json();
        expect(active.success).toBe(false);
        expect(active.log).toContain('Due date is required');

        const backlog = await (await api.post('/api/createTask', {
            data: {
                title: 'Someday idea',
                duration: 30,
                startDate: dateOnly(),
                isBacklog: true,
            },
        })).json();
        expect(backlog.success).toBe(true);
    });

    test('rejects circular dependencies', async ({ seed, api }) => {
        const data = await seed();

        const body = await (await api.post('/api/editTask', {
            data: {
                task: {
                    _id: data.named.research._id.toString(),
                    dependsOn: [data.named.publish._id.toString()],
                },
            },
        })).json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('Circular dependency');
    });

    test('completes a task and removes only its generated task events', async ({ seed, api }) => {
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

        const body = await (await api.post('/api/completeTask', {
            data: { taskId: task._id.toString() },
        })).json();
        const remainingIds = await withDb(async () => {
            const remaining = await EventDetails.find({ _id: { $in: events.map((event) => event._id) } });
            return remaining.map((event) => event._id.toString());
        });

        expect(body.success).toBe(true);
        expect(titles(body.taskList)).not.toContain(task.title);
        expect(remainingIds).not.toContain(events[0]._id.toString());
        expect(remainingIds).not.toContain(events[1]._id.toString());
        expect(remainingIds).toEqual(expect.arrayContaining(
            events.slice(2).map((event) => event._id.toString())
        ));
        expect(remainingIds).toHaveLength(3);
    });

    test('completes chunked tasks incrementally until the final chunk removes them from the active list', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        const task = data.named.documentation;

        const partial = await (await api.post('/api/completeTaskChunk', {
            data: { taskId: task._id.toString(), chunkDuration: 60 },
        })).json();
        expect(partial.success).toBe(true);
        expect(partial.taskList.find((item) => item._id === task._id.toString()).duration).toBe(120);

        const final = await (await api.post('/api/completeTaskChunk', {
            data: { taskId: task._id.toString(), chunkDuration: 120 },
        })).json();
        expect(final.success).toBe(true);
        expect(final.taskList.find((item) => item._id === task._id.toString())).toBeUndefined();
    });

    test('exports owned completed work as LLM-ready Markdown in the saved timezone', async ({
        seed,
        api,
        apiAnon,
    }) => {
        const data = await seed();
        await withDb(async () => {
            await UserDetails.updateOne(
                { _id: data.primary.user._id },
                { $set: { timeZone: 'America/New_York' } }
            );
            const orphanProject = await ProjectDetails.create({
                title: 'Surviving project context',
                description: 'Project remains after its hierarchy changed',
                userRef: data.primary.user._id,
            });
            await TaskDetails.create([
                completedTask(data, {
                    title: 'Before export range',
                    completedDate: new Date('2024-03-04T04:59:59.999Z'),
                }),
                completedTask(data, {
                    title: 'At first local midnight',
                    notes: 'Impact *and* <private-looking-tag>\nsecond line',
                    completedDate: new Date('2024-03-04T05:00:00.000Z'),
                    dueDate: parseDateOnly('2030-12-31').date,
                }),
                completedTask(data, {
                    title: 'Recurring review 🚀',
                    completedDate: new Date('2024-03-11T03:59:59.999Z'),
                    occurrenceDate: parseDateOnly('2024-03-10').date,
                    seriesRef: data.named.weekdaysSeries._id,
                    projectRef: null,
                }),
                completedTask(data, {
                    title: 'Partial hierarchy completion',
                    completedDate: new Date('2024-03-08T16:00:00.000Z'),
                    projectRef: orphanProject._id,
                }),
                completedTask(data, {
                    title: 'Unavailable project completion',
                    completedDate: new Date('2024-03-09T12:00:00.000Z'),
                    projectRef: data.named.otherProject._id,
                }),
                completedTask(data, {
                    title: 'At next local midnight',
                    completedDate: new Date('2024-03-11T04:00:00.000Z'),
                }),
                completedTask(data, {
                    title: 'Incomplete secret',
                    completed: false,
                    completedDate: new Date('2024-03-08T12:00:00.000Z'),
                }),
                completedTask(data, {
                    title: 'OTHER USER SECRET COMPLETION',
                    userRef: data.other.user._id,
                    projectRef: data.named.otherProject._id,
                    completedDate: new Date('2024-03-08T12:00:00.000Z'),
                }),
            ]);
        });

        const query = '?completedFrom=2024-03-04&completedTo=2024-03-10';
        expect((await apiAnon.get(`/api/exportCompletedTasks${query}`)).status()).toBe(401);

        const response = await api.get(`/api/exportCompletedTasks${query}`);
        const report = await response.text();

        expect(response.headers()['content-type']).toContain('text/markdown');
        expect(response.headers()['cache-control']).toBe('no-store');
        expect(response.headers()['content-disposition']).toBe(
            'attachment; filename="completed-tasks-2024-03-04-to-2024-03-10.md"'
        );
        expect(report).toContain('# Completed task report');
        expect(report).toContain('America/New\\_York');
        expect(report).toContain('Completed tasks: **4**');
        expect(report).toContain('Engineer → Ship v2 by June → Migration plan');
        expect(report).toContain('Build and ship good software');
        expect(report).toContain('Plan and execute the data migration');
        expect(report).toContain('### Surviving project context');
        expect(report).toContain('Project remains after its hierarchy changed');
        expect(report).toContain('Partial hierarchy completion');
        expect(report).toContain('2024-03-04 00:00 EST — At first local midnight');
        expect(report).toContain('Impact \\*and\\* &lt;private-looking-tag&gt; second line');
        expect(report).toContain('Due date: 2030-12-31');
        expect(report).toContain('### Unaligned or unavailable project context');
        expect(report).toContain('Unavailable project completion');
        expect(report).toContain('2024-03-10 23:59 EDT — Recurring review 🚀');
        expect(report).toContain('Recurring occurrence: 2024-03-10');
        expect(report.indexOf('At first local midnight')).toBeLessThan(
            report.indexOf('Partial hierarchy completion')
        );
        expect(report.indexOf('Partial hierarchy completion')).toBeLessThan(
            report.indexOf('Unavailable project completion')
        );
        expect(report.indexOf('Unavailable project completion')).toBeLessThan(
            report.indexOf('Recurring review 🚀')
        );
        expect(report).not.toContain('Before export range');
        expect(report).not.toContain('At next local midnight');
        expect(report).not.toContain('Incomplete secret');
        expect(report).not.toContain('OTHER USER SECRET');
        expect(report).not.toContain('userRef');
        expect(report).not.toContain('priority');
        expect(report).not.toContain('duration');
    });

    test('validates completed task export date bounds and returns an empty report', async ({ seed, api }) => {
        await seed.clearTasks();

        for (const [query, message] of [
            ['', 'completedFrom and completedTo are required'],
            ['?completedFrom=2024-03-01&completedTo=not-a-date', 'Completion dates must use YYYY-MM-DD'],
            ['?completedFrom=2024-03-02&completedTo=2024-03-01', 'completedFrom must be on or before completedTo'],
        ]) {
            const body = await (await api.get(`/api/exportCompletedTasks${query}`)).json();
            expect(body.success).toBe(false);
            expect(body.log).toContain(message);
        }

        const response = await api.get(
            '/api/exportCompletedTasks?completedFrom=2024-03-01&completedTo=2024-03-31'
        );
        const report = await response.text();
        expect(report).toContain('Completed tasks: **0**');
        expect(report).toContain('No tasks were completed in this range.');
        expect(report).toContain('No completed work to list.');
    });

    test('returns authenticated, owned project completions from the local completion window', async ({
        seed,
        api,
        apiAnon,
    }) => {
        const data = await seed();
        await withDb(async () => {
            await UserDetails.updateOne(
                { _id: data.primary.user._id },
                { $set: { timeZone: 'America/New_York' } }
            );
            await TaskDetails.create([
                completedTask(data, {
                    title: 'Completed inside despite later due date',
                    dueDate: parseDateOnly('2024-04-20').date,
                    completedDate: new Date('2024-03-08T15:00:00.000Z'),
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

        const query = '?completedFrom=2024-03-04&completedTo=2024-03-10';
        expect((await apiAnon.get(`/api/getProjectCompletions${query}`)).status()).toBe(401);

        const body = await (await api.get(`/api/getProjectCompletions${query}`)).json();

        expect(body.success).toBe(true);
        expect(body.completedFrom).toBe('2024-03-04');
        expect(body.completedTo).toBe('2024-03-10');
        expect(body.items.map((task) => task.title)).toEqual([
            'Late local Sunday',
            'Completed inside despite later due date',
            'At local Monday',
        ]);
    });

    test('ignores server-owned identity fields when editing a task', async ({ seed, api }) => {
        const data = await seed();
        const task = data.named.proposal;
        const forgedCompletion = new Date('2024-03-06T12:00:00.000Z');

        const body = await (await api.post('/api/editTask', {
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
        })).json();
        const saved = await withDb(() => TaskDetails.findById(task._id));

        expect(body.success).toBe(true);
        expect(saved.title).toBe('Legitimate title edit');
        expect(saved.completed).not.toBe(true);
        expect(saved.completedDate).toBeFalsy();
        expect(String(saved.userRef)).toBe(String(data.primary.user._id));
        expect(saved.seriesRef).toBeNull();
        expect(saved.occurrenceDate).toBeNull();
        expect(saved.scheduledDate).toBeFalsy();
    });
});
