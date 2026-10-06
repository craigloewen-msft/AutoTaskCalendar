const { RoleDetails, GoalDetails, ProjectDetails, TaskDetails } = require('../models');
const { addDateOnlyDays, startOfDateInZone } = require('../utils/temporal');

// Legacy `repeat` strings repeat just like a rule does. See controllers/recurrence.js.
const REPEAT_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

/**
 * Intentions. See docs/INTENTIONS.md.
 *
 * `isIntention` is DERIVED, never stored: a task is an intention exactly when its project
 * ladders up to a role with `context: 'personal'`. Storing it would let the flag drift away
 * from the role the day a role is flipped work/personal, so the rule lives here alone and
 * every read, write, and query goes through this module.
 *
 * Backlog and repeating tasks are excluded by definition, which is what keeps the three
 * concepts orthogonal: because nothing is stored, a conflict could never be rejected at
 * write time, so there must be no conflict to reject.
 */

// Minutes an intention is assumed to need when the client does not say.
const DEFAULT_INTENTION_DURATION = 30;

/**
 * Every project id belonging to a personal role, for one user.
 *
 * Two indexed queries, walking role -> goal -> project. Ended roles still count: a task
 * under a role you have stepped away from is no more schedulable than one you have not.
 */
async function personalProjectIds(userId) {
    const roles = await RoleDetails.find({ userRef: userId, context: 'personal' })
        .select('_id')
        .lean();
    if (!roles.length) return new Set();

    const goals = await GoalDetails.find({
        userRef: userId,
        roleRef: { $in: roles.map((role) => role._id) },
    }).select('_id').lean();
    if (!goals.length) return new Set();

    const projects = await ProjectDetails.find({
        userRef: userId,
        goalRef: { $in: goals.map((goal) => goal._id) },
    }).select('_id').lean();

    return new Set(projects.map((project) => String(project._id)));
}

// One project, asked directly. Used on create/edit, where only the chosen project matters.
async function isPersonalProject(projectId, userId) {
    if (!projectId) return false;

    let project = null;
    try {
        project = await ProjectDetails.findOne({ _id: projectId, userRef: userId })
            .select('goalRef')
            .lean();
    } catch (error) {
        // A malformed id is not a personal project; the caller validates it separately.
        return false;
    }
    if (!project?.goalRef) return false;

    const goal = await GoalDetails.findOne({ _id: project.goalRef, userRef: userId })
        .select('roleRef')
        .lean();
    if (!goal?.roleRef) return false;

    const role = await RoleDetails.findOne({ _id: goal.roleRef, userRef: userId })
        .select('context')
        .lean();

    return role?.context === 'personal';
}

// True when this already-loaded task is an intention, given the set above.
function taskIsIntention(task, personalIds) {
    if (!task?.projectRef || !personalIds.has(String(task.projectRef))) return false;
    // A backlog item is deliberately undated and a series' dates come from its rule.
    // Neither can carry "due this Sunday", so neither is ever an intention.
    if (task.isBacklog || task.seriesRef) return false;
    return !isRepeating(task);
}

// A task repeats through a recurrence rule or, in older data, a plain `repeat` string.
function isRepeating(task) {
    return !!task?.recurrence?.freq || REPEAT_FREQUENCIES.includes(task?.repeat);
}

/**
 * Stamp `isIntention` onto tasks on their way out to the client.
 *
 * The field exists only in the response, so the client can read it exactly like a stored
 * one while the database keeps a single source of truth.
 */
async function attachIntentionFlags(taskList, userId) {
    if (!taskList?.length) return taskList;

    const personalIds = await personalProjectIds(userId);

    return taskList.map((task) => {
        const plain = task.toObject ? task.toObject() : { ...task };
        plain.isIntention = taskIsIntention(task, personalIds);
        return plain;
    });
}

/**
 * The intention exclusion as a list of `$and` clauses, for the scheduler.
 *
 * Returned as clauses rather than a whole filter because the caller's query already uses
 * `$or`/`$and`, and merging by spread would silently clobber them. This is
 * `taskIsIntention` expressed as a query, and the two must stay in step: a task is kept
 * unless it is a non-backlog, non-repeating task under a personal project.
 */
async function intentionExclusionClauses(userId) {
    const personalIds = [...await personalProjectIds(userId)];
    if (!personalIds.length) return [];

    return [{
        $or: [
            { projectRef: null },
            { projectRef: { $nin: personalIds } },
            // Under a personal project, but not an intention for one of these reasons.
            { isBacklog: true },
            { seriesRef: { $ne: null } },
            { 'recurrence.freq': { $exists: true } },
            { repeat: { $in: REPEAT_FREQUENCIES } },
        ],
    }];
}

/**
 * Every intention due inside a civil date range, complete or not.
 *
 * The ordinary task list omits completed work, but the band must show what you ticked --
 * that is the answer to "did I do it?" -- so the weekly bands read from here instead.
 */
async function getIntentions(user, from, to) {
    const personalIds = [...await personalProjectIds(user._id)];
    if (!personalIds.length) return [];

    const start = startOfDateInZone(from, user.timeZone);
    const exclusiveEnd = startOfDateInZone(addDateOnlyDays(to, 1), user.timeZone);

    const tasks = await TaskDetails.find({
        userRef: user._id,
        projectRef: { $in: personalIds },
        dueDate: { $gte: start, $lt: exclusiveEnd },
        // The same exclusions `taskIsIntention` applies.
        seriesRef: null,
        'recurrence.freq': { $exists: false },
        repeat: { $nin: REPEAT_FREQUENCIES },
        $or: [{ isBacklog: false }, { isBacklog: null }],
    }).sort({ completed: 1, dueDate: 1 });

    return tasks.map((task) => {
        const plain = task.toObject();
        plain.isIntention = true;
        return plain;
    });
}

module.exports = {
    DEFAULT_INTENTION_DURATION,
    personalProjectIds,
    isPersonalProject,
    isRepeating,
    taskIsIntention,
    attachIntentionFlags,
    getIntentions,
    intentionExclusionClauses,
};
