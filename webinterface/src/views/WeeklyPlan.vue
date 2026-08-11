<template>
  <div class="weekly-plan-page">
    <BContainer class="py-4">
      <header class="plan-header">
        <div>
          <p class="eyebrow">Compass review</p>
          <h1>Weekly plan</h1>
          <p
            class="week-range"
            data-test="week-range"
            :data-week-start="week.startDate"
            :data-week-end="week.endDate"
          >
            {{ formattedWeekRange }}
          </p>
          <p class="header-copy">
            Review your direction, then create ordinary tasks for the week. They will be
            auto-scheduled using their normal dates and priority.
          </p>
        </div>
        <div v-if="!loading && !loadError" class="plan-overview" data-test="weekly-overview">
          <strong>{{ weeklyTasks.length }} {{ taskNoun(weeklyTasks.length) }}</strong>
          <span>{{ formatDuration(weeklyDuration) }} due this week</span>
          <router-link class="btn btn-outline-primary" to="/calendar">Go to calendar</router-link>
        </div>
      </header>

      <div v-if="loading" class="loading-state" role="status">
        <span class="spinner-border text-primary" aria-hidden="true"></span>
        <span>Loading your weekly plan…</span>
      </div>

      <div v-else-if="loadError" class="error-state" role="alert" data-test="weekly-plan-error">
        <h2>Weekly plan could not be loaded</h2>
        <p>{{ loadError }}</p>
        <button class="btn btn-primary" type="button" @click="load">Try again</button>
      </div>

      <div v-else-if="!roles.length" class="empty-state">
        <h2>Start with your Compass</h2>
        <p>Add a role, a goal, and a project before planning tasks around them.</p>
        <router-link class="btn btn-primary" to="/compass">Set up Compass</router-link>
      </div>

      <main v-else class="role-grid" data-test="weekly-hierarchy">
        <article
          v-for="role in roles"
          :key="role._id"
          class="role-card"
          :data-role-id="role._id"
        >
          <header class="role-heading">
            <span class="role-swatch" :style="{ backgroundColor: roleColors[role._id] }"></span>
            <div>
              <h2>{{ role.title }}</h2>
              <p v-if="role.description" class="description">{{ role.description }}</p>
              <p class="date-range">{{ compassDateRange(role) }}</p>
            </div>
          </header>

          <div v-if="!(role.goalList || []).length" class="hierarchy-empty">
            No active goals. <router-link to="/compass">Add one in Compass</router-link>.
          </div>

          <section v-for="goal in role.goalList || []" :key="goal._id" class="goal-card">
            <header class="goal-heading">
              <div>
                <h3>{{ goal.title }}</h3>
                <p v-if="goal.description" class="description">{{ goal.description }}</p>
              </div>
              <span class="date-range">{{ compassDateRange(goal) }}</span>
            </header>

            <div v-if="!startedProjects(goal).length" class="hierarchy-empty">
              No started projects. <router-link to="/compass">Review this goal in Compass</router-link>.
            </div>

            <section
              v-for="project in startedProjects(goal)"
              :key="project._id"
              class="project-card"
              :data-project-id="project._id"
            >
              <header class="project-heading">
                <div>
                  <h4>{{ project.title }}</h4>
                  <p v-if="project.description" class="description">{{ project.description }}</p>
                  <span class="date-range">{{ compassDateRange(project) }}</span>
                </div>
                <div class="project-total">
                  {{ tasksForProject(project._id, true).length }}
                  {{ taskNoun(tasksForProject(project._id, true).length) }} ·
                  {{ formatDuration(durationFor(tasksForProject(project._id, true))) }}
                </div>
              </header>

              <ul
                v-if="tasksForProject(project._id, true).length"
                class="task-list"
                :data-test="`week-tasks-${project._id}`"
              >
                <li v-for="task in tasksForProject(project._id, true)" :key="task._id">
                  <button
                    class="task-row task-button"
                    type="button"
                    :data-test="`edit-weekly-task-${task._id}`"
                    @click="openTask(task, $event)"
                  >
                    <span>
                      <span v-if="task.seriesRef" class="task-marker" title="Repeating task" aria-label="Repeating task">↻</span>
                      <strong>{{ task.title }}</strong>
                      <span v-if="task.isBacklog" class="task-badge">Backlog</span>
                    </span>
                    <span class="task-meta">
                      <span>{{ dueLabel(task) }}</span>
                      <span>{{ formatDuration(Number(task.duration) || 0) }}</span>
                    </span>
                  </button>
                </li>
              </ul>
              <p v-else class="nothing-planned">Nothing planned for this week yet.</p>

              <details v-if="tasksForProject(project._id, false).length" class="other-tasks">
                <summary>
                  Other active tasks · {{ tasksForProject(project._id, false).length }}
                </summary>
                <ul class="task-list compact">
                  <li v-for="task in tasksForProject(project._id, false)" :key="task._id">
                    <button class="task-row task-button" type="button" @click="openTask(task, $event)">
                      <span>
                        <span v-if="task.seriesRef" class="task-marker" title="Repeating task" aria-label="Repeating task">↻</span>
                        <strong>{{ task.title }}</strong>
                        <span v-if="task.isBacklog" class="task-badge">Backlog</span>
                      </span>
                      <span class="task-meta">
                        <span>{{ dueLabel(task) }}</span>
                        <span>{{ formatDuration(Number(task.duration) || 0) }}</span>
                      </span>
                    </button>
                  </li>
                </ul>
              </details>

              <form
                class="quick-task-form"
                :data-test="`quick-task-${project._id}`"
                @submit.prevent="createTask(project)"
              >
                <div class="quick-task-title">
                  <strong>Quick task</strong>
                  <span>for {{ project.title }}</span>
                </div>
                <div class="quick-fields">
                  <div class="field title-field">
                    <label :for="`quick-title-${project._id}`">Task title</label>
                    <input
                      :id="`quick-title-${project._id}`"
                      v-model="forms[project._id].title"
                      class="form-control"
                      type="text"
                      required
                    />
                  </div>
                  <div class="field duration-field">
                    <label :for="`quick-duration-${project._id}`">Minutes</label>
                    <input
                      :id="`quick-duration-${project._id}`"
                      v-model.number="forms[project._id].duration"
                      class="form-control"
                      type="number"
                      min="1"
                      step="1"
                      required
                    />
                  </div>
                  <div class="field due-field">
                    <label :for="`quick-due-${project._id}`">Due date</label>
                    <input
                      :id="`quick-due-${project._id}`"
                      v-model="forms[project._id].dueDate"
                      class="form-control date-input"
                      type="date"
                      :min="week.startDate"
                      :max="week.endDate"
                      required
                    />
                  </div>
                  <button class="btn btn-primary add-task-button" type="submit" :disabled="forms[project._id].saving">
                    {{ forms[project._id].saving ? "Adding…" : "Add task" }}
                  </button>
                </div>
                <p
                  v-if="forms[project._id].message"
                  class="form-message"
                  :class="{ error: forms[project._id].error }"
                  :role="forms[project._id].error ? 'alert' : 'status'"
                  :data-test="`quick-status-${project._id}`"
                >
                  {{ forms[project._id].message }}
                </p>
              </form>
            </section>
          </section>
        </article>
      </main>

      <details
        v-if="!loading && !loadError && somedayProjects.length"
        class="lower-section someday-section"
        data-test="someday-projects"
      >
        <summary>
          Someday · {{ somedayProjects.length }} parked projects<span v-if="somedayWeeklyTasks.length">
            · {{ somedayWeeklyTasks.length }} {{ taskNoun(somedayWeeklyTasks.length) }} due this week</span>
        </summary>
        <p>Start these projects in Compass before creating new weekly work beneath them.</p>
        <ul>
          <li v-for="project in somedayProjects" :key="project._id">
            <strong>{{ project.title }}</strong>
            <span>{{ project.parentLabel }}</span>
            <p v-if="project.description">{{ project.description }}</p>
            <ul v-if="tasksForProject(project._id, true).length" class="parked-task-list">
              <li v-for="task in tasksForProject(project._id, true)" :key="task._id">
                <button class="task-row task-button" type="button" @click="openTask(task, $event)">
                  <strong>{{ task.title }}</strong>
                  <span>{{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <router-link to="/compass">Manage Someday projects in Compass</router-link>
      </details>

      <details
        v-if="!loading && !loadError && outsideCompassWeeklyTasks.length"
        class="lower-section"
        data-test="outside-compass-tasks"
      >
        <summary>
          Outside active Compass · {{ outsideCompassWeeklyTasks.length }}
          {{ taskNoun(outsideCompassWeeklyTasks.length) }} due this week
        </summary>
        <p>These tasks belong to a project that is no longer in the active Compass hierarchy.</p>
        <ul class="task-list">
          <li v-for="task in outsideCompassWeeklyTasks" :key="task._id">
            <button class="task-row task-button" type="button" @click="openTask(task, $event)">
              <strong>{{ task.title }}</strong>
              <span class="task-meta">{{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}</span>
            </button>
          </li>
        </ul>
      </details>

      <details
        v-if="!loading && !loadError && unalignedWeeklyTasks.length"
        class="lower-section"
        data-test="unaligned-tasks"
      >
        <summary>Unaligned tasks · {{ unalignedWeeklyTasks.length }} due this week</summary>
        <p>Alignment is optional. Assign a task when its project is clear.</p>
        <ul class="unaligned-list">
          <li v-for="task in unalignedWeeklyTasks" :key="task._id" class="unaligned-row">
            <button class="unaligned-task-button" type="button" @click="openTask(task, $event)">
              <strong>{{ task.title }}</strong>
              <span>{{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}</span>
            </button>
            <div class="align-controls">
              <label :for="`align-${task._id}`" class="visually-hidden">Project for {{ task.title }}</label>
              <select :id="`align-${task._id}`" v-model="alignmentSelections[task._id]" class="form-control">
                <option value="">Choose a project</option>
                <optgroup v-for="group in projectOptionGroups" :key="group.label" :label="group.label">
                  <option v-for="project in group.projects" :key="project._id" :value="project._id">
                    {{ project.title }}
                  </option>
                </optgroup>
              </select>
              <button
                class="btn btn-outline-primary"
                type="button"
                :disabled="!alignmentSelections[task._id] || aligningTaskId === task._id"
                @click="alignTask(task)"
              >
                {{ aligningTaskId === task._id ? "Assigning…" : "Assign" }}
              </button>
            </div>
            <p v-if="alignmentMessages[task._id]" class="form-message error" role="alert">
              {{ alignmentMessages[task._id] }}
            </p>
          </li>
        </ul>
      </details>
    </BContainer>

    <TaskEditor
      v-if="selectedTask"
      :key="selectedTask._id"
      :task="selectedTask"
      :tasks="taskList"
      :project-groups="editorProjectOptionGroups"
      :working-days="$store.state.user?.workingDays || []"
      @close="closeTaskEditor"
      @changed="applyTaskChanges"
    />
  </div>
</template>

<script>
import { BContainer } from "bootstrap-vue-next";
import TaskEditor from "../components/TaskEditor.vue";
import { buildRoleColorMap } from "../utils/roleColors";
import {
  apiDateOnly,
  dateOnlyInTimeZone,
  formatCivilDate,
  mondayWeekBounds,
} from "../utils/temporal";

export default {
  name: "WeeklyPlan",
  components: { BContainer, TaskEditor },
  data() {
    const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);

    return {
      roles: [],
      taskList: [],
      selectedTask: null,
      lastTaskTrigger: null,
      forms: {},
      alignmentSelections: {},
      alignmentMessages: {},
      aligningTaskId: null,
      loading: true,
      compassError: "",
      taskError: "",
      today,
      week: mondayWeekBounds(today),
    };
  },
  computed: {
    loadError() {
      return this.compassError || this.taskError;
    },
    roleColors() {
      return buildRoleColorMap(this.roles);
    },
    formattedWeekRange() {
      if (!this.week) return "";
      const options = { weekday: "short", month: "short", day: "numeric" };
      return `${formatCivilDate(this.week.startDate, options)} – ${formatCivilDate(this.week.endDate, options)}`;
    },
    weeklyTasks() {
      return this.sortTasks(this.taskList.filter((task) => this.isDueThisWeek(task)));
    },
    weeklyDuration() {
      return this.durationFor(this.weeklyTasks);
    },
    unalignedWeeklyTasks() {
      return this.weeklyTasks.filter((task) => !task.projectRef);
    },
    compassProjectIds() {
      const ids = new Set();
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of goal.projectList || []) ids.add(project._id);
        }
      }
      return ids;
    },
    somedayWeeklyTasks() {
      const ids = new Set(this.somedayProjects.map((project) => project._id));
      return this.weeklyTasks.filter((task) => ids.has(task.projectRef));
    },
    outsideCompassWeeklyTasks() {
      return this.weeklyTasks.filter((task) => {
        return task.projectRef && !this.compassProjectIds.has(task.projectRef);
      });
    },
    somedayProjects() {
      const projects = [];
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of goal.projectList || []) {
            if (!project.startDate) {
              projects.push({ ...project, parentLabel: `${role.title} → ${goal.title}` });
            }
          }
        }
      }
      return projects;
    },
    projectOptionGroups() {
      const groups = [];
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          const projects = this.startedProjects(goal);
          if (projects.length) groups.push({ label: `${role.title} → ${goal.title}`, projects });
        }
      }
      return groups;
    },
    editorProjectOptionGroups() {
      const groups = [];
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          const projects = goal.projectList || [];
          if (projects.length) groups.push({ label: `${role.title} → ${goal.title}`, projects });
        }
      }
      return groups;
    },
  },
  methods: {
    async load() {
      this.refreshTemporal();
      this.loading = true;
      this.compassError = "";
      this.taskError = "";
      this.roles = [];
      this.taskList = [];
      this.forms = {};

      const [compassResult, taskResult] = await Promise.allSettled([
        this.$http.get("/api/getCompass"),
        this.$http.get("/api/getUserTasks"),
      ]);

      if (compassResult.status === "fulfilled" && compassResult.value.data.success) {
        this.roles = compassResult.value.data.roles || [];
        this.initializeForms();
      } else {
        this.compassError = compassResult.status === "fulfilled"
          ? compassResult.value.data.log || "Your Compass could not be loaded."
          : "Your Compass could not be loaded.";
      }

      if (taskResult.status === "fulfilled" && taskResult.value.data.success) {
        this.taskList = taskResult.value.data.taskList || [];
      } else {
        this.taskError = taskResult.status === "fulfilled"
          ? taskResult.value.data.log || "Your tasks could not be loaded."
          : "Your tasks could not be loaded.";
      }

      this.loading = false;
    },
    refreshTemporal() {
      const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);
      const nextWeek = mondayWeekBounds(today);
      const weekChanged = nextWeek && this.week?.startDate !== nextWeek.startDate;
      this.today = today;
      this.week = nextWeek;

      if (weekChanged) {
        for (const form of Object.values(this.forms)) {
          form.dueDate = nextWeek.endDate;
          form.error = false;
          form.message = "";
        }
      }
    },
    handleVisibilityChange() {
      if (document.visibilityState === "visible") this.refreshTemporal();
    },
    initializeForms() {
      const next = {};
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of this.startedProjects(goal)) {
            next[project._id] = this.forms[project._id] || this.blankForm();
          }
        }
      }
      this.forms = next;
    },
    blankForm() {
      return {
        title: "",
        duration: 30,
        dueDate: this.week?.endDate || "",
        saving: false,
        error: false,
        message: "",
      };
    },
    startedProjects(goal) {
      return (goal.projectList || []).filter((project) => !!project.startDate);
    },
    isDueThisWeek(task) {
      const dueDate = apiDateOnly(task.dueDate);
      return !!dueDate && dueDate >= this.week.startDate && dueDate <= this.week.endDate;
    },
    tasksForProject(projectId, thisWeek) {
      return this.sortTasks(this.taskList.filter((task) => {
        return task.projectRef === projectId && this.isDueThisWeek(task) === thisWeek;
      }));
    },
    sortTasks(tasks) {
      return [...tasks].sort((left, right) => {
        const leftDate = apiDateOnly(left.dueDate) || "9999-12-31";
        const rightDate = apiDateOnly(right.dueDate) || "9999-12-31";
        return leftDate.localeCompare(rightDate)
          || (Number(left.priority ?? 100) - Number(right.priority ?? 100))
          || String(left.title || "").localeCompare(String(right.title || ""));
      });
    },
    durationFor(tasks) {
      return tasks.reduce((total, task) => total + (Number(task.duration) || 0), 0);
    },
    formatDuration(minutes) {
      const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
      const hours = Math.floor(safeMinutes / 60);
      const remainder = safeMinutes % 60;
      if (!hours) return `${remainder}m`;
      return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
    },
    taskNoun(count) {
      return count === 1 ? "task" : "tasks";
    },
    dueLabel(task) {
      if (task.isBacklog || !task.dueDate) return "Backlog";
      return formatCivilDate(task.dueDate, { weekday: "short", month: "short", day: "numeric" });
    },
    compassDateRange(item) {
      const start = item.startDate
        ? formatCivilDate(item.startDate, { month: "short", year: "numeric" })
        : "";
      const end = item.endDate
        ? formatCivilDate(item.endDate, { month: "short", year: "numeric" })
        : "";
      if (!start && !end) return "Someday";
      if (!start) return `until ${end}`;
      if (!end) return `since ${start}`;
      return `${start} – ${end}`;
    },
    openTask(task, event) {
      this.lastTaskTrigger = event?.currentTarget || null;
      this.selectedTask = task;
    },
    closeTaskEditor() {
      this.selectedTask = null;
      this.$nextTick(() => this.lastTaskTrigger?.focus());
    },
    applyTaskChanges(taskList) {
      this.taskList = taskList;
      this.closeTaskEditor();
    },
    async createTask(project) {
      this.refreshTemporal();
      const form = this.forms[project._id];
      form.error = false;
      form.message = "";
      const title = form.title.trim();
      const duration = Number(form.duration);

      if (!title) {
        form.error = true;
        form.message = "Enter a task title.";
        return;
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        form.error = true;
        form.message = "Duration must be at least one minute.";
        return;
      }
      if (form.dueDate < this.week.startDate || form.dueDate > this.week.endDate) {
        form.error = true;
        form.message = "Choose a due date in the displayed week.";
        return;
      }

      form.saving = true;
      try {
        const response = await this.$http.post("/api/createTask", {
          title,
          duration,
          startDate: this.today,
          dueDate: form.dueDate,
          projectRef: project._id,
          isBacklog: false,
          breakUpTask: false,
          recurrence: null,
          dependsOn: [],
          priority: 100,
        });

        if (!response.data.success) {
          form.error = true;
          form.message = response.data.log || "Task could not be created.";
          return;
        }

        this.taskList = response.data.taskList || [];
        form.title = "";
        form.duration = 30;
        form.dueDate = this.week.endDate;
        form.message = "Task added to this week.";
      } catch (error) {
        form.error = true;
        form.message = "Task could not be created.";
      } finally {
        form.saving = false;
      }
    },
    async alignTask(task) {
      const projectId = this.alignmentSelections[task._id];
      if (!projectId) return;
      this.aligningTaskId = task._id;
      this.alignmentMessages[task._id] = "";

      try {
        const response = await this.$http.post("/api/setTaskProject", {
          taskId: task._id,
          projectId,
        });
        if (!response.data.success) {
          this.alignmentMessages[task._id] = response.data.log || "Task could not be assigned.";
          return;
        }
        task.projectRef = projectId;
      } catch (error) {
        this.alignmentMessages[task._id] = "Task could not be assigned.";
      } finally {
        this.aligningTaskId = null;
      }
    },
  },
  mounted() {
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.load();
  },
  beforeUnmount() {
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  },
};
</script>

<style scoped>
.weekly-plan-page {
  min-height: calc(100vh - 56px);
  text-align: left;
  background:
    radial-gradient(circle at 10% 0%, rgba(102, 126, 234, 0.13), transparent 34rem),
    #0d1117;
}

.plan-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 28px;
  align-items: end;
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 4px;
  color: #8da2fb;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.plan-header h1 {
  margin: 0;
  color: #f0f3f6;
  font-size: clamp(2rem, 5vw, 3.25rem);
  line-height: 1;
}

.week-range {
  margin: 10px 0 0;
  color: #c8d1da;
  font-size: 1.15rem;
  font-weight: 600;
}

.header-copy {
  max-width: 680px;
  margin: 8px 0 0;
  color: #8b949e;
}

.plan-overview {
  display: grid;
  min-width: 220px;
  gap: 3px;
  padding: 16px;
  border: 1px solid rgba(141, 162, 251, 0.28);
  border-radius: 12px;
  background: rgba(22, 27, 34, 0.88);
}

.plan-overview strong {
  color: #f0f3f6;
  font-size: 1.15rem;
}

.plan-overview span {
  margin-bottom: 10px;
  color: #8b949e;
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  min-height: 280px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  background: rgba(22, 27, 34, 0.82);
  text-align: center;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
  gap: 22px;
  align-items: start;
}

.role-card {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: rgba(22, 27, 34, 0.9);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.18);
}

.role-heading {
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr);
  gap: 14px;
  padding: 20px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.role-swatch {
  width: 6px;
  min-height: 48px;
  border-radius: 999px;
}

.role-heading h2,
.goal-heading h3,
.project-heading h4 {
  margin: 0;
  color: #f0f3f6;
}

.role-heading h2 {
  font-size: 1.35rem;
}

.goal-card {
  padding: 18px 22px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.goal-card:last-child {
  border-bottom: 0;
}

.goal-heading,
.project-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.goal-heading h3 {
  font-size: 1.05rem;
}

.project-card {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.72);
}

.project-heading h4 {
  font-size: 1rem;
}

.description {
  margin: 4px 0 0;
  color: #9ca7b2;
  font-size: 0.88rem;
}

.date-range,
.project-total {
  color: #77818d;
  font-size: 0.78rem;
  white-space: nowrap;
}

.project-total {
  color: #a8b4c0;
  font-weight: 600;
}

.hierarchy-empty,
.nothing-planned {
  margin: 14px 0 0;
  color: #7d8792;
  font-size: 0.87rem;
}

.task-list {
  display: grid;
  gap: 7px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.task-list.compact {
  margin-top: 10px;
}

.task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.045);
  color: #d7dde4;
  font-size: 0.85rem;
}

.task-button {
  width: 100%;
  border: 1px solid transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.task-button:hover,
.task-button:focus-visible {
  border-color: rgba(141, 162, 251, 0.5);
  outline: none;
  background: rgba(102, 126, 234, 0.12);
}

.unaligned-task-button {
  display: grid;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  text-align: left;
}

.unaligned-task-button:hover,
.unaligned-task-button:focus-visible {
  border-color: rgba(141, 162, 251, 0.5);
  outline: none;
  background: rgba(102, 126, 234, 0.12);
}

.task-marker {
  margin-right: 5px;
  color: #9aa9ed;
}

.task-badge {
  margin-left: 7px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(139, 148, 158, 0.18);
  color: #9ca7b2;
  font-size: 0.65rem;
  text-transform: uppercase;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #8b949e;
  white-space: nowrap;
}

.other-tasks {
  margin-top: 12px;
  color: #8b949e;
  font-size: 0.83rem;
}

.other-tasks summary,
.lower-section summary {
  cursor: pointer;
}

.quick-task-form {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.quick-task-title {
  display: flex;
  gap: 6px;
  margin-bottom: 9px;
  color: #d7dde4;
  font-size: 0.82rem;
}

.quick-task-title span {
  color: #77818d;
}

.quick-fields {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) 88px minmax(138px, auto) auto;
  gap: 8px;
  align-items: end;
}

.field label {
  display: block;
  margin-bottom: 4px;
  color: #8b949e;
  font-size: 0.72rem;
}

.quick-fields .form-control,
.align-controls .form-control {
  min-height: 40px;
  padding: 7px 9px;
  font-size: 0.84rem;
}

.add-task-button {
  min-height: 40px;
  white-space: nowrap;
}

.form-message {
  margin: 8px 0 0;
  color: #6ee7b7;
  font-size: 0.8rem;
}

.form-message.error {
  color: #fca5a5;
}

.lower-section {
  margin-top: 20px;
  padding: 16px 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(22, 27, 34, 0.85);
  color: #a8b4c0;
}

.lower-section > summary {
  color: #d7dde4;
  font-weight: 600;
}

.someday-section ul,
.unaligned-list {
  display: grid;
  gap: 8px;
  padding: 0;
  list-style: none;
}

.someday-section li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
}

.someday-section li span,
.someday-section li p {
  color: #7d8792;
}

.someday-section li p {
  width: 100%;
  margin: 0;
}

.someday-section .parked-task-list {
  display: grid;
  width: 100%;
  gap: 6px;
  padding: 0;
  list-style: none;
}

.someday-section .parked-task-list .task-row {
  display: flex;
}

.unaligned-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(280px, 0.7fr);
  gap: 14px;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.unaligned-row > div:first-child,
.unaligned-task-button {
  display: grid;
}

.unaligned-row span {
  color: #7d8792;
  font-size: 0.8rem;
}

.align-controls {
  display: flex;
  gap: 8px;
}

@media (max-width: 900px) {
  .plan-header {
    grid-template-columns: 1fr;
  }

  .plan-overview {
    width: 100%;
  }

  .quick-fields {
    grid-template-columns: minmax(0, 1fr) 90px;
  }

  .title-field,
  .due-field {
    grid-column: span 1;
  }
}

@media (max-width: 620px) {
  .plan-header {
    gap: 18px;
  }

  .role-card,
  .project-card {
    border-radius: 10px;
  }

  .role-heading,
  .goal-card {
    padding-left: 15px;
    padding-right: 15px;
  }

  .goal-heading,
  .project-heading,
  .task-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .project-total,
  .date-range {
    white-space: normal;
  }

  .quick-fields,
  .unaligned-row {
    grid-template-columns: 1fr;
  }

  .title-field,
  .duration-field,
  .due-field {
    grid-column: 1;
  }

  .align-controls {
    flex-direction: column;
  }
}
</style>
