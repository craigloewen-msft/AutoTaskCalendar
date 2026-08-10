const { TaskDetails, RoleDetails, GoalDetails, ProjectDetails } = require('../models');

/**
 * Compass: roles > goals > projects. See docs/COMPASS.md.
 *
 * This layer returns records as they are stored. It nests them, because that is the shape
 * of the data, but it derives no status, builds no buckets, and computes no rollups --
 * those are view concerns and live in the client.
 */

// Each level's model plus the parent it hangs off, so the CRUD helpers stay generic.
const LEVELS = {
    role: {
        label: 'Role',
        Model: RoleDetails,
        parentField: null,
        parentLevel: null,
        startDateRequired: true,
    },
    goal: {
        label: 'Goal',
        Model: GoalDetails,
        parentField: 'roleRef',
        parentLevel: 'role',
        startDateRequired: true,
    },
    project: {
        label: 'Project',
        Model: ProjectDetails,
        parentField: 'goalRef',
        parentLevel: 'goal',
        // A project with no start date is a parked "someday" item.
        startDateRequired: false,
    },
};

class CompassError extends Error {}

function fail(message) {
    throw new CompassError(message);
}

// Returns a Date, null for blank input, or throws when the value is unusable.
function parseDate(value, fieldName, { required }) {
    if (value === undefined || value === null || value === '') {
        if (required) {
            fail(`${fieldName} is required`);
        }
        return null;
    }

    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
        fail(`${fieldName} is not a valid date`);
    }

    return parsed;
}

// Lenient variant for query strings: an unparseable date is ignored rather than fatal.
function parseOptionalDate(value) {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Load a document at `level` that belongs to `user`. This is the cross-tenant boundary:
 * every id arriving from a request goes through here.
 */
async function findOwned(level, id, userId, { label } = {}) {
    const config = LEVELS[level];
    const name = label || config.label;

    if (!id) {
        fail(`${name} id is required`);
    }

    let doc = null;
    try {
        doc = await config.Model.findOne({ _id: id, userRef: userId });
    } catch (error) {
        // A malformed ObjectId is just a not-found from the caller's point of view.
        fail(`${name} not found`);
    }

    if (!doc) {
        fail(`${name} not found`);
    }

    return doc;
}

/**
 * Shared field handling for create and edit.
 *
 * `existing` is null on create. Only the fields present in the body are touched on edit,
 * so a partial update cannot silently blank a date.
 */
async function buildFields(level, body, user, existing) {
    const config = LEVELS[level];
    const isCreate = !existing;
    const fields = {};

    if (isCreate || body.title !== undefined) {
        const title = (body.title || '').trim();
        if (!title) {
            fail('Title is required');
        }
        fields.title = title;
    }

    if (isCreate || body.description !== undefined) {
        fields.description = body.description || '';
    }

    if (level === 'role' && (isCreate || body.color !== undefined)) {
        fields.color = body.color || '#667eea';
    }

    if (isCreate || body.startDate !== undefined) {
        fields.startDate = parseDate(body.startDate, 'Start date', {
            required: isCreate && config.startDateRequired,
        });

        // An edit that clears a required start date is still invalid.
        if (!isCreate && config.startDateRequired && !fields.startDate) {
            fail('Start date is required');
        }
    }

    if (isCreate || body.endDate !== undefined) {
        fields.endDate = parseDate(body.endDate, 'End date', { required: false });
    }

    if (body.sortOrder !== undefined) {
        fields.sortOrder = Number(body.sortOrder) || 0;
    }

    // Compare against the merged result so editing either date alone is still validated.
    const startDate = fields.startDate !== undefined ? fields.startDate : existing?.startDate;
    const endDate = fields.endDate !== undefined ? fields.endDate : existing?.endDate;

    if (startDate && endDate && endDate < startDate) {
        fail('End date must be on or after the start date');
    }

    // Re-parenting is allowed; the new parent must still belong to the caller.
    if (config.parentField && (isCreate || body[config.parentField] !== undefined)) {
        const parentId = body[config.parentField];
        const parent = await findOwned(config.parentLevel, parentId, user._id);
        fields[config.parentField] = parent._id;
    }

    return fields;
}

async function createItem(level, body, user) {
    const fields = await buildFields(level, body, user, null);
    return LEVELS[level].Model.create({ ...fields, userRef: user._id });
}

async function editItem(level, body, user) {
    const existing = await findOwned(level, body._id || body.id, user._id);
    const fields = await buildFields(level, body, user, existing);

    Object.assign(existing, fields);
    await existing.save();

    return existing;
}

/**
 * Delete a role, goal, or project.
 *
 * Refuses by default when children exist -- ending an item is nearly always what was
 * meant. With `cascade`, the subtree goes and affected tasks are UNLINKED, never deleted.
 */
async function deleteItem(level, body, user, cascade = false) {
    const doc = await findOwned(level, body._id || body.id, user._id);

    if (level === 'role') {
        const goals = await GoalDetails.find({ roleRef: doc._id, userRef: user._id });

        if (goals.length && !cascade) {
            fail('Role still has goals. End it instead, or delete with cascade.');
        }

        const goalIds = goals.map((g) => g._id);
        const projects = await ProjectDetails.find({ goalRef: { $in: goalIds }, userRef: user._id });

        await unlinkTasks(projects.map((p) => p._id), user._id);
        await ProjectDetails.deleteMany({ goalRef: { $in: goalIds }, userRef: user._id });
        await GoalDetails.deleteMany({ _id: { $in: goalIds }, userRef: user._id });
    } else if (level === 'goal') {
        const projects = await ProjectDetails.find({ goalRef: doc._id, userRef: user._id });

        if (projects.length && !cascade) {
            fail('Goal still has projects. End it instead, or delete with cascade.');
        }

        await unlinkTasks(projects.map((p) => p._id), user._id);
        await ProjectDetails.deleteMany({ goalRef: doc._id, userRef: user._id });
    } else {
        await unlinkTasks([doc._id], user._id);
    }

    await doc.deleteOne();
}

// Deleting hierarchy never destroys work: the tasks survive with no project.
async function unlinkTasks(projectIds, userId) {
    if (!projectIds.length) {
        return;
    }

    await TaskDetails.updateMany(
        { projectRef: { $in: projectIds }, userRef: userId },
        { $set: { projectRef: null } }
    );
}

/**
 * Point a task at a project, or pass a null projectId to unlink it.
 */
async function setTaskProject(taskId, projectId, user) {
    if (!taskId) {
        fail('Task id is required');
    }

    let task = null;
    try {
        task = await TaskDetails.findOne({ _id: taskId, userRef: user._id });
    } catch (error) {
        fail('Task not found');
    }

    if (!task) {
        fail('Task not found');
    }

    if (projectId) {
        const project = await findOwned('project', projectId, user._id);
        task.projectRef = project._id;
    } else {
        task.projectRef = null;
    }

    await task.save();
    return task;
}

// Finished means an end date that has already passed.
function completedFilter(userId, from, to) {
    const endDate = { $ne: null, $lte: new Date() };

    if (from) {
        endDate.$gte = from;
    }
    if (to && to < endDate.$lte) {
        endDate.$lte = to;
    }

    return { userRef: userId, endDate };
}

/**
 * The whole hierarchy, nested, plus the two counts the page needs.
 *
 * `completedFrom`/`completedTo` scope completedCounts only -- the tree is never filtered,
 * because the client decides what to show and what to tuck away.
 */
async function getCompassPayload(user, { completedFrom, completedTo } = {}) {
    const sort = { sortOrder: 1, startDate: 1 };
    const from = parseOptionalDate(completedFrom);
    const to = parseOptionalDate(completedTo);

    const roles = await RoleDetails.find({ userRef: user._id })
        .sort(sort)
        .populate({
            path: 'goalList',
            match: { userRef: user._id },
            options: { sort },
            populate: {
                path: 'projectList',
                match: { userRef: user._id },
                options: { sort },
            },
        });

    const [completedRoles, completedGoals, completedProjects, unalignedTaskCount] = await Promise.all([
        RoleDetails.countDocuments(completedFilter(user._id, from, to)),
        GoalDetails.countDocuments(completedFilter(user._id, from, to)),
        ProjectDetails.countDocuments(completedFilter(user._id, from, to)),
        TaskDetails.countDocuments({
            userRef: user._id,
            $or: [{ completed: false }, { completed: null }],
            projectRef: null,
        }),
    ]);

    return {
        roles,
        completedCounts: {
            roles: completedRoles,
            goals: completedGoals,
            projects: completedProjects,
        },
        unalignedTaskCount,
    };
}

module.exports = {
    CompassError,
    getCompassPayload,
    createItem,
    editItem,
    deleteItem,
    setTaskProject,
    findOwned,
};
