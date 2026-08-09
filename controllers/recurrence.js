'use strict';

/**
 * Recurrence rules and the occurrences they generate.
 *
 * A repeating task is a *series*: one template document holding the rule, plus concrete
 * occurrence documents materialised over a rolling horizon by `expandRecurrences`.
 *
 * TIMEZONES: everything here works in SERVER-LOCAL time, matching the scheduler
 * (`getWorkingHoursForDay`) and the seed factories. Never use UTC getters for weekday
 * logic and never advance days with `+ MS_PER_DAY` — both drift across DST and can flip
 * the date. Always go through moment's `add()`.
 */

const moment = require('moment');
const { TaskDetails } = require('../models');

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
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
        if (!moment(rule.endsOn).isValid()) {
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
        endsOn: rule.endsOn ? moment(rule.endsOn).toDate() : null,
        endsAfter: rule.endsAfter ? Number(rule.endsAfter) : null,
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
    };
}

/** The effective rule for a task: the modern field, else a translated legacy string. */
function effectiveRule(task) {
    if (task && task.recurrence && task.recurrence.freq) {
        return task.recurrence;
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
        text += `, until ${moment(rule.endsOn).format('D MMM YYYY')}`;
    } else if (rule.endsAfter) {
        text += `, ${rule.endsAfter} times`;
    }

    return text;
}

// ============================================================================
// Occurrence generation
// ============================================================================

/** Local midnight for a date, which is how occurrenceDate is always stored. */
function startOfLocalDay(date) {
    return moment(date).startOf('day');
}

function hasMonthlyDayFilter(rule) {
    return Array.isArray(rule.byMonthDay) && rule.byMonthDay.length > 0;
}

/**
 * Does a date satisfy the day-of-period part of the rule?
 * The interval is handled separately by `isOnInterval`.
 */
function matchesDayFilter(rule, day) {
    if (rule.freq === 'weekly' && Array.isArray(rule.byWeekday) && rule.byWeekday.length > 0) {
        // moment().day() is local, matching the scheduler's local weekday logic.
        return rule.byWeekday.includes(day.day());
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
            // Compare whole weeks from the anchor's week start, so every day in an active
            // week qualifies and byWeekday can then pick days out of it.
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
 * `anchor` is the series start date. It fixes the phase for intervals, so "every 2 weeks"
 * counts from the anchor rather than from an arbitrary window edge.
 *
 * Returns local-midnight Dates in ascending order.
 */
function occurrenceDatesBetween(rule, from, to, anchor) {
    if (!rule || !FREQUENCIES.includes(rule.freq)) {
        return [];
    }

    const interval = rule.interval && rule.interval > 0 ? rule.interval : 1;
    const anchorDay = startOfLocalDay(anchor);
    const windowStart = startOfLocalDay(from);
    const windowEnd = startOfLocalDay(to);
    const hardEnd = rule.endsOn ? startOfLocalDay(rule.endsOn) : null;

    const dates = [];
    // Counts every occurrence since the anchor, including ones before the window, so
    // endsAfter means "N occurrences ever" rather than "N within this window".
    let produced = 0;

    // Walk day by day from the anchor, bounded by the window, endsOn, endsAfter, and a
    // hard iteration cap so a pathological rule can never spin.
    const cursor = anchorDay.clone();
    let iterations = 0;
    const MAX_ITERATIONS = 4000;

    while (cursor.isSameOrBefore(windowEnd, 'day') && iterations < MAX_ITERATIONS) {
        iterations++;

        if (hardEnd && cursor.isAfter(hardEnd, 'day')) break;
        if (rule.endsAfter && produced >= rule.endsAfter) break;

        if (isOnInterval(rule, anchorDay, cursor, interval) && matchesDayFilter(rule, cursor)) {
            produced++;

            if (cursor.isSameOrAfter(windowStart, 'day')) {
                dates.push(cursor.clone().toDate());
                if (dates.length >= MAX_OCCURRENCES_PER_SERIES) break;
            }
        }

        // moment's add() is DST-safe; `+ MS_PER_DAY` is not.
        cursor.add(1, 'day');
    }

    return dates;
}

// ============================================================================
// Expansion: materialise and prune occurrence documents
// ============================================================================

/**
 * Fields an occurrence inherits from its template. Everything else (completion state,
 * scheduling state, series bookkeeping) is per-occurrence.
 */
const INHERITED_FIELDS = [
    'title',
    'notes',
    'duration',
    'breakUpTask',
    'breakUpTaskChunkDuration',
    'priority',
    'dependsOn',
];

/**
 * Materialise occurrences for every recurring series belonging to a user, and prune the
 * ones that no longer belong.
 *
 * Idempotent: keyed on (seriesRef, occurrenceDate), so running it twice is a no-op.
 * Completed occurrences are never pruned and never regenerated — they are the user's
 * completion history.
 */
async function expandRecurrences(user, horizonDays) {
    const today = moment().startOf('day');
    const horizonEnd = today.clone().add(horizonDays, 'days');

    // Any task carrying a rule is a series template. Legacy `repeat` strings are promoted
    // on the fly so old data starts behaving without a migration.
    const templates = await TaskDetails.find({
        userRef: user._id,
        $or: [
            { 'recurrence.freq': { $in: FREQUENCIES } },
            { repeat: { $in: FREQUENCIES } },
        ],
    });

    for (const template of templates) {
        const rule = effectiveRule(template);
        if (!rule) continue;

        // Promote: this task holds a rule, so it is a template, not a work item.
        if (!template.isSeriesTemplate || !template.recurrence || !template.recurrence.freq) {
            template.isSeriesTemplate = true;
            template.recurrence = rule;
            template.scheduledDate = null;
            await template.save();
        }

        await expandSeries(template, rule, today, horizonEnd);
    }

    // Drop past incomplete occurrences across all series: recurring chores never pile up.
    await TaskDetails.deleteMany({
        userRef: user._id,
        seriesRef: { $ne: null },
        occurrenceDate: { $lt: today.toDate() },
        $or: [{ completed: false }, { completed: null }],
    });
}

/** Materialise one series' occurrences and prune its stale future ones. */
async function expandSeries(template, rule, today, horizonEnd) {
    const anchor = template.startDate || template.occurrenceDate || today.toDate();

    // Generate from today rather than the anchor: past occurrences are pruned anyway.
    const from = moment.max(today.clone(), startOfLocalDay(anchor));
    const dates = occurrenceDatesBetween(rule, from.toDate(), horizonEnd.toDate(), anchor);
    const wanted = dates.map((d) => startOfLocalDay(d).toDate());
    const wantedTimes = new Set(wanted.map((d) => d.getTime()));

    // Everything this series already has from today onwards.
    const existing = await TaskDetails.find({
        userRef: template.userRef,
        seriesRef: template._id,
        occurrenceDate: { $gte: today.toDate() },
    });

    // Drop future occurrences the rule no longer produces (e.g. after an edit). Completed
    // ones are untouched: they are history, not a projection of the current rule.
    const staleIds = existing
        .filter((t) => !t.completed && !wantedTimes.has(t.occurrenceDate.getTime()))
        .map((t) => t._id);

    if (staleIds.length > 0) {
        await TaskDetails.deleteMany({ _id: { $in: staleIds } });
    }

    // Surviving documents keep their identity, which is what makes a re-run a no-op.
    const staleSet = new Set(staleIds.map((id) => id.toString()));
    const taken = new Set(
        existing
            .filter((t) => !staleSet.has(t._id.toString()))
            .map((t) => t.occurrenceDate.getTime())
    );

    const inherited = {};
    for (const field of INHERITED_FIELDS) {
        inherited[field] = template[field];
    }

    const toCreate = wanted
        .filter((date) => !taken.has(date.getTime()))
        .map((date) => ({
            ...inherited,
            userRef: template.userRef,
            seriesRef: template._id,
            occurrenceDate: date,
            // Due at the end of its own day, which is what drives scheduling priority.
            dueDate: moment(date).endOf('day').toDate(),
            startDate: date,
            completed: false,
            completedDate: null,
            scheduledDate: null,
            isBacklog: false,
            isSeriesTemplate: false,
            recurrence: null,
            repeat: null,
        }));

    if (toCreate.length > 0) {
        await TaskDetails.insertMany(toCreate);
    }
}

module.exports = {
    FREQUENCIES,
    WEEKDAY_NAMES,
    MAX_OCCURRENCES_PER_SERIES,
    validateRecurrence,
    normaliseRecurrence,
    normaliseLegacyRepeat,
    effectiveRule,
    describeRecurrence,
    occurrenceDatesBetween,
    expandRecurrences,
};
