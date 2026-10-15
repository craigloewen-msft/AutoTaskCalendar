<template>
  <div class="compass-page">
    <BContainer class="mt-4">
      <div class="compass-header">
        <div>
          <h1 class="page-title">Compass</h1>
          <p class="text-muted compass-subtitle">Roles → Goals → Projects</p>
        </div>
        <div class="compass-header-right">
          <ContextFilter v-model="contextFilter" />
          <button class="btn btn-primary" @click="openCreate('role')">+ Role</button>
        </div>
      </div>

      <p v-if="notice" class="compass-notice" role="status" data-test="compass-notice">
        {{ notice }}
        <button class="notice-dismiss" aria-label="Dismiss" @click="notice = ''">✕</button>
      </p>

      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <div v-else-if="!roles.length" class="empty-state text-center py-5">
        <h3>No roles yet</h3>
        <p class="text-muted">
          Start by naming a role you are choosing to play. Give it goals, then give those
          goals projects, and your tasks will have something to ladder up to.
        </p>
        <button class="btn btn-primary mt-2" @click="openCreate('role')">+ Role</button>
      </div>

      <div v-else class="compass-tree">
        <p v-if="!activeRoles.length" class="empty-note" data-test="context-empty">
          No {{ contextFilter }} roles. Switch the filter above to see the rest.
        </p>
        <section
          v-for="role in activeRoles"
          :key="role._id"
          class="role-card"
          :style="{ '--role-color': roleColors[role._id] }"
        >
          <header class="role-head">
            <div class="role-identity">
              <span class="role-title">{{ role.title }}</span>
              <span class="context-badge" data-test="role-context">
                {{ contextMeta(roleContextOf(role)).icon }} {{ contextMeta(roleContextOf(role)).label }}
              </span>
            </div>
            <div class="row-actions">
              <span class="item-dates">{{ dateRange(role) }}</span>
              <button class="link-btn" :aria-label="'Edit ' + role.title" @click="openEdit('role', role)">✎</button>
              <button class="btn btn-sm btn-outline-primary" @click="openCreate('goal', role._id)">+ Goal</button>
            </div>
          </header>

          <div class="role-body">
            <div v-for="goal in activeGoals(role)" :key="goal._id" class="goal-block">
              <div class="goal-row">
                <span class="goal-title">{{ goal.title }}</span>
                <div class="row-actions">
                  <span class="item-dates">{{ dateRange(goal) }}</span>
                  <button class="link-btn" :aria-label="'Edit ' + goal.title" @click="openEdit('goal', goal)">✎</button>
                  <button class="btn btn-sm btn-outline-primary" @click="openCreate('project', goal._id)">
                    + Project
                  </button>
                </div>
              </div>

              <ul v-if="activeProjects(goal).length" class="project-list">
                <li
                  v-for="project in activeProjects(goal)"
                  :key="project._id"
                  class="project-row"
                >
                  <span class="project-title">{{ project.title }}</span>
                  <div class="row-actions">
                    <span class="item-dates">{{ dateRange(project) }}</span>
                    <span class="project-count">{{ activeTaskCount(project._id) }} active</span>
                    <button class="link-btn" :aria-label="'Edit ' + project.title" @click="openEdit('project', project)">✎</button>
                  </div>
                </li>
              </ul>

              <p v-else class="empty-note">No active projects yet.</p>
            </div>

            <p v-if="!activeGoals(role).length" class="empty-note">No active goals yet.</p>
          </div>
        </section>

        <details v-if="somedayProjects.length" class="compass-drawer-section">
          <summary>Someday · {{ somedayProjects.length }} parked projects</summary>
          <ul class="project-list">
            <li
              v-for="project in somedayProjects"
              :key="project._id"
              class="project-row"
            >
              <span class="project-title">{{ project.title }}</span>
              <div class="row-actions">
                <span class="item-dates">{{ project.parentLabel }}</span>
                <button class="link-btn" :aria-label="'Edit ' + project.title" @click="openEdit('project', project)">✎</button>
              </div>
            </li>
          </ul>
        </details>

        <details v-if="hasArchive" class="compass-drawer-section" @toggle="onArchiveToggle">
          <summary>Archive · {{ archiveSummary }}</summary>

          <div class="archive-levels" role="group" aria-label="Archive level">
            <button
              v-for="level in archiveLevels"
              :key="level"
              class="archive-tab"
              :class="{ active: archive.level === level }"
              :aria-pressed="archive.level === level ? 'true' : 'false'"
              @click="loadArchive(level)"
            >
              {{ level }}s ({{ completedCounts[level + 's'] }})
            </button>
          </div>

          <p v-if="archive.loading" class="empty-note">Loading…</p>

          <ul v-if="archive.items.length" class="project-list">
            <li v-for="item in archive.items" :key="item._id" class="project-row">
              <span class="project-title">{{ item.title }}</span>
              <div class="row-actions">
                <span class="item-dates">{{ archive.level }} · {{ dateRange(item) }}</span>
                <button
                  class="link-btn"
                  :aria-label="'Edit ' + item.title"
                  @click="openEdit(archive.level, item)"
                >✎</button>
              </div>
            </li>
          </ul>

          <p v-if="!archive.loading && !archive.items.length" class="empty-note">
            Nothing finished at this level yet.
          </p>

          <button
            v-if="archive.hasMore"
            class="btn btn-sm btn-outline-primary"
            :disabled="archive.loading"
            @click="loadArchive(archive.level, true)"
          >
            Load more ({{ archive.totalCount - archive.items.length }} remaining)
          </button>
        </details>

        <p class="unaligned-line">Unaligned tasks: {{ unalignedTaskCount }}</p>
      </div>
    </BContainer>

    <CompassEditorDrawer
      v-if="editor.open"
      :key="editor.key"
      :level="editor.level"
      :existing="editor.existing"
      :roles="roles"
      :parent-id="editor.parentId"
      :open-tasks="editorOpenTasks"
      :error="editor.error"
      @save="save"
      @cancel="closeEditor"
      @end="endItem"
      @delete="deleteItem"
    />
  </div>
</template>

<script>
import { formatCivilDate } from "../utils/temporal";
import { BContainer } from "bootstrap-vue-next";
import CompassEditorDrawer from "../components/CompassEditorDrawer.vue";
import { buildRoleColorMap } from "../utils/roleColors";
import ContextFilter from "../components/ContextFilter";
import { contextMeta, filterRolesByContext, readContextFilter, roleContextOf } from "../utils/roleContext";
import { useSeo } from '@/composables/useSeo';

/**
 * Compass: roles > goals > projects.
 *
 * The API returns the tree exactly as stored. Deciding what counts as active, parked, or
 * archived happens here, so the shape of the page can change without touching the server.
 */
export default {
  name: "Compass",
  setup() {
    useSeo({ title: 'Compass', noindex: true });
  },
  components: { BContainer, CompassEditorDrawer, ContextFilter },
  data() {
    return {
      roles: [],
      completedCounts: { roles: 0, goals: 0, projects: 0 },
      unalignedTaskCount: 0,
      taskList: [],
      loading: true,
      archiveLevels: ["role", "goal", "project"],
      archive: { level: "role", items: [], totalCount: 0, hasMore: false, loading: false, loaded: false },
      editor: { open: false, level: "role", existing: null, parentId: null, error: "", key: 0 },
      notice: "",
      contextFilter: readContextFilter(),
    };
  },
  computed: {
    // Colours are derived from role order, never stored, so nobody has to pick one.
    roleColors() {
      return buildRoleColorMap(this.roles);
    },
    // The API only sends live roles; the context filter is the only narrowing on top.
    activeRoles() {
      return filterRolesByContext(this.roles, this.contextFilter);
    },
    // Parked projects, carrying their ladder so the drawer reads sensibly.
    somedayProjects() {
      const parked = [];

      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of goal.projectList || []) {
            if (!project.startDate) {
              parked.push({ ...project, parentLabel: `${role.title} \u2192 ${goal.title}` });
            }
          }
        }
      }

      return parked;
    },
    hasArchive() {
      const { roles, goals, projects } = this.completedCounts;
      return roles + goals + projects > 0;
    },
    archiveSummary() {
      const { roles, goals, projects } = this.completedCounts;

      return [
        `${roles} ended roles`,
        `${goals} ended goals`,
        `${projects} ended projects`,
      ].join(", ");
    },
    // Active tasks per project, derived from the task list the app already loads.
    activeTasksByProject() {
      const grouped = {};

      for (const task of this.taskList || []) {
        if (task.completed || !task.projectRef) continue;
        if (!grouped[task.projectRef]) grouped[task.projectRef] = [];
        grouped[task.projectRef].push(task);
      }

      return grouped;
    },
    // The unfinished tasks the editor would affect if this item were ended.
    editorOpenTasks() {
      const item = this.editor.existing;
      if (!item) return [];

      if (this.editor.level === "project") {
        return this.activeTasksByProject[item._id] || [];
      }

      const goals = this.editor.level === "role" ? item.goalList || [] : [item];

      return goals.flatMap((goal) => (goal.projectList || [])
        .flatMap((project) => this.activeTasksByProject[project._id] || []));
    },
  },
  methods: {
    contextMeta,
    roleContextOf,
    activeGoals(role) {
      return role.goalList || [];
    },
    // Parked projects live in the Someday drawer instead of under their goal.
    activeProjects(goal) {
      return (goal.projectList || []).filter((project) => project.startDate);
    },
    activeTaskCount(projectId) {
      return (this.activeTasksByProject[projectId] || []).length;
    },
    formatDate(value) {
      return formatCivilDate(value, { month: "short", year: "numeric" });
    },
    dateRange(item) {
      if (!item.startDate && !item.endDate) return "someday";
      if (!item.startDate) return `until ${this.formatDate(item.endDate)}`;
      if (!item.endDate) return `since ${this.formatDate(item.startDate)}`;
      return `${this.formatDate(item.startDate)} – ${this.formatDate(item.endDate)}`;
    },
    applyPayload(data) {
      this.roles = data.roles || [];
      this.completedCounts = data.completedCounts || { roles: 0, goals: 0, projects: 0 };
      this.unalignedTaskCount = data.unalignedTaskCount || 0;

      // Ending or deleting something changes the archive, so refetch it if it's open.
      if (this.archive.loaded) {
        this.loadArchive(this.archive.level);
      }
    },
    // Only fetch the archive when the drawer is actually opened.
    onArchiveToggle(event) {
      if (event.target.open && !this.archive.loaded) {
        this.loadArchive(this.archive.level);
      }
    },
    async loadArchive(level, append = false) {
      this.archive.loading = true;

      try {
        const skip = append ? this.archive.items.length : 0;
        const response = await this.$http.get('/api/getCompassArchive', {
          params: { level, skip, limit: 20 },
        });

        if (response.data.success) {
          this.archive.level = level;
          this.archive.items = append
            ? [...this.archive.items, ...response.data.items]
            : response.data.items;
          this.archive.totalCount = response.data.totalCount;
          this.archive.hasMore = response.data.hasMore;
          this.archive.loaded = true;
        }
      } catch (error) {
        console.error(error);
      } finally {
        this.archive.loading = false;
      }
    },
    async load() {
      this.loading = true;
      try {
        const [compass, tasks] = await Promise.all([
          this.$http.get("/api/getCompass"),
          this.$http.get("/api/getUserTasks"),
        ]);

        if (compass.data.success) {
          this.applyPayload(compass.data);
        }
        if (tasks.data.success) {
          this.taskList = tasks.data.taskList || [];
        }
      } catch (error) {
        console.error(error);
      } finally {
        this.loading = false;
      }
    },
    openCreate(level, parentId = null) {
      this.editor = {
        open: true,
        level,
        existing: null,
        parentId,
        error: "",
        key: this.editor.key + 1,
      };
    },
    openEdit(level, item) {
      this.editor = {
        open: true,
        level,
        existing: item,
        parentId: null,
        error: "",
        key: this.editor.key + 1,
      };
    },
    closeEditor() {
      this.editor.open = false;
    },
    endpointFor(action, level) {
      const suffix = level.charAt(0).toUpperCase() + level.slice(1);
      return `/api/${action}${suffix}`;
    },
    // Every mutation returns the refreshed payload, so there is nothing to re-fetch.
    async post(url, body) {
      const response = await this.$http.post(url, body);

      if (!response.data.success) {
        this.editor.error = response.data.log || "Something went wrong";
        return false;
      }

      this.applyPayload(response.data);
      return true;
    },
    async save({ level, payload, isEdit }) {
      try {
        const url = this.endpointFor(isEdit ? "edit" : "create", level);
        if (await this.post(url, payload)) {
          this.closeEditor();
        }
      } catch (error) {
        console.error(error);
        this.editor.error = "Something went wrong";
      }
    },
    // Ending is the gentle option: it keeps the item and its history.
    async endItem({ level, item, taskAction }) {
      try {
        const url = this.endpointFor("end", level);
        const response = await this.$http.post(url, { _id: item._id, taskAction });

        if (!response.data.success) {
          this.editor.error = response.data.log || "Something went wrong";
          return;
        }

        this.applyPayload(response.data);
        // The task list moves too when tasks were completed or unlinked.
        if (taskAction && taskAction !== "keep") this.reloadTasks();
        this.notice = this.endNotice(item, response.data);
        this.closeEditor();
      } catch (error) {
        console.error(error);
        this.editor.error = "Something went wrong";
      }
    },
    // Ending makes the item vanish, so say what happened rather than leaving it silent.
    endNotice(item, data) {
      const count = data.affectedTaskCount || 0;
      const noun = count === 1 ? "task" : "tasks";
      if (!count) return `“${item.title}” ended. Find it in the Archive.`;
      const verb = data.taskAction === "complete" ? "completed" : "unlinked";
      return `“${item.title}” ended · ${count} ${noun} ${verb}.`;
    },
    async reloadTasks() {
      try {
        const tasks = await this.$http.get("/api/getUserTasks");
        if (tasks.data.success) this.taskList = tasks.data.taskList || [];
      } catch (error) {
        console.error(error);
      }
    },
    async deleteItem({ level, item }) {
      try {
        const url = this.endpointFor("delete", level);
        const response = await this.$http.post(url, { _id: item._id });

        if (response.data.success) {
          this.applyPayload(response.data);
          this.closeEditor();
          return;
        }

        // The API refuses to delete something with children unless asked twice.
        const message = response.data.log || "Something went wrong";
        if (message.includes('cascade')) {
          const confirmed = window.confirm(
            `${message}\n\nDelete it and everything under it? Tasks will be kept and simply unlinked.`
          );

          if (confirmed && (await this.post(url, { _id: item._id, cascade: true }))) {
            this.closeEditor();
          }
          return;
        }

        this.editor.error = message;
      } catch (error) {
        console.error(error);
        this.editor.error = "Something went wrong";
      }
    },
  },
  mounted() {
    this.load();
  },
};
</script>

<style scoped>
.compass-page {
  text-align: left;
  padding-bottom: var(--space-7);
}

.compass-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: var(--radius-md);
  background: var(--success-soft);
  color: var(--success-text);
  font-size: var(--fs-md);
}

.notice-dismiss {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: var(--fs-sm);
}

.compass-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.page-title {
  margin-bottom: var(--space-1);
  font-size: var(--fs-2xl);
}

.compass-subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-md);
}

.compass-header-right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

/* A role is a card, with its colour carried on the left edge rather than in a
   loose swatch. Hierarchy comes from the surfaces, not from indentation alone. */
.role-card {
  margin-bottom: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--role-color, var(--accent));
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  box-shadow: var(--elev-1);
  overflow: hidden;
}

.role-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(90deg, var(--accent-softer), transparent 60%);
}

.role-identity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.role-title {
  color: var(--text-primary);
  font-size: var(--fs-lg);
  font-weight: 600;
}

.role-body {
  padding: var(--space-3) var(--space-5) var(--space-4);
}

.goal-block {
  padding: var(--space-3) 0;
}

.goal-block + .goal-block {
  border-top: 1px solid var(--border-subtle);
}

.goal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.goal-title {
  color: var(--text-primary);
  font-weight: 600;
}

/* Projects sit on a raised surface, so a goal's children read as a group. */
.project-list {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.project-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  transition: background var(--motion) var(--ease);
}

.project-row + .project-row {
  border-top: 1px solid var(--border-subtle);
}

.project-row:hover {
  background: var(--surface-3);
}

.project-title {
  color: var(--text-secondary);
  font-size: var(--fs-md);
  min-width: 0;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.item-dates {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.project-count {
  color: var(--text-faint);
  font-size: var(--fs-sm);
  white-space: nowrap;
}

.link-btn {
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px var(--space-1);
  transition: color var(--motion) var(--ease), background var(--motion) var(--ease);
}

.link-btn:hover {
  color: var(--accent-300);
  background: var(--accent-soft);
}

.context-badge {
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.empty-note {
  margin: var(--space-2) 0 0;
  color: var(--text-faint);
  font-size: var(--fs-sm);
  font-style: italic;
}

.compass-drawer-section {
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-1);
}

.compass-drawer-section summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: var(--fs-md);
  font-weight: 500;
}

.compass-drawer-section summary:hover {
  color: var(--text-primary);
}

/* Segmented control, rather than three loose outlined buttons. */
.archive-levels {
  display: inline-flex;
  gap: 2px;
  margin: var(--space-3) 0;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.archive-tab {
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  padding: var(--space-1) var(--space-3);
  font-size: var(--fs-sm);
  text-transform: capitalize;
  cursor: pointer;
  transition: background var(--motion) var(--ease), color var(--motion) var(--ease);
}

.archive-tab:hover {
  color: var(--text-primary);
}

.archive-tab.active {
  background: var(--accent);
  color: #fff;
}

.empty-state h3 {
  margin-bottom: var(--space-3);
}

.unaligned-line {
  margin-top: var(--space-5);
  color: var(--text-muted);
  font-size: var(--fs-md);
}
</style>
