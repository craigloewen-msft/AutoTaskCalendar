<template>
  <div class="weekly-plan-page">
    <div class="plan-shell">
      <header class="week-bar" :class="{ committed: isCommitted }">
        <div class="week-identity">
          <p class="eyebrow">{{ isCommitted ? "Committed week" : "Week of" }}</p>
          <h1
            class="week-range"
            data-test="week-range"
            :data-week-start="week.startDate"
            :data-week-end="week.endDate"
          >
            {{ formattedWeekRange }}
          </h1>
          <p class="week-totals" data-test="weekly-overview">
            <template v-if="isCommitted">
              <strong>{{ committedDoneCount }} of {{ committedItems.length }} done</strong>
              <span>{{ formatDuration(committedDoneMinutes) }} of {{ formatDuration(committedMinutes) }}</span>
            </template>
            <template v-else>
              <strong>{{ selectedTasks.length }} {{ taskNoun(selectedTasks.length) }}</strong>
              <span>{{ formatDuration(selectedMinutes) }} selected</span>
            </template>
          </p>
        </div>

        <div class="week-strip" aria-hidden="true">
          <span
            v-for="day in weekDays"
            :key="day.date"
            class="strip-day"
            :class="{ today: day.date === today }"
          >
            <span class="strip-bar">
              <span class="strip-fill" :style="{ height: `${dayLoadPercent(day.date)}%` }"></span>
            </span>
            <span class="strip-label">{{ day.label }}</span>
          </span>
        </div>

        <div class="week-actions">
          <button
            v-if="!loading && !loadError"
            class="btn commit-button"
            :class="isCommitted ? 'btn-outline-primary' : 'btn-primary'"
            type="button"
            data-test="commit-week"
            :disabled="committing"
            @click="commitWeek()"
          >
            {{ commitLabel }}
          </button>
          <router-link class="btn btn-link calendar-link" to="/calendar">Go to calendar</router-link>
        </div>
      </header>

      <p v-if="commitError" class="bar-message error" role="alert" data-test="commit-error">
        {{ commitError }}
      </p>

      <div
        v-if="!loading && !loadError && planError"
        class="bar-message"
        role="status"
        data-test="weekly-plans-error"
      >
        <span>This week's commitment could not be loaded.</span>
        <button
          class="btn btn-sm btn-outline-secondary"
          type="button"
          :disabled="planLoading"
          @click="loadPlans"
        >
          {{ planLoading ? "Retrying…" : "Retry" }}
        </button>
      </div>

      <details
        v-if="!loading && !loadError && previousPlan"
        class="recap"
        data-test="previous-week-recap"
      >
        <summary>
          <strong>Last week:</strong>
          committed {{ previousPlan.items.length }},
          finished {{ previousDoneCount }},
          {{ previousSlippedCount }} slipped
        </summary>
        <ul class="recap-list">
          <li
            v-for="item in previousPlan.items"
            :key="item.taskRef"
            class="recap-row"
            :class="`is-${item.status}`"
            :data-status="item.status"
          >
            <span class="recap-title">
              <span class="status-glyph" aria-hidden="true">{{ statusGlyph(item.status) }}</span>
              {{ item.title }}
            </span>
            <span class="recap-meta">{{ item.status }}</span>
          </li>
        </ul>
      </details>

      <div
        v-if="!loading && !loadError && roles.length && completionError"
        class="bar-message"
        role="status"
        data-test="project-completions-error"
      >
        <span>Last week's completions could not be loaded.</span>
        <button
          class="btn btn-sm btn-outline-secondary"
          type="button"
          :disabled="completionLoading"
          @click="loadProjectCompletions"
        >
          {{ completionLoading ? "Retrying…" : "Retry" }}
        </button>
      </div>

      <div v-if="loading" class="panel-state" role="status">
        <span class="spinner-border text-primary" aria-hidden="true"></span>
        <span>Loading your weekly plan…</span>
      </div>

      <div v-else-if="loadError" class="panel-state" role="alert" data-test="weekly-plan-error">
        <h2>Weekly plan could not be loaded</h2>
        <p>{{ loadError }}</p>
        <button class="btn btn-primary" type="button" @click="load">Try again</button>
      </div>

      <div v-else-if="!roles.length" class="panel-state">
        <h2>Start with your Compass</h2>
        <p>Add a role, a goal, and a project before planning tasks around them.</p>
        <router-link class="btn btn-primary" to="/compass">Set up Compass</router-link>
      </div>

      <main
        v-else
        ref="weeklyHierarchy"
        class="role-stream"
        data-test="weekly-hierarchy"
        tabindex="-1"
      >
        <section
          v-for="role in roles"
          :key="role._id"
          class="role"
          data-test="role-section"
          :data-role-id="role._id"
        >
          <header class="role-head">
            <span class="role-bar" :style="{ backgroundColor: roleColors[role._id] }"></span>
            <div class="role-identity">
              <h2>{{ role.title }}</h2>
              <p v-if="role.description" class="description">{{ role.description }}</p>
            </div>
            <div class="role-meta">
              <span class="role-total">{{ roleSummary(role) }}</span>
              <span class="date-range">{{ compassDateRange(role) }}</span>
            </div>
          </header>

          <p v-if="!(role.goalList || []).length" class="hierarchy-empty">
            No active goals. <router-link to="/compass">Add one in Compass</router-link>.
          </p>

          <div v-for="goal in role.goalList || []" :key="goal._id" class="goal">
            <div class="goal-rule">
              <h3>{{ goal.title }}</h3>
              <span class="rule-line"></span>
              <span class="date-range">{{ compassDateRange(goal) }}</span>
            </div>
            <p v-if="goal.description" class="description goal-description">
              {{ goal.description }}
            </p>

            <p v-if="!startedProjects(goal).length" class="hierarchy-empty">
              No started projects.
              <router-link to="/compass">Review this goal in Compass</router-link>.
            </p>

            <div v-else class="project-stack">
              <WeeklyProjectCard
                v-for="project in startedProjects(goal)"
                :key="project._id"
                :project="project"
                :week-tasks="tasksForProject(project._id, true)"
                :other-tasks="tasksForProject(project._id, false)"
                :completions="completionsForProject(project._id)"
                :committed-items="committedItemsForProject(project._id)"
                :added-tasks="addedTasksForProject(project._id)"
                :tasks-by-id="tasksById"
                :form="forms[project._id]"
                :week="week"
                :week-days="weekDays"
                :previous-week="previousWeek"
                :previous-range-label="formattedPreviousWeekRange"
                :selectable="!isCommitted"
                :selected-ids="selection"
                :folding-in="committing"
                :committed="isCommitted"
                :time-zone="timeZone"
                :plan-date-for="weeklyPlanDate"
                @open-task="openTask"
                @toggle-task="toggleTask"
                @open-form="openForm(project._id)"
                @close-form="closeForm(project._id)"
                @update-field="(field, value) => updateForm(project._id, field, value)"
                @submit="createTask(project)"
                @fold-in="commitWeek()"
              />
            </div>
          </div>
        </section>
      </main>

      <div v-if="!loading && !loadError" class="loose-ends">
        <details v-if="somedayProjects.length" class="drawer" data-test="someday-projects">
          <summary>
            Someday · {{ somedayProjects.length }} parked projects<span v-if="somedayWeeklyTasks.length">
              · {{ somedayWeeklyTasks.length }} {{ taskNoun(somedayWeeklyTasks.length) }} due this week</span>
          </summary>
          <p class="drawer-copy">
            Start these projects in Compass before creating new weekly work beneath them.
          </p>
          <ul class="parked-list">
            <li v-for="project in somedayProjects" :key="project._id" class="parked-item">
              <div class="parked-head">
                <strong>{{ project.title }}</strong>
                <span class="date-range">{{ project.parentLabel }}</span>
              </div>
              <p v-if="project.description" class="description">{{ project.description }}</p>
              <ul v-if="tasksForProject(project._id, true).length" class="loose-task-list">
                <li v-for="task in tasksForProject(project._id, true)" :key="task._id">
                  <button class="loose-task" type="button" @click="openTask(task, $event)">
                    <span>{{ task.title }}</span>
                    <span class="loose-meta">
                      {{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}
                    </span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>
          <router-link to="/compass">Manage Someday projects in Compass</router-link>
        </details>

        <details
          v-if="outsideCompassWeeklyTasks.length"
          class="drawer"
          data-test="outside-compass-tasks"
        >
          <summary>
            Outside active Compass · {{ outsideCompassWeeklyTasks.length }}
            {{ taskNoun(outsideCompassWeeklyTasks.length) }} due this week
          </summary>
          <p class="drawer-copy">
            These tasks belong to a project that is no longer in the active Compass hierarchy.
          </p>
          <ul class="loose-task-list">
            <li v-for="task in outsideCompassWeeklyTasks" :key="task._id">
              <button class="loose-task" type="button" @click="openTask(task, $event)">
                <span>{{ task.title }}</span>
                <span class="loose-meta">
                  {{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}
                </span>
              </button>
            </li>
          </ul>
        </details>

        <details v-if="unalignedWeeklyTasks.length" class="drawer" data-test="unaligned-tasks">
          <summary>Unaligned tasks · {{ unalignedWeeklyTasks.length }} due this week</summary>
          <p class="drawer-copy">
            Older tasks without a project can be assigned here when their project is clear.
          </p>
          <ul class="unaligned-list">
            <li v-for="task in unalignedWeeklyTasks" :key="task._id" class="unaligned-row">
              <button class="loose-task" type="button" @click="openTask(task, $event)">
                <span>{{ task.title }}</span>
                <span class="loose-meta">
                  {{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}
                </span>
              </button>
              <div class="align-controls">
                <label :for="`align-${task._id}`" class="visually-hidden">
                  Project for {{ task.title }}
                </label>
                <select
                  :id="`align-${task._id}`"
                  v-model="alignmentSelections[task._id]"
                  class="form-control"
                >
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
      </div>
    </div>

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
import TaskEditor from "../components/TaskEditor.vue";
import WeeklyProjectCard from "../components/WeeklyProjectCard.vue";
import { buildRoleColorMap } from "../utils/roleColors";
import {
  addCalendarDays,
  apiDateOnly,
  dateOnlyInTimeZone,
  formatCivilDate,
  mondayWeekBounds,
} from "../utils/temporal";

/**
 * Weekly Plan. See docs/WEEKLY_PLAN.md.
 *
 * Two modes over one hierarchy. Before a commitment exists for the current week the page
 * builds it; afterwards the same page reviews progress against it. Nothing but the calendar
 * rolling to a new Monday moves it back, so there is no save, close, or archive action.
 */
export default {
  name: "WeeklyPlan",
  components: { TaskEditor, WeeklyProjectCard },
  data() {
    const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);

    return {
      roles: [],
      taskList: [],
      projectCompletions: [],
      plans: [],
      completionError: "",
      completionLoading: false,
      completionRequestId: 0,
      planError: "",
      planLoading: false,
      planRequestId: 0,
      committing: false,
      commitError: "",
      selection: {},
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
    timeZone() {
      return this.$store.state.user?.timeZone || "UTC";
    },
    roleColors() {
      return buildRoleColorMap(this.roles);
    },
    formattedWeekRange() {
      if (!this.week) return "";
      const options = { weekday: "short", month: "short", day: "numeric" };
      return `${formatCivilDate(this.week.startDate, options)} – ${formatCivilDate(this.week.endDate, options)}`;
    },
    // Mon-Sun, used by both the header strip and the quick-add day chips.
    weekDays() {
      if (!this.week?.startDate) return [];
      return Array.from({ length: 7 }, (unused, index) => {
        const date = addCalendarDays(this.week.startDate, index);
        return { date, label: formatCivilDate(date, { weekday: "short" }) };
      });
    },
    previousWeek() {
      const currentMonday = this.week?.startDate;
      return {
        startDate: addCalendarDays(currentMonday, -7),
        endDate: addCalendarDays(currentMonday, -1),
        nextStartDate: currentMonday,
      };
    },
    formattedPreviousWeekRange() {
      const { startDate, endDate } = this.previousWeek;
      if (!startDate || !endDate) return "";
      const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
      const options = { month: "short", day: "numeric" };
      if (!sameYear) options.year = "numeric";
      return `${formatCivilDate(startDate, options)} – ${formatCivilDate(endDate, options)}`;
    },
    currentPlan() {
      return this.plans.find((plan) => plan.weekStart === this.week?.startDate) || null;
    },
    previousPlan() {
      return this.plans.find((plan) => plan.weekStart === this.previousWeek.startDate) || null;
    },
    isCommitted() {
      return !!this.currentPlan;
    },
    committedItems() {
      return this.currentPlan?.items || [];
    },
    committedItemsByProject() {
      const grouped = {};
      for (const item of this.committedItems) {
        const key = item.projectRef || "";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      }
      return grouped;
    },
    committedTaskIds() {
      return new Set(this.committedItems.map((item) => item.taskRef));
    },
    committedDoneCount() {
      return this.committedItems.filter((item) => item.status === "done").length;
    },
    committedMinutes() {
      return this.committedItems.reduce(
        (total, item) => total + (Number(item.duration) || 0),
        0
      );
    },
    committedDoneMinutes() {
      return this.committedItems
        .filter((item) => item.status === "done")
        .reduce((total, item) => total + (Number(item.duration) || 0), 0);
    },
    previousDoneCount() {
      return (this.previousPlan?.items || []).filter((item) => item.status === "done").length;
    },
    previousSlippedCount() {
      return (this.previousPlan?.items || []).filter(
        (item) => item.status !== "done"
      ).length;
    },
    commitLabel() {
      if (this.committing) return "Saving…";
      if (this.isCommitted) return "Update commitment";
      return `Commit to this week · ${this.selectedTasks.length} ${this.taskNoun(this.selectedTasks.length)}`;
    },
    tasksById() {
      const map = {};
      for (const task of this.taskList) map[task._id] = task;
      return map;
    },
    weeklyTasks() {
      return this.sortTasks(this.taskList.filter((task) => this.isDueThisWeek(task)));
    },
    // Every in-week project task is committed unless explicitly unchecked.
    selectedTasks() {
      return this.weeklyTasks.filter(
        (task) => task.projectRef && this.selection[task._id] !== false
      );
    },
    selectedMinutes() {
      return this.durationFor(this.selectedTasks);
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
    projectCompletionsByProject() {
      const grouped = {};
      for (const task of this.projectCompletions) {
        if (!grouped[task.projectRef]) grouped[task.projectRef] = [];
        grouped[task.projectRef].push(task);
      }
      for (const tasks of Object.values(grouped)) {
        tasks.sort((left, right) => {
          return new Date(right.completedDate) - new Date(left.completedDate)
            || String(left.title || "").localeCompare(String(right.title || ""));
        });
      }
      return grouped;
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
      this.projectCompletions = [];
      this.completionError = "";
      this.loadProjectCompletions();
      this.loadPlans();

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
    /**
     * The current and previous week in one bounded read.
     *
     * A failure here must not present a committed week as uncommitted, so the error is
     * surfaced with its own retry rather than falling back to Plan mode.
     */
    async loadPlans() {
      const from = this.previousWeek.startDate;
      const to = this.week?.startDate;
      if (!from || !to) return;

      const requestId = ++this.planRequestId;
      this.planLoading = true;

      try {
        const response = await this.$http.get("/api/getWeeklyPlans", { params: { from, to } });
        if (requestId !== this.planRequestId) return;
        if (!response.data.success) {
          this.planError = response.data.log || "Weekly plans could not be loaded.";
          return;
        }
        this.applyPlans(response.data.plans);
      } catch (error) {
        if (requestId === this.planRequestId) {
          this.planError = "Weekly plans could not be loaded.";
        }
      } finally {
        if (requestId === this.planRequestId) this.planLoading = false;
      }
    },
    // Commit and read return the same shape, so one reducer serves both.
    applyPlans(plans) {
      const incoming = plans || [];
      const replaced = new Set(incoming.map((plan) => plan.weekStart));
      this.plans = [
        ...this.plans.filter((plan) => !replaced.has(plan.weekStart)),
        ...incoming,
      ];
      this.planError = "";
    },
    async loadProjectCompletions() {
      const { startDate, endDate } = this.previousWeek;
      if (!startDate || !endDate) return;

      const requestId = ++this.completionRequestId;
      this.completionLoading = true;
      this.projectCompletions = [];
      const focusAfterRetry = !!this.completionError;

      try {
        const response = await this.$http.get("/api/getProjectCompletions", {
          params: { completedFrom: startDate, completedTo: endDate },
        });
        if (requestId !== this.completionRequestId) return;
        if (!response.data.success) {
          this.completionError = response.data.log || "Completion history could not be loaded.";
          return;
        }
        this.projectCompletions = response.data.items || [];
        this.completionError = "";
        if (focusAfterRetry) {
          this.$nextTick(() => {
            const target = this.$refs.weeklyHierarchy?.querySelector(
              ".completed-last-week summary"
            ) || this.$refs.weeklyHierarchy;
            target?.focus();
          });
        }
      } catch (error) {
        if (requestId === this.completionRequestId) {
          this.completionError = "Completion history could not be loaded.";
        }
      } finally {
        if (requestId === this.completionRequestId) this.completionLoading = false;
      }
    },
    /**
     * Record or amend this week's commitment.
     *
     * Amending is additive on the server, so this only ever sends work that is not in the
     * snapshot yet. Already-committed items are never re-sent: they must keep their
     * recorded status even when the task has since been deleted or moved out of the week.
     */
    async commitWeek() {
      if (this.refreshTemporal()) {
        this.loadProjectCompletions();
        await this.loadPlans();
      }

      this.committing = true;
      this.commitError = "";

      const taskIds = this.selectedTasks
        .map((task) => task._id)
        .filter((id) => !this.committedTaskIds.has(String(id)));

      try {
        const response = await this.$http.post("/api/commitWeeklyPlan", {
          weekStart: this.week.startDate,
          taskIds,
        });

        if (!response.data.success) {
          this.commitError = response.data.log || "This week could not be committed.";
          return;
        }
        this.applyPlans(response.data.plans);
      } catch (error) {
        this.commitError = "This week could not be committed.";
      } finally {
        this.committing = false;
      }
    },
    toggleTask(task) {
      this.selection[task._id] = this.selection[task._id] === false;
    },
    refreshTemporal() {
      const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);
      const nextWeek = mondayWeekBounds(today);
      const weekChanged = nextWeek && this.week?.startDate !== nextWeek.startDate;
      this.today = today;
      this.week = nextWeek;

      if (weekChanged) {
        // A new week starts uncommitted and with a fresh selection.
        this.selection = {};
        this.commitError = "";
        for (const form of Object.values(this.forms)) {
          form.dueDate = this.quickTaskDueDate(nextWeek);
          form.error = false;
          form.message = "";
        }
      }
      return weekChanged;
    },
    // A tab left open over the weekend must land in Plan mode for the new week.
    handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (this.refreshTemporal()) {
        this.loadProjectCompletions();
        this.loadPlans();
      }
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
    quickTaskDueDate(week = this.week) {
      return week?.startDate ? addCalendarDays(week.startDate, 4) : "";
    },
    blankForm() {
      return {
        open: false,
        title: "",
        duration: 30,
        dueDate: this.quickTaskDueDate(),
        saving: false,
        error: false,
        message: "",
      };
    },
    openForm(projectId) {
      this.forms[projectId].open = true;
      this.forms[projectId].message = "";
      this.forms[projectId].error = false;
    },
    closeForm(projectId) {
      this.forms[projectId].open = false;
    },
    // Form state stays here and keyed by project, so one draft cannot clear another.
    updateForm(projectId, field, value) {
      this.forms[projectId][field] = value;
    },
    startedProjects(goal) {
      return (goal.projectList || []).filter((project) => !!project.startDate);
    },
    weeklyPlanDate(task) {
      if (task?.seriesRef) {
        if (!task.scheduledDate) return "";
        return dateOnlyInTimeZone(
          this.$store.state.user?.timeZone,
          new Date(task.scheduledDate)
        );
      }
      return apiDateOnly(task?.dueDate);
    },
    isWeeklyPlanTask(task) {
      return !task?.seriesRef || !!this.weeklyPlanDate(task);
    },
    isDueThisWeek(task) {
      const planDate = this.weeklyPlanDate(task);
      return !!planDate && planDate >= this.week.startDate && planDate <= this.week.endDate;
    },
    tasksForProject(projectId, thisWeek) {
      return this.sortTasks(this.taskList.filter((task) => {
        return this.isWeeklyPlanTask(task)
          && task.projectRef === projectId
          && this.isDueThisWeek(task) === thisWeek;
      }));
    },
    committedItemsForProject(projectId) {
      return this.committedItemsByProject[projectId] || [];
    },
    // In-week work that is not part of the snapshot yet.
    addedTasksForProject(projectId) {
      if (!this.isCommitted) return [];
      return this.tasksForProject(projectId, true).filter(
        (task) => !this.committedTaskIds.has(String(task._id))
      );
    },
    completionsForProject(projectId) {
      return this.projectCompletionsByProject[projectId] || [];
    },
    roleSummary(role) {
      const projectIds = [];
      for (const goal of role.goalList || []) {
        for (const project of goal.projectList || []) projectIds.push(project._id);
      }
      const ids = new Set(projectIds);

      if (this.isCommitted) {
        const items = this.committedItems.filter((item) => ids.has(item.projectRef));
        if (!items.length) return "nothing committed";
        const done = items.filter((item) => item.status === "done").length;
        return `${done}/${items.length} done`;
      }

      const tasks = this.weeklyTasks.filter((task) => ids.has(task.projectRef));
      if (!tasks.length) return "nothing planned";
      return `${tasks.length} ${this.taskNoun(tasks.length)} · ${this.formatDuration(this.durationFor(tasks))}`;
    },
    // Relative load for the header strip, scaled against the busiest day.
    dayLoadPercent(date) {
      const minutesOn = (day) => {
        if (this.isCommitted) {
          return this.committedItems
            .filter((item) => (item.liveDueDate || item.dueDate) === day)
            .reduce((total, item) => total + (Number(item.duration) || 0), 0);
        }
        return this.selectedTasks
          .filter((task) => this.weeklyPlanDate(task) === day)
          .reduce((total, task) => total + (Number(task.duration) || 0), 0);
      };

      const loads = this.weekDays.map((day) => minutesOn(day.date));
      const peak = Math.max(...loads, 0);
      if (!peak) return 0;
      return Math.round((minutesOn(date) / peak) * 100);
    },
    statusGlyph(status) {
      return { done: "✓", moved: "↷", removed: "✗" }[status] || "●";
    },
    sortTasks(tasks) {
      return [...tasks].sort((left, right) => {
        const leftDate = this.weeklyPlanDate(left) || "9999-12-31";
        const rightDate = this.weeklyPlanDate(right) || "9999-12-31";
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
      if (!task.seriesRef && (task.isBacklog || !task.dueDate)) return "Backlog";
      return formatCivilDate(this.weeklyPlanDate(task), {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
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
    // Editing can complete, delete, or move a task, so the commitment view must resync.
    applyTaskChanges(taskList) {
      this.taskList = taskList;
      this.closeTaskEditor();
      if (this.isCommitted) this.loadPlans();
    },
    async createTask(project) {
      if (this.refreshTemporal()) this.loadProjectCompletions();
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
        form.dueDate = this.quickTaskDueDate();
        form.open = false;
        form.message = this.isCommitted
          ? "Task added since commit."
          : "Task added to this week.";
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
  padding: 0 20px 60px;
  text-align: left;
  background:
    radial-gradient(circle at 12% 0%, rgba(102, 126, 234, 0.13), transparent 34rem),
    #0d1117;
}

/* One column, capped so lines stay readable on wide screens. */
.plan-shell {
  max-width: 1100px;
  margin: 0 auto;
  padding-top: 20px;
}

.week-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 24px;
  align-items: center;
  margin-bottom: 20px;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  background: rgba(13, 17, 23, 0.93);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.week-bar.committed {
  border-color: rgba(110, 231, 183, 0.24);
}

.eyebrow {
  margin: 0 0 2px;
  color: #8da2fb;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.week-bar.committed .eyebrow {
  color: #6ee7b7;
}

.week-range {
  margin: 0;
  color: #f0f3f6;
  font-size: clamp(1.15rem, 2.4vw, 1.6rem);
  font-weight: 600;
  line-height: 1.15;
}

.week-totals {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin: 4px 0 0;
  font-size: 0.85rem;
}

.week-totals strong {
  color: #d7dde4;
}

.week-totals span {
  color: #8b949e;
}

.week-strip {
  display: flex;
  align-items: flex-end;
  gap: 5px;
}

.strip-day {
  display: grid;
  gap: 4px;
  justify-items: center;
}

.strip-bar {
  display: flex;
  width: 14px;
  height: 30px;
  align-items: flex-end;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
}

.strip-fill {
  width: 100%;
  min-height: 2px;
  border-radius: 4px;
  background: linear-gradient(180deg, #8da2fb, #667eea);
  transition: height 0.3s ease;
}

.strip-label {
  color: #6f7883;
  font-size: 0.6rem;
  letter-spacing: 0.02em;
}

.strip-day.today .strip-label {
  color: #c8d1da;
  font-weight: 700;
}

.week-actions {
  display: grid;
  gap: 4px;
  justify-items: stretch;
}

.commit-button {
  white-space: nowrap;
}

.calendar-link {
  padding: 0;
  color: #8b949e;
  font-size: 0.78rem;
  text-decoration: none;
}

.calendar-link:hover {
  color: #8da2fb;
}

.bar-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 14px;
  border: 1px solid rgba(139, 148, 158, 0.22);
  border-radius: 10px;
  background: rgba(22, 27, 34, 0.75);
  color: #9ca7b2;
  font-size: 0.84rem;
}

.bar-message.error {
  border-color: rgba(248, 113, 113, 0.35);
  color: #fca5a5;
}

.recap {
  margin-bottom: 18px;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 11px;
  background: rgba(22, 27, 34, 0.6);
}

.recap summary {
  color: #a8b4c0;
  font-size: 0.85rem;
  cursor: pointer;
}

.recap summary strong {
  color: #d7dde4;
}

.recap-list {
  display: grid;
  gap: 2px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.recap-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  color: #b6c0ca;
  font-size: 0.82rem;
}

.recap-title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  overflow-wrap: anywhere;
}

.recap-meta {
  flex: 0 0 auto;
  color: #77818d;
  font-size: 0.74rem;
  text-transform: capitalize;
}

.status-glyph {
  width: 12px;
  color: #8b949e;
  text-align: center;
}

.recap-row.is-done .status-glyph {
  color: #6ee7b7;
}

.recap-row.is-moved .status-glyph {
  color: #fbbf24;
}

.recap-row.is-removed .status-glyph {
  color: #f87171;
}

.panel-state {
  display: flex;
  min-height: 260px;
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

.role-stream {
  display: grid;
  gap: 34px;
}

.role-stream:focus {
  outline: none;
}

/* A role is a band in the stream, not a raised card. */
.role {
  display: grid;
  gap: 18px;
}

.role-head {
  display: grid;
  grid-template-columns: 4px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.role-bar {
  height: 100%;
  min-height: 34px;
  border-radius: 999px;
}

.role-identity h2 {
  margin: 0;
  color: #f0f3f6;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.role-meta {
  display: grid;
  gap: 2px;
  justify-items: end;
  text-align: right;
}

.role-total {
  color: #c8d1da;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.description {
  margin: 4px 0 0;
  color: #8b949e;
  font-size: 0.86rem;
}

.date-range {
  color: #6f7883;
  font-size: 0.74rem;
  white-space: nowrap;
}

/* A goal is a labelled rule, not another box. */
.goal {
  display: grid;
  gap: 10px;
  padding-left: 18px;
}

.goal-rule {
  display: flex;
  align-items: center;
  gap: 12px;
}

.goal-rule h3 {
  margin: 0;
  color: #d7dde4;
  font-size: 0.94rem;
  font-weight: 600;
  white-space: nowrap;
}

.rule-line {
  height: 1px;
  flex: 1 1 auto;
  background: rgba(255, 255, 255, 0.08);
}

.goal-description {
  margin: -4px 0 0;
}

.project-stack {
  display: grid;
  gap: 12px;
}

.hierarchy-empty {
  margin: 0;
  color: #6f7883;
  font-size: 0.85rem;
  font-style: italic;
}

.loose-ends {
  display: grid;
  gap: 10px;
  margin-top: 34px;
}

.drawer {
  padding: 14px 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(22, 27, 34, 0.62);
  color: #a8b4c0;
}

.drawer > summary {
  color: #c8d1da;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.drawer-copy {
  margin: 10px 0;
  color: #8b949e;
  font-size: 0.83rem;
}

.parked-list,
.loose-task-list,
.unaligned-list {
  display: grid;
  gap: 6px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.parked-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.parked-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.parked-item .loose-task-list {
  margin-top: 8px;
  margin-bottom: 0;
}

.loose-task {
  display: flex;
  width: 100%;
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
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.loose-task:hover,
.loose-task:focus-visible {
  border-color: rgba(141, 162, 251, 0.5);
  outline: none;
  background: rgba(102, 126, 234, 0.12);
}

.loose-meta {
  flex: 0 0 auto;
  color: #8b949e;
  font-size: 0.77rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.unaligned-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(260px, 0.7fr);
  gap: 12px;
  align-items: center;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.align-controls {
  display: flex;
  gap: 8px;
}

.align-controls .form-control {
  min-height: 38px;
  padding: 6px 9px;
  font-size: 0.83rem;
}

.form-message {
  margin: 8px 0 0;
  font-size: 0.8rem;
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

@media (max-width: 900px) {
  .week-bar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .week-strip {
    display: none;
  }
}

@media (max-width: 620px) {
  .weekly-plan-page {
    padding: 0 12px 40px;
  }

  .week-bar {
    position: static;
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 14px;
  }

  .week-actions {
    justify-items: start;
  }

  .role-head {
    grid-template-columns: 4px minmax(0, 1fr);
  }

  .role-meta {
    grid-column: 2;
    justify-items: start;
    text-align: left;
  }

  .date-range,
  .role-total {
    white-space: normal;
  }

  .goal {
    padding-left: 0;
  }

  .bar-message,
  .loose-task,
  .unaligned-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .unaligned-row {
    display: flex;
  }

  .align-controls {
    width: 100%;
    flex-direction: column;
  }
}
</style>
