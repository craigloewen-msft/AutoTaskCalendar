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
    return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

test.describe('compass', () => {
    test('returns roles with goals and projects nested, as stored', async ({ seed, api }) => {
        const data = await seed();
        const body = await compass(api);

        expect(body.success).toBe(true);

        const engineer = findRole(body, 'Engineer');
        expect(engineer).toBeTruthy();
        expect(engineer.description).toBe(data.named.engineerRole.description);

        const shipV2 = findGoal(engineer, 'Ship v2 by June');
        expect(shipV2).toBeTruthy();
        expect(shipV2.roleRef).toBe(String(engineer._id));

        const migration = shipV2.projectList.find((p) => p.title === 'Migration plan');
        expect(migration).toBeTruthy();
        expect(migration.goalRef).toBe(String(shipV2._id));
    });

    test('adds no derived status, buckets, or rollups', async ({ seed, api }) => {
        await seed();
        const body = await compass(api);

        // The payload is the tree plus exactly two extras.
        expect(Object.keys(body).sort()).toEqual(
            ['completedCounts', 'roles', 'success', 'unalignedTaskCount'].sort()
        );

        const engineer = findRole(body, 'Engineer');
        expect(engineer.rollup).toBeUndefined();
        expect(engineer.stalled).toBeUndefined();
        expect(engineer.isActive).toBeUndefined();

        const shipV2 = findGoal(engineer, 'Ship v2 by June');
        expect(shipV2.rollup).toBeUndefined();
        expect(shipV2.stalled).toBeUndefined();
    });

    test('keeps ended and parked items in the tree under their real parent', async ({ seed, api }) => {
        await seed();
        const body = await compass(api);

        // An ended role is still returned, not filtered into an archive bucket.
        const ended = findRole(body, 'Volunteer board member');
        expect(ended).toBeTruthy();
        expect(ended.endDate).toBeTruthy();

        const engineer = findRole(body, 'Engineer');
        const endedGoal = findGoal(engineer, 'Finish the v1 maintenance window');
        expect(endedGoal).toBeTruthy();

        // A project with no start date stays under its goal; the client parks it.
        const shipV2 = findGoal(engineer, 'Ship v2 by June');
        const someday = shipV2.projectList.find((p) => p.title === 'Rewrite the CLI');
        expect(someday).toBeTruthy();
        expect(someday.startDate).toBeFalsy();
    });

    test('creates a role, goal, and project', async ({ seed, api }) => {
        await seed();

        const roleRes = await api.post('/api/createRole', {
            data: { title: 'Musician', description: 'Play more', startDate: daysFromNow(-10) },
        });
        let body = await roleRes.json();
        expect(body.success).toBe(true);

        const musician = findRole(body, 'Musician');
        expect(musician).toBeTruthy();

        const goalRes = await api.post('/api/createGoal', {
            data: { title: 'Learn piano', startDate: daysFromNow(-5), roleRef: musician._id },
        });
        body = await goalRes.json();
        expect(body.success).toBe(true);

        const goal = findGoal(findRole(body, 'Musician'), 'Learn piano');
        expect(goal).toBeTruthy();

        const projectRes = await api.post('/api/createProject', {
            data: { title: 'Scales practice', goalRef: goal._id },
        });
        body = await projectRes.json();
        expect(body.success).toBe(true);

        const project = findGoal(findRole(body, 'Musician'), 'Learn piano')
            .projectList.find((p) => p.title === 'Scales practice');
        expect(project).toBeTruthy();
        // No start date given: it stays parked.
        expect(project.startDate).toBeFalsy();
    });

    test('edits an item', async ({ seed, api }) => {
        const data = await seed();

        const res = await api.post('/api/editRole', {
            data: { _id: String(data.named.healthRole._id), title: 'Health & fitness' },
        });
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(findRole(body, 'Health & fitness')).toBeTruthy();
        expect(findRole(body, 'Health')).toBeFalsy();
    });

    test('deletes a project and keeps its tasks', async ({ seed, api }) => {
        const data = await seed();
        const projectId = String(data.named.trainingProject._id);

        const before = await api.get('/api/getUserTasks');
        const beforeCount = (await before.json()).taskList.length;

        const res = await api.post('/api/deleteProject', { data: { _id: projectId } });
        expect((await res.json()).success).toBe(true);

        const after = await api.get('/api/getUserTasks');
        const afterTasks = (await after.json()).taskList;

        // Same tasks, just no longer pointing at the deleted project.
        expect(afterTasks.length).toBe(beforeCount);
        expect(afterTasks.some((t) => t.projectRef === projectId)).toBe(false);
    });

    test.describe('validation', () => {
        test('requires a title', async ({ seed, api }) => {
            await seed();

            const res = await api.post('/api/createRole', { data: { startDate: daysFromNow(0) } });
            const body = await res.json();

            expect(body.success).toBe(false);
            expect(body.log).toContain('Title');
        });

        test('requires a start date on roles and goals', async ({ seed, api }) => {
            const data = await seed();

            const roleRes = await api.post('/api/createRole', { data: { title: 'No start' } });
            expect((await roleRes.json()).log).toContain('Start date');

            const goalRes = await api.post('/api/createGoal', {
                data: { title: 'No start', roleRef: String(data.named.engineerRole._id) },
            });
            expect((await goalRes.json()).log).toContain('Start date');
        });

        test('allows a project with no start date', async ({ seed, api }) => {
            const data = await seed();

            const res = await api.post('/api/createProject', {
                data: { title: 'Parked idea', goalRef: String(data.named.shipV2._id) },
            });

            expect((await res.json()).success).toBe(true);
        });

        test('rejects an end date before the start date', async ({ seed, api }) => {
            await seed();

            const res = await api.post('/api/createRole', {
                data: { title: 'Backwards', startDate: daysFromNow(0), endDate: daysFromNow(-10) },
            });
            const body = await res.json();

            expect(body.success).toBe(false);
            expect(body.log).toContain('End date');
        });

        test('rejects an unknown parent', async ({ seed, api }) => {
            await seed();

            const res = await api.post('/api/createGoal', {
                data: { title: 'Orphan', startDate: daysFromNow(0), roleRef: '507f1f77bcf86cd799439011' },
            });
            const body = await res.json();

            expect(body.success).toBe(false);
            expect(body.log).toContain('not found');
        });
    });

    test.describe('cross-tenant isolation', () => {
        test('never returns another user\'s hierarchy', async ({ seed, api }) => {
            await seed();
            const body = await compass(api);

            const titles = JSON.stringify(body.roles);
            expect(titles).not.toContain('OTHER USER SECRET');
        });

        test('cannot edit or delete another user\'s role', async ({ seed, api }) => {
            const data = await seed();
            const otherRoleId = String(data.named.otherRole._id);

            const editRes = await api.post('/api/editRole', {
                data: { _id: otherRoleId, title: 'Hijacked' },
            });
            expect((await editRes.json()).success).toBe(false);

            const deleteRes = await api.post('/api/deleteRole', { data: { _id: otherRoleId } });
            expect((await deleteRes.json()).success).toBe(false);
        });

        test('cannot parent a goal to another user\'s role', async ({ seed, api }) => {
            const data = await seed();

            const res = await api.post('/api/createGoal', {
                data: {
                    title: 'Sneaky goal',
                    startDate: daysFromNow(0),
                    roleRef: String(data.named.otherRole._id),
                },
            });

            expect((await res.json()).success).toBe(false);
        });

        test('cannot link a task to another user\'s project', async ({ seed, api }) => {
            const data = await seed();

            const res = await api.post('/api/setTaskProject', {
                data: {
                    taskId: String(data.named.proposal._id),
                    projectId: String(data.named.otherProject._id),
                },
            });

            expect((await res.json()).success).toBe(false);
        });
    });

    test.describe('cascading deletes', () => {
        test('refuses to delete a role that still has goals', async ({ seed, api }) => {
            const data = await seed();

            const res = await api.post('/api/deleteRole', {
                data: { _id: String(data.named.engineerRole._id) },
            });
            const body = await res.json();

            expect(body.success).toBe(false);
            expect(body.log).toContain('cascade');
        });

        test('cascade removes the subtree but never deletes tasks', async ({ seed, api }) => {
            const data = await seed();
            const migrationId = String(data.named.migrationProject._id);

            const before = await api.get('/api/getUserTasks');
            const beforeTasks = (await before.json()).taskList;
            const linked = beforeTasks.filter((t) => t.projectRef === migrationId);
            expect(linked.length).toBeGreaterThan(0);

            const res = await api.post('/api/deleteRole', {
                data: { _id: String(data.named.engineerRole._id), cascade: true },
            });
            const body = await res.json();

            expect(body.success).toBe(true);
            expect(findRole(body, 'Engineer')).toBeFalsy();

            const after = await api.get('/api/getUserTasks');
            const afterTasks = (await after.json()).taskList;

            // Every task survives; they are simply unlinked.
            expect(afterTasks.length).toBe(beforeTasks.length);
            for (const task of linked) {
                const still = afterTasks.find((t) => t._id === task._id);
                expect(still).toBeTruthy();
                expect(still.projectRef).toBeFalsy();
            }
        });
    });

    test.describe('completedCounts', () => {
        test('counts finished items across all time', async ({ seed, api }) => {
            await seed();
            const body = await compass(api);

            // The dataset ends one role, one goal, and one project.
            expect(body.completedCounts).toEqual({ roles: 1, goals: 1, projects: 1 });
        });

        test('a window narrows the counts but never the tree', async ({ seed, api }) => {
            await seed();
            const all = await compass(api);

            // The ended role finished 120 days ago; the goal and project inside 100.
            const windowed = await compass(api, `?completedFrom=${daysFromNow(-100)}`);

            expect(windowed.success).toBe(true);
            expect(windowed.completedCounts.roles).toBe(0);
            expect(windowed.completedCounts.goals).toBe(1);
            expect(windowed.completedCounts.projects).toBe(1);

            // The hierarchy itself is untouched by the window.
            expect(windowed.roles.length).toBe(all.roles.length);
        });

        test('an out-of-range window returns zeroes', async ({ seed, api }) => {
            await seed();

            const body = await compass(
                api,
                `?completedFrom=${daysFromNow(-3000)}&completedTo=${daysFromNow(-2000)}`
            );

            expect(body.completedCounts).toEqual({ roles: 0, goals: 0, projects: 0 });
        });

        test('an unparseable date is ignored rather than fatal', async ({ seed, api }) => {
            await seed();
            const body = await compass(api, '?completedFrom=not-a-date');

            expect(body.success).toBe(true);
            expect(body.completedCounts).toEqual({ roles: 1, goals: 1, projects: 1 });
        });
    });

    test.describe('task alignment', () => {
        test('unalignedTaskCount drops when a task is linked', async ({ seed, api }) => {
            const data = await seed();
            const before = await compass(api);
            expect(before.unalignedTaskCount).toBeGreaterThan(0);

            const res = await api.post('/api/setTaskProject', {
                data: {
                    taskId: String(data.named.zeroDuration._id),
                    projectId: String(data.named.perfProject._id),
                },
            });
            const body = await res.json();

            expect(body.success).toBe(true);
            expect(body.unalignedTaskCount).toBe(before.unalignedTaskCount - 1);
        });

        test('a null projectId unlinks the task', async ({ seed, api }) => {
            const data = await seed();
            const before = await compass(api);

            const res = await api.post('/api/setTaskProject', {
                data: { taskId: String(data.named.research._id), projectId: null },
            });
            const body = await res.json();

            expect(body.success).toBe(true);
            expect(body.unalignedTaskCount).toBe(before.unalignedTaskCount + 1);
        });

        test('projectRef survives createTask and editTask', async ({ seed, api }) => {
            const data = await seed();
            const projectId = String(data.named.perfProject._id);

            const createRes = await api.post('/api/createTask', {
                data: {
                    title: 'Aligned task',
                    duration: 30,
                    startDate: new Date().toISOString(),
                    dueDate: new Date(Date.now() + 86400000).toISOString(),
                    projectRef: projectId,
                },
            });
            const created = (await createRes.json()).taskList.find((t) => t.title === 'Aligned task');
            expect(created.projectRef).toBe(projectId);

            const newProjectId = String(data.named.hiringProject._id);
            const editRes = await api.post('/api/editTask', {
                data: { task: { ...created, projectRef: newProjectId } },
            });
            expect((await editRes.json()).success).toBe(true);

            const list = await api.get('/api/getUserTasks');
            const reloaded = (await list.json()).taskList.find((t) => t._id === created._id);
            expect(reloaded.projectRef).toBe(newProjectId);
        });

        test('rejects a task pointed at an unknown project', async ({ seed, api }) => {
            await seed();

            const res = await api.post('/api/createTask', {
                data: {
                    title: 'Bad project',
                    duration: 30,
                    startDate: new Date().toISOString(),
                    dueDate: new Date(Date.now() + 86400000).toISOString(),
                    projectRef: '507f1f77bcf86cd799439011',
                },
            });
            const body = await res.json();

            expect(body.success).toBe(false);
            expect(body.log).toContain('project');
        });
    });

    test('editTask cannot modify another user\'s task', async ({ seed, api, loginAs }) => {
        const data = await seed();

        // Find a task owned by otheruser.
        const otherTask = data.tasks.find((t) => t.title.includes('OTHER USER SECRET TASK'));
        expect(otherTask).toBeTruthy();

        const res = await api.post('/api/editTask', {
            data: { task: { _id: String(otherTask._id), title: 'Hijacked title' } },
        });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.log).toContain('not found');

        // And the task itself is untouched.
        const otherApi = await loginAs('otheruser');
        const list = await otherApi.get('/api/getUserTasks');
        const titles = (await list.json()).taskList.map((t) => t.title);

        expect(titles).toContain(otherTask.title);
        expect(titles).not.toContain('Hijacked title');
    });

    test('requires authentication', async ({ seed, apiAnon }) => {
        await seed();

        const res = await apiAnon.get('/api/getCompass');
        expect(res.status()).toBe(401);
    });
});
