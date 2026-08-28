'use strict';

/** Many agents share one database, so tenants must not see or delete each other. */

const { test, expect, testNamespace, withDb } = require('../fixtures');
const { runSeed, wipeNamespace, sweepStaleNamespaces } = require('../../seed');
const { UserDetails, TaskDetails } = require('../../models');
const instance = require('../../instance');

const TENANTS = 5;

async function userIds(namespace) {
    const users = await UserDetails.find({ seedNamespace: namespace }).select('_id');
    return users.map((user) => user._id);
}

test('concurrent tenants in the one database stay invisible to each other', async ({}, testInfo) => {
    test.slow();

    const base = testNamespace(testInfo);
    const namespaces = Array.from({ length: TENANTS }, (unused, index) => `${base}-t${index}`);

    try {
        await Promise.all(namespaces.map((namespace) => withDb(() => runSeed({
            mongoUrl: instance.mongoUrl,
            namespace,
        }))));

        const counts = await Promise.all(namespaces.map((namespace) => withDb(async () => {
            const ids = await userIds(namespace);
            return {
                users: ids.length,
                tasks: await TaskDetails.countDocuments({ userRef: { $in: ids } }),
            };
        })));

        // Every tenant got a full dataset, and each is identical in size to the others.
        expect(counts.every((count) => count.users > 0 && count.tasks > 0)).toBe(true);
        expect(new Set(counts.map((count) => `${count.users}:${count.tasks}`)).size).toBe(1);

        // Wiping one leaves the rest exactly as they were.
        await withDb(() => wipeNamespace(namespaces[0]));

        expect(await withDb(() => userIds(namespaces[0]))).toHaveLength(0);

        const after = await Promise.all(namespaces.slice(1).map((namespace) => withDb(async () => {
            const ids = await userIds(namespace);
            return {
                users: ids.length,
                tasks: await TaskDetails.countDocuments({ userRef: { $in: ids } }),
            };
        })));

        expect(after).toEqual(counts.slice(1));
    } finally {
        for (const namespace of namespaces) {
            await withDb(() => wipeNamespace(namespace));
        }
    }
});

test('seeding without a namespace is refused', async () => {
    await expect(runSeed({ mongoUrl: instance.mongoUrl })).rejects.toThrow(/needs a namespace/);
});

test('the sweeper removes abandoned tenants and spares live ones', async ({}, testInfo) => {
    const stale = `${testNamespace(testInfo)}-stale`;
    const live = `${testNamespace(testInfo)}-live`;

    try {
        await withDb(() => runSeed({ mongoUrl: instance.mongoUrl, namespace: stale }));
        await withDb(() => runSeed({ mongoUrl: instance.mongoUrl, namespace: live }));

        // Backdate one tenant past the sweep window.
        await withDb(() => UserDetails.updateMany(
            { seedNamespace: stale },
            { $set: { seededAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } }
        ));

        await withDb(() => sweepStaleNamespaces());

        expect(await withDb(() => userIds(stale))).toHaveLength(0);
        expect((await withDb(() => userIds(live))).length).toBeGreaterThan(0);
    } finally {
        await withDb(() => wipeNamespace(stale));
        await withDb(() => wipeNamespace(live));
    }
});
