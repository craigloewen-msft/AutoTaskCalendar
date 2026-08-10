const { TaskDetails, RoleDetails, GoalDetails, ProjectDetails } = require('../models');
const { parseDateOnly, addDateOnlyDays, todayInZone } = require('../utils/temporal');

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

/**
 * Compass's error policy on top of the shared parser in utils/temporal.
 *
 * These wrappers stay here because they throw CompassError, which only this module's
 * callers know how to translate. The shared parser supplies strict civil-date semantics.
 */

// Body fields: a blank value is only allowed when optional, and a bad one is fatal.
function parseDateOrFail(value, fieldName, { required }) {
    const { provided, valid, date } = parseDateOnly(value);

    if (!provided) {
        if (required) {
            fail(`${fieldName} is required`);
        }
        return null;
    }

    if (!valid) {
        fail(`${fieldName} is not a valid date`);
    }

    return date;
}

// Query strings: an unparseable date is ignored rather than fatal.
function parseDateOrIgnore(value) {
    return parseDateOnly(value).date;
}

// End dates are inclusive civil dates. An item archives on the following UTC marker.
function todayMarker(timeZone, now = new Date()) {
    return parseDateOnly(todayInZone(timeZone, now)).date;
}

function liveFilter(timeZone, now = new Date()) {
    return {
        $or: [
            { endDate: null },
            { endDate: { $exists: false } },
            { endDate: { $gte: todayMarker(timeZone, now) } },
        ],
    };
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

    if (isCreate || body.startDate !== undefined) {
        fields.startDate = parseDateOrFail(body.startDate, 'Start date', {
            required: isCreate && config.startDateRequired,
        });

        // An edit that clears a required start date is still invalid.
        if (!isCreate && config.startDateRequired && !fields.startDate) {
            fail('Start date is required');
        }
    }

    if (isCreate || body.endDate !== undefined) {
        fields.endDate = parseDateOrFail(body.endDate, 'End date', { required: false });
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

// Finished means an end date that has already passed, optionally inside a window.
function completedFilter(userId, timeZone, from, to) {
    const endDate = { $ne: null, $lt: todayMarker(timeZone) };

    if (from) endDate.$gte = from;
    if (to) {
        const exclusive = parseDateOnly(addDateOnlyDays(to, 1)).date;
        if (exclusive < endDate.$lt) endDate.$lt = exclusive;
    }

    return { userRef: userId, endDate };
}

/**
 * The live hierarchy, nested, plus the counts the page needs.
 *
 * **Only live items are returned in detail.** A role, goal, or project whose end date has
 * passed is excluded and represented solely by `completedCounts`; use getCompassArchive()
 * to page through those. Without this the payload would grow forever as work is finished,
 * and every mutation would pay for it too, since mutations return this same payload.
 *
 * Ending a role archives its whole branch: its goals and projects come back from the
 * archive endpoint, not from here.
 *
 * Parked ("someday") projects have no start date but no end date either, so they are live
 * and always included -- the client decides how to present them.
 *
 * `completedFrom`/`completedTo` scope completedCounts only.
 */
async function getCompassPayload(user, { completedFrom, completedTo } = {}) {
    const sort = { sortOrder: 1, startDate: 1 };
    const from = parseDateOrIgnore(completedFrom);
    const to = parseDateOrIgnore(completedTo);
    const live = liveFilter(user.timeZone);

    const roles = await RoleDetails.find({ userRef: user._id, ...live })
        .sort(sort)
        .populate({
            path: 'goalList',
            match: { userRef: user._id, ...live },
            options: { sort },
            populate: {
                path: 'projectList',
                match: { userRef: user._id, ...live },
                options: { sort },
            },
        });

    const [completedRoles, completedGoals, completedProjects, unalignedTaskCount] = await Promise.all([
        RoleDetails.countDocuments(completedFilter(user._id, user.timeZone, from, to)),
        GoalDetails.countDocuments(completedFilter(user._id, user.timeZone, from, to)),
        ProjectDetails.countDocuments(completedFilter(user._id, user.timeZone, from, to)),
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

/**
 * Page through finished roles, goals, or projects.
 *
 * This is the other half of getCompassPayload: detail about ended items lives here, behind
 * pagination, so the main hierarchy stays a fixed size no matter how much work is finished.
 *
 * Returns records as stored, newest first, with the same pagination shape as
 * getCompletedTasks (`items`, `totalCount`, `hasMore`).
 */
async function getCompassArchive(user, { level, limit, skip, completedFrom, completedTo } = {}) {
    const config = LEVELS[level];

    if (!config) {
        fail('Level must be one of role, goal, or project');
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const parsedSkip = Math.max(parseInt(skip, 10) || 0, 0);

    const filter = completedFilter(
        user._id,
        user.timeZone,
        parseDateOrIgnore(completedFrom),
        parseDateOrIgnore(completedTo)
    );

    const [items, totalCount] = await Promise.all([
        config.Model.find(filter).sort({ endDate: -1 }).skip(parsedSkip).limit(parsedLimit),
        config.Model.countDocuments(filter),
    ]);

    return {
        level,
        items,
        totalCount,
        hasMore: parsedSkip + items.length < totalCount,
    };
}

module.exports = {
    CompassError,
    getCompassPayload,
    getCompassArchive,
    createItem,
    editItem,
    deleteItem,
    setTaskProject,
    findOwned,
};
