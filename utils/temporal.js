'use strict';

const moment = require('moment-timezone');

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME_RE = /^(\d{2}):(\d{2})$/;
const TEMPORAL_DATA_VERSION = 1;
const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_WORKING_START_MINUTES = 9 * 60;
const DEFAULT_WORKING_END_MINUTES = 17 * 60;

function isValidTimeZone(value) {
    return typeof value === 'string' && value.length > 0 && !!moment.tz.zone(value);
}

function normaliseTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
    return isValidTimeZone(value) ? value : fallback;
}

function parseDateOnly(value) {
    if (value === undefined || value === null || value === '') {
        return { provided: false, valid: true, value: null, date: null };
    }

    if (value instanceof Date && Number.isNaN(value.getTime())) {
        return { provided: true, valid: false, value: null, date: null };
    }
    const input = value instanceof Date ? dateOnlyFromMarker(value) : String(value);
    const match = DATE_ONLY_RE.exec(input);
    if (!match) {
        return { provided: true, valid: false, value: null, date: null };
    }

    const parsed = moment.utc(input, 'YYYY-MM-DD', true);
    if (!parsed.isValid()) {
        return { provided: true, valid: false, value: null, date: null };
    }

    return {
        provided: true,
        valid: true,
        value: parsed.format('YYYY-MM-DD'),
        date: parsed.startOf('day').toDate(),
    };
}

function dateOnlyFromMarker(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return moment.utc(date).format('YYYY-MM-DD');
}

function addDateOnlyDays(value, days) {
    const parsed = parseDateOnly(value);
    if (!parsed.valid || !parsed.value) return null;
    return moment.utc(parsed.value, 'YYYY-MM-DD', true).add(days, 'days').format('YYYY-MM-DD');
}

function dateOnlyDay(value) {
    const parsed = parseDateOnly(value);
    return parsed.valid && parsed.value
        ? moment.utc(parsed.value, 'YYYY-MM-DD', true).day()
        : null;
}

function compareDateOnly(left, right) {
    const a = parseDateOnly(left);
    const b = parseDateOnly(right);
    if (!a.valid || !a.value || !b.valid || !b.value) return null;
    return a.value.localeCompare(b.value);
}

function parseInstant(value) {
    if (value === undefined || value === null || value === '') {
        return { provided: false, valid: true, date: null };
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? { provided: true, valid: false, date: null }
            : { provided: true, valid: true, date: new Date(value) };
    }

    const input = String(value);
    const hasExplicitZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(input);
    if (DATE_ONLY_RE.test(input) || !hasExplicitZone) {
        return { provided: true, valid: false, date: null };
    }

    const parsed = moment.parseZone(input, moment.ISO_8601, true);
    if (!parsed.isValid()) {
        return { provided: true, valid: false, date: null };
    }

    return { provided: true, valid: true, date: parsed.toDate() };
}

function parseWallTime(value) {
    if (typeof value !== 'string') {
        return { valid: false, minutes: null, value: null };
    }

    const match = WALL_TIME_RE.exec(value);
    if (!match) {
        return { valid: false, minutes: null, value: null };
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
        return { valid: false, minutes: null, value: null };
    }

    return { valid: true, minutes: hours * 60 + minutes, value };
}

function wallTimeFromMinutes(value) {
    if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) return null;
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function zonedDateTime(dateOnly, minutes, timeZone) {
    const parsed = parseDateOnly(dateOnly);
    if (!parsed.valid || !parsed.value || !Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
        return null;
    }

    const zone = normaliseTimeZone(timeZone);
    const hours = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const result = moment.tz(
        `${parsed.value} ${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        'YYYY-MM-DD HH:mm',
        true,
        zone
    );

    return result.isValid() ? result.toDate() : null;
}

function dateOnlyInZone(value, timeZone) {
    if (!value) return null;
    const parsed = value instanceof Date ? moment(value) : moment.parseZone(value, moment.ISO_8601, true);
    if (!parsed.isValid()) return null;
    return parsed.tz(normaliseTimeZone(timeZone)).format('YYYY-MM-DD');
}

function startOfDateInZone(dateOnly, timeZone) {
    return zonedDateTime(dateOnly, 0, timeZone);
}

function nextDateStartInZone(dateOnly, timeZone) {
    const next = addDateOnlyDays(dateOnly, 1);
    return next ? startOfDateInZone(next, timeZone) : null;
}

function endOfDateInZone(dateOnly, timeZone) {
    const next = nextDateStartInZone(dateOnly, timeZone);
    return next ? new Date(next.getTime() - 1) : null;
}

function todayInZone(timeZone, now = new Date()) {
    return moment(now).tz(normaliseTimeZone(timeZone)).format('YYYY-MM-DD');
}

function localWeekBounds(value, timeZone, weekStartsOn = 0) {
    const zone = normaliseTimeZone(timeZone);
    const anchorDate = typeof value === 'string' && DATE_ONLY_RE.test(value)
        ? value
        : dateOnlyInZone(value, zone);
    const parsed = parseDateOnly(anchorDate);
    if (!parsed.valid || !parsed.value || !Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
        return null;
    }

    const day = dateOnlyDay(parsed.value);
    const daysSinceStart = (day - weekStartsOn + 7) % 7;
    const startDate = addDateOnlyDays(parsed.value, -daysSinceStart);
    const nextStartDate = addDateOnlyDays(startDate, 7);
    return {
        startDate,
        endDate: addDateOnlyDays(nextStartDate, -1),
        nextStartDate,
        start: startOfDateInZone(startDate, zone),
        end: startOfDateInZone(nextStartDate, zone),
    };
}

function mondayWeekBounds(value, timeZone) {
    return localWeekBounds(value, timeZone, 1);
}

function taskEligibleInstant(value, timeZone) {
    const dateOnly = typeof value === 'string' && DATE_ONLY_RE.test(value)
        ? value
        : dateOnlyFromMarker(value);
    return dateOnly ? startOfDateInZone(dateOnly, timeZone) : null;
}

function sameWallTimeNextDay(value, timeZone) {
    const zone = normaliseTimeZone(timeZone);
    const current = moment(value).tz(zone);
    if (!current.isValid()) return null;

    const nextDate = addDateOnlyDays(current.format('YYYY-MM-DD'), 1);
    const wallTime = current.format('HH:mm:ss.SSS');
    const next = moment.tz(
        `${nextDate} ${wallTime}`,
        'YYYY-MM-DD HH:mm:ss.SSS',
        true,
        zone
    );
    return next.isValid() ? next.toDate() : null;
}

function legacyWorkingMinutes(user, timeZone) {
    const zone = normaliseTimeZone(timeZone);
    if (!(user.workingStartTime instanceof Date) || Number.isNaN(user.workingStartTime.getTime())) {
        return {
            start: DEFAULT_WORKING_START_MINUTES,
            end: DEFAULT_WORKING_END_MINUTES,
        };
    }

    const startMoment = moment(user.workingStartTime).tz(zone);
    const start = startMoment.hour() * 60 + startMoment.minute();
    const duration = Number.isFinite(user.workingDuration) ? user.workingDuration * 60 : 8 * 60;
    const end = Math.min(start + Math.round(duration), 24 * 60 - 1);
    return { start, end };
}

module.exports = {
    TEMPORAL_DATA_VERSION,
    DEFAULT_TIME_ZONE,
    DEFAULT_WORKING_START_MINUTES,
    DEFAULT_WORKING_END_MINUTES,
    isValidTimeZone,
    normaliseTimeZone,
    parseDateOnly,
    dateOnlyFromMarker,
    addDateOnlyDays,
    dateOnlyDay,
    compareDateOnly,
    parseInstant,
    parseWallTime,
    wallTimeFromMinutes,
    zonedDateTime,
    dateOnlyInZone,
    startOfDateInZone,
    nextDateStartInZone,
    endOfDateInZone,
    todayInZone,
    localWeekBounds,
    mondayWeekBounds,
    taskEligibleInstant,
    sameWallTimeNextDay,
    legacyWorkingMinutes,
};
