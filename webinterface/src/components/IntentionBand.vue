<template>
  <!-- Personal work for one week. Never scheduled; see docs/INTENTIONS.md. -->
  <section
    class="intention-band"
    :class="[`urgency-${urgency}`, { collapsed: !open, review: review }]"
    data-test="intention-band"
    :data-intention-count="summary.total"
  >
    <header class="ib-head">
      <!-- A review band is always open, so its title is text rather than a dead control. -->
      <button
        v-if="!review"
        class="ib-toggle"
        type="button"
        data-test="intention-band-toggle"
        :aria-expanded="open ? 'true' : 'false'"
        @click="$emit('toggle')"
      >
        <span class="ib-caret" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
        <span class="ib-title">{{ headline }}</span>
      </button>
      <span v-else class="ib-title">{{ headline }}</span>
      <p class="ib-summary" data-test="intention-summary">
        <strong>{{ summary.done }} of {{ summary.total }}</strong>
        <span v-if="!review && summary.openMinutes">
          · {{ formatDuration(summary.openMinutes) }} left
        </span>
      </p>
    </header>

    <div
      v-if="summary.total"
      class="ib-bar"
      role="progressbar"
      :aria-valuenow="summary.percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${summary.done} of ${summary.total} intentions done`"
    >
      <span class="ib-fill" :style="{ width: `${summary.percent}%` }"></span>
    </div>

    <div v-if="open" class="ib-body">
      <p v-if="error" class="ib-error" role="alert" data-test="intention-error">{{ error }}</p>

      <p v-if="!summary.total && !error" class="ib-empty" data-test="intention-empty">
        Nothing beyond work this week. Add a task to any personal project and it becomes an
        intention.
      </p>

      <ul v-else class="ib-list">
        <li
          v-for="task in intentions"
          :key="task._id"
          class="ib-row"
          :class="{ done: task.completed }"
          :data-test="`intention-${task._id}`"
        >
          <!-- One click is the whole check-in, on a page that is already open. -->
          <button
            v-if="!review"
            class="ib-check"
            type="button"
            :data-test="`intention-complete-${task._id}`"
            :aria-label="task.completed ? `${task.title} is done` : `Mark ${task.title} done`"
            :disabled="task.completed || busy"
            @click="$emit('complete', task)"
          >
            <span aria-hidden="true">{{ task.completed ? "✓" : "" }}</span>
          </button>
          <span v-else class="ib-glyph" aria-hidden="true">{{ task.completed ? "✓" : "○" }}</span>

          <button
            class="ib-name"
            type="button"
            :data-test="`intention-open-${task._id}`"
            @click="$emit('open', task)"
          >
            {{ task.title }}
          </button>

          <span class="ib-meta">
            <span v-if="task.completed" class="ib-done-label">{{ doneLabel(task) }}</span>
            <span v-else class="ib-duration">{{ formatDuration(Number(task.duration) || 0) }}</span>
          </span>

          <!-- Last week's misses are the only ones with anything left to act on. -->
          <button
            v-if="review && !task.completed"
            class="ib-carry"
            type="button"
            :data-test="`intention-carry-${task._id}`"
            :disabled="busy"
            @click="$emit('carry', task)"
          >
            Carry →
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script>
import { intentionHeadline, intentionSummary } from "../utils/intentions";

export default {
  name: "IntentionBand",
  props: {
    intentions: { type: Array, default: () => [] },
    // "quiet" most of the week, "nudge" from Friday.
    urgency: { type: String, default: "quiet" },
    open: { type: Boolean, default: false },
    // Last week's band is read-only apart from carrying a miss forward.
    review: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" },
    headlineOverride: { type: String, default: "" },
  },
  emits: ["toggle", "complete", "open", "carry"],
  computed: {
    summary() {
      return intentionSummary(this.intentions);
    },
    headline() {
      return this.headlineOverride || intentionHeadline(this.urgency, this.summary);
    },
  },
  methods: {
    doneLabel(task) {
      if (!task.completedDate) return "done";
      const date = new Date(task.completedDate);
      if (Number.isNaN(date.getTime())) return "done";
      return `done ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}`;
    },
    formatDuration(minutes) {
      const safe = Math.max(0, Math.round(Number(minutes) || 0));
      const hours = Math.floor(safe / 60);
      const remainder = safe % 60;
      if (!hours) return `${remainder}m`;
      return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
    },
  },
};
</script>

<style scoped>
.intention-band {
  margin: 0 0 18px;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid rgba(118, 134, 168, 0.25);
  background: rgba(118, 134, 168, 0.07);
}

/* The only visual change as the week runs out: a warmer edge, never a red alert. */
.intention-band.urgency-nudge {
  border-color: rgba(214, 158, 46, 0.45);
  background: rgba(214, 158, 46, 0.08);
}

.intention-band.review {
  margin: 14px 0 0;
  background: rgba(118, 134, 168, 0.05);
}

.ib-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.ib-toggle {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font-weight: 600;
}

.ib-caret {
  opacity: 0.6;
  font-size: 0.8rem;
}

.ib-summary {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.85;
}

.ib-bar {
  margin-top: 10px;
  height: 5px;
  border-radius: 999px;
  background: rgba(118, 134, 168, 0.22);
  overflow: hidden;
}

.ib-fill {
  display: block;
  height: 100%;
  background: rgba(72, 187, 120, 0.8);
  transition: width 160ms ease-out;
}

.ib-body {
  margin-top: 12px;
}

.ib-error {
  margin: 0 0 8px;
  color: #c53030;
  font-size: 0.85rem;
}

.ib-empty {
  margin: 0;
  font-size: 0.88rem;
  opacity: 0.75;
}

.ib-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.ib-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
}

/* Kept, not celebrated: a done intention recedes rather than lighting up. */
.ib-row.done .ib-name,
.ib-row.done .ib-meta {
  opacity: 0.55;
  text-decoration: line-through;
}

.ib-check {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid rgba(118, 134, 168, 0.6);
  background: transparent;
  cursor: pointer;
  line-height: 1;
  font-size: 0.8rem;
}

.ib-check:disabled {
  cursor: default;
  border-color: rgba(72, 187, 120, 0.7);
  color: rgba(72, 187, 120, 0.9);
}

.ib-glyph {
  flex: none;
  width: 20px;
  text-align: center;
  opacity: 0.7;
}

.ib-name {
  flex: 1 1 auto;
  text-align: left;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font-size: 0.92rem;
}

.ib-meta {
  flex: none;
  font-size: 0.82rem;
  opacity: 0.75;
}

.ib-carry {
  flex: none;
  border: 1px solid rgba(118, 134, 168, 0.45);
  background: transparent;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 0.78rem;
  cursor: pointer;
  color: inherit;
}

.ib-carry:disabled {
  opacity: 0.5;
  cursor: default;
}

.intention-band.collapsed .ib-bar {
  margin-top: 8px;
}
</style>
