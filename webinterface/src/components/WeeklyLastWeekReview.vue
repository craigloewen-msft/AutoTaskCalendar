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

      <!-- Only work with no project below to sit under. Everything else reads inline,
           beneath its own project. -->
      <p v-if="!groups.length" class="lw-pointer" data-test="last-week-all-inline">
        Every task from last week is shown under its own project below.
      </p>

      <WeeklyLastWeekProject
        v-for="group in groups"
        :key="group.key"
        :project-id="group.key"
        :label="group.title"
        :badge="group.badge"
        :items="group.items"
        :unplanned="group.unplanned"
        :tasks-by-id="tasksById"
        :week="week"
        :previous-week-start="plan?.weekStart || ''"
        :today="today"
        :busy="busy"
        @carry="(entries) => $emit('carry', entries)"
      />
    </div>
  </section>
</template>

<script>
import WeeklyLastWeekProject from "./WeeklyLastWeekProject.vue";
import { lastWeekRows } from "../utils/lastWeek";

/**
 * Last week at week level. See docs/WEEKLY_PLAN.md.
 *
 * The headline and bar answer "how did last week go" for the whole week; the body lists
 * only the work whose project is not rendered below -- ended, deleted, or absent -- so the
 * same task is never shown twice.
 */
export default {
  name: "WeeklyLastWeekReview",
  components: { WeeklyLastWeekProject },
  mixins: [lastWeekRows],
  props: {
    plan: { type: Object, default: null },
    unplanned: { type: Array, default: () => [] },
    groups: { type: Array, default: () => [] },
    tasksById: { type: Object, default: () => ({}) },
    rangeLabel: { type: String, default: "" },
    week: { type: Object, required: true },
    today: { type: String, default: "" },
    open: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" },
  },
  emits: ["carry", "toggle"],
  computed: {
    items() {
      return this.plan?.items || [];
    },
    hasCommitment() {
      return this.items.length > 0;
    },
    kept() {
      return this.items.filter((item) => item.status === "done");
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
  },
  methods: {
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

.lw-pointer {
  margin: 0;
  color: #8b949e;
  font-size: 0.82rem;
}
</style>
