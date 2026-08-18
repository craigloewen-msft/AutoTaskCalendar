'use strict';

const moment = require('moment-timezone');
const {
    TaskDetails,
    ProjectDetails,
    GoalDetails,
    RoleDetails,
} = require('../models');
const {
    addDateOnlyDays,
    dateOnlyFromMarker,
    normaliseTimeZone,
    startOfDateInZone,
} = require('../utils/temporal');

const FALLBACK_KEY = '__unaligned__';

function markdownText(value) {
    return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/([\\`*_{}\[\]()#+|])/g, '\\$1')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
}

function civilDate(value) {
    return value ? dateOnlyFromMarker(value) : null;
}

function groupKey(context) {
    return context ? String(context.project._id) : FALLBACK_KEY;
}

function compareGroups(left, right) {
    if (left.key === FALLBACK_KEY) return right.key === FALLBACK_KEY ? 0 : 1;
    if (right.key === FALLBACK_KEY) return -1;
    return left.label.localeCompare(right.label);
}

function contextFor(task, projects, goals, roles) {
    if (!task.projectRef) return null;
    const project = projects.get(String(task.projectRef));
    if (!project) return null;
    const goal = goals.get(String(project.goalRef)) || null;
    const role = goal ? roles.get(String(goal.roleRef)) || null : null;
    return { project, goal, role };
}

async function loadCompletedTaskExport(user, completedFrom, completedTo) {
    const timeZone = normaliseTimeZone(user.timeZone);
    const start = startOfDateInZone(completedFrom, timeZone);
    const exclusiveEnd = startOfDateInZone(addDateOnlyDays(completedTo, 1), timeZone);
    const tasks = await TaskDetails.find({
        userRef: user._id,
        completed: true,
        completedDate: { $gte: start, $lt: exclusiveEnd },
    })
        .select('title notes startDate dueDate completedDate occurrenceDate seriesRef projectRef')
        .sort({ completedDate: 1, title: 1, _id: 1 })
        .lean();

    const projectIds = [...new Set(tasks.filter((task) => task.projectRef).map((task) => String(task.projectRef)))];
    const projectDocs = projectIds.length
        ? await ProjectDetails.find({ _id: { $in: projectIds }, userRef: user._id })
            .select('title description goalRef')
            .lean()
        : [];
    const goalIds = [...new Set(projectDocs.filter((project) => project.goalRef).map((project) => String(project.goalRef)))];
    const goalDocs = goalIds.length
        ? await GoalDetails.find({ _id: { $in: goalIds }, userRef: user._id })
            .select('title description roleRef')
            .lean()
        : [];
    const roleIds = [...new Set(goalDocs.filter((goal) => goal.roleRef).map((goal) => String(goal.roleRef)))];
    const roleDocs = roleIds.length
        ? await RoleDetails.find({ _id: { $in: roleIds }, userRef: user._id })
            .select('title description')
            .lean()
        : [];

    const byId = (items) => new Map(items.map((item) => [String(item._id), item]));
    const projects = byId(projectDocs);
    const goals = byId(goalDocs);
    const roles = byId(roleDocs);
    const groups = new Map();

    for (const task of tasks) {
        const context = contextFor(task, projects, goals, roles);
        const key = groupKey(context);
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                context,
                label: context
                    ? [context.role, context.goal, context.project]
                        .filter(Boolean)
                        .map((item) => item.title || '')
                        .join(' → ')
                    : 'Unaligned or unavailable project context',
                tasks: [],
            });
        }
        groups.get(key).tasks.push(task);
    }

    return { tasks, groups: [...groups.values()].sort(compareGroups), timeZone };
}

function taskLines(task, timeZone) {
    const completed = moment(task.completedDate).tz(timeZone).format('YYYY-MM-DD HH:mm z');
    const lines = [`- **${completed} — ${markdownText(task.title || 'Untitled task')}**`];
    if (task.notes) lines.push(`  - Notes: ${markdownText(task.notes)}`);
    if (task.startDate) lines.push(`  - Start date: ${civilDate(task.startDate)}`);
    if (task.dueDate) lines.push(`  - Due date: ${civilDate(task.dueDate)}`);
    if (task.seriesRef || task.occurrenceDate) {
        const occurrence = civilDate(task.occurrenceDate);
        lines.push(`  - Recurring occurrence${occurrence ? `: ${occurrence}` : ''}`);
    }
    return lines;
}

function contextLines(context) {
    if (!context) {
        return ['Tasks in this section were unaligned or their saved project hierarchy is no longer available.'];
    }

    const lines = [];
    for (const [label, item] of [
        ['Role', context.role],
        ['Goal', context.goal],
        ['Project', context.project],
    ]) {
        if (!item) continue;
        lines.push(`- ${label}: **${markdownText(item.title || `Untitled ${label.toLowerCase()}`)}**`);
        if (item.description) lines.push(`  - Context: ${markdownText(item.description)}`);
    }
    return lines;
}

function formatCompletedTaskReport({ tasks, groups, timeZone }, completedFrom, completedTo, generatedAt = new Date()) {
    const monthCounts = new Map();
    for (const task of tasks) {
        const month = moment(task.completedDate).tz(timeZone).format('YYYY-MM');
        monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    }

    const lines = [
        '# Completed task report',
        '',
        '## Export details',
        '',
        `- Completion range: **${completedFrom} through ${completedTo}**, inclusive`,
        `- Timezone: **${markdownText(timeZone)}**`,
        `- Generated: **${generatedAt.toISOString()}**`,
        `- Completed tasks: **${tasks.length}**`,
        '',
        '> Tasks are selected by their actual completion timestamp, not by their start or due date. Each completed recurring occurrence is a separate record.',
        '',
        '## Monthly summary',
        '',
    ];

    if (monthCounts.size) {
        for (const [month, count] of [...monthCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            lines.push(`- ${month}: ${count} ${count === 1 ? 'task' : 'tasks'}`);
        }
    } else {
        lines.push('No tasks were completed in this range.');
    }

    lines.push('', '## Completed work', '');
    if (!groups.length) {
        lines.push('No completed work to list.', '');
        return `${lines.join('\n')}\n`;
    }

    for (const group of groups) {
        lines.push(`### ${markdownText(group.label)}`, '', ...contextLines(group.context), '');
        for (const task of group.tasks) lines.push(...taskLines(task, timeZone));
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

async function createCompletedTaskReport(user, completedFrom, completedTo, generatedAt = new Date()) {
    const data = await loadCompletedTaskExport(user, completedFrom, completedTo);
    return formatCompletedTaskReport(data, completedFrom, completedTo, generatedAt);
}

module.exports = {
    createCompletedTaskReport,
    formatCompletedTaskReport,
    loadCompletedTaskExport,
    markdownText,
};
