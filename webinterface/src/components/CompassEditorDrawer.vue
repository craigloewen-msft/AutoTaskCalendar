<template>
  <div class="compass-drawer-backdrop" @click.self="$emit('cancel')">
    <aside class="compass-drawer" role="dialog" aria-label="Compass editor">
      <header class="drawer-header">
        <h2 class="drawer-title">{{ heading }}</h2>
        <button class="drawer-close" aria-label="Close" @click="$emit('cancel')">✕</button>
      </header>

      <div v-if="error" class="drawer-error">{{ error }}</div>

      <div class="drawer-body">
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
          <input
            id="compass-start"
            v-model="form.startDate"
            type="date"
            class="form-control"
          />
          <small v-if="level === 'project'" class="form-text text-muted">
            Leave blank to park this as a someday project.
          </small>
        </div>

        <div class="form-group">
          <label for="compass-end">End date</label>
          <input
            id="compass-end"
            v-model="form.endDate"
            type="date"
            class="form-control"
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

      <footer class="drawer-footer">
        <div class="drawer-footer-left">
          <button
            v-if="existing && !existing.endDate"
            class="btn btn-secondary"
            :disabled="!canEnd"
            :title="canEnd ? '' : endBlockedHint"
            @click="$emit('end', { level, item: existing })"
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
// One editor for all three Compass levels: they differ only by parent and a couple fields.
export default {
  name: "CompassEditorDrawer",
  props: {
    level: { type: String, required: true },
    existing: { type: Object, default: null },
    roles: { type: Array, default: () => [] },
    // Preselected parent when adding from a role or goal card.
    parentId: { type: String, default: null },
    error: { type: String, default: "" },
  },
  emits: ["save", "cancel", "delete", "end"],
  data() {
    return {
      form: {
        title: "",
        description: "",
        startDate: "",
        endDate: "",
        parentId: null,
      },
      isActive: true,
    };
  },
  computed: {
    heading() {
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
  },
  created() {
    const item = this.existing;

    if (item) {
      this.form.title = item.title || "";
      this.form.description = item.description || "";
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
