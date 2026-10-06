import { calendarDayDifference } from "./temporal";

/**
 * Intentions: personal work that is never scheduled. See docs/INTENTIONS.md.
 *
 * `isIntention` is derived on the server from the task's role and sent on every task, so
 * the client only ever reads it. All the derived view logic lives here, used by the Weekly
 * Plan band, the last-week review, and the Calendar sidebar.
 */

// Day index within the Monday-Sunday week at which the band opens itself.
const NUDGE_FROM_DAY = 4;

export function isIntention(task) {
  return !!task?.isIntention;
}

// Intentions whose due date falls inside the given Monday-Sunday week.
export function intentionsForWeek(tasks = [], week) {
  if (!week?.startDate || !week?.endDate) return [];
  return tasks.filter(
    (task) =>
      isIntention(task) &&
      task.dueDate &&
      task.dueDate >= week.startDate &&
      task.dueDate <= week.endDate
  );
}

export function intentionSummary(intentions = []) {
  const done = intentions.filter((task) => task.completed).length;
  const minutes = intentions.reduce(
    (total, task) => total + (Number(task.duration) || 0),
    0
  );
  const openMinutes = intentions
    .filter((task) => !task.completed)
    .reduce((total, task) => total + (Number(task.duration) || 0), 0);

  return {
    done,
    total: intentions.length,
    minutes,
    openMinutes,
    percent: intentions.length
      ? Math.round((done / intentions.length) * 100)
      : 0,
  };
}

/**
 * How loud the band should be, from the weekday alone.
 *
 * Quiet for most of the week and open from Friday, so the reminder arrives when the week
 * is running out rather than every time the page is opened.
 */
export function intentionUrgency(today, week) {
  if (!today || !week?.startDate) return "quiet";
  const offset = calendarDayDifference(today, week.startDate);
  if (!Number.isFinite(offset) || offset < 0) return "quiet";
  return offset >= NUDGE_FROM_DAY ? "nudge" : "quiet";
}

export function intentionHeadline(urgency, summary) {
  if (!summary.total) return "Nothing beyond work this week";
  if (urgency === "nudge") {
    return summary.done === summary.total
      ? "Everything beyond work is done"
      : "The week is nearly up";
  }
  return "Beyond work this week";
}

export default {
  isIntention,
  intentionsForWeek,
  intentionSummary,
  intentionUrgency,
  intentionHeadline,
};
