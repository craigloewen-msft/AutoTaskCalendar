const { test, expect, withDb } = require('../fixtures');
const { UserDetails, TaskDetails } = require('../../models');
const { getOverview, ACTIVE_TASK } = require('../../controllers/adminController');

/**
 * Admin dashboard. See docs/ADMIN.md.
 *
 * Twelve workers share one database and these endpoints read across every tenant, so
 * site-wide totals move underneath the test. Global counts are asserted with `>=`; exact
 * assertions are reserved for a single searched row.
 */
test.describe('admin', () => {
    test('serves the dashboard only to admins', async ({ seed, api, apiAnon, loginAs }) => {
        const data = await seed();
        const adminApi = await loginAs(data.admin.username, data.admin.password);

        for (const path of ['/api/admin/overview', '/api/admin/users']) {
            expect((await apiAnon.get(path)).status()).toBe(401);
            // The primary seeded user is an ordinary account.
            expect((await api.get(path)).status()).toBe(403);
            expect((await adminApi.get(path)).status()).toBe(200);
        }

        // The flag alone decides: revoke it and the very same session loses access.
        await withDb(() => UserDetails.updateOne(
            { _id: data.admin.user._id },
            { $set: { isAdmin: false } }
        ));
        expect((await adminApi.get('/api/admin/overview')).status()).toBe(403);
    });

    test('reports site-wide totals, engagement, health, and a 30-day trend', async ({
        seed,
        loginAs,
    }) => {
        const data = await seed();
        const adminApi = await loginAs(data.admin.username, data.admin.password);
        const body = await (await adminApi.get('/api/admin/overview')).json();

        expect(body.success).toBe(true);
        expect(body.timeZone).toBe('UTC');

        // This tenant alone seeds six users and hundreds of tasks.
        expect(body.totals.users).toBeGreaterThanOrEqual(data.users.length);
        expect(body.totals.tasks).toBeGreaterThanOrEqual(data.tasks.length);
        expect(body.totals.completedTasks).toBeGreaterThanOrEqual(data.counts.completed);
        expect(body.totals.recurringSeries).toBeGreaterThanOrEqual(data.counts.series);
        expect(body.totals.projects).toBeGreaterThanOrEqual(data.projects.length);

        expect(body.engagement.activeUsers7).toBeGreaterThanOrEqual(1);
        expect(body.engagement.usersWithTasks).toBeGreaterThanOrEqual(1);
        expect(body.health.completionRate).toBeGreaterThan(0);
        // scheduled/unscheduled partition activeTasks, but each is its own query and
        // concurrent workers move the totals between them, so only the parts are asserted.
        expect(body.health.scheduledTasks).toBeGreaterThanOrEqual(0);
        expect(body.health.unscheduledTasks).toBeGreaterThanOrEqual(0);
        expect(body.health.scheduledTasks + body.health.unscheduledTasks)
            .toBeGreaterThan(0);

        // Exactly 30 buckets, oldest first, one civil day apart and zero-filled.
        expect(body.trends).toHaveLength(30);
        expect(body.trends[29].date).toBe(new Date().toISOString().slice(0, 10));
        const dates = body.trends.map((day) => day.date);
        expect([...dates].sort()).toEqual(dates);
        for (const day of body.trends) {
            expect(day.signups).toBeGreaterThanOrEqual(0);
            expect(day.tasksCreated).toBeGreaterThanOrEqual(0);
        }
    });

    test('lists users with per-tenant counts and never leaks credentials', async ({
        seed,
        loginAs,
    }) => {
        const data = await seed();
        const adminApi = await loginAs(data.admin.username, data.admin.password);

        // Searching the namespaced username pins the result to this test's own tenant.
        const body = await (await adminApi.get(
            `/api/admin/users?search=${encodeURIComponent(data.primary.username)}`
        )).json();

        expect(body.success).toBe(true);
        expect(body.totalCount).toBe(1);
        const row = body.users[0];
        expect(row.username).toBe(data.primary.username);

        const [taskCount, completedCount] = await withDb(() => Promise.all([
            TaskDetails.countDocuments({ userRef: data.primary.user._id }),
            TaskDetails.countDocuments({ userRef: data.primary.user._id, completed: true }),
        ]));
        expect(row.taskCount).toBe(taskCount);
        expect(row.completedCount).toBe(completedCount);
        expect(row.isAdmin).toBe(false);
        expect(row.createdAt).toBeTruthy();

        // Counts and booleans only: no hashes, no tokens, nothing a tenant owns.
        for (const field of ['hash', 'salt', 'googleAccessTokenEncrypted', 'googleRefreshTokenEncrypted']) {
            expect(row[field]).toBeUndefined();
        }
        expect(JSON.stringify(body)).not.toContain('OTHER USER SECRET');

        // The seeded admin is flagged in the listing.
        const adminBody = await (await adminApi.get(
            `/api/admin/users?search=${encodeURIComponent(data.admin.username)}`
        )).json();
        expect(adminBody.users[0].isAdmin).toBe(true);
    });

    // The overview's scheduled/unscheduled and aligned/unaligned splits must be exhaustive.
    // Scoped to this test's own tenant: site-wide counts move while concurrent workers seed.
    test('partitions active tasks into scheduled and unscheduled', async ({ seed }) => {
        const data = await seed();
        const mine = { ...ACTIVE_TASK, userRef: data.primary.user._id };

        const [active, scheduled, unscheduled, aligned, unaligned] = await withDb(() => Promise.all([
            TaskDetails.countDocuments(mine),
            TaskDetails.countDocuments({ ...mine, scheduledDate: { $ne: null } }),
            TaskDetails.countDocuments({ ...mine, scheduledDate: null }),
            TaskDetails.countDocuments({ ...mine, projectRef: { $ne: null } }),
            TaskDetails.countDocuments({ ...mine, projectRef: null }),
        ]));

        expect(active).toBeGreaterThan(0);
        expect(scheduled + unscheduled).toBe(active);
        expect(aligned + unaligned).toBe(active);

        // The same predicates the dashboard reports with, so the split cannot silently drift.
        const overview = await withDb(() => getOverview());
        expect(overview.totals.activeTasks).toBeGreaterThanOrEqual(active);
        expect(overview.health.scheduledTasks).toBeGreaterThanOrEqual(scheduled);
    });

    test('bounds paging and rejects an unknown sort', async ({ seed, loginAs }) => {
        const data = await seed();
        const adminApi = await loginAs(data.admin.username, data.admin.password);

        const capped = await (await adminApi.get('/api/admin/users?limit=5000')).json();
        expect(capped.success).toBe(true);
        expect(capped.limit).toBe(100);
        expect(capped.users.length).toBeLessThanOrEqual(100);

        const sorted = await (await adminApi.get('/api/admin/users?sort=username&limit=100')).json();
        const names = sorted.users.map((user) => user.username);
        expect([...names].sort()).toEqual(names);

        const bad = await (await adminApi.get('/api/admin/users?sort=password')).json();
        expect(bad.success).toBe(false);
        expect(bad.log).toContain('Sort must be one of');
    });
});
