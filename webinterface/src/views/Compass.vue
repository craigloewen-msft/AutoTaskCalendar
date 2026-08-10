<template>
  <div class="compass-page">
    <BContainer class="mt-4">
      <div class="compass-header">
        <div>
          <h1 class="page-title">Compass</h1>
          <p class="text-muted compass-subtitle">Roles → Goals → Projects</p>
        </div>
        <div class="compass-header-right">
          <span class="completed-counts">
            Finished: {{ completedCounts.roles }} roles ·
            {{ completedCounts.goals }} goals ·
            {{ completedCounts.projects }} projects
          </span>
          <button class="btn btn-primary" @click="openCreate('role')">+ Role</button>
        </div>
      </div>

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
        <section
          v-for="role in activeRoles"
          :key="role._id"
          class="role-block"
        >
          <div class="role-row">
            <span class="role-swatch" :style="{ backgroundColor: roleColors[role._id] }"></span>
            <span class="role-title">{{ role.title }}</span>
            <span class="item-dates">{{ dateRange(role) }}</span>
            <button class="link-btn" :aria-label="'Edit ' + role.title" @click="openEdit('role', role)">✎</button>
            <button class="btn btn-sm btn-outline-primary" @click="openCreate('goal', role._id)">+ Goal</button>
          </div>

          <div v-for="goal in activeGoals(role)" :key="goal._id" class="goal-block">
            <div class="goal-row">
              <span class="goal-title">{{ goal.title }}</span>
              <span class="item-dates">{{ dateRange(goal) }}</span>
              <button class="link-btn" :aria-label="'Edit ' + goal.title" @click="openEdit('goal', goal)">✎</button>
              <button class="btn btn-sm btn-outline-primary" @click="openCreate('project', goal._id)">
                + Project
              </button>
            </div>

            <div
              v-for="project in activeProjects(goal)"
              :key="project._id"
              class="project-row"
            >
              <span class="project-title">{{ project.title }}</span>
              <span class="item-dates">{{ dateRange(project) }}</span>
              <button class="link-btn" :aria-label="'Edit ' + project.title" @click="openEdit('project', project)">✎</button>
              <span class="project-count">{{ activeTaskCount(project._id) }} active</span>
            </div>

            <p v-if="!activeProjects(goal).length" class="empty-note">No active projects yet.</p>
          </div>

          <p v-if="!activeGoals(role).length" class="empty-note">No active goals yet.</p>
        </section>

        <details v-if="somedayProjects.length" class="compass-drawer-section">
          <summary>Someday · {{ somedayProjects.length }} parked projects</summary>
          <div
            v-for="project in somedayProjects"
            :key="project._id"
            class="project-row"
          >
            <span class="project-title">{{ project.title }}</span>
            <span class="item-dates">{{ project.parentLabel }}</span>
            <button class="link-btn" :aria-label="'Edit ' + project.title" @click="openEdit('project', project)">✎</button>
          </div>
        </details>

        <details v-if="archivedItems.length" class="compass-drawer-section">
          <summary>Archive · {{ archiveSummary }}</summary>
          <div v-for="entry in archivedItems" :key="entry.item._id" class="project-row">
            <span class="project-title">{{ entry.item.title }}</span>
            <span class="item-dates">{{ entry.level }} · {{ dateRange(entry.item) }}</span>
            <button
              class="link-btn"
              :aria-label="'Edit ' + entry.item.title"
              @click="openEdit(entry.level, entry.item)"
            >✎</button>
          </div>
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
      :error="editor.error"
      @save="save"
      @cancel="closeEditor"
      @end="endItem"
      @delete="deleteItem"
    />
  </div>
</template>

<script>
import { BContainer } from "bootstrap-vue-next";
import CompassEditorDrawer from "../components/CompassEditorDrawer.vue";
import { buildRoleColorMap } from "../utils/roleColors";

/**
 * Compass: roles > goals > projects.
 *
 * The API returns the tree exactly as stored. Deciding what counts as active, parked, or
 * archived happens here, so the shape of the page can change without touching the server.
 */
export default {
  name: "Compass",
  components: { BContainer, CompassEditorDrawer },
  data() {
    return {
      roles: [],
      completedCounts: { roles: 0, goals: 0, projects: 0 },
      unalignedTaskCount: 0,
      taskList: [],
      loading: true,
      editor: { open: false, level: "role", existing: null, parentId: null, error: "", key: 0 },
    };
  },
  computed: {
    // Colours are derived from role order, never stored, so nobody has to pick one.
    roleColors() {
      return buildRoleColorMap(this.roles);
    },
    activeRoles() {
      return this.roles.filter((role) => !this.hasEnded(role));
    },
    // Parked projects, carrying their ladder so the drawer reads sensibly.
    somedayProjects() {
      const parked = [];

      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of goal.projectList || []) {
            if (!project.startDate && !this.hasEnded(project)) {
              parked.push({ ...project, parentLabel: `${role.title} \u2192 ${goal.title}` });
            }
          }
        }
      }

      return parked;
    },
    archivedItems() {
      const archived = [];

      for (const role of this.roles) {
        if (this.hasEnded(role)) {
          archived.push({ level: "role", item: role });
        }

        for (const goal of role.goalList || []) {
          if (this.hasEnded(goal)) {
            archived.push({ level: "goal", item: goal });
          }

          for (const project of goal.projectList || []) {
            if (this.hasEnded(project)) {
              archived.push({ level: "project", item: project });
            }
          }
        }
      }

      return archived;
    },
    archiveSummary() {
      const counts = { role: 0, goal: 0, project: 0 };
      this.archivedItems.forEach((entry) => (counts[entry.level] += 1));

      return [
        `${counts.role} ended roles`,
        `${counts.goal} ended goals`,
        `${counts.project} ended projects`,
      ].join(", ");
    },
    // Active task count per project, derived from the task list the app already loads.
    activeTasksByProject() {
      const counts = {};

      for (const task of this.taskList || []) {
        if (task.completed || !task.projectRef) continue;
        counts[task.projectRef] = (counts[task.projectRef] || 0) + 1;
      }

      return counts;
    },
  },
  methods: {
    hasEnded(item) {
      return !!item.endDate && new Date(item.endDate) <= new Date();
    },
    activeGoals(role) {
      return (role.goalList || []).filter((goal) => !this.hasEnded(goal));
    },
    // Parked projects live in the Someday drawer instead of under their goal.
    activeProjects(goal) {
      return (goal.projectList || []).filter(
        (project) => !this.hasEnded(project) && project.startDate
      );
    },
    activeTaskCount(projectId) {
      return this.activeTasksByProject[projectId] || 0;
    },
    formatDate(value) {
      if (!value) return "";
      return new Date(value).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
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
    async endItem({ level, item }) {
      try {
        const url = this.endpointFor("edit", level);
        if (await this.post(url, { _id: item._id, endDate: new Date().toISOString() })) {
          this.closeEditor();
        }
      } catch (error) {
        console.error(error);
        this.editor.error = "Something went wrong";
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
  padding-bottom: 40px;
}

.compass-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}

.page-title {
  margin-bottom: 2px;
}

.compass-subtitle {
  margin: 0;
  font-size: 0.95rem;
}

.compass-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.completed-counts {
  color: #9aa0a6;
  font-size: 0.85rem;
}

.role-block {
  margin-bottom: 26px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.role-row,
.goal-row,
.project-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  flex-wrap: wrap;
}

.role-swatch {
  width: 6px;
  height: 20px;
  border-radius: 3px;
  display: inline-block;
}

.role-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: #e8e8e8;
}

.goal-block {
  margin-left: 22px;
}

.goal-title {
  font-weight: 600;
  color: #d5d5d5;
}

.project-row {
  margin-left: 22px;
}

.project-title {
  color: #bdbdbd;
}

.item-dates {
  color: #8b9096;
  font-size: 0.82rem;
}

.project-count {
  color: #8b9096;
  font-size: 0.82rem;
  margin-left: auto;
}

.link-btn {
  background: none;
  border: none;
  color: #8b9096;
  cursor: pointer;
  padding: 0 4px;
}

.link-btn:hover {
  color: #58a6ff;
}

.empty-note {
  margin: 0 0 6px 22px;
  color: #7a7f85;
  font-size: 0.85rem;
  font-style: italic;
}

.compass-drawer-section {
  margin-top: 18px;
  padding: 10px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.compass-drawer-section summary {
  cursor: pointer;
  color: #b0b0b0;
}

.unaligned-line {
  margin-top: 18px;
  color: #8b9096;
  font-size: 0.9rem;
}
</style>
