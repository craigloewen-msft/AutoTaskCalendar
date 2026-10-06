<template>
  <div class="compass-drawer-backdrop" @click.self="$emit('cancel')">
    <aside class="compass-drawer" role="dialog" aria-label="Compass editor">
      <header class="drawer-header">
        <h2 class="drawer-title">{{ heading }}</h2>
        <button class="drawer-close" aria-label="Close" @click="$emit('cancel')">✕</button>
      </header>

      <div v-if="error" class="drawer-error">{{ error }}</div>

      <!-- Ending is immediate and may touch tasks, so it is confirmed in place. -->
      <div v-if="confirmingEnd" class="drawer-body end-confirm" data-test="end-confirm">
        <h3 class="end-confirm-title">End “{{ existing.title }}”?</h3>
        <p class="end-confirm-copy">
          It leaves your board and your weekly plan straight away. You can still find it in
          the Archive, and nothing is deleted.
        </p>

        <template v-if="openTasks.length">
          <p class="end-confirm-copy">
            It still has {{ openTasks.length }}
            unfinished {{ openTasks.length === 1 ? 'task' : 'tasks' }}:
          </p>
          <ul class="end-task-list">
            <li v-for="task in previewTasks" :key="task._id">{{ task.title }}</li>
            <li v-if="openTasks.length > previewTasks.length" class="end-task-more">
              and {{ openTasks.length - previewTasks.length }} more
            </li>
          </ul>

          <div class="end-choices" role="radiogroup" aria-label="What to do with the unfinished tasks">
            <label v-for="choice in taskChoices" :key="choice.value" class="end-choice">
              <input
                v-model="taskAction"
                type="radio"
                name="compass-end-task-action"
                :value="choice.value"
              />
              <span>
                <strong>{{ choice.label }}</strong>
                <small>{{ choice.hint }}</small>
              </span>
            </label>
          </div>
        </template>
        <p v-else class="end-confirm-copy">
          Nothing unfinished is left under it.
        </p>
      </div>

      <div v-else class="drawer-body">
        <div class="form-group">
          <label :for="'compass-title'">Title*</label>
          <input
            id="compass-title"
            v-model="form.title"
            type="text"
            class="form-control"
            placeholder="What is it called?"
          />
        </div>

        <div v-if="level === 'role'" class="form-group">
          <span class="form-label-text">Context</span>
          <div class="context-toggle" role="radiogroup" aria-label="Context">
            <button
              v-for="option in contexts"
              :key="option.id"
              type="button"
              role="radio"
              class="context-choice"
              :class="{ active: form.context === option.id }"
              :aria-checked="form.context === option.id"
              :data-test="'context-choice-' + option.id"
              @click="form.context = option.id"
            >
              <span aria-hidden="true">{{ option.icon }}</span> {{ option.label }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label for="compass-description">Description</label>
          <textarea
            id="compass-description"
            v-model="form.description"
            class="form-control"
            rows="2"
          ></textarea>
        </div>

        <div v-if="level !== 'role'" class="form-group">
          <label for="compass-parent">{{ parentLabel }}*</label>
          <select id="compass-parent" v-model="form.parentId" class="form-control">
            <option :value="null" disabled>Choose one</option>
            <option v-for="option in parentOptions" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label for="compass-start">Start date{{ level === 'project' ? '' : '*' }}</label>
          <DateField id="compass-start" v-model="form.startDate" />
          <small v-if="level === 'project'" class="form-text text-muted">
            Leave blank to park this as a someday project.
          </small>
        </div>

        <div class="form-group">
          <label for="compass-end">End date</label>
          <DateField
            id="compass-end"
            v-model="form.endDate"
            :disabled="isActive || !canEnd"
          />
          <label class="compass-active-toggle">
            <input type="checkbox" v-model="isActive" :disabled="!canEnd" />
            Still active (no end date)
          </label>
          <small v-if="!canEnd" class="form-text compass-blocked-hint">
            {{ endBlockedHint }}
          </small>
        </div>
      </div>

      <footer v-if="confirmingEnd" class="drawer-footer">
        <div class="drawer-footer-left"></div>
        <div class="drawer-footer-right">
          <button class="btn btn-secondary" @click="confirmingEnd = false">Back</button>
          <button class="btn btn-danger" data-test="confirm-end" @click="confirmEnd">
            {{ endActionLabel }}
          </button>
        </div>
      </footer>

      <footer v-else class="drawer-footer">
        <div class="drawer-footer-left">
          <button
            v-if="existing && !existing.endDate"
            class="btn btn-secondary"
            data-test="end-item"
            :disabled="!canEnd"
            :title="canEnd ? '' : endBlockedHint"
            @click="confirmingEnd = true"
          >
            End {{ level }}
          </button>
          <button
            v-if="existing"
            class="btn btn-danger"
            @click="$emit('delete', { level, item: existing })"
          >
            Delete
          </button>
        </div>
        <div class="drawer-footer-right">
          <button class="btn btn-secondary" @click="$emit('cancel')">Cancel</button>
          <button class="btn btn-primary" @click="submit">Save</button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<script>
import { apiDateOnly, dateOnlyInTimeZone } from "../utils/temporal";
import { CONTEXTS } from "../utils/roleContext";
import DateField from "./DateField.vue";
// One editor for all three Compass levels: they differ only by parent and a couple fields.
export default {
  name: "CompassEditorDrawer",
  components: { DateField },
  props: {
    level: { type: String, required: true },
    existing: { type: Object, default: null },
    roles: { type: Array, default: () => [] },
    // Preselected parent when adding from a role or goal card.
    parentId: { type: String, default: null },
    // The item's unfinished tasks, so ending can offer what to do with them.
    openTasks: { type: Array, default: () => [] },
    error: { type: String, default: "" },
  },
  emits: ["save", "cancel", "delete", "end"],
  data() {
    return {
      form: {
        title: "",
        description: "",
        context: "personal",
        startDate: "",
        endDate: "",
        parentId: null,
      },
      isActive: true,
      confirmingEnd: false,
      taskAction: "keep",
      contexts: CONTEXTS,
    };
  },
  computed: {
    heading() {
      if (this.confirmingEnd) return `End ${this.level}`;
      return `${this.existing ? "Edit" : "New"} ${this.level}`;
    },
    parentLabel() {
      return this.level === "goal" ? "Parent role" : "Parent goal";
    },
    // Roles for a goal; every goal, labelled by role, for a project.
    parentOptions() {
      if (this.level === "goal") {
        return this.roles.map((role) => ({ id: role._id, label: role.title }));
      }

      const options = [];
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          options.push({ id: goal._id, label: `${role.title} → ${goal.title}` });
        }
      }
      return options;
    },
    /**
     * Live children of the item being edited.
     *
     * getCompass only returns live items, so anything populated here is still active.
     * Items opened from the Archive drawer arrive without children, which is fine: they
     * have already ended, so there is nothing to guard against.
     */
    liveChildCount() {
      if (!this.existing) {
        return 0;
      }

      if (this.level === "role") {
        return (this.existing.goalList || []).length;
      }
      if (this.level === "goal") {
        return (this.existing.projectList || []).length;
      }

      // Projects have no children in the hierarchy; tasks are only unlinked, never ended.
      return 0;
    },
    childLabel() {
      const plural = this.liveChildCount === 1 ? "" : "s";
      return this.level === "role" ? `goal${plural}` : `project${plural}`;
    },
    // The API still allows ending a parent -- this only stops it happening by accident here.
    canEnd() {
      return this.liveChildCount === 0;
    },
    endBlockedHint() {
      return (
        `Ending this ${this.level} would archive its ${this.liveChildCount} active ` +
        `${this.childLabel} too. End or move ${this.liveChildCount === 1 ? "it" : "them"} first.`
      );
    },
    // A long list would push the choices off screen, so only the first few are named.
    previewTasks() {
      return this.openTasks.slice(0, 5);
    },
    taskChoices() {
      const them = this.openTasks.length === 1 ? "it" : "them";
      return [
        {
          value: "keep",
          label: `Leave ${them} alone`,
          hint: `Still on your calendar, just no longer under a ${this.level}.`,
        },
        {
          value: "unlink",
          label: `Unlink ${them}`,
          hint: "Keeps the work and lists it as unaligned, ready to reassign.",
        },
        {
          value: "complete",
          label: `Mark ${them} done`,
          hint: "Completes the work and clears it off your calendar.",
        },
      ];
    },
    endActionLabel() {
      if (!this.openTasks.length) return `End ${this.level}`;
      if (this.taskAction === "unlink") return "End and unlink";
      if (this.taskAction === "complete") return "End and complete";
      return "End anyway";
    },
  },
  created() {
    const item = this.existing;

    if (item) {
      this.form.title = item.title || "";
      this.form.description = item.description || "";
      this.form.context = item.context || "personal";
      this.form.startDate = this.toInputDate(item.startDate);
      this.form.endDate = this.toInputDate(item.endDate);
      this.form.parentId = item.roleRef || item.goalRef || null;
      this.isActive = !item.endDate;
    } else {
      this.form.parentId = this.parentId;
      this.form.startDate = dateOnlyInTimeZone(this.$store.state.user.timeZone);
    }
  },
  methods: {
    toInputDate(value) {
      return apiDateOnly(value);
    },
    submit() {
      const payload = {
        title: this.form.title,
        description: this.form.description,
        startDate: this.form.startDate || null,
        endDate: this.isActive ? null : this.form.endDate || null,
      };

      // Work vs personal is a role-level field only.
      if (this.level === "role") {
        payload.context = this.form.context;
      }

      if (this.level === "goal") {
        payload.roleRef = this.form.parentId;
      } else if (this.level === "project") {
        payload.goalRef = this.form.parentId;
      }

      if (this.existing) {
        payload._id = this.existing._id;
      }

      this.$emit("save", { level: this.level, payload, isEdit: !!this.existing });
    },
    confirmEnd() {
      this.$emit("end", {
        level: this.level,
        item: this.existing,
        taskAction: this.openTasks.length ? this.taskAction : "keep",
      });
    },
  },
};
</script>

<style scoped>
.compass-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: flex-end;
  z-index: 1050;
}

.compass-drawer {
  width: 420px;
  max-width: 100vw;
  height: 100%;
  background: rgba(30, 30, 35, 0.98);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  text-align: left;
  overflow-y: auto;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.drawer-title {
  font-size: 1.15rem;
  margin: 0;
  text-transform: capitalize;
  color: #e0e0e0;
}

.drawer-close {
  background: none;
  border: none;
  color: #9aa0a6;
  font-size: 1.1rem;
  cursor: pointer;
}

.drawer-error {
  margin: 16px 24px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(220, 53, 69, 0.15);
  border: 1px solid rgba(220, 53, 69, 0.4);
  color: #f1aeb5;
  font-size: 0.9rem;
}

.drawer-body {
  padding: 20px 24px;
  flex: 1;
}

.form-label-text {
  display: block;
  margin-bottom: 6px;
  font-size: 0.85rem;
  color: #9aa0a6;
}

.context-toggle {
  display: flex;
  gap: 6px;
}

.context-choice {
  flex: 1;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: inherit;
  opacity: 0.75;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.context-choice.active {
  background: rgba(102, 126, 234, 0.35);
  border-color: #667eea;
  opacity: 1;
}

.drawer-body .form-group {
  margin-bottom: 16px;
}

.compass-active-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 0.9rem;
  color: #b0b0b0;
  font-weight: 400;
}

.compass-blocked-hint {
  display: block;
  margin-top: 6px;
  color: #d9a441;
  font-size: 0.82rem;
}

.end-confirm-title {
  font-size: 1rem;
  color: #e0e0e0;
  margin: 0 0 10px;
}

.end-confirm-copy {
  color: #b0b0b0;
  font-size: 0.9rem;
  margin-bottom: 12px;
}

.end-task-list {
  margin: 0 0 16px;
  padding-left: 18px;
  color: #d0d0d0;
  font-size: 0.88rem;
}

.end-task-more {
  color: #9aa0a6;
  list-style: none;
  margin-left: -18px;
}

.end-choices {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.end-choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 400;
  margin: 0;
}

.end-choice:hover {
  border-color: rgba(255, 255, 255, 0.28);
}

.end-choice strong {
  display: block;
  color: #e0e0e0;
  font-size: 0.92rem;
}

.end-choice small {
  display: block;
  color: #9aa0a6;
  font-size: 0.8rem;
}

.drawer-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.drawer-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  flex-wrap: wrap;
}

.drawer-footer-left,
.drawer-footer-right {
  display: flex;
  gap: 8px;
}
</style>
