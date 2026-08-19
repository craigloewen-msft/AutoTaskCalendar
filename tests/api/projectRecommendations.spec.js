const mongoose = require('mongoose');
const { test, expect, withDb } = require('../fixtures');
const { TaskDetails, ProjectDetails } = require('../../models');
const { parseDateOnly } = require('../../utils/temporal');
const { _internals } = require('../../controllers/projectRecommendation');

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

function suggestedIds(result) {
    return result.recommendations.map((suggestion) => suggestion.projectId);
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
        expect(suggestedIds(rareName)).toEqual([String(migration)]);
        expect(suggestedIds(vocabulary)).toEqual([String(migration)]);
    });

    test('uses metadata and history fallbacks and offers tied evidence together', async ({
        seed,
        api,
    }) => {
        const data = await seed();
        const competitor = data.named.hiringProject._id;
        // All fixtures land before the first request so the lazily built model sees them.
        const { coldProject, twins } = await withDb(async () => {
            const cold = await ProjectDetails.create({
                title: 'Quasar orchard restoration',
                description: 'Replant the celestial fruit grove',
                goalRef: data.named.shipV2._id,
                userRef: data.primary.user._id,
            });
            const pair = await ProjectDetails.create([
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
                task(data, pair[0]._id, 'Discuss Ambrosia with Rowan'),
                task(data, pair[1]._id, 'Discuss Ambrosia with Rowan'),
            ]);
            return { coldProject: cold, twins: pair };
        });

        const coldStart = await recommend(
            api,
            'Restore the quasar fruit orchard',
            [coldProject._id, competitor]
        );
        expect(suggestedIds(coldStart)).toEqual([String(coldProject._id)]);

        const fallback = await recommend(api, 'zzqv wxjk', [coldProject._id, competitor]);
        // The weak-text fallback stays a single suggestion.
        expect(suggestedIds(fallback)).toEqual([String(competitor)]);
        expect(fallback.recommendations[0].confidence).toBe('likely');

        const tied = await recommend(api, 'Discuss Ambrosia with Rowan', twins.map((item) => item._id));
        // Indistinguishable projects are offered together rather than hidden.
        expect(suggestedIds(tied).sort()).toEqual(twins.map((item) => String(item._id)).sort());
        expect(tied.recommendations.every((entry) => entry.confidence === 'high')).toBe(true);

        // Identical evidence must rank deterministically across requests.
        const repeat = await recommend(api, 'Discuss Ambrosia with Rowan', twins.map((item) => item._id));
        expect(suggestedIds(repeat)).toEqual(suggestedIds(tied));
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
        expect(suggestedIds(result)).toEqual([String(migration)]);
        expect(result.recommendations[0].evidenceCount).toBe(1);

        const foreignOnly = await recommend(api, 'OTHER USER SECRET', [data.named.otherProject._id]);
        expect(foreignOnly.recommendations).toEqual([]);
    });

    test('clears a warm model after a relevant task mutation', async ({ seed, api }) => {
        const data = await seed();
        const projectId = data.named.emptyProject._id;
        const phrase = 'Flibbertigibbet xylophone rendezvous';

        const before = await recommend(api, phrase, [projectId]);
        expect(before.recommendations).toEqual([]);

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
        expect(suggestedIds(after)).toEqual([String(projectId)]);
    });

    test('bounds feature and candidate input deterministically', async ({ seed, api }) => {
        const data = await seed();
        const ids = Array.from({ length: 600 }, () => String(data.named.migrationProject._id));
        ids.push('bad', String(data.named.otherProject._id));

        expect(_internals.candidateIds(ids)).toEqual([String(data.named.migrationProject._id)]);
        expect(_internals.FEATURE_SPACE).toBe(32_768);
        expect(_internals.CACHE_LIMIT_BYTES).toBe(64 * 1024 * 1024);
        expect(_internals.MAX_RECOMMENDATIONS).toBe(3);
        expect(_internals.RELATIVE_BAND).toBe(0.75);

        const result = await recommend(api, 'migration '.repeat(100), ids);
        expect(result.success).toBe(true);
    });
});
