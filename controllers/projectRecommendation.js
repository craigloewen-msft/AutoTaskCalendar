'use strict';

const { TaskDetails, ProjectDetails, GoalDetails, RoleDetails } = require('../models');

const FEATURE_SPACE = 32_768;
const MAX_PROJECTS = 500;
const MAX_TASKS = 3_000;
const MAX_EXEMPLARS = 256;
const MAX_EXEMPLARS_PER_PROJECT = 32;
const MAX_VECTOR_FEATURES = 384;
const MAX_CENTROID_FEATURES = 256;
const MAX_TITLE_LENGTH = 240;
const MAX_NOTES_LENGTH = 2_000;
const MAX_CANDIDATES = 500;
const CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const MAX_GENERATION_ENTRIES = 10_000;
const MIN_SCORE = 0.16;
const MIN_MARGIN = 0.035;

const modelCache = new Map();
const pendingBuilds = new Map();
const generations = new Map();
let cacheBytes = 0;

function boundedText(value, limit) {
    return String(value || '').slice(0, limit);
}

function normaliseText(value) {
    return boundedText(value, MAX_NOTES_LENGTH)
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('und')
        .replace(/[^\p{L}\p{N}_'-]+/gu, ' ')
        .trim();
}

function hashFeature(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % FEATURE_SPACE;
}

function addFeature(features, name, weight) {
    const index = hashFeature(name);
    features.set(index, (features.get(index) || 0) + weight);
}

function addTextFeatures(features, value, weight, namespace) {
    const normalised = normaliseText(value);
    if (!normalised) return;

    const words = normalised.split(/\s+/u).filter(Boolean);
    for (let index = 0; index < words.length; index++) {
        const word = words[index];
        addFeature(features, `${namespace}:word:${word}`, weight);
        if (index > 0) {
            addFeature(features, `${namespace}:pair:${words[index - 1]} ${word}`, weight * 0.75);
        }

        const padded = `^${word}$`;
        for (let size = 3; size <= 5; size++) {
            for (let offset = 0; offset + size <= padded.length; offset++) {
                addFeature(features, `${namespace}:char:${padded.slice(offset, offset + size)}`, weight * 0.35);
            }
        }
    }
}

function textFeatures(title, notes = '') {
    const features = new Map();
    addTextFeatures(features, boundedText(title, MAX_TITLE_LENGTH), 2, 'text');
    addTextFeatures(features, boundedText(notes, MAX_NOTES_LENGTH), 0.75, 'text');
    return features;
}

function metadataFeatures(project, goal, role) {
    const features = new Map();
    addTextFeatures(features, project?.title, 2, 'text');
    addTextFeatures(features, project?.description, 0.8, 'text');
    addTextFeatures(features, goal?.title, 0.55, 'text');
    addTextFeatures(features, goal?.description, 0.25, 'text');
    addTextFeatures(features, role?.title, 0.3, 'text');
    return features;
}

function documentFrequencies(documents) {
    const frequencies = new Uint16Array(FEATURE_SPACE);
    for (const document of documents) {
        for (const index of document.keys()) {
            if (frequencies[index] < 65_535) frequencies[index]++;
        }
    }
    return frequencies;
}

function buildIdf(documents) {
    const frequencies = documentFrequencies(documents);
    const idf = new Float32Array(FEATURE_SPACE);
    const total = Math.max(documents.length, 1);
    for (let index = 0; index < frequencies.length; index++) {
        if (frequencies[index]) {
            idf[index] = Math.log((total + 1) / (frequencies[index] + 1)) + 1;
        }
    }
    return idf;
}

function buildTrainingIdf(tasks, metadata) {
    const frequencies = new Uint16Array(FEATURE_SPACE);
    const addDocument = (features) => {
        for (const index of features.keys()) {
            if (frequencies[index] < 65_535) frequencies[index]++;
        }
    };

    for (const task of tasks) addDocument(textFeatures(task.title, task.notes));
    for (const item of metadata) addDocument(metadataFeatures(item.project, item.goal, item.role));

    const idf = new Float32Array(FEATURE_SPACE);
    const total = Math.max(tasks.length + metadata.length, 1);
    for (let index = 0; index < frequencies.length; index++) {
        if (frequencies[index]) {
            idf[index] = Math.log((total + 1) / (frequencies[index] + 1)) + 1;
        }
    }
    return idf;
}

function sparseVector(features, idf, limit = MAX_VECTOR_FEATURES) {
    const weighted = [];
    let magnitudeSquared = 0;

    for (const [index, count] of features) {
        const weight = Math.log1p(Math.max(count, 0)) * idf[index];
        if (weight > 0) weighted.push([index, weight]);
    }

    if (weighted.length > limit) {
        weighted.sort((left, right) => right[1] - left[1]);
        weighted.length = limit;
    }
    weighted.sort((left, right) => left[0] - right[0]);
    for (const [, weight] of weighted) magnitudeSquared += weight * weight;

    const magnitude = Math.sqrt(magnitudeSquared);
    if (!magnitude) return { indices: new Uint16Array(), values: new Float32Array() };

    return {
        indices: Uint16Array.from(weighted.map(([index]) => index)),
        values: Float32Array.from(weighted.map(([, weight]) => weight / magnitude)),
    };
}

function dot(left, right) {
    let leftIndex = 0;
    let rightIndex = 0;
    let score = 0;

    while (leftIndex < left.indices.length && rightIndex < right.indices.length) {
        const leftFeature = left.indices[leftIndex];
        const rightFeature = right.indices[rightIndex];
        if (leftFeature === rightFeature) {
            score += left.values[leftIndex] * right.values[rightIndex];
            leftIndex++;
            rightIndex++;
        } else if (leftFeature < rightFeature) {
            leftIndex++;
        } else {
            rightIndex++;
        }
    }

    return score;
}

function normalisedEntries(entries, limit) {
    const retained = [...entries];
    if (retained.length > limit) {
        retained.sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]));
        retained.length = limit;
    }
    retained.sort((left, right) => left[0] - right[0]);

    const magnitude = Math.sqrt(retained.reduce((total, [, weight]) => total + weight * weight, 0));
    if (!magnitude) return { indices: new Uint16Array(), values: new Float32Array() };
    return {
        indices: Uint16Array.from(retained.map(([index]) => index)),
        values: Float32Array.from(retained.map(([, weight]) => weight / magnitude)),
    };
}

function centroid(vectors, metadataVector) {
    const sums = new Map();
    for (const vector of vectors) {
        for (let index = 0; index < vector.indices.length; index++) {
            const feature = vector.indices[index];
            sums.set(feature, (sums.get(feature) || 0) + vector.values[index]);
        }
    }

    const metadataWeight = vectors.length ? 0.5 : 1;
    for (let index = 0; index < metadataVector.indices.length; index++) {
        const feature = metadataVector.indices[index];
        sums.set(feature, (sums.get(feature) || 0) + metadataVector.values[index] * metadataWeight);
    }

    return normalisedEntries(sums.entries(), MAX_CENTROID_FEATURES);
}

function recurrenceKey(task) {
    const seriesId = task.seriesRef
        || (task.recurrence?.freq || task.repeat ? task._id : null);
    return seriesId ? `series:${seriesId}:${task.projectRef}` : `task:${task._id}`;
}

function balanceExemplars(projectModels) {
    const retained = [];
    for (let offset = 0; retained.length < MAX_EXEMPLARS; offset++) {
        let found = false;
        for (const project of projectModels.values()) {
            if (offset < project.vectors.length && offset < MAX_EXEMPLARS_PER_PROJECT) {
                retained.push({ projectId: project.projectId, vector: project.vectors[offset] });
                found = true;
                if (retained.length === MAX_EXEMPLARS) break;
            }
        }
        if (!found) break;
    }
    return retained;
}

function vectorBytes(vector) {
    // Include a conservative allowance for JavaScript containers and references.
    return 64 + vector.indices.length * 16;
}

function estimateModelBytes(model) {
    let bytes = model.idf.byteLength + 1_024;
    for (const project of model.projects.values()) {
        bytes += 512 + vectorBytes(project.centroid);
    }
    for (const exemplar of model.exemplars) bytes += 64 + vectorBytes(exemplar.vector);
    return bytes;
}

async function loadTrainingData(userId) {
    const projects = await ProjectDetails.find({ userRef: userId })
        .sort({ _id: -1 })
        .limit(MAX_PROJECTS)
        .select('_id title description goalRef')
        .lean();
    const projectIds = projects.map((project) => project._id);
    const goalIds = [...new Set(projects.filter((project) => project.goalRef).map((project) => String(project.goalRef)))];
    const goals = goalIds.length
        ? await GoalDetails.find({ _id: { $in: goalIds }, userRef: userId })
            .select('_id title description roleRef')
            .lean()
        : [];
    const roleIds = [...new Set(goals.filter((goal) => goal.roleRef).map((goal) => String(goal.roleRef)))];
    const roles = roleIds.length
        ? await RoleDetails.find({ _id: { $in: roleIds }, userRef: userId })
            .select('_id title')
            .lean()
        : [];
    const tasks = projectIds.length
        ? await TaskDetails.find({ userRef: userId, projectRef: { $in: projectIds } })
            .sort({ completedDate: -1, _id: -1 })
            .limit(MAX_TASKS)
            .select('_id title notes projectRef seriesRef recurrence repeat')
            .lean()
        : [];

    return { projects, goals, roles, tasks };
}

async function buildModel(userId) {
    const { projects, goals, roles, tasks } = await loadTrainingData(userId);
    const goalsById = new Map(goals.map((goal) => [String(goal._id), goal]));
    const rolesById = new Map(roles.map((role) => [String(role._id), role]));
    const taskSamples = [];
    const seen = new Set();

    for (const task of tasks) {
        const key = recurrenceKey(task);
        if (seen.has(key)) continue;
        seen.add(key);
        taskSamples.push({
            projectId: String(task.projectRef),
            title: task.title,
            notes: task.notes,
        });
    }

    const metadata = projects.map((project) => {
        const goal = goalsById.get(String(project.goalRef));
        const role = goal ? rolesById.get(String(goal.roleRef)) : null;
        return { projectId: String(project._id), project, goal, role };
    });
    const idf = buildTrainingIdf(taskSamples, metadata);
    const projectModels = new Map(projects.map((project) => [String(project._id), {
        projectId: String(project._id),
        historyCount: 0,
        recentHistoryRank: Number.POSITIVE_INFINITY,
        vectors: [],
        centroid: null,
    }]));

    for (let rank = 0; rank < taskSamples.length; rank++) {
        const task = taskSamples[rank];
        const project = projectModels.get(task.projectId);
        if (!project) continue;
        project.historyCount++;
        project.recentHistoryRank = Math.min(project.recentHistoryRank, rank);
        project.vectors.push(sparseVector(textFeatures(task.title, task.notes), idf));
    }

    for (const item of metadata) {
        const project = projectModels.get(item.projectId);
        project.centroid = centroid(
            project.vectors,
            sparseVector(metadataFeatures(item.project, item.goal, item.role), idf)
        );
    }

    const exemplars = balanceExemplars(projectModels);
    const model = { idf, projects: projectModels, exemplars, estimatedBytes: 0 };
    model.estimatedBytes = estimateModelBytes(model);

    // Exemplar vectors are now retained separately; release the unbounded working arrays.
    for (const project of projectModels.values()) delete project.vectors;
    return model;
}

function removeCached(userKey) {
    const existing = modelCache.get(userKey);
    if (!existing) return;
    cacheBytes -= existing.model.estimatedBytes;
    modelCache.delete(userKey);
}

function purgeExpired(now = Date.now()) {
    for (const [userKey, entry] of modelCache) {
        if (now - entry.lastAccess > CACHE_TTL_MS) removeCached(userKey);
    }
}

function cacheModel(userKey, model) {
    if (model.estimatedBytes > CACHE_LIMIT_BYTES) return;
    removeCached(userKey);
    while (cacheBytes + model.estimatedBytes > CACHE_LIMIT_BYTES && modelCache.size) {
        removeCached(modelCache.keys().next().value);
    }
    modelCache.set(userKey, { model, lastAccess: Date.now() });
    cacheBytes += model.estimatedBytes;
}

async function getModel(userId) {
    const userKey = String(userId);
    purgeExpired();
    const cached = modelCache.get(userKey);
    if (cached) {
        cached.lastAccess = Date.now();
        modelCache.delete(userKey);
        modelCache.set(userKey, cached);
        return cached.model;
    }

    const generation = generations.get(userKey) || 0;
    const buildKey = `${userKey}:${generation}`;
    if (!pendingBuilds.has(buildKey)) {
        pendingBuilds.set(buildKey, buildModel(userId).finally(() => pendingBuilds.delete(buildKey)));
    }
    const model = await pendingBuilds.get(buildKey);
    if ((generations.get(userKey) || 0) !== generation) return getModel(userId);
    cacheModel(userKey, model);
    return model;
}

function candidateIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .slice(0, MAX_CANDIDATES)
        .filter((id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id))
        .map((id) => id.toLowerCase()))];
}

function scoreProjects(model, queryVector, candidates) {
    const exemplarScores = new Map();
    const supportingEvidence = new Map();

    for (const exemplar of model.exemplars) {
        if (!candidates.has(exemplar.projectId)) continue;
        const score = dot(queryVector, exemplar.vector);
        if (score > (exemplarScores.get(exemplar.projectId) || 0)) {
            exemplarScores.set(exemplar.projectId, score);
        }
        if (score >= 0.12) {
            supportingEvidence.set(
                exemplar.projectId,
                (supportingEvidence.get(exemplar.projectId) || 0) + 1
            );
        }
    }

    const scored = [];
    for (const projectId of candidates) {
        const project = model.projects.get(projectId);
        if (!project?.centroid) continue;
        const centroidScore = dot(queryVector, project.centroid);
        const exemplarScore = exemplarScores.get(projectId) || 0;
        const score = project.historyCount
            ? exemplarScore * 0.65 + centroidScore * 0.35
            : centroidScore * 0.8;
        scored.push({
            projectId,
            score,
            evidenceCount: Math.min(
                supportingEvidence.get(projectId) || 0,
                project.historyCount
            ),
        });
    }

    return scored.sort((left, right) => right.score - left.score || left.projectId.localeCompare(right.projectId));
}

function historyFallback(model, candidates) {
    return [...candidates]
        .map((projectId) => model.projects.get(projectId))
        .filter((project) => project?.historyCount)
        .sort((left, right) => {
            return right.historyCount - left.historyCount
                || left.recentHistoryRank - right.recentHistoryRank
                || left.projectId.localeCompare(right.projectId);
        })[0] || null;
}

async function recommendTaskProject(user, input = {}) {
    const title = boundedText(input.title, MAX_TITLE_LENGTH).trim();
    if (title.length < 2) return null;

    const candidates = new Set(candidateIds(input.candidateProjectIds));
    if (!candidates.size) return null;

    const model = await getModel(user._id);
    for (const projectId of [...candidates]) {
        if (!model.projects.has(projectId)) candidates.delete(projectId);
    }
    if (!candidates.size) return null;

    const queryVector = sparseVector(
        textFeatures(title, boundedText(input.notes, MAX_NOTES_LENGTH)),
        model.idf
    );
    const scored = scoreProjects(model, queryVector, candidates);
    const best = scored[0];
    const runnerUp = scored[1];
    const ambiguous = best?.score >= MIN_SCORE
        && runnerUp
        && best.score - runnerUp.score < MIN_MARGIN;
    if (ambiguous) return null;

    if (best?.score >= MIN_SCORE) {
        return {
            projectId: best.projectId,
            confidence: 'high',
            evidenceCount: best.evidenceCount,
        };
    }

    const fallback = historyFallback(model, candidates);
    return fallback ? {
        projectId: fallback.projectId,
        confidence: 'likely',
        evidenceCount: fallback.historyCount,
    } : null;
}

function pruneGenerations() {
    if (generations.size <= MAX_GENERATION_ENTRIES) return;
    const pendingUsers = new Set([...pendingBuilds.keys()].map((key) => key.split(':')[0]));
    for (const userKey of generations.keys()) {
        if (!modelCache.has(userKey) && !pendingUsers.has(userKey)) generations.delete(userKey);
        if (generations.size <= MAX_GENERATION_ENTRIES) break;
    }
}

/**
 * Drop one user's disposable model after its source task data changes.
 *
 * The generation counter also prevents an in-flight old build from being cached. The next
 * recommendation lazily rebuilds from MongoDB, so this does not delete learned data.
 */
function clearProjectRecommendationCache(userId) {
    if (!userId) return;
    const userKey = String(userId);
    generations.set(userKey, (generations.get(userKey) || 0) + 1);
    removeCached(userKey);
    pruneGenerations();
}

module.exports = {
    recommendTaskProject,
    clearProjectRecommendationCache,
    // Export pure primitives for deterministic focused tests.
    _internals: {
        FEATURE_SPACE,
        CACHE_LIMIT_BYTES,
        textFeatures,
        buildIdf,
        sparseVector,
        dot,
        candidateIds,
        recurrenceKey,
        estimateModelBytes,
    },
};
