/**
 * Recurrence helpers for the UI.
 *
 * `describeRecurrence` mirrors the same function in controllers/recurrence.js: the summary
 * the user reads must match what the API stores. Change one, change both.
 */

import { apiDateOnly, dateOnlyInTimeZone, formatCivilDate } from './temporal';

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

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

function formatDate(value) {
  return formatCivilDate(
    value,
    { day: 'numeric', month: 'short', year: 'numeric' },
    'en-GB'
  );
}

/** Render a rule as a sentence, e.g. "Every week on Monday and Tuesday". */
export function describeRecurrence(rule) {
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
    text += `, until ${formatDate(rule.endsOn)}`;
  } else if (rule.endsAfter) {
    text += `, ${rule.endsAfter} times`;
  }

  return text;
}

/** A blank rule for a given frequency, used when the user first picks one. */
export function emptyRule(freq) {
  return {
    freq,
    interval: 1,
    byWeekday: freq === 'weekly' ? [new Date().getDay()] : [],
    byMonthDay: [],
    endsOn: null,
    endsAfter: null,
    whenUnschedulableBehavior: 'skip',
  };
}

/** "Fri 23 Oct": the short civil-date form used for occurrence identity. */
export function occurrenceLabel(dateOnly) {
  return formatCivilDate(dateOnly, { weekday: 'short', day: 'numeric', month: 'short' }, 'en-GB');
}

/**
 * The occurrence date when it differs from the day the task was scheduled, else null.
 * Tells you that a task under Tuesday is really the previous Friday's occurrence.
 */
export function movedOccurrenceDate(task, timeZone) {
  const occurrence = apiDateOnly(task?.occurrenceDate);
  if (!occurrence || !task?.scheduledDate) return null;
  const scheduledDay = dateOnlyInTimeZone(timeZone, task.scheduledDate);
  return scheduledDay && scheduledDay !== occurrence ? occurrence : null;
}

/** True when completing this occurrence now would be before its own day. */
export function isEarlyOccurrence(task, timeZone, now = new Date()) {
  const occurrence = apiDateOnly(task?.occurrenceDate);
  if (!occurrence || !task?.seriesRef) return false;
  return dateOnlyInTimeZone(timeZone, now) < occurrence;
}
