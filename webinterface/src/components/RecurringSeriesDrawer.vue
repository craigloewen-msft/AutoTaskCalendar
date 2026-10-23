<template>
  <!-- Series rules, not work: one row per repeating task. See docs/RECURRING_TASKS.md. -->
  <details v-if="series.length" class="series-group" data-test="calendar-recurring-series">
    <summary>
      <span class="series-group-title">Repeating tasks</span>
      <span class="series-group-count">
        {{ series.length }} {{ series.length === 1 ? "rule" : "rules" }}
      </span>
    </summary>
    <ul class="series-items">
      <li
        v-for="item in series"
        :key="item._id"
        class="series-item"
        :class="{ 'series-item--warn': needsAttention(item) }"
        :data-test="`series-item-${item._id}`"
        role="button"
        tabindex="0"
        @click="$emit('open', item)"
        @keydown.enter.prevent="$emit('open', item)"
      >
        <span class="series-primary">
          <span class="series-title">
            <span class="series-icon" aria-hidden="true">↻</span>{{ item.title }}
          </span>
          <span
            v-if="needsAttention(item)"
            class="series-badge"
            :data-test="`series-unscheduled-${item._id}`"
          >NOT SCHEDULED</span>
          <span
            v-else-if="isSkipped(item)"
            class="series-badge series-badge--quiet"
            title="No slot on its day, and this series skips rather than moving later"
          >SKIPPED</span>
        </span>
        <span class="series-line">
          {{ item.summary }} · {{ item.duration }} min · If no time: {{ behaviourLabel(item) }}
        </span>
        <span class="series-line" :data-test="`series-next-${item._id}`">
          Next: {{ nextLabel(item) }}
        </span>
        <span v-if="item.nextScheduledOccurrence" class="series-line">
          Next placed: {{ placedLabel(item.nextScheduledOccurrence) }}
        </span>
        <span
          v-if="item.lastCompletion"
          class="series-line series-line--quiet"
          :data-test="`series-last-${item._id}`"
        >
          Last done: {{ lastLabel(item) }}
        </span>
      </li>
    </ul>
  </details>
</template>

<script>
import { apiDateOnly, dateOnlyInTimeZone } from "../utils/temporal";
import { occurrenceLabel } from "../utils/recurrence";

export default {
  name: "RecurringSeriesDrawer",
  props: {
    series: { type: Array, default: () => [] },
    timeZone: { type: String, default: "UTC" },
  },
  emits: ["open"],
  methods: {
    behaviourLabel(item) {
      return item.whenUnschedulableBehavior === "next-available" ? "next available" : "skip";
    },
    isNextUnplaced(item) {
      return !!item.nextOccurrence && !item.nextOccurrence.scheduledDate;
    },
    // Only next-available series are meant to always land somewhere; skip is expected.
    needsAttention(item) {
      return this.isNextUnplaced(item) && item.whenUnschedulableBehavior === "next-available";
    },
    isSkipped(item) {
      return this.isNextUnplaced(item) && item.whenUnschedulableBehavior !== "next-available";
    },
    instantLabel(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const day = occurrenceLabel(dateOnlyInTimeZone(this.timeZone, date));
      const time = new Intl.DateTimeFormat("en-US", {
        timeZone: this.timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
      return `${day} ${time}`;
    },
    placedLabel(occurrence) {
      return `${occurrenceLabel(occurrence.occurrenceDate)} → ${this.instantLabel(occurrence.scheduledDate)}`;
    },
    nextLabel(item) {
      const next = item.nextOccurrence;
      if (!next) return "none pending";
      const day = occurrenceLabel(next.occurrenceDate);
      if (next.scheduledDate) return this.placedLabel(next);
      return this.isSkipped(item) ? `${day} → no slot that day` : `${day} → not scheduled`;
    },
    lastLabel(item) {
      const { occurrenceDate, completedDate } = item.lastCompletion;
      const occurrence = occurrenceLabel(occurrenceDate);
      const doneDay = dateOnlyInTimeZone(this.timeZone, completedDate);
      // Only call out the tick date when it differs, e.g. an occurrence completed early.
      return doneDay && doneDay !== apiDateOnly(occurrenceDate)
        ? `${occurrence} occurrence, ticked ${occurrenceLabel(doneDay)}`
        : `${occurrence} occurrence`;
    },
  },
};
</script>

<style scoped>
/* Collapsed by default, like intentions: context, not a list competing with work. */
.series-group {
  margin-top: 14px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
}

.series-group > summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  opacity: 0.85;
  list-style: revert;
}

.series-group-title {
  font-weight: 600;
}

.series-group-count {
  opacity: 0.75;
}

.series-items {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}

.series-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  margin-bottom: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.series-item:hover,
.series-item:focus-visible {
  background: var(--surface-3);
}

.series-item--warn {
  border-left-color: var(--warning);
}

.series-badge.series-badge--quiet {
  background: var(--surface-3);
  color: var(--text-muted);
}

.series-primary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.series-title {
  min-width: 0;
  font-weight: 500;
  color: var(--text-primary);
}

.series-icon {
  margin-right: 6px;
  color: var(--text-muted);
}

.series-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--warning-soft);
  color: var(--warning-text);
  white-space: nowrap;
}

.series-line {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.series-line--quiet {
  color: var(--text-muted);
}
</style>
