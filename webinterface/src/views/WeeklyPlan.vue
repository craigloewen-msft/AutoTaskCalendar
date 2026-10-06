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
          <ContextFilter v-model="contextFilter" />
          <router-link class="btn btn-link calendar-link" to="/calendar">Go to calendar</router-link>
        </div>
      </header>

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

      <!-- Personal work. Shown once the week is committed, or earlier if there is already
           an intention to answer for. See docs/INTENTIONS.md. -->
      <IntentionBand
        v-if="!loading && !loadError && (isCommitted || weekIntentions.length)"
        :intentions="weekIntentions"
        :urgency="intentionUrgency"
        :open="intentionBandOpen"
        :busy="completingIntentionId !== null"
        :error="intentionError || intentionLoadError"
        @toggle="intentionOpenOverride = !intentionBandOpen"
        @complete="completeIntention"
        @open="openTask"
      />

      <WeeklyLastWeekReview
        v-if="!loading && !loadError && showLastWeek"
        :plan="previousPlan"
        :unplanned="unplannedLastWeekCompletions"
        :groups="homelessLastWeekGroups"
        :tasks-by-id="tasksById"
        :range-label="formattedPreviousWeekRange"
        :week="week"
        :today="today"
        :open="lastWeekOpen"
        :busy="carrying"
        :error="carryError"
        :intentions="previousIntentions"
        @toggle="lastWeekOpenOverride = !lastWeekOpen"
        @carry="carryForward"
        @carry-intention="carryIntention"
      />

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
          v-for="role in visibleRoles"
          :key="role._id"
          class="role"
          data-test="role-section"
          :data-role-id="role._id"
        >
          <header class="role-head">
            <span class="role-bar" :style="{ backgroundColor: roleColors[role._id] }"></span>
            <div class="role-identity">
              <div class="role-name-row">
                <h2>{{ role.title }}</h2>
                <span class="context-badge" data-test="role-context">
                  {{ contextMeta(roleContextOf(role)).icon }} {{ contextMeta(roleContextOf(role)).label }}
                </span>
              </div>
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
                :other-tasks="otherTasksForProject(project._id)"
                :completions="completionsForProject(project._id)"
                :committed-items="committedItemsForProject(project._id)"
                :added-tasks="addedTasksForProject(project._id)"
                :tasks-by-id="tasksById"
                :form="forms[project._id]"
                :week="week"
                :week-days="weekDays"
                :previous-week="previousWeek"
                :last-week-items="previousItemsForProject(project._id)"
                :today="today"
                :carrying="carrying"
                :selectable="!isCommitted"
                :is-intention-project="personalProjectIds.has(project._id)"
                :selected-ids="selection"
                :folding-in="committing"
                :committed="isCommitted"
                :plan-date-for="weeklyPlanDate"
                @open-task="openTask"
                @toggle-task="toggleTask"
                @open-form="openForm(project._id)"
                @close-form="closeForm(project._id)"
                @update-field="(field, value) => updateForm(project._id, field, value)"
                @submit="createTask(project)"
                @fold-in="commitWeek()"
                @carry="carryForward"
              />
            </div>
          </div>
        </section>
      </main>

      <div v-if="!loading && !loadError" class="loose-ends">
        <!-- A promise outlives its project: committed work under an ended project still
             shows, so the week's totals match what is on screen. -->
        <section
          v-for="group in endedCommitmentGroups"
          :key="group._id"
          class="ended-commitment"
          :data-test="`ended-commitment-${group._id}`"
        >
          <header class="ended-head">
            <h3>{{ group.title }}</h3>
            <span class="ended-badge">project ended</span>
          </header>
          <p class="drawer-copy">
            You committed to this before the project ended. It stays here so the week reads
            honestly.
          </p>
          <WeeklyCommitmentProgress
            :project-id="String(group._id)"
            :items="group.items"
            :tasks-by-id="tasksById"
            @open="(task, event) => openTask(task, event)"
          />
        </section>

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
          v-if="endedProjectGroups.length"
          class="drawer"
          data-test="ended-project-tasks"
        >
          <summary>
            Ended projects · {{ endedProjectTaskCount }}
            {{ taskNoun(endedProjectTaskCount) }} due this week
          </summary>
          <p class="drawer-copy">
            These projects have ended but still have work due this week. Reassign anything
            that should carry on, or finish it off on the calendar.
          </p>
          <div
            v-for="group in endedProjectGroups"
            :key="group._id"
            class="ended-group"
            :data-test="`ended-project-${group._id}`"
          >
            <h4 class="ended-group-title">{{ group.title }}</h4>
            <ul class="unaligned-list">
              <li v-for="task in group.tasks" :key="task._id" class="unaligned-row">
                <button class="loose-task" type="button" @click="openTask(task, $event)">
                  <span>{{ task.title }}</span>
                  <span class="loose-meta">
                    {{ dueLabel(task) }} · {{ formatDuration(Number(task.duration) || 0) }}
                  </span>
                </button>
                <div class="align-controls">
                  <label :for="`realign-${task._id}`" class="visually-hidden">
                    Project for {{ task.title }}
                  </label>
                  <select
                    :id="`realign-${task._id}`"
                    v-model="alignmentSelections[task._id]"
                    class="form-control"
                  >
                    <option value="">Choose a project</option>
                    <optgroup
                      v-for="optionGroup in projectOptionGroups"
                      :key="optionGroup.label"
                      :label="optionGroup.label"
                    >
                      <option
                        v-for="project in optionGroup.projects"
                        :key="project._id"
                        :value="project._id"
                      >
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
                    {{ aligningTaskId === task._id ? "Assigning…" : "Reassign" }}
                  </button>
                </div>
                <p v-if="alignmentMessages[task._id]" class="form-message error" role="alert">
                  {{ alignmentMessages[task._id] }}
                </p>
              </li>
            </ul>
          </div>
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
            These tasks belonged to a project that has since been deleted.
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

      <footer v-if="!loading && !loadError" class="commit-bar">
        <p v-if="commitError" class="bar-message error" role="alert" data-test="commit-error">
          {{ commitError }}
        </p>
        <button
          class="btn commit-button"
          :class="isCommitted ? 'btn-outline-primary' : 'btn-primary'"
          type="button"
          data-test="commit-week"
          :disabled="committing"
          @click="commitWeek()"
        >
          {{ commitLabel }}
        </button>
        <p class="commit-note" data-test="commit-note">{{ commitNote }}</p>
      </footer>
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
import WeeklyCommitmentProgress from "../components/WeeklyCommitmentProgress.vue";
import WeeklyLastWeekReview from "../components/WeeklyLastWeekReview.vue";
import WeeklyProjectCard from "../components/WeeklyProjectCard.vue";
import IntentionBand from "../components/IntentionBand.vue";
import {
  intentionsForWeek,
  intentionUrgency as urgencyForWeek,
} from "../utils/intentions";
import { buildRoleColorMap } from "../utils/roleColors";
import ContextFilter from "../components/ContextFilter.vue";
import { contextMeta, filterRolesByContext, isPersonalRole, readContextFilter, roleContextOf } from "../utils/roleContext";
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
  components: { ContextFilter, IntentionBand, TaskEditor, WeeklyCommitmentProgress, WeeklyLastWeekReview, WeeklyProjectCard },
  data() {
    const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);

    return {
      roles: [],
      endedProjects: [],
      planProjects: [],
      taskList: [],
      projectCompletions: [],
      plans: [],
      completionError: "",
      completionLoading: false,
      completionRequestId: 0,
      planError: "",
      planLoading: false,
      planRequestId: 0,
      carrying: false,
      carryError: "",
      lastWeekOpenOverride: null,
      intentionOpenOverride: null,
      intentionError: "",
      intentions: [],
      intentionLoadError: "",
      completingIntentionId: null,
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
      contextFilter: readContextFilter(),
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
    // Only the hierarchy is narrowed. Everything below still partitions over every role,
    // so hiding a context never makes its tasks look orphaned.
    visibleRoles() {
      return filterRolesByContext(this.roles, this.contextFilter);
    },
    // Projects under a role with `context: 'personal'`, whose tasks are intentions. The same
    // ladder controllers/intentions.js walks, defaulting the context exactly as the server's
    // schema does, so the page cannot disagree with it. Used only to decide what to show.
    personalProjectIds() {
      const ids = new Set();
      for (const role of this.roles) {
        if (!isPersonalRole(role)) continue;
        for (const goal of role.goalList || []) {
          for (const project of goal.projectList || []) ids.add(project._id);
        }
      }
      return ids;
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
    // Open while this week is still being planned -- that is when last week is the question.
    // Once committed the current week leads and the review folds away, unless asked for.
    lastWeekOpen() {
      return this.lastWeekOpenOverride === null ? !this.isCommitted : this.lastWeekOpenOverride;
    },
    // Intentions due inside this Monday-Sunday. Deliberately NOT narrowed by the
    // work/personal filter: hiding your personal life in "work mode" defeats the point.
    weekIntentions() {
      return intentionsForWeek(this.intentions, this.week);
    },
    // Last week's, for the review band: the honest end-of-week answer.
    previousIntentions() {
      return intentionsForWeek(this.intentions, this.previousWeek);
    },
    intentionUrgency() {
      return urgencyForWeek(this.today, this.week);
    },
    // Quiet until Friday, then open by itself as the week runs out.
    intentionBandOpen() {
      if (this.intentionOpenOverride !== null) return this.intentionOpenOverride;
      return this.intentionUrgency === "nudge";
    },
    // A week with neither a commitment, a completion, nor an intention has nothing to review.
    showLastWeek() {
      return !!this.previousPlan?.items?.length
        || !!this.unplannedLastWeekCompletions.length
        || !!this.previousIntentions.length;
    },
    // Completed last week but never promised -- the other half of where the week went.
    unplannedLastWeekCompletions() {
      const promised = new Set(
        (this.previousPlan?.items || []).map((item) => String(item.taskRef))
      );
      return this.projectCompletions.filter((task) => !promised.has(String(task._id)));
    },
    previousItems() {
      return this.previousPlan?.items || [];
    },
    previousItemsByProject() {
      const grouped = {};
      for (const item of this.previousItems) {
        const key = item.projectRef || "";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      }
      return grouped;
    },
    unplannedCompletionsByProject() {
      const promised = new Set(this.previousItems.map((item) => String(item.taskRef)));
      const grouped = {};
      for (const [projectId, tasks] of Object.entries(this.projectCompletionsByProject)) {
        grouped[projectId] = tasks.filter((task) => !promised.has(String(task._id)));
      }
      return grouped;
    },
    // Projects that actually render a card below, so the partition matches the page.
    startedCompassProjectIds() {
      const ids = new Set();
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of this.startedProjects(goal)) ids.add(project._id);
        }
      }
      return ids;
    },
    /**
     * Last week's work with no project below to sit under.
     *
     * A strict partition against the rendered project cards: ended, parked, deleted, or no
     * project at all. Anything else reads inline under its project, never in both places.
     */
    homelessLastWeekGroups() {
      const keys = new Set([
        ...Object.keys(this.previousItemsByProject),
        ...Object.keys(this.unplannedCompletionsByProject),
      ]);
      const groups = [];

      for (const key of keys) {
        if (key && this.startedCompassProjectIds.has(key)) continue;
        const items = this.previousItemsByProject[key] || [];
        const unplanned = this.unplannedCompletionsByProject[key] || [];
        if (!items.length && !unplanned.length) continue;

        const ended = key ? this.endedProjectsById[key] : null;
        const title = ended?.title || this.projectTitles[key] || "";
        groups.push({
          key: key || "none",
          title: key ? title || "No longer tracked" : "No project",
          badge: this.homelessBadge(key, !!ended),
          items,
          unplanned,
        });
      }

      return groups.sort((left, right) => left.title.localeCompare(right.title));
    },
    projectTitles() {
      const titles = {};
      for (const role of this.roles) {
        for (const goal of role.goalList || []) {
          for (const project of goal.projectList || []) titles[project._id] = project.title;
        }
      }
      return titles;
    },
    commitLabel() {
      if (this.committing) return "Saving…";
      if (this.isCommitted) return "Update commitment";
      return `Commit to this week · ${this.selectedTasks.length} ${this.taskNoun(this.selectedTasks.length)}`;
    },
    // Committing only ever adds, so say so before the click rather than after.
    commitNote() {
      return this.isCommitted
        ? "Adds new work to the record. Committed items are never removed."
        : "Records what you promised this week. You can add more later, but not un-promise.";
    },
    tasksById() {
      const map = {};
      for (const task of this.taskList) map[task._id] = task;
      return map;
    },
    weeklyTasks() {
      return this.sortTasks(this.taskList.filter((task) => this.isDueThisWeek(task)));
    },
    // Every in-week project task is committed unless explicitly unchecked. An intention is
    // never committable work, so it is never selected. See docs/INTENTIONS.md.
    selectedTasks() {
      return this.weeklyTasks.filter(
        (task) => task.projectRef
          && !task.isIntention
          && this.selection[task._id] !== false
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
        return task.projectRef
          && !this.compassProjectIds.has(task.projectRef)
          && !this.endedProjectsById[task.projectRef];
      });
    },
    endedProjectsById() {
      const byId = {};
      for (const project of this.endedProjects) byId[project._id] = project;
      // A plan can name a project the compass payload no longer mentions at all.
      for (const project of this.planProjects) {
        if (project.ended && !byId[project._id]) byId[project._id] = project;
      }
      return byId;
    },
    // This week's live work under projects that have ended, named and grouped.
    endedProjectGroups() {
      const grouped = new Map();

      for (const task of this.weeklyTasks) {
        const project = task.projectRef && this.endedProjectsById[task.projectRef];
        if (!project) continue;
        if (!grouped.has(project._id)) {
          grouped.set(project._id, { _id: project._id, title: project.title, tasks: [] });
        }
        grouped.get(project._id).tasks.push(task);
      }

      return [...grouped.values()];
    },
    endedProjectTaskCount() {
      return this.endedProjectGroups.reduce((total, group) => total + group.tasks.length, 0);
    },
    /**
     * Committed work whose project is no longer on the board.
     *
     * Without this the items would count towards the week's totals while rendering
     * nowhere, so the header would promise rows that do not exist.
     */
    endedCommitmentGroups() {
      if (!this.isCommitted) return [];

      const groups = [];
      for (const [projectId, items] of Object.entries(this.committedItemsByProject)) {
        if (!projectId || this.compassProjectIds.has(projectId)) continue;
        const project = this.endedProjectsById[projectId]
          || this.planProjects.find((entry) => entry._id === projectId);
        groups.push({ _id: projectId, title: project?.title || "Former project", items });
      }
      return groups;
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
          // The role's context rides along so the editor can tell an intention.
          if (projects.length) {
            groups.push({
              label: `${role.title} → ${goal.title}`,
              projects,
              context: roleContextOf(role),
            });
          }
        }
      }
      return groups;
    },
  },
  methods: {
    contextMeta,
    roleContextOf,
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
      this.loadIntentions();

      const [compassResult, taskResult] = await Promise.allSettled([
        this.$http.get("/api/getCompass"),
        this.$http.get("/api/getUserTasks"),
      ]);

      if (compassResult.status === "fulfilled" && compassResult.value.data.success) {
        this.roles = compassResult.value.data.roles || [];
        this.endedProjects = compassResult.value.data.endedProjects || [];
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
        this.applyPlans(response.data.plans, response.data.projects);
      } catch (error) {
        if (requestId === this.planRequestId) {
          this.planError = "Weekly plans could not be loaded.";
        }
      } finally {
        if (requestId === this.planRequestId) this.planLoading = false;
      }
    },
    // Commit and read return the same shape, so one reducer serves both.
    applyPlans(plans, projects) {
      const incoming = plans || [];
      const replaced = new Set(incoming.map((plan) => plan.weekStart));
      this.plans = [
        ...this.plans.filter((plan) => !replaced.has(plan.weekStart)),
        ...incoming,
      ];
      // Identity for projects a plan references, including ones that have since ended.
      if (projects) {
        const byId = new Map(this.planProjects.map((entry) => [entry._id, entry]));
        for (const project of projects) byId.set(project._id, project);
        this.planProjects = [...byId.values()];
      }
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
              "[data-test^='last-week-project-toggle-']"
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
        this.applyPlans(response.data.plans, response.data.projects);
      } catch (error) {
        this.commitError = "This week could not be committed.";
      } finally {
        this.committing = false;
      }
    },
    /**
     * Move last week's unfinished work into this week.
     *
     * One request per target date, and each response carries both the refreshed tasks and
     * both weeks' plans -- so the carried task appears below and last week's item becomes
     * `moved` without its snapshot being rewritten.
     */
    async carryForward(entries) {
      const wanted = (entries || []).filter((entry) => entry.taskId && entry.dueDate);
      if (!wanted.length || this.carrying) return;

      if (this.refreshTemporal()) {
        // A rollover invalidates dates computed against the old week, so re-read and stop.
        this.loadProjectCompletions();
        await this.loadPlans();
        this.carryError = "The week rolled over. Check the dates and try again.";
        return;
      }

      this.carrying = true;
      this.carryError = "";

      // The endpoint takes one date per call, so same-day rows travel together.
      const byDate = new Map();
      for (const entry of wanted) {
        if (!byDate.has(entry.dueDate)) byDate.set(entry.dueDate, []);
        byDate.get(entry.dueDate).push(String(entry.taskId));
      }

      try {
        for (const [dueDate, taskIds] of byDate) {
          const response = await this.$http.post("/api/carryTasksForward", { taskIds, dueDate });
          if (!response.data.success) {
            this.carryError = response.data.log || "That work could not be carried forward.";
            return;
          }
          this.taskList = response.data.taskList || this.taskList;
          this.applyPlans(response.data.plans, response.data.projects);
        }
      } catch (error) {
        this.carryError = "That work could not be carried forward.";
      } finally {
        this.carrying = false;
      }
    },
    toggleTask(task) {
      this.selection[task._id] = this.selection[task._id] === false;
    },
    // A missed intention moves to THIS week's Sunday: the same intent, a fresh week.
    async carryIntention(task) {
      if (!task?._id || this.carrying) return;

      this.carrying = true;
      this.carryError = "";

      try {
        const response = await this.$http.post("/api/carryTasksForward", {
          taskIds: [String(task._id)],
          dueDate: this.week.endDate,
        });
        if (!response.data.success) {
          this.carryError = response.data.log || "That could not be carried forward.";
          return;
        }
        this.taskList = response.data.taskList || this.taskList;
        this.applyPlans(response.data.plans, response.data.projects);
        await this.loadIntentions();
      } catch (error) {
        this.carryError = "That could not be carried forward.";
      } finally {
        this.carrying = false;
      }
    },
    // Both weeks in one call: this week's band and last week's review band.
    async loadIntentions() {
      const from = this.previousWeek?.startDate;
      const to = this.week?.endDate;
      if (!from || !to) return;

      try {
        const response = await this.$http.get("/api/getIntentions", {
          params: { from, to },
        });
        if (!response.data.success) {
          this.intentionLoadError = response.data.log || "Intentions could not be loaded.";
          return;
        }
        this.intentions = response.data.items || [];
        this.intentionLoadError = "";
      } catch (error) {
        this.intentionLoadError = "Intentions could not be loaded.";
      }
    },
    /**
     * The whole check-in: one click marks an intention done.
     *
     * Completion is an ordinary task completion, so there is no intention-specific
     * endpoint and the Calendar stays in step without anything to synchronise.
     */
    async completeIntention(task) {
      const taskId = task?._id;
      if (!taskId || this.completingIntentionId) return;

      this.completingIntentionId = taskId;
      this.intentionError = "";

      try {
        const response = await this.$http.post("/api/completeTask", { taskId });
        if (!response.data.success || !Array.isArray(response.data.taskList)) {
          this.intentionError = response.data.log || "That could not be marked done.";
          return;
        }
        this.taskList = response.data.taskList;
        // The completed task leaves the task list, so re-read the band's own source.
        await this.loadIntentions();
      } catch (error) {
        this.intentionError = "That could not be marked done.";
      } finally {
        this.completingIntentionId = null;
      }
    },
    refreshTemporal() {
      const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);
      const nextWeek = mondayWeekBounds(today);
      const weekChanged = nextWeek && this.week?.startDate !== nextWeek.startDate;
      this.today = today;
      this.week = nextWeek;

      if (weekChanged) {
        // A new week starts uncommitted, with a fresh selection, and with both bands back
        // to their default open state for the new week's weekday.
        this.selection = {};
        this.commitError = "";
        this.intentionOpenOverride = null;
        this.lastWeekOpenOverride = null;
        // The loaded range is keyed to the old week, so every caller needs it re-read.
        this.loadIntentions();
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
    // Out-of-week work, minus anything the commitment already reports as "moved".
    otherTasksForProject(projectId) {
      return this.tasksForProject(projectId, false).filter(
        (task) => !this.committedTaskIds.has(String(task._id))
      );
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
      return this.unplannedCompletionsByProject[projectId] || [];
    },
    previousItemsForProject(projectId) {
      return this.previousItemsByProject[projectId] || [];
    },
    // Why this project has no card below, named rather than left as a mystery.
    homelessBadge(projectId, ended) {
      if (!projectId) return "";
      if (ended) return "project ended";
      if (this.compassProjectIds.has(projectId)) return "not started";
      return "no longer tracked";
    },
    roleSummary(role) {
      const projectIds = [];
      for (const goal of role.goalList || []) {
        for (const project of goal.projectList || []) projectIds.push(project._id);
      }
      const ids = new Set(projectIds);

      if (this.isCommitted) {
        const items = this.committedItems.filter((item) => ids.has(item.projectRef));
        if (items.length) {
          const done = items.filter((item) => item.status === "done").length;
          return `${done}/${items.length} done`;
        }
        // Nothing committed under this role, but work added later still belongs to it.
        const added = this.weeklyTasks.filter((task) => {
          return ids.has(task.projectRef) && !this.committedTaskIds.has(String(task._id));
        });
        return added.length ? `${added.length} added` : "nothing committed";
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
      // The band reads its own endpoint, so an edited task will not appear without this.
      this.loadIntentions();
    },
    async createTask(project) {
      if (this.refreshTemporal()) this.loadProjectCompletions();
      const form = this.forms[project._id];
      form.error = false;
      form.message = "";
      const title = form.title.trim();
      const duration = Number(form.duration);
      const intention = this.personalProjectIds.has(project._id);

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
      // An intention's due date is the week's Sunday, set by the server, so there is no
      // chosen date to validate.
      if (!intention && (form.dueDate < this.week.startDate || form.dueDate > this.week.endDate)) {
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
          dueDate: intention ? null : form.dueDate,
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
        if (intention) {
          // The band reads its own endpoint, so a new intention needs it re-read.
          form.message = "Added as an intention, due Sunday.";
          this.loadIntentions();
        } else {
          form.message = this.isCommitted
            ? "Task added since commit."
            : "Task added to this week.";
        }
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
  justify-items: end;
}

/* The primary action lives at the foot of the page, after all the week's content. */
.commit-bar {
  display: grid;
  gap: 8px;
  justify-items: center;
  margin-top: 24px;
  padding: 18px 20px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  background: rgba(13, 17, 23, 0.6);
}

.commit-bar .bar-message {
  width: 100%;
  margin-bottom: 0;
}

.commit-button {
  white-space: nowrap;
}

.commit-note {
  margin: 0;
  color: #8b949e;
  font-size: 0.72rem;
  text-align: center;
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

.role-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.context-badge {
  font-size: 0.68rem;
  padding: 1px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #9aa0a6;
  white-space: nowrap;
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

.ended-commitment {
  padding: 14px 18px;
  border: 1px solid rgba(217, 164, 65, 0.28);
  border-radius: 12px;
  background: rgba(40, 33, 20, 0.45);
}

.ended-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ended-head h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #d8dee5;
}

.ended-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(217, 164, 65, 0.18);
  color: #d9a441;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ended-group + .ended-group {
  margin-top: 14px;
}

.ended-group-title {
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: #c8d1da;
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

  .commit-bar {
    padding: 14px;
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
