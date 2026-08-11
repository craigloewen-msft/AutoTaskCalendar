'use strict';

/**
 * Recurrence rules and the occurrences they generate.
 *
 * A repeating task is a series: one template holding the rule, plus occurrence documents
 * materialised from it over a rolling horizon. A task IS a template exactly when it has a
 * recurrence rule; there is no separate flag to keep in sync.
 *
 * Calendar dates are canonical UTC markers. The user's IANA timezone only determines
 * which civil date is "today" and when occurrences become eligible on the timeline.
 */

const moment = require('moment');
const { TaskDetails } = require('../models');
const {
    parseDateOnly,
    dateOnlyFromMarker,
    addDateOnlyDays,
    todayInZone,
} = require('../utils/temporal');

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
const WHEN_UNSCHEDULABLE_BEHAVIORS = ['skip', 'next-available'];
const DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR = 'skip';
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Ceiling on occurrences generated per series per run, so a runaway rule cannot exhaust
// the scheduler's iteration guard.
const MAX_OCCURRENCES_PER_SERIES = 200;

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a recurrence rule from a request body.
 * Returns an error string, or null when the rule is acceptable.
 */
function validateRecurrence(rule) {
    if (rule === null || rule === undefined) {
        return null;
    }

    if (typeof rule !== 'object' || Array.isArray(rule)) {
        return 'Recurrence must be an object';
    }

    if (!FREQUENCIES.includes(rule.freq)) {
        return `Recurrence frequency must be one of: ${FREQUENCIES.join(', ')}`;
    }

    if (
        rule.whenUnschedulableBehavior !== undefined
        && rule.whenUnschedulableBehavior !== null
        && !WHEN_UNSCHEDULABLE_BEHAVIORS.includes(rule.whenUnschedulableBehavior)
    ) {
        return `Recurrence whenUnschedulableBehavior must be one of: ${WHEN_UNSCHEDULABLE_BEHAVIORS.join(', ')}`;
    }

    if (rule.interval !== undefined && rule.interval !== null) {
        const interval = Number(rule.interval);
        if (!Number.isInteger(interval) || interval < 1 || interval > 366) {
            return 'Recurrence interval must be a whole number between 1 and 366';
        }
    }

    if (rule.byWeekday !== undefined && rule.byWeekday !== null) {
        if (!Array.isArray(rule.byWeekday)) {
            return 'Recurrence byWeekday must be an array';
        }
        for (const day of rule.byWeekday) {
            const value = Number(day);
            if (!Number.isInteger(value) || value < 0 || value > 6) {
                return 'Recurrence byWeekday values must be whole numbers from 0 (Sunday) to 6 (Saturday)';
            }
        }
    }

    if (rule.byMonthDay !== undefined && rule.byMonthDay !== null) {
        if (!Array.isArray(rule.byMonthDay)) {
            return 'Recurrence byMonthDay must be an array';
        }
        for (const day of rule.byMonthDay) {
            const value = Number(day);
            const valid = Number.isInteger(value) && ((value >= 1 && value <= 31) || value === -1);
            if (!valid) {
                return 'Recurrence byMonthDay values must be 1-31, or -1 for the last day of the month';
            }
        }
    }

    if (rule.endsAfter !== undefined && rule.endsAfter !== null) {
        const count = Number(rule.endsAfter);
        if (!Number.isInteger(count) || count < 1) {
            return 'Recurrence endsAfter must be a whole number of at least 1';
        }
    }

    if (rule.endsOn !== undefined && rule.endsOn !== null) {
        const endsOn = parseDateOnly(rule.endsOn);
        if (!endsOn.provided || !endsOn.valid) {
            return 'Recurrence endsOn must be a valid date';
        }
    }

    return null;
}

/**
 * Coerce a request-body rule into the stored shape, dropping fields that do not apply to
 * the chosen frequency so stale selections cannot leak through an edit.
 */
function normaliseRecurrence(rule) {
    if (!rule || !FREQUENCIES.includes(rule.freq)) {
        return null;
    }

    const normalised = {
        freq: rule.freq,
        interval: rule.interval ? Number(rule.interval) : 1,
        byWeekday: [],
        byMonthDay: [],
        endsOn: rule.endsOn ? parseDateOnly(rule.endsOn).date : null,
        endsAfter: rule.endsAfter ? Number(rule.endsAfter) : null,
        whenUnschedulableBehavior: recurrenceWhenUnschedulableBehavior(rule),
    };

    // Sorted and de-duplicated, so two equivalent rules always compare equal.
    if (rule.freq === 'weekly' && Array.isArray(rule.byWeekday)) {
        normalised.byWeekday = [...new Set(rule.byWeekday.map(Number))].sort((a, b) => a - b);
    }

    if (rule.freq === 'monthly' && Array.isArray(rule.byMonthDay)) {
        normalised.byMonthDay = [...new Set(rule.byMonthDay.map(Number))].sort((a, b) => a - b);
    }

    return normalised;
}

/**
 * Translate a legacy `repeat` string into a rule object, so old documents keep working
 * without a migration script.
 */
function normaliseLegacyRepeat(task) {
    if (!task || !task.repeat || !FREQUENCIES.includes(task.repeat)) {
        return null;
    }

    return {
        freq: task.repeat,
        interval: 1,
        byWeekday: [],
        byMonthDay: [],
        endsOn: null,
        endsAfter: null,
        whenUnschedulableBehavior: DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
    };
}

function recurrenceWhenUnschedulableBehavior(rule) {
    return WHEN_UNSCHEDULABLE_BEHAVIORS.includes(rule?.whenUnschedulableBehavior)
        ? rule.whenUnschedulableBehavior
        : DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR;
}

/** The effective rule for a task: the modern field, else a translated legacy string. */
function effectiveRule(task) {
    if (task && task.recurrence && task.recurrence.freq) {
        const rule = task.recurrence.toObject
            ? task.recurrence.toObject()
            : { ...task.recurrence };
        return {
            ...rule,
            whenUnschedulableBehavior: recurrenceWhenUnschedulableBehavior(rule),
        };
    }
    return normaliseLegacyRepeat(task);
}

// ============================================================================
// Plain-English description
// ============================================================================

function joinWithAnd(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function ordinal(n) {
    if (n === -1) return 'last day';
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
    return `${n}${suffix}`;
}

/**
 * Render a rule as a sentence, e.g. "Every week on Monday and Tuesday".
 * Shared with the UI so the summary line and the API never disagree.
 */
function describeRecurrence(rule) {
    if (!rule || !FREQUENCIES.includes(rule.freq)) {
        return 'Does not repeat';
    }

    const interval = rule.interval && rule.interval > 0 ? rule.interval : 1;
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
    let text = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;

    if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length > 0) {
        const days = rule.byWeekday.map((d) => WEEKDAY_NAMES[d]).filter(Boolean);
        text += ` on ${joinWithAnd(days)}`;
    }

    if (rule.freq === 'monthly' && rule.byMonthDay && rule.byMonthDay.length > 0) {
        text += ` on the ${joinWithAnd(rule.byMonthDay.map(ordinal))}`;
    }

    if (rule.endsOn) {
        const endsOn = dateOnlyFromMarker(rule.endsOn) || String(rule.endsOn);
        text += `, until ${moment.utc(endsOn, 'YYYY-MM-DD', true).format('D MMM YYYY')}`;
    } else if (rule.endsAfter) {
        text += `, ${rule.endsAfter} times`;
    }

    return text;
}

// ============================================================================
// Occurrence generation
// ============================================================================

/** Canonical UTC marker for a civil date. */
function civilDay(date) {
    const value = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : dateOnlyFromMarker(date);
    return moment.utc(value, 'YYYY-MM-DD', true).startOf('day');
}

function hasMonthlyDayFilter(rule) {
    return Array.isArray(rule.byMonthDay) && rule.byMonthDay.length > 0;
}

/** Weekdays a weekly rule fires on. Empty means the day the series starts on, not every day. */
function weeklyDays(rule, anchorDay) {
    const chosen = Array.isArray(rule.byWeekday) ? rule.byWeekday : [];
    return chosen.length > 0 ? chosen : [anchorDay.day()];
}

/**
 * Does a date satisfy the day-of-period part of the rule?
 * The interval is handled separately by `isOnInterval`.
 */
function matchesDayFilter(rule, day, anchorDay) {
    if (rule.freq === 'weekly') {
        return weeklyDays(rule, anchorDay).includes(day.day());
    }

    if (rule.freq === 'monthly' && hasMonthlyDayFilter(rule)) {
        const dayOfMonth = day.date();
        const lastDayOfMonth = day.daysInMonth();

        return rule.byMonthDay.some((target) => {
            if (target === -1) return dayOfMonth === lastDayOfMonth;
            // A 31st rule simply does not fire in a 30-day month; it never rolls over.
            return target === dayOfMonth;
        });
    }

    return true;
}

/**
 * Is `day` inside an active period, given the rule's interval?
 * e.g. for a fortnightly rule only every second week counts.
 */
function isOnInterval(rule, anchorDay, day, interval) {
    switch (rule.freq) {
        case 'daily':
            return day.diff(anchorDay, 'days') % interval === 0;

        case 'weekly': {
            // Compare whole weeks from the anchor's week start, so byWeekday can pick days
            // out of an active week.
            const anchorWeek = anchorDay.clone().startOf('week');
            const dayWeek = day.clone().startOf('week');
            return dayWeek.diff(anchorWeek, 'weeks') % interval === 0;
        }

        case 'monthly': {
            const months = (day.year() - anchorDay.year()) * 12 + (day.month() - anchorDay.month());
            if (months % interval !== 0) return false;
            // With no explicit day filter, repeat on the anchor's day of the month.
            return hasMonthlyDayFilter(rule) || day.date() === anchorDay.date();
        }

        case 'yearly': {
            if ((day.year() - anchorDay.year()) % interval !== 0) return false;
            return day.date() === anchorDay.date() && day.month() === anchorDay.month();
        }

        default:
            return false;
    }
}

/**
 * Generate occurrence dates for a rule within [from, to].
 *
 * `anchor` is the series start date; it fixes the phase for intervals, so "every 2 weeks"
 * counts from the anchor rather than from an arbitrary window edge.
 */
function occurrenceDatesBetween(rule, from, to, anchor) {
    if (!rule || !FREQUENCIES.includes(rule.freq)) {
        return [];
    }

    const interval = rule.interval && rule.interval > 0 ? rule.interval : 1;
    const anchorDay = civilDay(anchor);
    const windowStart = civilDay(from);
    const windowEnd = civilDay(to);
    const hardEnd = rule.endsOn ? civilDay(rule.endsOn) : null;

    const dates = [];
    let produced = 0;
    let cursor = anchorDay.clone();

    // Count-limited rules must walk from the anchor. Unlimited rules can jump near the
    // requested window while retaining the anchor for interval phase calculations.
    if (!rule.endsAfter && cursor.isBefore(windowStart, 'day')) {
        cursor = windowStart.clone();
        if (rule.freq === 'daily') {
            const remainder = cursor.diff(anchorDay, 'days') % interval;
            if (remainder) cursor.add(interval - remainder, 'days');
        }
    }

    let iterations = 0;
    const daysToWalk = Math.max(0, windowEnd.diff(cursor, 'days'));
    const MAX_ITERATIONS = Math.min(1_000_000, daysToWalk + 1);

    while (cursor.isSameOrBefore(windowEnd, 'day') && iterations < MAX_ITERATIONS) {
        iterations++;

        if (hardEnd && cursor.isAfter(hardEnd, 'day')) break;
        if (rule.endsAfter && produced >= rule.endsAfter) break;

        if (isOnInterval(rule, anchorDay, cursor, interval) && matchesDayFilter(rule, cursor, anchorDay)) {
            produced++;

            if (cursor.isSameOrAfter(windowStart, 'day')) {
                dates.push(cursor.clone().toDate());
                if (dates.length >= MAX_OCCURRENCES_PER_SERIES) break;
            }
        }

        cursor.add(1, 'day');
    }

    return dates;
}

// ============================================================================
// Expansion: materialise and prune occurrence documents
// ============================================================================

/**
 * Fields an occurrence inherits from its template. Everything else is per-occurrence.
 */
const INHERITED_FIELDS = [
    'title',
    'notes',
    'duration',
    'breakUpTask',
    'breakUpTaskChunkDuration',
    'priority',
    'dependsOn',
    'projectRef',
];

/**
 * Materialise occurrences for every recurring series belonging to a user, and prune the
 * ones that no longer belong.
 *
 * Idempotent: keyed on (seriesRef, occurrenceDate), so running it twice is a no-op.
 * Completed occurrences are never pruned or regenerated — they are the user's history.
 */
async function expandRecurrences(user, horizonDays, { synchronizeSeriesId = null } = {}) {
    const todayValue = todayInZone(user.timeZone);
    const today = civilDay(todayValue);
    const horizonEnd = civilDay(addDateOnlyDays(todayValue, horizonDays));
    const deferredSeriesIds = [];

    // Any task carrying a rule is a template. Legacy `repeat` strings are promoted on the
    // fly, so old data starts behaving without a migration. Completed tasks are excluded:
    // a finished task is history, not a live rule.
    const templates = await TaskDetails.find({
        userRef: user._id,
        $and: [
            {
                $or: [
                    { 'recurrence.freq': { $in: FREQUENCIES } },
                    { repeat: { $in: FREQUENCIES } },
                ],
            },
            { $or: [{ completed: false }, { completed: null }] },
        ],
    });

    for (const template of templates) {
        const rule = effectiveRule(template);
        if (!rule) continue;

        if (recurrenceWhenUnschedulableBehavior(rule) === 'next-available') {
            deferredSeriesIds.push(template._id);
        }

        // Promote a legacy string in place: writing the rule is what makes it a template.
        if (!template.recurrence || !template.recurrence.freq) {
            template.recurrence = rule;
            template.scheduledDate = null;
            await template.save();
        }

        const synchronizePending = !!synchronizeSeriesId
            && template._id.toString() === synchronizeSeriesId.toString();
        await expandSeries(template, rule, today, horizonEnd, { synchronizePending });
    }

    // Skip-policy chores never pile up. Deferred occurrences remain eligible across runs.
    await TaskDetails.deleteMany({
        userRef: user._id,
        seriesRef: { $ne: null, $nin: deferredSeriesIds },
        occurrenceDate: { $lt: today.toDate() },
        $or: [{ completed: false }, { completed: null }],
    });

    await pruneOccurrencesOfCompletedSeries(user);
}

/**
 * Remove pending occurrences whose template has since been completed. Completed
 * occurrences stay: they are the user's history.
 */
async function pruneOccurrencesOfCompletedSeries(user) {
    const completedTemplates = await TaskDetails.find({
        userRef: user._id,
        completed: true,
        $or: [
            { 'recurrence.freq': { $in: FREQUENCIES } },
            { repeat: { $in: FREQUENCIES } },
        ],
    }, '_id');

    if (completedTemplates.length === 0) {
        return;
    }

    await TaskDetails.deleteMany({
        userRef: user._id,
        seriesRef: { $in: completedTemplates.map((t) => t._id) },
        $or: [{ completed: false }, { completed: null }],
    });
}

/** Materialise one series' occurrences and prune its stale future ones. */
async function expandSeries(template, rule, today, horizonEnd, { synchronizePending }) {
    const anchor = template.startDate || template.occurrenceDate || today.toDate();

    // Generate from today rather than the anchor: past occurrences are pruned anyway.
    const from = moment.max(today.clone(), civilDay(anchor));
    const dates = occurrenceDatesBetween(rule, from.toDate(), horizonEnd.toDate(), anchor);
    const wanted = dates.map((d) => civilDay(d).toDate());
    const wantedTimes = new Set(wanted.map((d) => d.getTime()));

    const existing = await TaskDetails.find({
        userRef: template.userRef,
        seriesRef: template._id,
        occurrenceDate: { $gte: today.toDate() },
    });

    // Drop future occurrences the rule no longer produces, e.g. after an edit. Completed
    // ones stay: they are history, not a projection of the current rule.
    const staleIds = existing
        .filter((t) => !t.completed && !wantedTimes.has(t.occurrenceDate.getTime()))
        .map((t) => t._id);

    if (staleIds.length > 0) {
        await TaskDetails.deleteMany({ _id: { $in: staleIds } });
    }

    // Survivors keep their identity, which is what makes a re-run a no-op.
    const staleSet = new Set(staleIds.map((id) => id.toString()));
    const survivors = existing.filter((t) => !staleSet.has(t._id.toString()));
    const taken = new Set(survivors.map((t) => t.occurrenceDate.getTime()));

    const inherited = {};
    for (const field of INHERITED_FIELDS) {
        inherited[field] = template[field];
    }

    // Only explicit series edits refresh survivors. Normal expansion must preserve
    // per-occurrence progress such as duration remaining after partial chunk completion.
    if (synchronizePending) {
        const inheritedSet = {};
        const inheritedUnset = {};
        for (const field of INHERITED_FIELDS) {
            if (template[field] === undefined) {
                inheritedUnset[field] = 1;
            } else {
                inheritedSet[field] = template[field];
            }
        }

        const pendingSurvivorIds = survivors.filter((t) => !t.completed).map((t) => t._id);
        if (pendingSurvivorIds.length > 0) {
            const update = { $set: inheritedSet };
            if (Object.keys(inheritedUnset).length > 0) update.$unset = inheritedUnset;
            await TaskDetails.updateMany({ _id: { $in: pendingSurvivorIds } }, update);
        }
    }

    const toCreate = wanted
        .filter((date) => !taken.has(date.getTime()))
        .map((date) => ({
            ...inherited,
            userRef: template.userRef,
            seriesRef: template._id,
            occurrenceDate: date,
            dueDate: date,
            startDate: date,
            completed: false,
            completedDate: null,
            scheduledDate: null,
            isBacklog: false,
            recurrence: null,
            repeat: null,
        }));

    if (toCreate.length > 0) {
        await TaskDetails.insertMany(toCreate);
    }
}

module.exports = {
    FREQUENCIES,
    WHEN_UNSCHEDULABLE_BEHAVIORS,
    DEFAULT_WHEN_UNSCHEDULABLE_BEHAVIOR,
    WEEKDAY_NAMES,
    MAX_OCCURRENCES_PER_SERIES,
    validateRecurrence,
    normaliseRecurrence,
    normaliseLegacyRepeat,
    effectiveRule,
    recurrenceWhenUnschedulableBehavior,
    describeRecurrence,
    occurrenceDatesBetween,
    expandRecurrences,
};
