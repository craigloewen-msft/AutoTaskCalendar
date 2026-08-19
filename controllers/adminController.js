const {
    UserDetails,
    TaskDetails,
    EventDetails,
    RoleDetails,
    GoalDetails,
    ProjectDetails,
    WeeklyPlanDetails,
} = require('../models');
const { addDateOnlyDays, startOfDateInZone, todayInZone } = require('../utils/temporal');
const mongoose = require('mongoose');

/**
 * Admin dashboard metrics. See docs/ADMIN.md.
 *
 * Every other controller is single-tenant; this one deliberately reads across all of them,
 * so it returns counts and booleans only -- never task titles, notes, or event contents.
 *
 * Site-wide numbers have no single user timezone, so every bucket here is UTC.
 */

const METRICS_ZONE = 'UTC';
const TREND_DAYS = 30;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SORT_FIELDS = {
    lastLogin: 'lastLoginDate',
    created: 'createdAt',
    username: 'username',
    tasks: 'taskCount',
};

class AdminError extends Error {}

// Work in hand: neither completed nor a series template.
const ACTIVE_TASK = {
    $or: [{ completed: false }, { completed: null }, { completed: { $exists: false } }],
    'recurrence.freq': { $exists: false },
};

// Civil day boundary, walked with the temporal helpers rather than by subtracting millis.
function windowStart(days, now) {
    const today = todayInZone(METRICS_ZONE, now);
    return startOfDateInZone(addDateOnlyDays(today, -(days - 1)), METRICS_ZONE);
}

function percent(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
}

// An ObjectId encodes its creation time, so "created since" is an indexed _id range scan
// rather than a full collection scan computing $toDate on every document.
function createdSince(date) {
    return { _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000)) } };
}

// Mongo has no median operator; per-user counts are small enough to sort in memory.
function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

// One bucket per day, oldest first, with the days the aggregation omits filled with zeroes.
function buildTrends(days, buckets, now) {
    const today = todayInZone(METRICS_ZONE, now);
    const byDate = new Map();

    for (const [key, rows] of Object.entries(buckets)) {
        for (const row of rows) {
            if (!byDate.has(row._id)) byDate.set(row._id, {});
            byDate.get(row._id)[key] = row.count;
        }
    }

    const trends = [];
    for (let offset = days - 1; offset >= 0; offset--) {
        const date = addDateOnlyDays(today, -offset);
        const found = byDate.get(date) || {};
        trends.push({
            date,
            signups: found.signups || 0,
            tasksCreated: found.tasksCreated || 0,
            tasksCompleted: found.tasksCompleted || 0,
        });
    }
    return trends;
}

// Group by UTC civil day. Creation time comes from the ObjectId; there is no createdAt field.
// The indexed $match runs first so the bucket is only computed for documents in the window.
function dailyCounts(model, prefilter, dateExpr) {
    return model.aggregate([
        { $match: prefilter },
        { $addFields: { bucketDate: dateExpr } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$bucketDate',
                        timezone: METRICS_ZONE,
                    },
                },
                count: { $sum: 1 },
            },
        },
    ]);
}

async function getOverview(now = new Date()) {
    const todayMarker = startOfDateInZone(todayInZone(METRICS_ZONE, now), METRICS_ZONE);
    const last7 = windowStart(7, now);
    const last30 = windowStart(TREND_DAYS, now);
    const createdAt = { $toDate: '$_id' };

    const [
        users, tasks, completedTasks, activeTasks, backlogTasks, recurringSeries,
        events, roles, goals, projects, weeklyPlans,
    ] = await Promise.all([
        UserDetails.countDocuments({}),
        TaskDetails.countDocuments({}),
        TaskDetails.countDocuments({ completed: true }),
        TaskDetails.countDocuments(ACTIVE_TASK),
        TaskDetails.countDocuments({ ...ACTIVE_TASK, isBacklog: true }),
        TaskDetails.countDocuments({ 'recurrence.freq': { $exists: true } }),
        EventDetails.countDocuments({}),
        RoleDetails.countDocuments({}),
        GoalDetails.countDocuments({}),
        ProjectDetails.countDocuments({}),
        WeeklyPlanDetails.countDocuments({}),
    ]);

    const [
        newUsers7, newUsers30, activeUsers7, activeUsers30, usersWithGoogle,
        taskOwners, compassOwners, planOwners,
        scheduledTasks, unscheduledTasks, overdueTasks, tasksWithProject,
    ] = await Promise.all([
        UserDetails.countDocuments(createdSince(last7)),
        UserDetails.countDocuments(createdSince(last30)),
        UserDetails.countDocuments({ lastLoginDate: { $gte: last7 } }),
        UserDetails.countDocuments({ lastLoginDate: { $gte: last30 } }),
        UserDetails.countDocuments({
            googleAccessTokenEncrypted: { $exists: true, $nin: [null, ''] },
        }),
        TaskDetails.distinct('userRef'),
        ProjectDetails.distinct('userRef'),
        WeeklyPlanDetails.distinct('userRef'),
        TaskDetails.countDocuments({ ...ACTIVE_TASK, scheduledDate: { $ne: null } }),
        TaskDetails.countDocuments({ ...ACTIVE_TASK, scheduledDate: null }),
        // dueDate is a civil-date marker, so this compares markers, never wall clocks.
        TaskDetails.countDocuments({ ...ACTIVE_TASK, dueDate: { $ne: null, $lt: todayMarker } }),
        TaskDetails.countDocuments({ ...ACTIVE_TASK, projectRef: { $ne: null } }),
    ]);

    const [perUser, signups, tasksCreated, tasksCompleted] = await Promise.all([
        TaskDetails.aggregate([{ $group: { _id: '$userRef', count: { $sum: 1 } } }]),
        dailyCounts(UserDetails, createdSince(last30), createdAt),
        dailyCounts(TaskDetails, createdSince(last30), createdAt),
        dailyCounts(
            TaskDetails,
            { completed: true, completedDate: { $gte: last30 } },
            '$completedDate'
        ),
    ]);

    const counts = perUser.map((row) => row.count);
    const totalPerUser = counts.reduce((sum, count) => sum + count, 0);

    return {
        generatedAt: new Date().toISOString(),
        timeZone: METRICS_ZONE,
        totals: {
            users, tasks, completedTasks, activeTasks, backlogTasks, recurringSeries,
            events, roles, goals, projects, weeklyPlans,
        },
        engagement: {
            newUsers7,
            newUsers30,
            activeUsers7,
            activeUsers30,
            dormantUsers: Math.max(users - activeUsers30, 0),
            usersWithTasks: taskOwners.filter(Boolean).length,
            usersWithCompass: compassOwners.filter(Boolean).length,
            usersWithCommittedWeek: planOwners.filter(Boolean).length,
            usersWithGoogle,
            meanTasksPerUser: users ? Math.round((totalPerUser / users) * 10) / 10 : 0,
            medianTasksPerUser: median(counts),
        },
        health: {
            scheduledTasks,
            unscheduledTasks,
            overdueTasks,
            tasksWithProject,
            tasksWithoutProject: Math.max(activeTasks - tasksWithProject, 0),
            completionRate: percent(completedTasks, tasks),
        },
        trends: buildTrends(TREND_DAYS, { signups, tasksCreated, tasksCompleted }, now),
    };
}

// User-supplied text reaches a regex, so every metacharacter is escaped first.
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseListOptions(query = {}) {
    const sort = query.sort === undefined ? 'lastLogin' : String(query.sort);
    if (!SORT_FIELDS[sort]) {
        throw new AdminError(`Sort must be one of ${Object.keys(SORT_FIELDS).join(', ')}`);
    }

    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isInteger(page) || page < 1) {
        throw new AdminError('Page must be a positive integer');
    }

    const requested = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
    if (!Number.isInteger(requested) || requested < 1) {
        throw new AdminError('Limit must be a positive integer');
    }

    // Names read best A-Z; every other column is most interesting at its highest value.
    const defaultDirection = sort === 'username' ? 'asc' : 'desc';
    const direction = (query.direction === undefined ? defaultDirection : query.direction) === 'asc'
        ? 1
        : -1;

    return {
        search: typeof query.search === 'string' ? query.search.trim() : '',
        page,
        limit: Math.min(requested, MAX_LIMIT),
        sort,
        direction,
    };
}

async function listUsers(query = {}) {
    const { search, page, limit, sort, direction } = parseListOptions(query);
    const match = {};

    if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        match.$or = [{ username: pattern }, { email: pattern }];
    }

    const [result] = await UserDetails.aggregate([
        { $match: match },
        {
            $facet: {
                totalCount: [{ $count: 'value' }],
                users: [
                    // Hashes and Google tokens are dropped here, before anything can serialise them.
                    {
                        $project: {
                            username: 1,
                            email: 1,
                            timeZone: 1,
                            isAdmin: { $eq: ['$isAdmin', true] },
                            lastLoginDate: 1,
                            createdAt: { $toDate: '$_id' },
                            googleConnected: {
                                $and: [
                                    { $ne: [{ $ifNull: ['$googleAccessTokenEncrypted', null] }, null] },
                                    { $ne: ['$googleAccessTokenEncrypted', ''] },
                                ],
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: 'taskInfo',
                            localField: '_id',
                            foreignField: 'userRef',
                            pipeline: [{
                                $group: {
                                    _id: null,
                                    total: { $sum: 1 },
                                    completed: {
                                        $sum: { $cond: [{ $eq: ['$completed', true] }, 1, 0] },
                                    },
                                },
                            }],
                            as: 'taskStats',
                        },
                    },
                    {
                        $lookup: {
                            from: 'eventInfo',
                            localField: '_id',
                            foreignField: 'userRef',
                            pipeline: [{ $count: 'value' }],
                            as: 'eventStats',
                        },
                    },
                    {
                        $lookup: {
                            from: 'projectInfo',
                            localField: '_id',
                            foreignField: 'userRef',
                            pipeline: [{ $count: 'value' }],
                            as: 'projectStats',
                        },
                    },
                    {
                        $addFields: {
                            taskCount: { $ifNull: [{ $first: '$taskStats.total' }, 0] },
                            completedCount: { $ifNull: [{ $first: '$taskStats.completed' }, 0] },
                            eventCount: { $ifNull: [{ $first: '$eventStats.value' }, 0] },
                            projectCount: { $ifNull: [{ $first: '$projectStats.value' }, 0] },
                        },
                    },
                    {
                        $addFields: {
                            activeCount: {
                                $max: [{ $subtract: ['$taskCount', '$completedCount'] }, 0],
                            },
                        },
                    },
                    { $project: { taskStats: 0, eventStats: 0, projectStats: 0 } },
                    { $sort: { [SORT_FIELDS[sort]]: direction, _id: 1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                ],
            },
        },
    ]);

    return {
        users: result?.users || [],
        totalCount: result?.totalCount?.[0]?.value || 0,
        page,
        limit,
        sort,
    };
}

module.exports = {
    AdminError,
    ACTIVE_TASK,
    getOverview,
    listUsers,
    MAX_LIMIT,
};
