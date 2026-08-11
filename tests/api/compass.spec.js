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
