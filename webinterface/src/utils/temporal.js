const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function localDateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

export function dateOnlyInTimeZone(timeZone, value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function apiDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (DATE_ONLY_RE.test(text)) return text;
  const isoDate = text.slice(0, 10);
  return DATE_ONLY_RE.test(isoDate) ? isoDate : "";
}

export function addCalendarDays(value, days) {
  const source = apiDateOnly(value) || localDateOnly(value);
  if (!source) return "";
  const [year, month, day] = source.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateOnly(date);
}

export function mondayWeekBounds(value) {
  const source = apiDateOnly(value) || localDateOnly(value);
  if (!source) return null;
  const [year, month, day] = source.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const startDate = addCalendarDays(source, -daysSinceMonday);
  const nextStartDate = addCalendarDays(startDate, 7);

  return {
    startDate,
    endDate: addCalendarDays(nextStartDate, -1),
    nextStartDate,
  };
}

export function calendarDayDifference(left, right) {
  const parse = (value) => {
    const text = String(value || "");
    const input = DATE_ONLY_RE.test(text) ? text : localDateOnly(new Date(value));
    if (!input) return null;
    const [year, month, day] = input.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const a = parse(left);
  const b = parse(right);
  return a === null || b === null ? null : Math.round((a - b) / 86400000);
}

// DayPilot displays ISO fields as timezone-neutral wall time. Convert an instant's browser
// clock fields deliberately instead of passing an ISO instant that DayPilot would show as UTC.
export function instantToDayPilotWall(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateOnly(date)}T${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

export function dayPilotWallToIso(value) {
  const wall = value && typeof value.toString === "function" ? value.toString() : String(value);
  const date = new Date(wall);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function instantPartsInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "UTC",
    weekday: "long",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return {
    weekday: part("weekday"),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export function formatCivilDate(value, options, locale) {
  const dateOnly = apiDateOnly(value);
  if (!dateOnly) return "";
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, options).format(new Date(year, month - 1, day));
}
