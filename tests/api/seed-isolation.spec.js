'use strict';

const { test, expect, testNamespace, withDb } = require('../fixtures');
const { runSeed, wipeNamespace } = require('../../seed');
const {
    UserDetails,
    TaskDetails,
    EventDetails,
    RoleDetails,
    GoalDetails,
    ProjectDetails,
} = require('../../models');
const instance = require('../../instance');

const ownedModels = [TaskDetails, EventDetails, RoleDetails, GoalDetails, ProjectDetails];

async function tenantCounts(data) {
    const userIds = data.users.map((user) => user.user._id);
    return Promise.all(ownedModels.map((model) => model.countDocuments({
        userRef: { $in: userIds },
    })));
}

test('namespaced seeds and cleanup never touch another tenant', async ({}, testInfo) => {
    const fixtureNamespace = testNamespace(testInfo);
    const firstNamespace = `${fixtureNamespace}-first`;
    const secondNamespace = `${fixtureNamespace}-second`;

    try {
        const [first, second] = await Promise.all([
            withDb(() => runSeed({ mongoUrl: instance.mongoUrl, namespace: firstNamespace })),
            withDb(() => runSeed({ mongoUrl: instance.mongoUrl, namespace: secondNamespace })),
        ]);
        const [firstBefore, secondBefore] = await Promise.all([
            withDb(() => tenantCounts(first)),
            withDb(() => tenantCounts(second)),
        ]);

        expect(firstBefore.every((count) => count > 0)).toBe(true);
        expect(secondBefore.every((count) => count > 0)).toBe(true);
        await withDb(() => wipeNamespace(firstNamespace));

        const firstUsers = await withDb(() => UserDetails.countDocuments({
            _id: { $in: first.users.map((user) => user.user._id) },
        }));
        const secondUsers = await withDb(() => UserDetails.countDocuments({
            _id: { $in: second.users.map((user) => user.user._id) },
        }));
        const secondAfter = await withDb(() => tenantCounts(second));

        expect(firstUsers).toBe(0);
        expect(secondUsers).toBe(second.users.length);
        expect(secondAfter).toEqual(secondBefore);
    } finally {
        await withDb(() => wipeNamespace(firstNamespace));
        await withDb(() => wipeNamespace(secondNamespace));
    }
});
