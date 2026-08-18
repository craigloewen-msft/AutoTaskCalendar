const mongoose = require('mongoose');
const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, ProjectDetails } = require('../../models');
const { parseDateOnly } = require('../../utils/temporal');
const {
    clearProjectRecommendationCache,
    _internals,
} = require('../../controllers/projectRecommendation');

function task(data, projectRef, title, overrides = {}) {
    return {
        title,
        notes: '',
        duration: 30,
        startDate: parseDateOnly('2030-01-01').date,
        dueDate: parseDateOnly('2030-01-02').date,
        completed: false,
        isBacklog: false,
        userRef: data.primary.user._id,
        projectRef,
        ...overrides,
    };
}

async function recommend(api, title, candidates, notes = '') {
    return (await api.post('/api/recommendTaskProject', {
        data: { title, notes, candidateProjectIds: candidates.map(String) },
    })).json();
}

test.describe('project recommendations', () => {
    test('learns rare names and broader vocabulary from owned project task history', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        const migration = data.named.migrationProject._id;
        const hiring = data.named.hiringProject._id;

        await withDb(() => TaskDetails.create([
            task(data, migration, 'Call Priyanka about cutover'),
            task(data, migration, 'Send Priyanka the rehearsal notes'),
            task(data, migration, 'Review database cutover rehearsal'),
            task(data, migration, 'Measure migration endpoint throughput'),
            task(data, hiring, 'Interview backend candidate'),
            task(data, hiring, 'Prepare engineering hiring scorecard'),
        ]));

        const candidates = [migration, hiring];
        const rareName = await recommend(api, 'Ask Priyanka about the rehearsal', candidates);
        const vocabulary = await recommend(api, 'Measure database migration throughput', candidates);

        expect(rareName.success).toBe(true);
        expect(rareName.recommendation.projectId).toBe(String(migration));
        expect(vocabulary.recommendation.projectId).toBe(String(migration));
    });

    test('uses metadata and history fallbacks while abstaining on tied evidence', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        const coldProject = await withDb(() => ProjectDetails.create({
            title: 'Quasar orchard restoration',
            description: 'Replant the celestial fruit grove',
            goalRef: data.named.shipV2._id,
            userRef: data.primary.user._id,
        }));
        const competitor = data.named.hiringProject._id;

        const coldStart = await recommend(
            api,
            'Restore the quasar fruit orchard',
            [coldProject._id, competitor]
        );
        expect(coldStart.recommendation.projectId).toBe(String(coldProject._id));

        const fallback = await recommend(api, 'zzqv wxjk', [coldProject._id, competitor]);
        expect(fallback.recommendation.projectId).toBe(String(competitor));
        expect(fallback.recommendation.confidence).toBe('likely');

        const twins = await withDb(async () => {
            const projects = await ProjectDetails.create([
                {
                    title: 'Ambrosia correspondence',
                    description: 'Discuss Ambrosia with Rowan',
                    goalRef: data.named.shipV2._id,
                    userRef: data.primary.user._id,
                },
                {
                    title: 'Ambrosia correspondence',
                    description: 'Discuss Ambrosia with Rowan',
                    goalRef: data.named.shipV2._id,
                    userRef: data.primary.user._id,
                },
            ]);
            await TaskDetails.create([
                task(data, projects[0]._id, 'Discuss Ambrosia with Rowan'),
                task(data, projects[1]._id, 'Discuss Ambrosia with Rowan'),
            ]);
            return projects;
        });
        clearProjectRecommendationCache(data.primary.user._id);
        const tied = await recommend(api, 'Discuss Ambrosia with Rowan', twins.map((item) => item._id));
        expect(tied.recommendation).toBeNull();
    });

    test('ignores null tasks, collapses recurring evidence, and isolates tenants', async ({
        seed,
        api,
        apiAnon,
    }) => {
        const data = await seed();
        const migration = data.named.migrationProject._id;
        const hiring = data.named.hiringProject._id;
        const seriesRef = new mongoose.Types.ObjectId();

        await withDb(() => TaskDetails.create([
            ...Array.from({ length: 8 }, (_, index) => task(
                data,
                null,
                `Call Zafrina about confidential matter ${index}`
            )),
            ...Array.from({ length: 8 }, (_, index) => task(
                data,
                migration,
                'Review Zafrina migration checklist',
                {
                    seriesRef,
                    occurrenceDate: parseDateOnly(`2030-01-${String(index + 1).padStart(2, '0')}`).date,
                }
            )),
        ]));

        expect((await apiAnon.post('/api/recommendTaskProject', {
            data: { title: 'Zafrina', candidateProjectIds: [String(migration)] },
        })).status()).toBe(401);

        const result = await recommend(api, 'Review Zafrina checklist', [
            migration,
            hiring,
            data.named.otherProject._id,
            'not-an-object-id',
        ]);
        expect(result.success).toBe(true);
        expect(result.recommendation.projectId).toBe(String(migration));
        expect(result.recommendation.evidenceCount).toBe(1);

        const foreignOnly = await recommend(api, 'OTHER USER SECRET', [data.named.otherProject._id]);
        expect(foreignOnly.recommendation).toBeNull();
    });

    test('clears a warm model after a relevant task mutation', async ({ seed, api }) => {
        const data = await seed();
        const projectId = data.named.emptyProject._id;
        const phrase = 'Flibbertigibbet xylophone rendezvous';

        const before = await recommend(api, phrase, [projectId]);
        expect(before.recommendation).toBeNull();

        const created = await (await api.post('/api/createTask', {
            data: {
                title: phrase,
                duration: 30,
                startDate: '2030-01-01',
                dueDate: '2030-01-02',
                projectRef: String(projectId),
            },
        })).json();
        expect(created.success).toBe(true);

        const after = await recommend(api, phrase, [projectId]);
        expect(after.recommendation.projectId).toBe(String(projectId));
    });

    test('bounds feature and candidate input deterministically', async ({ seed, api }) => {
        const data = await seed();
        const ids = Array.from({ length: 600 }, () => String(data.named.migrationProject._id));
        ids.push('bad', String(data.named.otherProject._id));

        expect(_internals.candidateIds(ids)).toEqual([String(data.named.migrationProject._id)]);
        expect(_internals.FEATURE_SPACE).toBe(32_768);
        expect(_internals.CACHE_LIMIT_BYTES).toBe(64 * 1024 * 1024);

        const result = await recommend(api, 'migration '.repeat(100), ids);
        expect(result.success).toBe(true);
    });
});
