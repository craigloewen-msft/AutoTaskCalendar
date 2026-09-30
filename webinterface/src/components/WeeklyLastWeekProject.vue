<template>
  <section
    class="lw-project"
    :class="{ collapsed: !isOpen }"
    :data-test="`last-week-project-${projectId}`"
  >
    <button
      class="lw-summary"
      type="button"
      :aria-expanded="isOpen ? 'true' : 'false'"
      :data-test="`last-week-project-toggle-${projectId}`"
      @click="toggle"
    >
      <span class="lw-caret" aria-hidden="true">{{ isOpen ? "▾" : "▸" }}</span>
      <span class="lw-label">
        <span v-if="label" class="lw-name">{{ label }}</span>
        <span v-else class="lw-name">Last week</span>
        <span v-if="badge" class="lw-badge">{{ badge }}</span>
      </span>
      <span class="lw-counts">{{ summaryLabel }}</span>
    </button>

    <div v-if="isOpen" class="lw-rows">
      <div v-if="carryable.length" class="lw-actions">
        <button
          class="carry-all"
          type="button"
          :disabled="busy"
          :data-test="`carry-all-${projectId}`"
          @click="$emit('carry', carryable.map(entryFor))"
        >
          {{ busy ? "Carrying…" : `Carry ${carryable.length} into this week` }}
        </button>
      </div>

      <ul class="lw-list">
        <li
          v-for="item in unfinished"
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
          <span class="lw-meta">{{ completionLabel(task) }} · never promised</span>
          <span class="carry-placeholder" aria-hidden="true"></span>
        </li>
      </ul>

      <button
        v-if="hiddenUnplannedCount"
        class="show-rest"
        type="button"
        :data-test="`show-all-unplanned-${projectId}`"
        @click="showAllUnplanned = true"
      >
        + {{ hiddenUnplannedCount }} more finished last week
      </button>
    </div>
  </section>
</template>

<script>
import { lastWeekRows } from "../utils/lastWeek";

// How many unplanned completions to show before folding the rest away.
const UNPLANNED_PREVIEW = 4;

/**
 * One project's last week: unfinished first, then kept, then unplanned completions.
 *
 * Presentation only -- statuses are resolved by the server and carrying is emitted.
 * Used inline inside a project card and, with a label, for work whose project is gone.
 */
export default {
  name: "WeeklyLastWeekProject",
  mixins: [lastWeekRows],
  props: {
    projectId: { type: String, default: "none" },
    label: { type: String, default: "" },
    badge: { type: String, default: "" },
    items: { type: Array, default: () => [] },
    unplanned: { type: Array, default: () => [] },
    tasksById: { type: Object, default: () => ({}) },
    week: { type: Object, required: true },
    previousWeekStart: { type: String, default: "" },
    today: { type: String, default: "" },
    busy: { type: Boolean, default: false },
    open: { type: Boolean, default: true },
  },
  emits: ["carry", "toggle"],
  data() {
    return { openOverride: null, showAllUnplanned: false };
  },
  computed: {
    isOpen() {
      return this.openOverride === null ? this.open : this.openOverride;
    },
    kept() {
      return this.items.filter((item) => item.status === "done");
    },
    unfinished() {
      return this.items.filter((item) => item.status !== "done");
    },
    carryable() {
      return this.unfinished.filter((item) => this.canCarry(item));
    },
    // Unplanned work is context, not a to-do list: a long tail would bury what can be acted on.
    visibleUnplanned() {
      return this.showAllUnplanned ? this.unplanned : this.unplanned.slice(0, UNPLANNED_PREVIEW);
    },
    hiddenUnplannedCount() {
      return this.unplanned.length - this.visibleUnplanned.length;
    },
    // Named work rather than a bare number, in the order the rows appear.
    summaryLabel() {
      const parts = [];
      if (this.unfinished.length) parts.push(`${this.unfinished.length} unfinished`);
      if (this.kept.length) parts.push(`${this.kept.length} kept`);
      if (this.unplanned.length) parts.push(`${this.unplanned.length} unplanned`);
      return parts.length ? parts.join(" · ") : "nothing last week";
    },
  },
  watch: {
    // A page-level change of mode re-asserts the default until this block is touched again.
    open() {
      this.openOverride = null;
    },
  },
  methods: {
    toggle() {
      this.openOverride = !this.isOpen;
      this.$emit("toggle");
    },
  },
};
</script>

<style scoped>
.lw-project {
  margin-top: 12px;
  padding: 8px 10px;
  border-left: 2px solid rgba(141, 162, 251, 0.45);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.022);
}

.lw-summary {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #a8b4c0;
  font-size: 0.76rem;
  text-align: left;
  cursor: pointer;
}

.lw-summary:focus-visible {
  outline: 1px solid rgba(141, 162, 251, 0.6);
  outline-offset: 3px;
}

.lw-caret {
  flex: 0 0 auto;
  width: 10px;
  color: #8b949e;
}

.lw-label {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: baseline;
  gap: 8px;
}

.lw-name {
  color: #c3ccd6;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.lw-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.14);
  color: #fbbf24;
  font-size: 0.68rem;
}

.lw-counts {
  flex: 0 0 auto;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.lw-rows {
  margin-top: 7px;
}

.lw-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 5px;
}

.carry-all {
  padding: 3px 11px;
  border: 1px solid rgba(141, 162, 251, 0.45);
  border-radius: 999px;
  background: rgba(102, 126, 234, 0.12);
  color: #aab8fc;
  font-size: 0.72rem;
  cursor: pointer;
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
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  color: #c3ccd6;
  font-size: 0.82rem;
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
  font-size: 0.74rem;
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
