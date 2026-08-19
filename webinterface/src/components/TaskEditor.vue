<template>
  <div class="editor-backdrop" @click.self="close" @keydown.esc="close">
    <section
      ref="dialog"
      class="task-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-editor-title"
      data-test="task-editor"
      tabindex="-1"
    >
      <header class="editor-header">
        <div>
          <p class="editor-eyebrow">{{ isEdit ? "Manage task" : "New task" }}</p>
          <h2 id="task-editor-title">{{ isEdit ? "Edit task" : "Add task" }}</h2>
        </div>
        <button class="close-button" type="button" aria-label="Close task editor" @click="close">
          ×
        </button>
      </header>

      <div class="editor-body">
        <p v-if="isSeriesTask" class="series-banner" data-test="series-banner">
          <span aria-hidden="true">↻</span>
          Part of a repeating series — edits and deletion apply to the whole series.
        </p>

        <p v-if="error" class="editor-error" role="alert" data-test="task-editor-error">
          {{ error }}
        </p>

        <form id="task-editor-form" novalidate @submit.prevent="save">
          <div class="form-group">
            <label for="task-title">Task title*</label>
            <input
              id="task-title"
              ref="titleInput"
              v-model="draft.title"
              class="form-control"
              type="text"
              required
            />
          </div>

          <div class="editor-grid">
            <div class="form-group">
              <label for="task-duration">Duration in minutes*</label>
              <input
                id="task-duration"
                v-model.number="draft.duration"
                class="form-control"
                type="number"
                min="1"
                step="1"
                required
              />
            </div>

            <div class="form-group">
              <label for="task-priority">Priority</label>
              <input
                id="task-priority"
                v-model.number="draft.priority"
                class="form-control"
                type="number"
                min="0"
              />
              <small>Lower numbers are scheduled first when due dates match.</small>
            </div>

            <div class="form-group">
              <label for="task-start-date">Start date*</label>
              <input
                id="task-start-date"
                v-model="draft.startDate"
                class="form-control date-input"
                type="date"
                required
                :disabled="isSeriesTask"
              />
            </div>

            <div v-if="!draft.isBacklog" class="form-group">
              <label for="task-due-date">Due date*</label>
              <input
                id="task-due-date"
                v-model="draft.dueDate"
                class="form-control date-input"
                type="date"
                required
                :disabled="isSeriesTask"
              />
            </div>
          </div>

          <label class="checkbox-row" for="task-is-backlog">
            <input id="task-is-backlog" v-model="draft.isBacklog" type="checkbox" />
            Backlog task
          </label>

          <div class="form-group">
            <label for="task-project">Project{{ isEdit ? "" : "*" }}</label>
            <select
              id="task-project"
              ref="projectSelect"
              v-model="draft.projectRef"
              class="form-control"
              @change="chooseProject"
            >
              <option v-if="!isEdit" disabled value="">Choose a project or Unassigned…</option>
              <option :value="null">Unassigned</option>
              <option v-if="currentProjectOutsideCompass" :value="draft.projectRef">
                Current project (outside active Compass)
              </option>
              <optgroup v-for="group in projectGroups" :key="group.label" :label="group.label">
                <option v-for="project in group.projects" :key="project._id" :value="project._id">
                  {{ project.title }}
                </option>
              </optgroup>
            </select>
            <ProjectSuggestions
              :title="draft.title"
              :notes="draft.notes"
              :project-groups="projectGroups"
              :active="!isEdit && !projectChoiceMade"
              @select="useRecommendation"
            />
          </div>

          <div class="form-group">
            <label for="task-notes">Notes</label>
            <textarea id="task-notes" v-model="draft.notes" class="form-control" rows="3"></textarea>
          </div>

          <label class="checkbox-row" for="task-break-up-task">
            <input id="task-break-up-task" v-model="draft.breakUpTask" type="checkbox" />
            Break task into chunks
          </label>

          <div v-if="draft.breakUpTask" class="form-group chunk-field">
            <label for="task-break-up-task-chunk-duration">Chunk duration in minutes*</label>
            <input
              id="task-break-up-task-chunk-duration"
              v-model.number="draft.breakUpTaskChunkDuration"
              class="form-control"
              type="number"
              min="1"
              step="1"
              required
            />
          </div>

          <RepeatEditor v-model="draft.recurrence" :working-days="workingDays" />

          <div class="form-group">
            <label for="task-dependencies">Dependencies</label>
            <select
              id="task-dependencies"
              v-model="draft.dependsOn"
              class="form-control"
              multiple
              size="4"
            >
              <option v-for="candidate in dependencyCandidates" :key="candidate._id" :value="candidate._id">
                {{ candidate.title }}
              </option>
            </select>
            <small>Hold Ctrl (Cmd on Mac) to choose more than one.</small>
          </div>
        </form>
      </div>

      <footer class="editor-footer">
        <div v-if="followUpOpen" class="follow-up-panel" data-test="follow-up-panel">
          <label for="task-follow-up-days">
            Completes this task and creates a successor in
          </label>
          <input
            id="task-follow-up-days"
            ref="followUpDaysInput"
            v-model.number="followUpDays"
            class="form-control"
            type="number"
            min="1"
            step="1"
          />
          <span>days.</span>
          <div class="follow-up-actions">
            <button
              class="btn btn-sm btn-secondary"
              type="button"
              :disabled="busy"
              @click="followUpOpen = false"
            >
              Cancel
            </button>
            <button
              class="btn btn-sm btn-primary"
              type="button"
              :disabled="busy"
              @click="createFollowUp"
            >
              Create follow up
            </button>
          </div>
        </div>
        <div v-if="isEdit" class="task-actions">
          <button
            v-if="showFollowUp && !followUpOpen"
            class="btn btn-outline-primary"
            type="button"
            :disabled="busy || confirmingDelete"
            @click="openFollowUp"
          >
            Follow up
          </button>
          <button
            class="btn btn-outline-success"
            type="button"
            :disabled="busy || confirmingDelete || followUpOpen"
            @click="completeTask"
          >
            Complete
          </button>
          <button
            class="btn btn-outline-danger"
            type="button"
            :disabled="busy || confirmingDelete || followUpOpen"
            @click="confirmingDelete = true"
          >
            {{ isSeriesTask ? "Delete series" : "Delete" }}
          </button>
        </div>
        <div class="save-actions">
          <button class="btn btn-secondary" type="button" :disabled="busy" @click="close">
            Cancel
          </button>
          <button class="btn btn-primary" type="submit" form="task-editor-form" :disabled="busy">
            {{ busy ? "Saving…" : isEdit ? "Save changes" : "Add task" }}
          </button>
        </div>
      </footer>
      <footer v-if="confirmingDelete" class="editor-actions confirm-delete" data-test="task-delete-confirm">
        <p class="confirm-message">{{ deleteMessage }}</p>
        <div class="save-actions">
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="busy"
            data-test="task-delete-cancel"
            @click="confirmingDelete = false"
          >
            Keep task
          </button>
          <button
            class="btn btn-danger"
            type="button"
            :disabled="busy"
            data-test="task-delete-confirm-button"
            @click="deleteTask"
          >
            {{ busy ? "Deleting…" : "Delete" }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script>
import RepeatEditor from "./RepeatEditor.vue";
import ProjectSuggestions from "./ProjectSuggestions.vue";
import { addCalendarDays, apiDateOnly, dateOnlyInTimeZone } from "../utils/temporal";

export default {
  name: "TaskEditor",
  components: { RepeatEditor, ProjectSuggestions },
  props: {
    task: { type: Object, default: null },
    tasks: { type: Array, default: () => [] },
    projectGroups: { type: Array, default: () => [] },
    workingDays: { type: Array, default: () => [] },
    defaultStartDate: { type: String, default: "" },
    defaultDueDate: { type: String, default: "" },
    timeZone: { type: String, default: "UTC" },
    completionChunkDuration: { type: Number, default: null },
    showFollowUp: { type: Boolean, default: false },
  },
  emits: ["close", "changed"],
  data() {
    return {
      draft: this.buildDraft(this.task),
      error: "",
      busy: false,
      confirmingDelete: false,
      followUpOpen: false,
      followUpDays: 7,
      projectChoiceMade: !!this.task?._id,
    };
  },
  computed: {
    isEdit() {
      return !!this.task?._id;
    },
    isSeriesTask() {
      return !!this.task?.seriesRef;
    },
    deleteMessage() {
      return this.isSeriesTask
        ? "Delete this repeating series? Completed occurrences will be kept."
        : `Delete “${this.task?.title}”? This cannot be undone.`;
    },
    currentProjectOutsideCompass() {
      if (!this.draft.projectRef) return false;
      return !this.projectGroups.some((group) => {
        return group.projects.some((project) => project._id === this.draft.projectRef);
      });
    },
    dependencyCandidates() {
      return this.tasks.filter((candidate) => candidate._id !== this.task?._id);
    },
  },
  mounted() {
    document.body.classList.add("task-editor-open");
    this.$nextTick(() => this.$refs.titleInput?.focus());
  },
  beforeUnmount() {
    document.body.classList.remove("task-editor-open");
  },
  methods: {
    buildDraft(task) {
      return {
        title: task?.title || "",
        duration: Number(task?.duration) || 30,
        priority: task?.priority ?? 100,
        startDate: apiDateOnly(task?.startDate)
          || this.defaultStartDate
          || dateOnlyInTimeZone(this.timeZone),
        dueDate: apiDateOnly(task?.dueDate) || this.defaultDueDate || "",
        isBacklog: !!task?.isBacklog,
        projectRef: task?._id ? (task.projectRef || null) : "",
        notes: task?.notes || "",
        breakUpTask: !!task?.breakUpTask,
        breakUpTaskChunkDuration: Number(task?.breakUpTaskChunkDuration) || 30,
        recurrence: clone(task?.recurrence || task?.seriesRecurrence || null),
        dependsOn: [...(task?.dependsOn || [])],
      };
    },
    validate() {
      if (!this.draft.title.trim()) return "Enter a task title.";
      if (!this.isEdit && this.draft.projectRef === "") {
        return "Choose a project or Unassigned.";
      }
      if (!Number.isFinite(Number(this.draft.duration)) || Number(this.draft.duration) <= 0) {
        return "Duration must be at least one minute.";
      }
      if (!this.draft.startDate) return "Choose a start date.";
      if (!this.draft.isBacklog && !this.draft.dueDate) return "Choose a due date.";
      if (
        this.draft.breakUpTask
        && (!Number.isFinite(Number(this.draft.breakUpTaskChunkDuration))
          || Number(this.draft.breakUpTaskChunkDuration) <= 0)
      ) {
        return "Chunk duration must be at least one minute.";
      }
      return "";
    },
    fields() {
      return {
        title: this.draft.title.trim(),
        duration: Number(this.draft.duration),
        priority: Number(this.draft.priority ?? 100),
        startDate: this.draft.startDate,
        dueDate: this.draft.isBacklog ? null : this.draft.dueDate,
        isBacklog: this.draft.isBacklog,
        projectRef: this.draft.projectRef || null,
        notes: this.draft.notes,
        breakUpTask: this.draft.breakUpTask,
        breakUpTaskChunkDuration: this.draft.breakUpTask
          ? Number(this.draft.breakUpTaskChunkDuration)
          : null,
        recurrence: this.draft.recurrence,
        dependsOn: this.draft.dependsOn,
      };
    },
    chooseProject() {
      if (this.isEdit) return;
      this.projectChoiceMade = this.draft.projectRef !== "";
    },
    useRecommendation(projectId) {
      this.draft.projectRef = projectId;
      this.projectChoiceMade = true;
    },
    async save() {
      this.error = this.validate();
      if (this.error) {
        if (this.error === "Choose a project or Unassigned.") {
          this.$nextTick(() => this.$refs.projectSelect?.focus());
        }
        return;
      }
      this.busy = true;

      try {
        const response = this.isEdit
          ? await this.$http.post("/api/editTask", { task: { ...this.task, ...this.fields() } })
          : await this.$http.post("/api/createTask", this.fields());
        if (!response.data.success) {
          this.error = response.data.log || `Task could not be ${this.isEdit ? "saved" : "created"}.`;
          return;
        }
        if (response.data.taskList) {
          this.$emit("changed", response.data.taskList);
        } else {
          await this.refreshAndClose();
        }
      } catch (error) {
        this.error = `Task could not be ${this.isEdit ? "saved" : "created"}.`;
      } finally {
        this.busy = false;
      }
    },
    openFollowUp() {
      this.error = "";
      this.followUpOpen = true;
      this.$nextTick(() => this.$refs.followUpDaysInput?.focus());
    },
    /**
     * Complete this task and create its successor, which inherits this task's project.
     */
    async createFollowUp() {
      const days = Number(this.followUpDays);
      if (!Number.isFinite(days) || days <= 0) {
        this.error = "Follow up days must be at least one.";
        return;
      }

      this.error = "";
      this.busy = true;
      try {
        const response = await this.$http.post("/api/setFollowUp/", {
          title: this.draft.title.trim() || this.task.title,
          followUpDate: addCalendarDays(dateOnlyInTimeZone(this.timeZone), days),
          taskID: this.task._id,
        });
        if (!response.data.success) {
          this.error = response.data.log || "Follow up could not be created.";
          return;
        }
        this.followUpOpen = false;
        this.$emit("changed", response.data.taskList || []);
      } catch (error) {
        this.error = "Follow up could not be created.";
      } finally {
        this.busy = false;
      }
    },
    async completeTask() {
      this.error = "";
      this.busy = true;
      try {
        const response = this.completionChunkDuration
          ? await this.$http.post("/api/completeTaskChunk", {
            taskId: this.task._id,
            chunkDuration: this.completionChunkDuration,
          })
          : await this.$http.post("/api/completeTask", { taskId: this.task._id });
        if (!response.data.success) {
          this.error = response.data.log || "Task could not be completed.";
          return;
        }
        this.$emit("changed", response.data.taskList || []);
      } catch (error) {
        this.error = "Task could not be completed.";
      } finally {
        this.busy = false;
      }
    },
    async deleteTask() {
      this.error = "";
      this.busy = true;
      try {
        const response = await this.$http.post("/api/deleteTask", { taskId: this.task._id });
        if (!response.data.success) {
          this.error = response.data.log || "Task could not be deleted.";
          return;
        }
        this.$emit("changed", response.data.taskList || []);
      } catch (error) {
        this.error = "Task could not be deleted.";
      } finally {
        this.busy = false;
      }
    },
    async refreshAndClose() {
      const response = await this.$http.get("/api/getUserTasks");
      if (!response.data.success) {
        this.error = response.data.log || "The task was saved, but the list could not be refreshed.";
        return;
      }
      this.$emit("changed", response.data.taskList || []);
    },
    close() {
      if (this.busy) return;
      this.confirmingDelete = false;
      this.followUpOpen = false;
      this.$emit("close");
    },
  },
};

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
</script>

<style scoped>
.editor-backdrop {
  position: fixed;
  z-index: 2000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(3, 7, 12, 0.78);
  backdrop-filter: blur(4px);
}

.task-editor {
  display: flex;
  width: min(720px, 100%);
  max-height: min(900px, calc(100vh - 36px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  outline: none;
  background: #161b22;
  box-shadow: 0 26px 70px rgba(0, 0, 0, 0.55);
  color: #d7dde4;
}

.editor-header,
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  padding: 16px 20px;
  background: #1b2129;
}

/* Full-width row so the follow-up panel sits above the footer buttons. */
.follow-up-panel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(102, 126, 234, 0.42);
  border-radius: 8px;
  background: rgba(102, 126, 234, 0.1);
  color: #d7dde4;
  font-size: 0.86rem;
}

.follow-up-panel input {
  width: 72px;
}

.follow-up-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.editor-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.editor-header h2,
.editor-eyebrow {
  margin: 0;
}

.editor-eyebrow {
  color: #8da2fb;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.close-button {
  border: 0;
  background: transparent;
  color: #a8b4c0;
  font-size: 1.8rem;
  line-height: 1;
}

.close-button:hover,
.close-button:focus-visible {
  color: #fff;
}

.editor-body {
  overflow-y: auto;
  padding: 20px;
}

.editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
}

.form-group small {
  display: block;
  margin-top: 4px;
  color: #7d8792;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 14px;
}

.chunk-field {
  max-width: 260px;
}

.series-banner,
.editor-error {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-left: 3px solid #667eea;
  border-radius: 6px;
  background: rgba(102, 126, 234, 0.13);
  color: #c7d2fe;
}

.editor-error {
  border-left-color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.editor-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.task-actions,
.save-actions {
  display: flex;
  gap: 8px;
}

.confirm-delete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-top: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.12);
}

.confirm-delete .confirm-message {
  margin: 0;
  color: #fca5a5;
}

.date-input {
  color-scheme: dark;
}

@media (max-width: 760px) {
  .editor-footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .task-actions,
  .save-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  }
}

@media (max-width: 620px) {
  .editor-backdrop {
    padding: 0;
  }

  .task-editor {
    width: 100%;
    max-height: 100vh;
    min-height: 100vh;
    border: 0;
    border-radius: 0;
  }

  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
body.task-editor-open {
  overflow: hidden;
}
</style>
