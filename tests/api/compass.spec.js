const { test, expect } = require('../fixtures');

// Every mutation returns the same payload as getCompass.
async function compass(api, query = '') {
    const res = await api.get(`/api/getCompass${query}`);
    return res.json();
}

function findRole(body, title) {
    return body.roles.find((r) => r.title === title);
}

function findGoal(role, title) {
    return (role.goalList || []).find((g) => g.title === title);
}

// An ISO date offset from today, for building completed windows.
function daysFromNow(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

test.describe('compass', () => {
    test('returns the live hierarchy with nested refs and parked projects', async ({ seed, api }) => {
        const data = await seed();
        const body = await compass(api);

        expect(body.success).toBe(true);

        const engineer = findRole(body, 'Engineer');
        const shipV2 = findGoal(engineer, 'Ship v2 by June');
        const migration = shipV2.projectList.find((p) => p.title === 'Migration plan');
        const someday = shipV2.projectList.find((p) => p.title === 'Rewrite the CLI');

        expect(engineer.description).toBe(data.named.engineerRole.description);
        expect(shipV2.roleRef).toBe(String(engineer._id));
        expect(migration.goalRef).toBe(String(shipV2._id));
        expect(someday.startDate).toBeFalsy();
        expect(findRole(body, 'Volunteer board member')).toBeFalsy();
        expect(findGoal(engineer, 'Finish the v1 maintenance window')).toBeFalsy();
    });

    test('creates, edits, and archives a branch through the live payload', async ({ seed, api }) => {
        await seed();

        let body = await (await api.post('/api/createRole', {
            data: { title: 'Musician', description: 'Play more', startDate: daysFromNow(-10) },
        })).json();
        const musician = findRole(body, 'Musician');

        body = await (await api.post('/api/createGoal', {
            data: { title: 'Learn piano', startDate: daysFromNow(-5), roleRef: musician._id },
        })).json();
        const goal = findGoal(findRole(body, 'Musician'), 'Learn piano');

        body = await (await api.post('/api/createProject', {
            data: { title: 'Scales practice', goalRef: goal._id },
        })).json();

        expect(
            findGoal(findRole(body, 'Musician'), 'Learn piano').projectList
                .find((p) => p.title === 'Scales practice')
                .startDate
        ).toBeFalsy();

        body = await (await api.post('/api/editRole', {
            data: { _id: String(musician._id), title: 'Musician & theory' },
        })).json();
        expect(findRole(body, 'Musician & theory')).toBeTruthy();

        const beforeArchive = body.completedCounts.roles;
        body = await (await api.post('/api/editRole', {
            data: { _id: String(musician._id), endDate: daysFromNow(-1) },
        })).json();

        expect(body.success).toBe(true);
        expect(findRole(body, 'Musician & theory')).toBeFalsy();
        expect(JSON.stringify(body.roles)).not.toContain('Learn piano');
        expect(body.completedCounts.roles).toBe(beforeArchive + 1);
    });

    test('stores work vs personal context on the role only', async ({ seed, api }) => {
        await seed();
        let body = await compass(api);

        expect(findRole(body, 'Engineer').context).toBe('work');
        expect(findRole(body, 'Father').context).toBe('personal');

        // Explicit on create.
        body = await (await api.post('/api/createRole', {
            data: { title: 'Consultant', context: 'work', startDate: daysFromNow(-3) },
        })).json();
        const consultant = findRole(body, 'Consultant');
        expect(consultant.context).toBe('work');

        // Omitted on create defaults to personal.
        body = await (await api.post('/api/createRole', {
            data: { title: 'Gardener', startDate: daysFromNow(-3) },
        })).json();
        expect(findRole(body, 'Gardener').context).toBe('personal');

        // An unrelated edit leaves it alone.
        body = await (await api.post('/api/editRole', {
            data: { _id: String(consultant._id), description: 'Billable work' },
        })).json();
        expect(findRole(body, 'Consultant').context).toBe('work');

        // And it can be switched.
        body = await (await api.post('/api/editRole', {
            data: { _id: String(consultant._id), context: 'personal' },
        })).json();
        expect(findRole(body, 'Consultant').context).toBe('personal');

        // A bad value is fatal.
        const bad = await (await api.post('/api/editRole', {
            data: { _id: String(consultant._id), context: 'hobby' },
        })).json();
        expect(bad.success).toBe(false);
        expect(bad.log).toContain('Context must be work or personal');
    });

    test('ignores context on goals and projects', async ({ seed, api }) => {
        const data = await seed();

        let body = await (await api.post('/api/createGoal', {
            data: {
                title: 'Contextless goal',
                startDate: daysFromNow(-2),
                roleRef: String(data.named.engineerRole._id),
                context: 'work',
            },
        })).json();
        expect(body.success).toBe(true);

        const goal = findGoal(findRole(body, 'Engineer'), 'Contextless goal');
        expect(goal.context).toBeUndefined();

        body = await (await api.post('/api/createProject', {
            data: { title: 'Contextless project', goalRef: String(goal._id), context: 'nonsense' },
        })).json();
        expect(body.success).toBe(true);

        const project = findGoal(findRole(body, 'Engineer'), 'Contextless goal')
            .projectList.find((p) => p.title === 'Contextless project');
        expect(project.context).toBeUndefined();
    });

    test('requires cascade for a populated role and unlinks tasks when deleting the subtree', async ({ seed, api }) => {
        const data = await seed();
        const migrationId = String(data.named.migrationProject._id);

        const blockedBody = await (await api.post('/api/deleteRole', {
            data: { _id: String(data.named.engineerRole._id) },
        })).json();
        expect(blockedBody.success).toBe(false);
        expect(blockedBody.log).toContain('cascade');

        const beforeTasks = (await (await api.get('/api/getUserTasks')).json()).taskList;
        const linked = beforeTasks.filter((t) => t.projectRef === migrationId);

        const body = await (await api.post('/api/deleteRole', {
            data: { _id: String(data.named.engineerRole._id), cascade: true },
        })).json();
        expect(body.success).toBe(true);
        expect(findRole(body, 'Engineer')).toBeFalsy();

        const afterTasks = (await (await api.get('/api/getUserTasks')).json()).taskList;
        expect(afterTasks).toHaveLength(beforeTasks.length);
        expect(linked.length).toBeGreaterThan(0);
        for (const task of linked) {
            expect(afterTasks.find((t) => t._id === task._id)?.projectRef).toBeFalsy();
        }
    });

    test('ends a project immediately, on the same call', async ({ seed, api }) => {
        const data = await seed();
        const before = await compass(api);
        const projectId = String(data.named.perfProject._id);

        const body = await (await api.post('/api/endProject', {
            data: { _id: projectId },
        })).json();

        expect(body.success).toBe(true);
        expect(JSON.stringify(body.roles)).not.toContain('Perf pass');
        expect(body.completedCounts.projects).toBe(before.completedCounts.projects + 1);

        // And it stays gone on a fresh read, rather than only in the mutation's echo.
        expect(JSON.stringify((await compass(api)).roles)).not.toContain('Perf pass');
    });

    test('a future end date still leaves an item live', async ({ seed, api }) => {
        const data = await seed();

        const body = await (await api.post('/api/editProject', {
            data: { _id: String(data.named.perfProject._id), endDate: daysFromNow(3) },
        })).json();

        expect(JSON.stringify(body.roles)).toContain('Perf pass');
    });

    test('ending applies the chosen action to the unfinished tasks beneath', async ({ seed, api }) => {
        const data = await seed();
        const projectId = String(data.named.migrationProject._id);

        const taskList = (await (await api.get('/api/getUserTasks')).json()).taskList;
        const openIds = taskList.filter((t) => t.projectRef === projectId).map((t) => t._id);
        expect(openIds.length).toBeGreaterThan(0);

        const body = await (await api.post('/api/endProject', {
            data: { _id: projectId, taskAction: 'unlink' },
        })).json();

        expect(body.success).toBe(true);
        expect(body.taskAction).toBe('unlink');
        expect(body.affectedTaskCount).toBe(openIds.length);

        const after = (await (await api.get('/api/getUserTasks')).json()).taskList;
        for (const id of openIds) {
            const task = after.find((t) => t._id === id);
            expect(task).toBeTruthy();
            expect(task.projectRef).toBeFalsy();
        }

        // Completed work keeps its link, so the project's history survives being ended.
        const completions = (await (await api.get(
            `/api/getProjectCompletions?completedFrom=${daysFromNow(-60)}&completedTo=${daysFromNow(0)}`
        )).json()).items;
        expect(completions.some((item) => item.projectRef === projectId)).toBe(true);
    });

    test('ending can complete the work instead, or leave it alone', async ({ seed, api }) => {
        const data = await seed();
        const hiringId = String(data.named.hiringProject._id);
        const trainingId = String(data.named.trainingProject._id);

        const before = (await (await api.get('/api/getUserTasks')).json()).taskList;
        const hiringIds = before.filter((t) => t.projectRef === hiringId).map((t) => t._id);
        const trainingIds = before.filter((t) => t.projectRef === trainingId).map((t) => t._id);
        expect(hiringIds.length).toBeGreaterThan(0);
        expect(trainingIds.length).toBeGreaterThan(0);

        const completed = await (await api.post('/api/endProject', {
            data: { _id: hiringId, taskAction: 'complete' },
        })).json();
        expect(completed.affectedTaskCount).toBe(hiringIds.length);

        const kept = await (await api.post('/api/endProject', {
            data: { _id: trainingId, taskAction: 'keep' },
        })).json();
        expect(kept.affectedTaskCount).toBe(0);

        // getUserTasks only returns unfinished work, so completed tasks drop out of it.
        const after = (await (await api.get('/api/getUserTasks')).json()).taskList;
        for (const id of hiringIds) expect(after.find((t) => t._id === id)).toBeFalsy();
        for (const id of trainingIds) {
            expect(after.find((t) => t._id === id)?.projectRef).toBe(trainingId);
        }

        // Completing a repeating task clones it forward; that clone must not land back
        // inside the project that was just ended.
        expect(after.some((task) => task.projectRef === hiringId)).toBe(false);
    });

    test('rejects an unknown task action and another tenant\'s project', async ({ seed, api }) => {
        const data = await seed();

        const badAction = await (await api.post('/api/endProject', {
            data: { _id: String(data.named.perfProject._id), taskAction: 'destroy' },
        })).json();
        expect(badAction.success).toBe(false);
        expect(badAction.log).toContain('Task action');

        const otherTenant = await (await api.post('/api/endProject', {
            data: { _id: String(data.named.otherProject._id) },
        })).json();
        expect(otherTenant.success).toBe(false);
    });

    test('ending a role archives its whole branch into the archive, not into limbo', async ({ seed, api }) => {
        const data = await seed();
        const before = await compass(api);

        const body = await (await api.post('/api/endRole', {
            data: { _id: String(data.named.engineerRole._id), taskAction: 'keep' },
        })).json();

        expect(body.success).toBe(true);
        expect(findRole(body, 'Engineer')).toBeFalsy();

        // The children must be genuinely ended, not merely unreachable: otherwise they are
        // missing from the board AND from the archive.
        expect(body.completedCounts.goals).toBeGreaterThan(before.completedCounts.goals);
        expect(body.completedCounts.projects).toBeGreaterThan(before.completedCounts.projects);

        const archive = await (await api.get('/api/getCompassArchive?level=project&limit=100')).json();
        expect(archive.items.map((item) => item.title)).toContain('Migration plan');
    });

    test('names ended projects that unfinished work still points at', async ({ seed, api }) => {
        const data = await seed();
        const projectId = String(data.named.trainingProject._id);

        expect((await compass(api)).endedProjects).toEqual([]);

        const body = await (await api.post('/api/endProject', {
            data: { _id: projectId, taskAction: 'keep' },
        })).json();

        // Left-behind work is not an orphan: the page needs a title to group it under.
        const named = body.endedProjects.find((p) => String(p._id) === projectId);
        expect(named).toBeTruthy();
        expect(named.title).toBe('Training block');
        // Civil date, like every other date Compass returns -- not an ISO instant.
        expect(named.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // Unlinking removes the reason to mention it at all.
        const unlinked = await (await api.post('/api/endProject', {
            data: { _id: String(data.named.hiringProject._id), taskAction: 'unlink' },
        })).json();
        expect(unlinked.endedProjects.map((p) => p.title)).not.toContain('Hiring loop');
    });

    test('applies representative validation', async ({ seed, api }) => {
        const data = await seed();

        const body = await (await api.post('/api/createGoal', {
            data: { title: 'No start', roleRef: String(data.named.engineerRole._id) },
        })).json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('Start date');
    });

    test('keeps hierarchy and mutating endpoints tenant-scoped', async ({ seed, api }) => {
        const data = await seed();

        const body = await compass(api);
        expect(JSON.stringify(body.roles)).not.toContain('OTHER USER SECRET');

        const editBody = await (await api.post('/api/editRole', {
            data: { _id: String(data.named.otherRole._id), title: 'Hijacked' },
        })).json();
        expect(editBody.success).toBe(false);

        const linkTaskBody = await (await api.post('/api/setTaskProject', {
            data: {
                taskId: String(data.named.proposal._id),
                projectId: String(data.named.otherProject._id),
            },
        })).json();
        expect(linkTaskBody.success).toBe(false);
    });

    test('reports completed counts and a representative archive window without changing the live tree', async ({ seed, api }) => {
        const data = await seed();

        const all = await compass(api);
        const windowed = await compass(api, `?completedFrom=${daysFromNow(-100)}`);

        expect(all.completedCounts).toEqual({ roles: 1, goals: 1, projects: 1 });
        expect(windowed.completedCounts).toEqual({ roles: 0, goals: 1, projects: 1 });
        expect(windowed.roles.length).toBe(all.roles.length);

        const selected = data.named.endedGoal.endDate.toISOString().slice(0, 10);
        const archive = await (await api.get(
            `/api/getCompassArchive?level=goal&completedFrom=${selected}&completedTo=${selected}`
        )).json();

        expect(archive.success).toBe(true);
        expect(archive.level).toBe('goal');
        expect(archive.totalCount).toBe(1);
    });

    test('tracks task alignment when linking, unlinking, and editing project refs', async ({ seed, api }) => {
        const data = await seed();
        const before = await compass(api);

        const linkedBody = await (await api.post('/api/setTaskProject', {
            data: {
                taskId: String(data.named.zeroDuration._id),
                projectId: String(data.named.perfProject._id),
            },
        })).json();
        expect(linkedBody.unalignedTaskCount).toBe(before.unalignedTaskCount - 1);

        const unlinkedBody = await (await api.post('/api/setTaskProject', {
            data: { taskId: String(data.named.research._id), projectId: null },
        })).json();
        expect(unlinkedBody.unalignedTaskCount).toBe(linkedBody.unalignedTaskCount + 1);

        const projectId = String(data.named.perfProject._id);
        const created = (await (await api.post('/api/createTask', {
            data: {
                title: 'Aligned task',
                duration: 30,
                startDate: daysFromNow(0),
                dueDate: daysFromNow(1),
                projectRef: projectId,
            },
        })).json()).taskList.find((t) => t.title === 'Aligned task');
        expect(created.projectRef).toBe(projectId);

        const newProjectId = String(data.named.hiringProject._id);
        await api.post('/api/editTask', {
            data: { task: { ...created, projectRef: newProjectId } },
        });

        const reloaded = (await (await api.get('/api/getUserTasks')).json()).taskList
            .find((t) => t._id === created._id);
        expect(reloaded.projectRef).toBe(newProjectId);
    });
});
