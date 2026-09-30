import { addCalendarDays, calendarDayDifference, formatCivilDate } from "./temporal";

/**
 * Shared row logic for last week's review. See docs/WEEKLY_PLAN.md.
 *
 * The same rows appear twice -- inline under each project, and at the top for work whose
 * project is gone -- so the labels and carry rules live here rather than in both.
 *
 * A component using this mixin must provide `tasksById`, `week`, `today`, and
 * `previousWeekStart`.
 */
export const lastWeekRows = {
  methods: {
    liveTask(item) {
      return this.tasksById[item.taskRef] || null;
    },
    // Only live, unfinished, non-repeating work can be moved into this week.
    canCarry(item) {
      if (item.status === "removed") return false;
      if (item.seriesRef) return false;
      const task = this.liveTask(item);
      if (!task || task.completed || task.seriesRef) return false;
      return !this.alreadyInWeek(item);
    },
    alreadyInWeek(item) {
      const live = item.liveDueDate;
      return !!live && live >= this.week.startDate && live <= this.week.endDate;
    },
    /**
     * The same weekday in this week, or today when that day has already gone.
     *
     * Keeps the intent of "Friday work" without ever carrying something into a day that is
     * already in the past.
     */
    carryDate(item) {
      const offset = calendarDayDifference(item.dueDate, this.previousWeekStart);
      const index = Math.min(Math.max(Number.isFinite(offset) ? offset : 0, 0), 6);
      const target = addCalendarDays(this.week.startDate, index);
      return this.today && target < this.today ? this.today : target;
    },
    entryFor(item) {
      return { taskId: item.taskRef, dueDate: this.carryDate(item) };
    },
    unfinishedLabel(item) {
      if (item.status === "removed") return "deleted after committing";
      if (item.seriesRef) return "repeats — next occurrence stands";
      if (this.alreadyInWeek(item)) return "already in this week";
      if (item.status === "moved") {
        return item.liveDueDate ? `now due ${this.civilDay(item.liveDueDate)}` : "moved";
      }
      return `was due ${this.shortDay(item.dueDate)} · ${this.formatDuration(item.duration)}`;
    },
    keptLabel(item) {
      const day = item.completedDate ? this.instantDay(item.completedDate) : "";
      const duration = this.formatDuration(item.duration);
      return day ? `finished ${day} · ${duration}` : `finished · ${duration}`;
    },
    completionLabel(task) {
      const day = this.instantDay(task.completedDate);
      return day ? `finished ${day}` : "finished";
    },
    glyph(status) {
      return { done: "✓", moved: "↷", removed: "✗" }[status] || "●";
    },
    civilDay(value) {
      return formatCivilDate(value, { weekday: "short", month: "short", day: "numeric" });
    },
    shortDay(value) {
      return formatCivilDate(value, { weekday: "short" });
    },
    instantDay(instant) {
      const date = new Date(instant);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    },
    formatDuration(minutes) {
      const safe = Math.max(0, Math.round(Number(minutes) || 0));
      const hours = Math.floor(safe / 60);
      const remainder = safe % 60;
      if (!hours) return `${remainder}m`;
      return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
    },
    taskNoun(count) {
      return count === 1 ? "task" : "tasks";
    },
  },
};

export default lastWeekRows;
