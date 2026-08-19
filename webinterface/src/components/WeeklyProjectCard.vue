<template>
  <section class="project" :data-project-id="project._id">
    <header class="project-head">
      <div class="project-identity">
        <h4>{{ project.title }}</h4>
        <p v-if="project.description" class="description">{{ project.description }}</p>
      </div>
      <span class="project-total" :data-test="`project-total-${project._id}`">
        {{ summaryLabel }}
      </span>
    </header>

    <WeeklyCommitmentProgress
      v-if="committedItems.length"
      :project-id="String(project._id)"
      :items="committedItems"
      :added="addedTasks"
      :tasks-by-id="tasksById"
      :busy="foldingIn"
      @open="(task, event) => $emit('open-task', task, event)"
      @fold-in="$emit('fold-in')"
    />

    <ul
      v-if="showWeekList && weekTasks.length"
      class="task-list"
      :data-test="`week-tasks-${project._id}`"
    >
      <li v-for="task in weekTasks" :key="task._id" class="task-line">
        <label
          v-if="selectable"
          class="task-check"
          :data-test="`select-task-${task._id}`"
          @click.stop
        >
          <input
            type="checkbox"
            :checked="isSelected(task)"
            :aria-label="`Include ${task.title} in this week's commitment`"
            @change="$emit('toggle-task', task)"
          />
        </label>
        <button
          class="task-row"
          type="button"
          :data-test="`edit-weekly-task-${task._id}`"
          @click="$emit('open-task', task, $event)"
        >
          <span class="task-name">
            <span class="status-dot" aria-hidden="true"></span>
            <span v-if="task.seriesRef" class="task-marker" aria-label="Repeating task">↻</span>
            <span class="title-text">{{ task.title }}</span>
            <span v-if="task.isBacklog" class="task-badge">Backlog</span>
          </span>
          <span class="task-meta">
            <span>{{ dueLabel(task) }}</span>
            <span class="task-duration">{{ formatDuration(Number(task.duration) || 0) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-else-if="showWeekList && !committedItems.length" class="nothing-planned">
      Nothing planned for this week yet.
    </p>

    <div class="disclosures">
      <details v-if="otherTasks.length" class="drawer" :data-test="`other-tasks-${project._id}`">
        <summary>Other active tasks · {{ otherTasks.length }}</summary>
        <ul class="task-list compact">
          <li v-for="task in otherTasks" :key="task._id" class="task-line">
            <button class="task-row" type="button" @click="$emit('open-task', task, $event)">
              <span class="task-name">
                <span class="status-dot" aria-hidden="true"></span>
                <span v-if="task.seriesRef" class="task-marker" aria-label="Repeating task">↻</span>
                <span class="title-text">{{ task.title }}</span>
                <span v-if="task.isBacklog" class="task-badge">Backlog</span>
              </span>
              <span class="task-meta">
                <span>{{ dueLabel(task) }}</span>
                <span class="task-duration">{{ formatDuration(Number(task.duration) || 0) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </details>

      <details
        v-if="completions.length"
        class="drawer completed-last-week"
        :data-test="`completed-last-week-${project._id}`"
        :data-completed-from="previousWeek.startDate"
        :data-completed-to="previousWeek.endDate"
      >
        <summary>
          <span class="completion-check" aria-hidden="true">✓</span>
          {{ completions.length }} {{ taskNoun(completions.length) }} completed last week ·
          {{ previousRangeLabel }}
        </summary>
        <ul class="task-list compact">
          <li
            v-for="task in completions"
            :key="task._id"
            class="task-line completed-line"
            :data-test="`completed-last-week-row-${task._id}`"
          >
            <span class="task-row static">
              <span class="task-name">
                <span class="completion-check" aria-hidden="true">✓</span>
                <span v-if="task.seriesRef" class="task-marker" aria-label="Repeating task">↻</span>
                <strong class="title-text">{{ task.title }}</strong>
              </span>
              <span class="task-meta">{{ completionLabel(task) }}</span>
            </span>
          </li>
        </ul>
      </details>
    </div>

    <div class="quick-add" :data-test="`quick-task-${project._id}`">
      <button
        v-if="!form.open"
        class="quick-add-trigger"
        type="button"
        :data-test="`quick-add-open-${project._id}`"
        @click="$emit('open-form')"
      >
        <span aria-hidden="true">+</span> Add a task
      </button>

      <form v-else class="quick-form" @submit.prevent="$emit('submit')">
        <div class="quick-primary">
          <div class="field">
            <label :for="`quick-title-${project._id}`">Task title</label>
            <input
              :id="`quick-title-${project._id}`"
              ref="titleInput"
              :value="form.title"
              class="form-control"
              type="text"
              required
              @input="$emit('update-field', 'title', $event.target.value)"
            />
          </div>
          <div class="field minutes">
            <label :for="`quick-duration-${project._id}`">Minutes</label>
            <input
              :id="`quick-duration-${project._id}`"
              :value="form.duration"
              class="form-control"
              type="number"
              min="1"
              step="1"
              required
              @input="$emit('update-field', 'duration', Number($event.target.value))"
            />
          </div>
        </div>

        <fieldset class="day-chips">
          <legend>Due</legend>
          <label
            v-for="day in weekDays"
            :key="day.date"
            class="day-chip"
            :class="{ selected: form.dueDate === day.date }"
          >
            <input
              type="radio"
              :name="`quick-due-${project._id}`"
              :value="day.date"
              :checked="form.dueDate === day.date"
              @change="$emit('update-field', 'dueDate', day.date)"
            />
            <span>{{ day.label }}</span>
          </label>
          <!-- The native control stays as the accessible source of truth for the date. -->
          <label class="visually-hidden" :for="`quick-due-date-${project._id}`">Due date</label>
          <input
            :id="`quick-due-date-${project._id}`"
            :value="form.dueDate"
            class="visually-hidden"
            type="date"
            :min="week.startDate"
            :max="week.endDate"
            required
            @input="$emit('update-field', 'dueDate', $event.target.value)"
          />
        </fieldset>

        <div class="quick-actions">
          <button class="btn btn-secondary btn-sm" type="button" @click="$emit('close-form')">
            Cancel
          </button>
          <button class="btn btn-primary btn-sm" type="submit" :disabled="form.saving">
            {{ form.saving ? "Adding…" : "Add task" }}
          </button>
        </div>
      </form>

      <p
        v-if="form.message"
        class="form-message"
        :class="{ error: form.error }"
        :role="form.error ? 'alert' : 'status'"
        :data-test="`quick-status-${project._id}`"
      >
        {{ form.message }}
      </p>
    </div>
  </section>
</template>

<script>
import WeeklyCommitmentProgress from "./WeeklyCommitmentProgress.vue";
import { formatCivilDate } from "../utils/temporal";

/**
 * One project panel: committed progress, this week's live tasks, drawers, and quick add.
 *
 * Presentation only. Every mutation is emitted so WeeklyPlan.vue keeps owning page state.
 */
export default {
  name: "WeeklyProjectCard",
  components: { WeeklyCommitmentProgress },
  props: {
    project: { type: Object, required: true },
    weekTasks: { type: Array, default: () => [] },
    otherTasks: { type: Array, default: () => [] },
    completions: { type: Array, default: () => [] },
    committedItems: { type: Array, default: () => [] },
    addedTasks: { type: Array, default: () => [] },
    tasksById: { type: Object, default: () => ({}) },
    form: { type: Object, required: true },
    week: { type: Object, required: true },
    weekDays: { type: Array, default: () => [] },
    previousWeek: { type: Object, default: () => ({}) },
    previousRangeLabel: { type: String, default: "" },
    selectable: { type: Boolean, default: false },
    selectedIds: { type: Object, default: () => ({}) },
    foldingIn: { type: Boolean, default: false },
    committed: { type: Boolean, default: false },
    timeZone: { type: String, default: "UTC" },
    planDateFor: { type: Function, required: true },
  },
  emits: [
    "open-task",
    "toggle-task",
    "open-form",
    "close-form",
    "submit",
    "fold-in",
    "update-field",
  ],
  computed: {
    // After committing, the progress block already lists this week's work.
    showWeekList() {
      return !this.committed;
    },
    summaryLabel() {
      if (this.committed && this.committedItems.length) {
        const done = this.committedItems.filter((item) => item.status === "done").length;
        return `${done}/${this.committedItems.length} done`;
      }
      if (!this.weekTasks.length) return "nothing planned";
      const minutes = this.weekTasks.reduce(
        (total, task) => total + (Number(task.duration) || 0),
        0
      );
      return `${this.weekTasks.length} ${this.taskNoun(this.weekTasks.length)} · ${this.formatDuration(minutes)}`;
    },
  },
  watch: {
    "form.open"(open) {
      if (open) this.$nextTick(() => this.$refs.titleInput?.focus());
    },
  },
  methods: {
    isSelected(task) {
      return this.selectedIds[task._id] !== false;
    },
    taskNoun(count) {
      return count === 1 ? "task" : "tasks";
    },
    dueLabel(task) {
      if (!task.seriesRef && (task.isBacklog || !task.dueDate)) return "Backlog";
      return formatCivilDate(this.planDateFor(task), {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    },
    completionLabel(task) {
      const date = new Date(task.completedDate);
      if (Number.isNaN(date.getTime())) return "";
      return `Completed ${new Intl.DateTimeFormat(undefined, {
        timeZone: this.timeZone || "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(date)}`;
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
.project {
  padding: 16px 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(22, 27, 34, 0.66);
}

.project-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
}

.project-identity {
  min-width: 0;
}

.project-head h4 {
  margin: 0;
  color: #f0f3f6;
  font-size: 1rem;
  font-weight: 600;
}

.description {
  margin: 3px 0 0;
  color: #8b949e;
  font-size: 0.84rem;
}

.project-total {
  flex: 0 0 auto;
  color: #a8b4c0;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-list {
  display: grid;
  gap: 2px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.task-list.compact {
  margin-top: 8px;
}

.task-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-check {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  margin: 0;
  cursor: pointer;
}

.task-check input {
  width: 15px;
  height: 15px;
  accent-color: #667eea;
  cursor: pointer;
}

.task-row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
  color: #d7dde4;
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
}

button.task-row {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

button.task-row:hover,
button.task-row:focus-visible {
  border-color: rgba(141, 162, 251, 0.5);
  outline: none;
  background: rgba(102, 126, 234, 0.12);
}

.task-name {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.title-text {
  overflow-wrap: anywhere;
}

.status-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #667eea;
}

.task-marker {
  color: #9aa9ed;
}

.task-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(139, 148, 158, 0.18);
  color: #9ca7b2;
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.task-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 10px;
  color: #8b949e;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-duration {
  display: inline-block;
  min-width: 3.2em;
  text-align: right;
}

.nothing-planned {
  margin: 12px 0 0;
  color: #6f7883;
  font-size: 0.84rem;
  font-style: italic;
}

.disclosures {
  display: grid;
  gap: 4px;
  margin-top: 10px;
}

.drawer summary {
  padding: 5px 8px;
  border-radius: 6px;
  color: #8b949e;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.drawer summary:hover,
.drawer summary:focus-visible {
  outline: none;
  background: rgba(255, 255, 255, 0.04);
  color: #c8d1da;
}

.completed-last-week summary {
  color: #8fa79b;
}

.completed-last-week summary:hover,
.completed-last-week summary:focus-visible {
  background: rgba(110, 231, 183, 0.07);
  color: #b5c7bf;
}

.completion-check {
  color: #6ee7b7;
  font-weight: 700;
}

.completed-line .task-row {
  background: rgba(110, 231, 183, 0.04);
  color: #a4b3ab;
}

.quick-add {
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.quick-add-trigger {
  padding: 5px 11px;
  border: 1px dashed rgba(141, 162, 251, 0.36);
  border-radius: 999px;
  background: transparent;
  color: #8da2fb;
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.quick-add-trigger:hover,
.quick-add-trigger:focus-visible {
  border-color: rgba(141, 162, 251, 0.7);
  outline: none;
  background: rgba(102, 126, 234, 0.12);
}

.quick-form {
  display: grid;
  gap: 10px;
}

.quick-primary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 8px;
}

.field label {
  display: block;
  margin-bottom: 3px;
  color: #8b949e;
  font-size: 0.7rem;
}

.quick-form .form-control {
  min-height: 36px;
  padding: 6px 9px;
  font-size: 0.84rem;
}

.day-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 0;
  border: 0;
}

.day-chips legend {
  width: auto;
  margin: 0 6px 0 0;
  padding: 0;
  color: #8b949e;
  font-size: 0.7rem;
  float: none;
}

.day-chip {
  margin: 0;
  cursor: pointer;
}

.day-chip input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.day-chip span {
  display: inline-block;
  padding: 4px 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: #9ca7b2;
  font-size: 0.75rem;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.day-chip:hover span {
  border-color: rgba(141, 162, 251, 0.5);
  color: #c8d1da;
}

.day-chip.selected span {
  border-color: transparent;
  background: #667eea;
  color: #fff;
}

.day-chip input:focus-visible + span {
  outline: 2px solid #8da2fb;
  outline-offset: 2px;
}

.quick-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.form-message {
  margin: 8px 0 0;
  color: #6ee7b7;
  font-size: 0.79rem;
}

.form-message.error {
  color: #fca5a5;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 620px) {
  .project {
    padding: 14px;
  }

  .project-head,
  .task-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .project-total {
    white-space: normal;
  }

  .task-meta {
    padding-left: 13px;
  }

  .quick-primary {
    grid-template-columns: 1fr;
  }
}
</style>
