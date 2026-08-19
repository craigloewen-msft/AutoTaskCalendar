<template>
  <div class="commitment" :data-test="`commitment-${projectId}`">
    <div class="commitment-head">
      <span class="commitment-label">Committed</span>
      <span class="commitment-score" :data-test="`commitment-score-${projectId}`">
        {{ doneCount }} of {{ items.length }} done · {{ formatDuration(doneMinutes) }} of
        {{ formatDuration(totalMinutes) }}
      </span>
    </div>

    <div
      class="commitment-bar"
      role="progressbar"
      :aria-valuenow="donePercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${doneCount} of ${items.length} committed tasks done`"
    >
      <span class="commitment-fill" :style="{ width: `${donePercent}%` }"></span>
    </div>

    <ul class="commitment-list">
      <li
        v-for="item in items"
        :key="item.taskRef"
        class="commitment-row"
        :class="`is-${item.status}`"
        :data-test="`commitment-item-${item.taskRef}`"
        :data-status="item.status"
      >
        <component
          :is="openableTask(item) ? 'button' : 'div'"
          class="commitment-cell"
          :type="openableTask(item) ? 'button' : null"
          @click="openableTask(item) && $emit('open', openableTask(item), $event)"
        >
          <span class="commitment-title">
            <span class="status-glyph" aria-hidden="true">{{ glyph(item.status) }}</span>
            <span v-if="item.seriesRef" class="task-marker" aria-label="Repeating task">↻</span>
            <span class="title-text">{{ item.title }}</span>
          </span>
          <span class="commitment-meta">{{ statusLabel(item) }}</span>
        </component>
      </li>
    </ul>

    <template v-if="added.length">
      <div class="added-head">
        <span>Added since commit</span>
        <button
          class="fold-in"
          type="button"
          :disabled="busy"
          :data-test="`fold-in-${projectId}`"
          @click="$emit('fold-in')"
        >
          {{ busy ? "Updating…" : "Update commitment" }}
        </button>
      </div>
      <ul class="commitment-list">
        <li
          v-for="task in added"
          :key="task._id"
          class="commitment-row is-added"
          :data-test="`added-item-${task._id}`"
        >
          <button class="commitment-cell" type="button" @click="$emit('open', task, $event)">
            <span class="commitment-title">
              <span class="status-glyph" aria-hidden="true">+</span>
              <span v-if="task.seriesRef" class="task-marker" aria-label="Repeating task">↻</span>
              <span class="title-text">{{ task.title }}</span>
            </span>
            <span class="commitment-meta">{{ addedMeta(task) }}</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<script>
import { formatCivilDate } from "../utils/temporal";

/**
 * A project's committed work and its live progress.
 *
 * Items come from the stored snapshot, so a task that was deleted or pushed out of the week
 * still appears here. Their status is resolved by the server on every read.
 */
export default {
  name: "WeeklyCommitmentProgress",
  props: {
    projectId: { type: String, required: true },
    items: { type: Array, default: () => [] },
    added: { type: Array, default: () => [] },
    tasksById: { type: Object, default: () => ({}) },
    busy: { type: Boolean, default: false },
  },
  emits: ["open", "fold-in"],
  computed: {
    doneCount() {
      return this.items.filter((item) => item.status === "done").length;
    },
    totalMinutes() {
      return this.items.reduce((total, item) => total + (Number(item.duration) || 0), 0);
    },
    doneMinutes() {
      return this.items
        .filter((item) => item.status === "done")
        .reduce((total, item) => total + (Number(item.duration) || 0), 0);
    },
    donePercent() {
      if (!this.items.length) return 0;
      return Math.round((this.doneCount / this.items.length) * 100);
    },
  },
  methods: {
    // Only a task that still exists can be opened in the editor.
    openableTask(item) {
      if (item.status === "removed") return null;
      return this.tasksById[item.taskRef] || null;
    },
    glyph(status) {
      return { done: "✓", moved: "↷", removed: "✗" }[status] || "●";
    },
    statusLabel(item) {
      if (item.status === "done") {
        return item.completedDate
          ? `done ${this.shortDate(item.completedDate)}`
          : "done";
      }
      if (item.status === "moved") {
        return item.liveDueDate ? `moved to ${this.civilDay(item.liveDueDate)}` : "moved";
      }
      if (item.status === "removed") return "removed";
      return `due ${this.civilDay(item.liveDueDate || item.dueDate)} · ${this.formatDuration(item.duration)}`;
    },
    addedMeta(task) {
      const due = task.isBacklog && !task.dueDate ? "Backlog" : this.civilDay(this.planDate(task));
      return `${due} · ${this.formatDuration(Number(task.duration) || 0)}`;
    },
    planDate(task) {
      return task.weeklyPlanDate || task.dueDate;
    },
    civilDay(value) {
      return formatCivilDate(value, { weekday: "short", month: "short", day: "numeric" });
    },
    shortDate(instant) {
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
  },
};
</script>

<style scoped>
.commitment {
  margin: 14px 0 0;
  padding: 14px;
  border: 1px solid rgba(141, 162, 251, 0.16);
  border-radius: 10px;
  background: rgba(102, 126, 234, 0.05);
}

.commitment-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}

.commitment-label {
  color: #8da2fb;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.commitment-score {
  color: #c8d1da;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.commitment-bar {
  overflow: hidden;
  height: 5px;
  margin-bottom: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
}

.commitment-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6ee7b7, #34d399);
  transition: width 0.35s ease;
}

.commitment-list {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.commitment-cell {
  display: flex;
  width: 100%;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #d7dde4;
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
}

button.commitment-cell {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

button.commitment-cell:hover,
button.commitment-cell:focus-visible {
  border-color: rgba(141, 162, 251, 0.45);
  outline: none;
  background: rgba(102, 126, 234, 0.1);
}

.commitment-title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.title-text {
  overflow-wrap: anywhere;
}

.status-glyph {
  flex: 0 0 auto;
  width: 12px;
  color: #8b949e;
  font-size: 0.8rem;
  text-align: center;
}

.commitment-meta {
  flex: 0 0 auto;
  color: #8b949e;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-marker {
  color: #9aa9ed;
}

.is-done .status-glyph {
  color: #6ee7b7;
}

.is-done .title-text {
  color: #93a49c;
  text-decoration: line-through;
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

.is-added .status-glyph {
  color: #8da2fb;
}

.added-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0 6px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  color: #8b949e;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.fold-in {
  padding: 3px 10px;
  border: 1px solid rgba(141, 162, 251, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #8da2fb;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.fold-in:hover:not(:disabled),
.fold-in:focus-visible {
  outline: none;
  background: rgba(102, 126, 234, 0.14);
}

.fold-in:disabled {
  opacity: 0.6;
  cursor: default;
}

@media (max-width: 620px) {
  .commitment-cell {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }

  .commitment-meta {
    padding-left: 19px;
    white-space: normal;
  }
}
</style>
