<template>
  <section class="last-week" data-test="previous-week-recap" :class="{ collapsed: !open }">
    <header class="lw-head">
      <div class="lw-identity">
        <p class="eyebrow">Last week · {{ rangeLabel }}</p>
        <h2 class="lw-headline" data-test="last-week-headline">{{ headline }}</h2>
        <p v-if="hasCommitment" class="lw-subline">
          {{ formatDuration(keptMinutes) }} of {{ formatDuration(totalMinutes) }} promised
        </p>
      </div>
      <button
        class="lw-toggle"
        type="button"
        data-test="last-week-toggle"
        :aria-expanded="open ? 'true' : 'false'"
        @click="$emit('toggle')"
      >
        {{ open ? "Hide" : "Show" }}
      </button>
    </header>

    <div
      v-if="hasCommitment"
      class="lw-bar"
      role="progressbar"
      :aria-valuenow="keptPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${kept.length} of ${items.length} promises kept last week`"
    >
      <span class="lw-fill" :style="{ width: `${keptPercent}%` }"></span>
    </div>

    <div v-if="open" class="lw-body">
      <p v-if="error" class="lw-error" role="alert" data-test="carry-error">{{ error }}</p>

      <!-- Unfinished leads: it is the only part of last week you can still act on. -->
      <section v-if="unfinished.length" class="lw-block" data-test="last-week-unfinished">
        <div class="block-head">
          <h3>Unfinished · {{ unfinished.length }}</h3>
          <button
            v-if="carryable.length"
            class="carry-all"
            type="button"
            :disabled="busy"
            data-test="carry-all"
            @click="$emit('carry', carryable.map(entryFor))"
          >
            {{ busy ? "Carrying…" : `Carry ${carryable.length} into this week` }}
          </button>
        </div>

        <div v-for="group in unfinishedGroups" :key="group.key" class="lw-group">
          <p v-if="showGroupTitles" class="group-title">{{ group.title }}</p>
          <ul class="lw-list">
            <li
              v-for="item in group.items"
              :key="item.taskRef"
              class="lw-row"
              :class="`is-${item.status}`"
              :data-status="item.status"
              :data-test="`last-week-item-${item.taskRef}`"
            >
              <span class="lw-title">
                <span class="status-glyph" aria-hidden="true">{{ glyph(item.status) }}</span>
                <span class="title-text">{{ item.title }}</span>
              </span>
              <span class="lw-meta">{{ unfinishedLabel(item) }}</span>
              <button
                v-if="canCarry(item)"
                class="carry"
                type="button"
                :disabled="busy"
                :data-test="`carry-${item.taskRef}`"
                :title="`Carry to ${civilDay(carryDate(item))}`"
                @click="$emit('carry', [entryFor(item)])"
              >
                Carry → {{ shortDay(carryDate(item)) }}
              </button>
              <span v-else class="carry-placeholder" aria-hidden="true"></span>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="kept.length" class="lw-block" data-test="last-week-kept">
        <div class="block-head">
          <h3>Kept · {{ kept.length }}</h3>
        </div>
        <ul class="lw-list">
          <li
            v-for="item in kept"
            :key="item.taskRef"
            class="lw-row is-done"
            data-status="done"
            :data-test="`last-week-item-${item.taskRef}`"
          >
            <span class="lw-title">
              <span class="status-glyph" aria-hidden="true">✓</span>
              <span class="title-text">{{ item.title }}</span>
            </span>
            <span class="lw-meta">{{ keptLabel(item) }}</span>
            <span class="carry-placeholder" aria-hidden="true"></span>
          </li>
        </ul>
      </section>

      <!-- Unplanned work is usually the reason the promises slipped, so it is part of the
           story rather than a separate statistic. -->
      <section v-if="unplanned.length" class="lw-block" data-test="last-week-unplanned">
        <div class="block-head">
          <h3>Also finished, never promised · {{ unplanned.length }}</h3>
        </div>
        <ul class="lw-list">
          <li
            v-for="task in visibleUnplanned"
            :key="task._id"
            class="lw-row is-unplanned"
            :data-test="`last-week-unplanned-${task._id}`"
          >
            <span class="lw-title">
              <span class="status-glyph" aria-hidden="true">+</span>
              <span class="title-text">{{ task.title }}</span>
            </span>
            <span class="lw-meta">{{ completionLabel(task) }}</span>
            <span class="carry-placeholder" aria-hidden="true"></span>
          </li>
        </ul>
        <button
          v-if="hiddenUnplannedCount"
          class="show-rest"
          type="button"
          data-test="show-all-unplanned"
          @click="showAllUnplanned = true"
        >
          + {{ hiddenUnplannedCount }} more finished last week
        </button>
      </section>
    </div>
  </section>
</template>

<script>
import { addCalendarDays, calendarDayDifference, formatCivilDate } from "../utils/temporal";

// How many unplanned completions to show before folding the rest away.
const UNPLANNED_PREVIEW = 4;

/**
 * Last week, read as a review rather than a tally. See docs/WEEKLY_PLAN.md.
 *
 * Presentation only: statuses come from the server-resolved plan snapshot, and every action
 * is emitted. Carrying work forward never rewrites last week's promise -- it only moves the
 * live task, which then resolves as `moved`.
 */
export default {
  name: "WeeklyLastWeekReview",
  props: {
    plan: { type: Object, default: null },
    unplanned: { type: Array, default: () => [] },
    projectTitles: { type: Object, default: () => ({}) },
    tasksById: { type: Object, default: () => ({}) },
    rangeLabel: { type: String, default: "" },
    week: { type: Object, required: true },
    today: { type: String, default: "" },
    open: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" },
  },
  emits: ["carry", "toggle"],
  data() {
    return { showAllUnplanned: false };
  },
  computed: {
    // Unplanned work is context, not a to-do list: a long tail of it would bury the two
    // blocks that can actually be acted on.
    visibleUnplanned() {
      return this.showAllUnplanned ? this.unplanned : this.unplanned.slice(0, UNPLANNED_PREVIEW);
    },
    hiddenUnplannedCount() {
      return this.unplanned.length - this.visibleUnplanned.length;
    },
    items() {
      return this.plan?.items || [];
    },
    hasCommitment() {
      return this.items.length > 0;
    },
    kept() {
      return this.items.filter((item) => item.status === "done");
    },
    unfinished() {
      return this.items.filter((item) => item.status !== "done");
    },
    keptMinutes() {
      return this.kept.reduce((total, item) => total + (Number(item.duration) || 0), 0);
    },
    totalMinutes() {
      return this.items.reduce((total, item) => total + (Number(item.duration) || 0), 0);
    },
    keptPercent() {
      if (!this.items.length) return 0;
      return Math.round((this.kept.length / this.items.length) * 100);
    },
    // One sentence in promises, not a dashboard.
    headline() {
      if (!this.hasCommitment) {
        const count = this.unplanned.length;
        if (!count) return "Nothing was committed last week.";
        return `No commitment last week. You finished ${count} ${this.taskNoun(count)} anyway.`;
      }
      return `You kept ${this.kept.length} of ${this.items.length} ${this.promiseNoun(this.items.length)}`;
    },
    carryable() {
      return this.unfinished.filter((item) => this.canCarry(item));
    },
    unfinishedGroups() {
      const groups = new Map();
      for (const item of this.unfinished) {
        const key = item.projectRef || "";
        if (!groups.has(key)) {
          groups.set(key, {
            key: key || "none",
            title: this.projectTitles[key] || "No project",
            items: [],
          });
        }
        groups.get(key).items.push(item);
      }
      return [...groups.values()];
    },
    // A single project needs no header: the panel is already about one week of work.
    showGroupTitles() {
      return this.unfinishedGroups.length > 1;
    },
  },
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
      const offset = calendarDayDifference(item.dueDate, this.plan?.weekStart);
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
    promiseNoun(count) {
      return count === 1 ? "promise" : "promises";
    },
  },
};
</script>

<style scoped>
.last-week {
  margin-bottom: 20px;
  padding: 16px 18px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-left: 3px solid rgba(141, 162, 251, 0.6);
  border-radius: 12px;
  background: rgba(22, 27, 34, 0.72);
}

.lw-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  margin: 0 0 3px;
  color: #8b949e;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.lw-headline {
  margin: 0;
  color: #e6edf3;
  font-size: 1.02rem;
  font-weight: 600;
}

.lw-subline {
  margin: 3px 0 0;
  color: #8b949e;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.lw-toggle {
  flex: 0 0 auto;
  padding: 4px 12px;
  border: 1px solid rgba(141, 162, 251, 0.35);
  border-radius: 999px;
  background: transparent;
  color: #8da2fb;
  font-size: 0.74rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.lw-toggle:hover,
.lw-toggle:focus-visible {
  outline: none;
  background: rgba(102, 126, 234, 0.14);
}

.lw-bar {
  overflow: hidden;
  height: 5px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
}

.lw-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6ee7b7, #34d399);
  transition: width 0.35s ease;
}

.lw-body {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.lw-error {
  margin: 0;
  padding: 8px 12px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  color: #fca5a5;
  font-size: 0.8rem;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
}

.block-head h3 {
  margin: 0;
  color: #8b949e;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.carry-all {
  padding: 3px 11px;
  border: 1px solid rgba(141, 162, 251, 0.45);
  border-radius: 999px;
  background: rgba(102, 126, 234, 0.12);
  color: #aab8fc;
  font-size: 0.72rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.carry-all:hover:not(:disabled),
.carry-all:focus-visible {
  outline: none;
  background: rgba(102, 126, 234, 0.24);
}

.carry-all:disabled {
  opacity: 0.6;
  cursor: default;
}

.group-title {
  margin: 8px 0 4px;
  color: #a8b4c0;
  font-size: 0.78rem;
  font-weight: 600;
}

.lw-list {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.lw-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  color: #c3ccd6;
  font-size: 0.84rem;
}

.lw-title {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: baseline;
  gap: 8px;
}

.title-text {
  overflow-wrap: anywhere;
}

.status-glyph {
  flex: 0 0 auto;
  width: 12px;
  color: #8b949e;
  text-align: center;
}

.lw-meta {
  flex: 0 0 auto;
  color: #8b949e;
  font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.carry,
.carry-placeholder {
  flex: 0 0 auto;
  width: 92px;
  text-align: right;
}

.carry {
  padding: 2px 9px;
  border: 1px solid rgba(141, 162, 251, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #8da2fb;
  font-size: 0.71rem;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease;
}

.carry:hover:not(:disabled),
.carry:focus-visible {
  outline: none;
  background: rgba(102, 126, 234, 0.16);
}

.carry:disabled {
  opacity: 0.55;
  cursor: default;
}

.show-rest {
  margin-top: 5px;
  padding: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #8da2fb;
  font-size: 0.76rem;
  cursor: pointer;
}

.show-rest:hover,
.show-rest:focus-visible {
  outline: none;
  text-decoration: underline;
}

.is-done .status-glyph {
  color: #6ee7b7;
}

.is-done .title-text {
  color: #93a49c;
}

.is-moved .status-glyph {
  color: #fbbf24;
}

.is-removed .status-glyph {
  color: #f87171;
}

.is-removed .title-text {
  color: #8b949e;
  text-decoration: line-through;
}

.is-unplanned .status-glyph {
  color: #8da2fb;
}

@media (max-width: 620px) {
  .lw-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .lw-meta,
  .carry {
    margin-left: 20px;
  }

  .carry,
  .carry-placeholder {
    width: auto;
  }

  .carry-placeholder {
    display: none;
  }
}
</style>
