<template>
  <div>
    <div class="calendar-page">
      <div class="page-header-section">
        <h1 class="page-title">My Calendar</h1>
        <div class="header-actions">
          <BButton variant="primary" v-on:click="openAddTaskModal" class="action-btn" aria-label="Add new task">
            <span class="btn-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M3 8h10"/></svg></span> Add Task
          </BButton>
          <BButton
            variant="success"
            v-on:click="scheduleTasks"
            class="action-btn"
            aria-label="Schedule tasks"
            data-test="schedule-tasks"
            :disabled="schedulingBusy"
            :aria-busy="schedulingBusy ? 'true' : 'false'"
          >
            <span
              v-if="schedulingBusy"
              class="spinner-border spinner-border-sm btn-icon"
              aria-hidden="true"
            ></span>
            <span v-else-if="schedulingError" class="btn-icon" aria-hidden="true">!</span>
            <span v-else class="btn-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M6 10l1.5 1.5L10.5 8.5"/></svg></span>
            <span role="status" aria-live="polite">{{ scheduleButtonLabel }}</span>
          </BButton>
          <BButton
            variant="secondary"
            v-on:click="syncCalendar"
            class="action-btn"
            aria-label="Sync calendar with Google"
            data-test="sync-calendar"
            :disabled="syncing"
            :aria-busy="syncing ? 'true' : 'false'"
          >
            <span
              v-if="syncing"
              class="spinner-border spinner-border-sm btn-icon"
              aria-hidden="true"
            ></span>
            <span v-else class="btn-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/></svg></span>
            {{ syncing ? "Syncing…" : "Sync Calendar" }}
          </BButton>
        </div>
      </div>
      <div class="calendar-box" :class="{ 'is-busy': schedulingBusy }" :aria-busy="schedulingBusy ? 'true' : 'false'">
        <div class="task-controls">
          <div class="task-list">
            <h3 ref="taskListTitle" class="sidebar-title" tabindex="-1">Tasks</h3>
            <p
              v-if="quickCompleteError"
              class="quick-complete-error"
              role="alert"
              data-test="quick-complete-error"
            >
              {{ quickCompleteError }}
            </p>
            <p
              v-if="comparisonError"
              class="quick-complete-error"
              role="alert"
              data-test="compare-error"
            >
              {{ comparisonError }}
            </p>
            <section
              v-if="selectionActive"
              class="slip-forecast-panel"
              data-test="slip-forecast-panel"
              :data-forecast-mode="forecastMode"
              aria-labelledby="slip-forecast-title"
            >
              <div class="slip-forecast-heading">
                <div>
                  <span class="what-if-label">What if?</span>
                  <h4 id="slip-forecast-title" :title="forecastHeadingTooltip">{{ forecastHeading }}</h4>
                  <p v-if="premiseIds.length > 1" class="forecast-premises" data-test="forecast-premises">
                    <template v-for="(title, index) in premiseTitles" :key="premiseIds[index]">
                      <span v-if="index" class="premise-separator" aria-hidden="true">·</span>
                      <span class="premise-title" :title="title">{{ title }}</span>
                    </template>
                  </p>
                </div>
                <button
                  class="forecast-close"
                  type="button"
                  aria-label="Close blocked-slot forecast"
                  @click="closeSlipForecast"
                >
                  ×
                </button>
              </div>
              <p v-if="activeForecast" class="forecast-summary" data-test="slip-forecast-summary">
                <strong>
                  {{ activeForecast.movedCount }} downstream
                  {{ activeForecast.movedCount === 1 ? "task moves" : "tasks move" }} later
                </strong>
                <span>·</span>
                <strong :class="{ danger: activeForecast.newlyLateCount }">
                  {{ activeForecast.newlyLateCount }}
                  {{ activeForecast.newlyLateCount === 1
                    ? "newly misses its deadline"
                    : "newly miss deadlines" }}
                </strong>
              </p>
              <p
                v-if="activeForecast && movedPremiseCount"
                class="forecast-summary forecast-selected-summary"
                data-test="slip-selected-summary"
              >
                <strong>
                  {{ movedPremiseCount }} selected
                  {{ movedPremiseCount === 1 ? "task moves" : "tasks move" }} too
                </strong>
                <template v-if="latePremiseCount">
                  <span>·</span>
                  <strong class="danger">
                    {{ latePremiseCount }}
                    {{ latePremiseCount === 1
                      ? "misses its deadline"
                      : "miss their deadlines" }}
                  </strong>
                </template>
              </p>
              <p class="forecast-assumption">
                {{ premiseIds.length > 1
                  ? "Other events fill every selected task's planned time, then all incomplete tasks are scheduled again. Nothing is saved."
                  : "Another event fills this task's planned time, then all incomplete tasks are scheduled again. Nothing is saved." }}
              </p>
              <div class="forecast-selection-bar" data-test="forecast-selection-bar">
                <span data-test="compare-selection-count">
                  {{ premiseIds.length }}
                  {{ premiseIds.length === 1 ? "slot" : "slots" }} selected
                </span>
                <button
                  v-if="canAnalyzeSelection"
                  class="forecast-analyze"
                  type="button"
                  data-test="analyze-slots"
                  :disabled="comparisonLoading"
                  @click="analyzeSelectedSlots"
                >
                  {{ comparisonLoading ? "Analyzing…" : `Analyze ${premiseIds.length} slots together` }}
                </button>
                <span v-else class="forecast-selection-hint">
                  Use “+ add” on another task to add its slot.
                </span>
              </div>
              <!-- The premise moves too. Shown separately: it is the question, not the damage. -->
              <section
                v-if="activeForecast && premiseImpacts.length"
                class="forecast-section"
                data-test="forecast-selected-slots"
              >
                <h5 class="forecast-section-title">
                  {{ premiseImpacts.length === 1 ? "Selected slot" : "Selected slots" }}
                </h5>
                <ol class="forecast-cascade premise-cascade">
                  <li
                    v-for="impact in premiseImpacts"
                    :key="impact.taskId"
                    :class="{ 'newly-late': impact.newlyLate }"
                    :data-test="`slip-premise-${impact.taskId}`"
                    :data-baseline-date="impact.baselineDate"
                    :data-forecast-date="impact.forecastDate || 'unscheduled'"
                  >
                    <span class="cascade-marker" aria-hidden="true"></span>
                    <span class="cascade-task" :title="impact.title">{{ impact.title }}</span>
                    <span class="cascade-dates">
                      {{ forecastDateLabel(impact.baselineDate) }}
                      <span aria-hidden="true">→</span>
                      {{ forecastDateLabel(impact.forecastDate) || "Unscheduled" }}
                      <strong v-if="impact.newlyLate">Late</strong>
                    </span>
                  </li>
                </ol>
              </section>
              <section v-if="activeForecast && activeForecast.affected.length" class="forecast-section">
                <h5 class="forecast-section-title">Downstream</h5>
                <ol class="forecast-cascade">
                  <li
                    v-for="impact in activeForecast.affected"
                    :key="impact.taskId"
                    :class="{ 'newly-late': impact.newlyLate }"
                    :data-test="`slip-impact-${impact.taskId}`"
                    :data-baseline-date="impact.baselineDate"
                    :data-forecast-date="impact.forecastDate || 'unscheduled'"
                  >
                    <span class="cascade-marker" aria-hidden="true"></span>
                    <span class="cascade-task" :title="impact.title">{{ impact.title }}</span>
                    <span class="cascade-dates">
                      {{ forecastDateLabel(impact.baselineDate) }}
                      <span aria-hidden="true">→</span>
                      {{ forecastDateLabel(impact.forecastDate) || "Unscheduled" }}
                      <strong v-if="impact.newlyLate">Late</strong>
                    </span>
                  </li>
                </ol>
              </section>
            </section>
            <div v-for="date in tasksDatesArray" :key="date" class="task-group">
              <h4 class="task-date-header">{{ date }}</h4>
              <ul class="task-items">
                <li
                  v-for="task in taskGroupedByDate[date]"
                  :key="task._id"
                  :data-test="`task-item-${task._id}`"
                  v-bind:class="{
                    'task-item': true,
                    'late-task': !task.isBacklog && getTaskDaysBetweenDeadlineAndSchedule(task) < 0,
                    'on-track-task': !task.isBacklog &&
                      getTaskDaysBetweenDeadlineAndSchedule(task) > 0,
                    'due-that-day-task': !task.isBacklog &&
                      getTaskDaysBetweenDeadlineAndSchedule(task) == 0,
                    'backlog-task': task.isBacklog,
                    'forecast-selected-task': isForecastPremise(task),
                    'forecast-moved-task': selectedImpactForTask(task)?.moved,
                    'forecast-newly-late-task': selectedImpactForTask(task)?.newlyLate
                      || premiseImpactForTask(task)?.newlyLate
                  }"
                  v-on:click="openEditTaskModal(task)"
                >
                  <span class="task-primary-row">
                    <span class="task-title">
                      <span v-if="isRecurringTask(task)" class="recurring-icon" title="Part of a repeating series" role="img" aria-label="Repeating task">↻</span>
                      <span v-if="task.dependsOn && task.dependsOn.length > 0" class="dependency-icon" title="Has dependencies" role="img" aria-label="Has dependencies">🔗</span>
                      {{ task.title }}
                    </span>
                    <span class="task-row-meta">
                      <span class="task-badge" v-if="task.isBacklog">BACKLOG</span>
                      <span
                        v-else-if="!hasValidScheduledDate(task)"
                        class="task-badge unscheduled-badge"
                        title="No scheduled time"
                        aria-label="Needs time: no scheduled time"
                      >
                        NEEDS TIME
                      </span>
                      <span
                        class="task-days"
                        v-else
                        :title="deadlineGapLabel(task)"
                        :aria-label="deadlineGapLabel(task)"
                      >
                        {{ getTaskDaysBetweenDeadlineAndSchedule(task) }}
                      </span>
                      <!-- Two-step: the first click arms, the second completes. No undo exists. -->
                      <button
                        class="quick-complete-button"
                        :class="{ armed: isCompletionArmed(task) }"
                        type="button"
                        :data-test="`quick-complete-${task._id}`"
                        :aria-label="quickCompleteLabel(task)"
                        :aria-busy="isQuickCompleting(task)"
                        :title="quickCompleteLabel(task)"
                        :disabled="isQuickCompleting(task)"
                        @click.stop="toggleQuickComplete(task)"
                        @keydown.esc.stop="disarmCompletion()"
                        @blur="disarmCompletion()"
                      >
                        <span aria-hidden="true">{{ quickCompleteGlyph(task) }}</span>
                      </button>
                    </span>
                  </span>
                  <!-- Lets a title stay short: the project says what it is about. -->
                  <span
                    v-if="projectLabelFor(task)"
                    class="task-project"
                    :data-test="`task-project-${task._id}`"
                    :title="`Project: ${projectLabelFor(task)}`"
                    :aria-label="`Project: ${projectLabelFor(task)}`"
                  >
                    {{ projectLabelFor(task) }}
                  </span>
                  <span v-if="showsSlotControl(task)" class="slip-impact-row">
                    <!-- The task that opened the panel keeps its chip; the rest offer to join it. -->
                    <button
                      v-if="offersCompareControl(task)"
                      class="slot-select-chip"
                      :class="{ selected: isForecastPremise(task) }"
                      type="button"
                      :data-test="`slot-select-${task._id}`"
                      :aria-pressed="isForecastPremise(task)"
                      :aria-label="slotSelectLabel(task)"
                      :title="slotSelectLabel(task)"
                      @click.stop="toggleComparisonSelection(task)"
                    >
                      {{ isForecastPremise(task) ? "✓ added" : "+ add" }}
                    </button>
                    <button
                      v-else
                      class="slip-impact-chip"
                      :class="{ risk: slipForecastFor(task).newlyLateCount > 0, safe: !slipForecastFor(task).newlyLateCount }"
                      type="button"
                      :data-test="`slip-impact-chip-${task._id}`"
                      :aria-expanded="selectedSlipForecastId === task._id"
                      :aria-label="slipForecastAriaLabel(task)"
                      @click.stop="toggleSlipForecast(task)"
                    >
                      <span aria-hidden="true">slot blocked →</span>
                      {{ slipForecastFor(task).newlyLateCount ? `${slipForecastFor(task).newlyLateCount} late` : "safe" }}
                    </button>
                  </span>
                </li>
              </ul>
            </div>

            <!-- Personal work: present and tickable, but never given a slot on the grid.
                 See docs/INTENTIONS.md. -->
            <details
              v-if="sidebarIntentions.length"
              class="intention-group"
              data-test="calendar-intentions"
            >
              <summary>
                <span class="intention-group-title">This week, beyond work</span>
                <span class="intention-group-count">
                  {{ sidebarIntentions.length }} to do
                </span>
              </summary>
              <ul class="task-items">
                <li
                  v-for="task in sidebarIntentions"
                  :key="task._id"
                  class="task-item intention-task"
                  :data-test="`task-item-${task._id}`"
                  v-on:click="openEditTaskModal(task)"
                >
                  <span class="task-primary-row">
                    <span class="task-title">{{ task.title }}</span>
                    <span class="task-row-meta">
                      <!-- No day-count and no NEEDS TIME: there is no schedule to be late
                           against, so either would be a lie. -->
                      <span class="task-badge intention-badge">INTENTION</span>
                      <button
                        class="quick-complete-button"
                        :class="{ armed: isCompletionArmed(task) }"
                        type="button"
                        :data-test="`quick-complete-${task._id}`"
                        :aria-label="quickCompleteLabel(task)"
                        :aria-busy="isQuickCompleting(task)"
                        :title="quickCompleteLabel(task)"
                        :disabled="isQuickCompleting(task)"
                        @click.stop="toggleQuickComplete(task)"
                        @keydown.esc.stop="disarmCompletion()"
                        @blur="disarmCompletion()"
                      >
                        <span aria-hidden="true">{{ quickCompleteGlyph(task) }}</span>
                      </button>
                    </span>
                  </span>
                  <span
                    v-if="projectLabelFor(task)"
                    class="task-project"
                    :data-test="`task-project-${task._id}`"
                    :title="`Project: ${projectLabelFor(task)}`"
                    :aria-label="`Project: ${projectLabelFor(task)}`"
                  >
                    {{ projectLabelFor(task) }}
                  </span>
                </li>
              </ul>
            </details>
          </div>
      </div>
        <div class="main-calendar">
        <div class="calendar-controls">
          <button class="nav-btn" v-on:click="prevWeek" title="Previous Week">
            <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg></span> Previous
          </button>
          <button class="nav-btn" v-on:click="nextWeek" title="Next Week">
            Next <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg></span>
          </button>
        </div>
        <div v-if="allDayEvents.length" class="all-day-events" data-test="all-day-row">
          <span class="all-day-label">All day</span>
          <span
            v-for="event in allDayEvents"
            :key="event._id"
            class="all-day-event"
            :data-event-date="event.allDayStart"
            :data-event-end="event.allDayEnd"
          >
            <span>{{ allDayEventRange(event) }} · {{ event.title }}</span>
            <button
              class="all-day-delete"
              type="button"
              :aria-label="`Delete event: ${event.title}`"
              :title="`Delete event: ${event.title}`"
              @click.stop="deleteAllDayEvent(event)"
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        </div>
        <div class="calendar-container">
          <DayPilotCalendar :config="config" ref="calendar" id="dp" />
        </div>
      </div>
      </div>
    </div>
    <TaskEditor
      v-if="taskEditorOpen"
      :key="selectedTask?._id || 'new-task'"
      :task="selectedTask"
      :tasks="taskList || []"
      :project-groups="projectOptionGroups"
      :working-days="userWorkingDays"
      :time-zone="$store.state.user?.timeZone || 'UTC'"
      :default-start-date="editorDefaultStartDate"
      :completion-chunk-duration="selectedChunkDuration"
      show-follow-up
      @close="closeTaskEditor"
      @changed="applyTaskChanges"
    />
  </div>
</template>

<script>
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-vue";
import { BButton } from 'bootstrap-vue-next';
import TaskEditor from "../components/TaskEditor.vue";
import {
  addCalendarDays,
  apiDateOnly,
  calendarDayDifference,
  dayPilotWallToIso,
  dateOnlyInTimeZone,
  instantToDayPilotWall,
  instantPartsInTimeZone,
  localDateOnly,
  mondayWeekBounds,
} from "../utils/temporal";
import { isIntention, intentionsForWeek } from "../utils/intentions";
import { roleContextOf } from "../utils/roleContext";
import { useSeo } from '@/composables/useSeo';

// The sidebar shows this far ahead; the scheduler materialises 60 days of occurrences.
const SIDEBAR_WINDOW_DAYS = 21;

export default {
  name: "Calendar",
  setup() {
    useSeo({ title: 'My calendar', noindex: true });
  },
  components: {
    DayPilotCalendar,
    BButton,
    TaskEditor
  },
  data() {
    return {
      config: {
        viewType: "Week",
        dayBeginsHour: 9,
        businessBeginsHour: 10,
        businessEndsHour: 18,
        cellDuration: 15,
        onBeforeCellRender: (args) => {
          const user = this.$store.state.user || {};
          const start = user.workingStartMinutes ?? 9 * 60;
          const end = user.workingEndMinutes ?? 17 * 60;
          const workingDays = user.workingDays || [];
          const instant = dayPilotWallToIso(args.cell.start);
          const parts = instantPartsInTimeZone(instant, user.timeZone);
          args.cell.properties.business = !!parts &&
            workingDays.includes(parts.weekday) &&
            parts.minutes >= start &&
            parts.minutes < end;
        },
        startDate: new DayPilot.Date(
          dateOnlyInTimeZone(this.$store.state.user?.timeZone)
        ).firstDayOfWeek(),
        onTimeRangeSelected: async (args) => {
          const modal = await DayPilot.Modal.prompt(
            "Create a new event:",
            "Event 1"
          );
          const dp = args.control;
          dp.clearSelection();
          if (modal.canceled) {
            return;
          }
          // Make an API call to create the event in the backend
          try {
            const response = await this.$http.post("/api/createEvent", {
              title: modal.result,
              startDate: dayPilotWallToIso(args.start),
              endDate: dayPilotWallToIso(args.end),
            });
            if (response.data.success) {
              // Add the event to the calendar if the backend creation was successful
              dp.events.add({
                start: args.start,
                end: args.end,
                id: response.data.event._id,
                text: modal.result,
              });
            } else {
              console.error(response.data.log);
            }
          } catch (error) {
            console.error(error);
          }
        },
        onEventMove: async (args) => {
          let eventDetails = args.e.data;
          if (
            eventDetails.tags ? eventDetails.tags.type.includes("task") : false
          ) {
            this.openEditTaskModalFromEvent(eventDetails);
          } else {
            try {
              const response = await this.$http.post("/api/updateEvent", {
                eventId: args.e.data.id,
                startDate: dayPilotWallToIso(args.newStart),
                endDate: dayPilotWallToIso(args.newEnd),
              });
              if (!response.data.success) {
                console.error(response.data.log);
              }
            } catch (error) {
              console.error(error);
            }
          }
        },
        onEventResize: async (args) => {
          try {
            const response = await this.$http.post("/api/updateEvent", {
              eventId: args.e.data.id,
              startDate: dayPilotWallToIso(args.newStart),
              endDate: dayPilotWallToIso(args.newEnd),
            });
            if (!response.data.success) {
              console.error(response.data.log);
            }
          } catch (error) {
            console.error(error);
          }
        },
        onEventClicked: async (args) => {
          let eventDetails = args.e.data;
          if (
            eventDetails.tags ? eventDetails.tags.type.includes("task") : false
          ) {
            this.openEditTaskModalFromEvent(eventDetails);
          }
        },
        eventDeleteHandling: "Update",
        onAfterEventRender: (args) => {
          args.div.dataset.eventStart = args.e.data.start.toString();
        },
        onEventDeleted: async (args) => {
          try {
            const response = await this.$http.post("/api/deleteEvent", {
              eventId: args.e.data.id,
            });
            if (!response.data.success) {
              console.error(response.data.log);
            }
          } catch (error) {
            console.error(error);
          }
        },
      },
      user: this.$store.state.user,
      taskList: null,
      highlightInterval: null,
      taskEditorOpen: false,
      currentDate: dateOnlyInTimeZone(this.$store.state.user?.timeZone),
      selectedTask: null,
      selectedEvent: null,
      allDayEvents: [],
      quickCompletingTaskIds: [],
      quickCompleteError: "",
      // The task whose inline complete button is armed, plus its auto-disarm timer.
      armedCompleteTaskId: null,
      armedCompleteTimer: null,
      slipForecasts: {},
      selectedSlipForecastId: null,
      // Extra slots added while a forecast is open. Calculated on demand, never persisted.
      comparisonSelection: [],
      comparisonForecast: null,
      comparisonLoading: false,
      comparisonError: "",
      // Feedback for the long-running schedule run, shown in the button itself.
      schedulingBusy: false,
      schedulingError: false,
      schedulingErrorTimer: null,
      syncing: false,
      // Compass roles, nested with their goals and projects.
      compassRoles: [],
      // Open tasks can point at a finished project, which the roles tree no longer holds.
      endedProjects: [],
    };
  },
  methods: {
    allDayEventRange(event) {
      const lastDay = addCalendarDays(event.allDayEnd, -1);
      return lastDay && lastDay !== event.allDayStart
        ? `${event.allDayStart} – ${lastDay}`
        : event.allDayStart;
    },
    async deleteAllDayEvent(event) {
      try {
        const response = await this.$http.post("/api/deleteEvent", {
          eventId: event._id,
        });
        if (!response.data.success) {
          console.error(response.data.log);
          return;
        }
        this.allDayEvents = this.allDayEvents.filter(({ _id }) => _id !== event._id);
      } catch (error) {
        console.error(error);
      }
    },
    isRecurringTask(task) {
      return !!(task?.seriesRef || task?.repeat);
    },
    isQuickCompleting(task) {
      return this.quickCompletingTaskIds.includes(task?._id);
    },
    isCompletionArmed(task) {
      return !!task?._id && this.armedCompleteTaskId === task._id;
    },
    quickCompleteGlyph(task) {
      // Same glyph armed or not: the button must never change size.
      return this.isQuickCompleting(task) ? "…" : "✓";
    },
    quickCompleteLabel(task) {
      const title = task?.title || "task";
      return this.isCompletionArmed(task)
        ? `Confirm completion of ${title}`
        : `Complete task: ${title}`;
    },
    /** First click arms the button, second click within the window completes. */
    toggleQuickComplete(task) {
      if (this.isCompletionArmed(task)) {
        this.disarmCompletion();
        this.quickCompleteTask(task);
        return;
      }
      this.armCompletion(task);
    },
    armCompletion(task) {
      const taskId = task?._id;
      if (!taskId) return;
      this.quickCompleteError = "";
      this.disarmCompletion();
      this.armedCompleteTaskId = taskId;
      this.armedCompleteTimer = setTimeout(() => this.disarmCompletion(), 4000);
    },
    disarmCompletion() {
      if (this.armedCompleteTimer) clearTimeout(this.armedCompleteTimer);
      this.armedCompleteTimer = null;
      this.armedCompleteTaskId = null;
    },
    async quickCompleteTask(task) {
      const taskId = task?._id;
      if (!taskId || this.quickCompletingTaskIds.includes(taskId)) return;

      this.quickCompleteError = "";
      this.quickCompletingTaskIds = [...this.quickCompletingTaskIds, taskId];
      let completed = false;

      try {
        const response = await this.$http.post("/api/completeTask", { taskId });
        if (!response.data.success || !Array.isArray(response.data.taskList)) {
          this.quickCompleteError = response.data.log || "Task could not be completed.";
          return;
        }

        this.taskList = response.data.taskList;
        completed = true;
        await Promise.all([this.loadCalendarEvents(), this.loadSlipForecasts()]);
      } catch (error) {
        this.quickCompleteError = completed
          ? "Task completed, but the calendar could not refresh."
          : "Task could not be completed.";
      } finally {
        this.quickCompletingTaskIds = this.quickCompletingTaskIds.filter((id) => id !== taskId);
      }
    },
    async loadTasks() {
      const taskDataResponse = await this.$http.get("/api/getUserTasks/");
      if (!taskDataResponse.data.success) {
        console.error("Task retrieval error");
        return;
      }
      this.taskList = taskDataResponse.data.taskList;
      this.loadSlipForecasts();
    },
    loadSlipForecasts() {
      this.slipForecasts = Object.fromEntries(
        (this.taskList || [])
          .filter((task) => task.slipForecast)
          .map((task) => [task._id, task.slipForecast])
      );
      const selectedTask = this.taskList?.find((task) => task._id === this.selectedSlipForecastId);
      if (this.selectedSlipForecastId &&
        (!this.isInSidebarWindow(selectedTask) || !this.hasVisibleSlipForecast(selectedTask))) {
        this.clearSlipForecastSelection();
      }
    },
    hasValidScheduledDate(task) {
      if (!task?.scheduledDate) return false;
      return !Number.isNaN(new Date(task.scheduledDate).getTime());
    },
    hasVisibleSlipForecast(task) {
      const forecast = this.slipForecastFor(task);
      if (!this.hasValidScheduledDate(task) || !forecast) return false;
      return Number(forecast.movedCount) > 0 || Number(forecast.newlyLateCount) > 0;
    },
    isInSidebarWindow(task) {
      if (!this.hasValidScheduledDate(task)) return !this.isRecurringTask(task);
      if (!task?.seriesRef) return true;
      const scheduled = new Date(task.scheduledDate);
      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + SIDEBAR_WINDOW_DAYS);
      windowEnd.setHours(23, 59, 59, 999);
      return scheduled <= windowEnd;
    },
    slipForecastFor(task) {
      return this.slipForecasts[task?._id] || null;
    },
    canCompareTask(task) {
      return !task?.isBacklog && this.hasValidScheduledDate(task);
    },
    // The origin keeps its chip; every other scheduled task offers to join the comparison.
    offersCompareControl(task) {
      return this.selectionActive
        && this.selectedSlipForecastId !== task?._id
        && this.canCompareTask(task);
    },
    showsSlotControl(task) {
      return this.offersCompareControl(task) || this.hasVisibleSlipForecast(task);
    },
    isForecastPremise(task) {
      return this.premiseIds.includes(task?._id);
    },
    slotSelectLabel(task) {
      return this.isForecastPremise(task)
        ? `Remove ${task.title}'s slot from this what if`
        : `Also block ${task.title}'s slot in this what if`;
    },
    toggleComparisonSelection(task) {
      const taskId = task?._id;
      if (!taskId || taskId === this.selectedSlipForecastId) return;

      this.comparisonSelection = this.comparisonSelection.includes(taskId)
        ? this.comparisonSelection.filter((id) => id !== taskId)
        : [...this.comparisonSelection, taskId];
      this.comparisonError = "";
    },
    clearComparison() {
      this.comparisonSelection = [];
      this.comparisonForecast = null;
      this.comparisonError = "";
    },
    async analyzeSelectedSlots() {
      const taskIds = this.premiseIds;
      if (taskIds.length < 2 || this.comparisonLoading) return;

      this.comparisonLoading = true;
      this.comparisonError = "";
      try {
        const response = await this.$http.post("/api/analyzeBlockedSlots", { taskIds });
        if (!response.data.success || !response.data.forecast) {
          this.comparisonForecast = null;
          this.comparisonError = response.data.log || "Those slots could not be analyzed.";
          return;
        }
        this.comparisonForecast = response.data.forecast;
      } catch (error) {
        this.comparisonForecast = null;
        this.comparisonError = "Those slots could not be analyzed.";
      } finally {
        this.comparisonLoading = false;
      }
    },
    // Downstream collateral only. The premise is highlighted as a premise, not as collateral.
    selectedImpactForTask(task) {
      return this.activeForecast?.affected.find((impact) => impact.taskId === task?._id) || null;
    },
    premiseImpactForTask(task) {
      return this.premiseImpacts.find((impact) => impact.taskId === task?._id) || null;
    },
    toggleSlipForecast(task) {
      const closing = this.selectedSlipForecastId === task._id && !this.comparisonSelection.length;
      this.clearComparison();
      this.selectedSlipForecastId = closing ? null : task._id;
    },
    clearSlipForecastSelection(restoreFocus = null) {
      const taskId = this.selectedSlipForecastId;
      const panelHadFocus = typeof document !== "undefined"
        && !!document.activeElement?.closest?.(".slip-forecast-panel");
      this.selectedSlipForecastId = null;
      this.clearComparison();
      if (!taskId || !(restoreFocus ?? panelHadFocus)) return;
      this.$nextTick(() => {
        const chip = document.querySelector(`[data-test="slip-impact-chip-${taskId}"]`);
        (chip || this.$refs.taskListTitle)?.focus();
      });
    },
    // Closing always dismisses the whole panel, including any added slots.
    closeSlipForecast() {
      this.clearSlipForecastSelection(true);
    },
    slipForecastAriaLabel(task) {
      const forecast = this.slipForecastFor(task);
      if (!forecast) return "";
      const result = forecast.newlyLateCount
        ? `${forecast.newlyLateCount} downstream ${forecast.newlyLateCount === 1 ? "deadline is" : "deadlines are"} newly missed`
        : "no downstream deadlines are newly missed";
      return `If another event blocks ${task.title}'s planned time: ${result}. Show cascade.`;
    },
    // Unassigned tasks show nothing: a chip on every stray task would just be noise.
    projectLabelFor(task) {
      if (!task?.projectRef) return null;
      return this.projectTitleById.get(String(task.projectRef)) || null;
    },
    deadlineGapLabel(task) {
      const days = this.getTaskDaysBetweenDeadlineAndSchedule(task);
      if (days === null) return "No scheduled date";
      if (days < 0) return `${Math.abs(days)} calendar ${Math.abs(days) === 1 ? "day" : "days"} after its deadline`;
      if (days === 0) return "Scheduled on its deadline";
      return `Scheduled ${days} calendar ${days === 1 ? "day" : "days"} before its deadline; this is not spare capacity`;
    },
    forecastDateLabel(date) {
      if (!date) return "";
      const [year, month, day] = date.split("-").map(Number);
      return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(year, month - 1, day));
    },
    async loadCompass() {
      try {
        const response = await this.$http.get("/api/getCompass");
        this.compassRoles = response.data.success ? response.data.roles : [];
        this.endedProjects = response.data.success ? response.data.endedProjects || [] : [];
      } catch (error) {
        // Compass is optional context for the task modal; never block the calendar.
        console.error(error);
      }
    },
    async loadCalendarEvents() {
      const requestedDate =
        apiDateOnly(this.currentDate) || localDateOnly(this.currentDate);
      const eventDataResponse = await this.$http.get(
        `/api/getUserEvents/${requestedDate}`
      );

      if (!eventDataResponse.data.success) {
        console.error("Event retrieval error");
      }

      const events = eventDataResponse.data.events;
      this.allDayEvents = events.filter((event) => event.allDay);
      const eventsToAdd = events.filter((event) => !event.allDay).map((event) => {
        const inputStartDate = instantToDayPilotWall(event.startDate);
        const inputEndDate = instantToDayPilotWall(event.endDate);

        // External events are quiet slate; scheduled task blocks carry the indigo accent.
        // DayPilot needs literal colours; see docs/DESIGN_SYSTEM.md.
        let eventColor = "#3a4560";
        let eventTags = null;
        if (event.type.includes("task")) {
          eventColor = "#4f46e5";
          eventTags = {};
          eventTags.taskId = event.taskRef;
          if (event.type.includes("task-chunk")) {
            eventTags.type = "task-chunk";
          } else {
            eventTags.type = "task";
          }
        }

        return {
          id: event._id,
          start: inputStartDate,
          end: inputEndDate,
          text: event.title,
          backColor: eventColor,
          tags: eventTags,
          toolTip: event.title,
        };
      });
      this.calendar.update({ events: eventsToAdd });
    },
    async loadData() {
      await Promise.all([this.loadTasks(), this.loadCalendarEvents(), this.loadCompass()]);
    },
    async syncCalendar() {
      if (this.syncing) return;
      this.syncing = true;
      try {
        await this.$http.get("/api/synccalendar/");
        await this.loadCalendarEvents();
      } catch (error) {
        console.error(error);
      } finally {
        this.syncing = false;
      }
    },
    addDays(date, days) {
      return addCalendarDays(apiDateOnly(date) || localDateOnly(date), days);
    },
    prevWeek() {
      this.config.startDate = this.config.startDate.addDays(-7);
      // Add 7 days to the current date
      this.currentDate = this.addDays(this.currentDate, -7);
      this.loadCalendarEvents();
    },
    nextWeek() {
      this.config.startDate = this.config.startDate.addDays(7);
      this.currentDate = this.addDays(this.currentDate, 7);
      this.loadCalendarEvents();
    },
    getBusinessHourNumberFromDate(inputDate) {
      const hour = inputDate.getHours();
      return hour;
    },
    async scheduleTasks() {
      if (this.schedulingBusy) return;
      clearTimeout(this.schedulingErrorTimer);
      this.schedulingError = false;
      this.schedulingBusy = true;
      try {
        const response = await this.$http.get("/api/scheduletasks");
        if (response.data && response.data.success === false) {
          throw new Error(response.data.log || "Scheduling failed");
        }
        await this.loadData();
      } catch (error) {
        console.error(error);
        this.schedulingError = true;
        // The failure notice is transient; the button returns to its normal label.
        this.schedulingErrorTimer = setTimeout(() => {
          this.schedulingError = false;
        }, 4000);
      } finally {
        this.schedulingBusy = false;
      }
    },
    openAddTaskModal() {
      this.selectedTask = null;
      this.selectedEvent = null;
      this.taskEditorOpen = true;
    },
    closeTaskEditor() {
      this.taskEditorOpen = false;
      this.selectedTask = null;
      this.selectedEvent = null;
    },
    applyTaskChanges(taskList) {
      this.taskList = taskList;
      this.closeTaskEditor();
      Promise.all([this.loadCalendarEvents(), this.loadSlipForecasts()]);
    },
    openEditTaskModal(inputTask) {
      if (!inputTask) return;
      this.selectedTask = inputTask;
      this.taskEditorOpen = true;
    },
    openEditTaskModalFromEvent(eventDetails) {
      this.selectedEvent = eventDetails;
      const foundTask = this.taskList.find((task) => task._id == eventDetails.tags.taskId);
      this.openEditTaskModal(foundTask);
    },
    getTaskDaysBetweenDeadlineAndSchedule(inTask) {
      if (!inTask.dueDate || !this.hasValidScheduledDate(inTask)) return null;
      return calendarDayDifference(inTask.dueDate, inTask.scheduledDate);
    },
    getTaskDate(task) {
      if (task.isBacklog && !this.hasValidScheduledDate(task)) {
        return "Backlog";
      }
      if (!this.hasValidScheduledDate(task)) {
        return "Unscheduled";
      }
      const taskDate = new Date(task.scheduledDate);
      return taskDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    },
    highlightCurrentTimeCell() {
      const currentTime = new Date(); // Get the current time
      const dayOfWeek = currentTime.getDay();
      const hour = currentTime.getHours(); // Get the current hour (0-23)
      const minute = currentTime.getMinutes(); // Get the current minute (0-59)

      // Get column index
      let columnIndex = dayOfWeek;

      // Get row index
      let rowIndex = hour * 2 + (minute >= 30 ? 1 : 0);

      // Get cell index, rows and columns are reversed from what you think due to ordering
      let cellIndex = rowIndex * 7 + columnIndex;

      // Get all the calendar cells
      const calendarCells = document.querySelectorAll(".calendar_default_cell");

      // Highlight the current time cell's inner div
      if (calendarCells[cellIndex]) {
        const currentCell = calendarCells[cellIndex];
        const currentInnerDiv = currentCell.children[0];
        currentInnerDiv.style.setProperty(
          "background",
          "rgba(99, 102, 241, 0.22)",
          "important"
        );
      }
    },
  },
  computed: {
    // All schedule feedback lives in the button label, so nothing shifts the layout.
    scheduleButtonLabel() {
      if (this.schedulingBusy) return "Scheduling…";
      return this.schedulingError ? "Scheduling failed" : "Schedule Tasks";
    },
    calendar() {
      return this.$refs.calendar.control;
    },
    // Flatten the Compass tree into "Role -> Goal" groups for the project picker.
    projectOptionGroups() {
      const groups = [];

      for (const role of this.compassRoles || []) {
        for (const goal of role.goalList || []) {
          const projects = goal.projectList || [];
          // The role's context rides along so the editor can tell an intention.
          if (projects.length) {
            groups.push({
              label: `${role.title} \u2192 ${goal.title}`,
              projects,
              context: roleContextOf(role),
            });
          }
        }
      }

      return groups;
    },
    // Project titles for the sidebar labels, ended projects included.
    projectTitleById() {
      const titles = new Map();

      for (const group of this.projectOptionGroups) {
        for (const project of group.projects) {
          titles.set(String(project._id), project.title);
        }
      }
      for (const project of this.endedProjects || []) {
        titles.set(String(project._id), project.title);
      }

      return titles;
    },
    userWorkingDays() {
      return this.$store.state.user?.workingDays || [];
    },
    editorDefaultStartDate() {
      return dateOnlyInTimeZone(this.$store.state.user?.timeZone);
    },
    selectedChunkDuration() {
      if (this.selectedEvent?.tags?.type !== "task-chunk") return null;
      return (this.selectedEvent.end.getTime() - this.selectedEvent.start.getTime()) / 60000;
    },
    selectedSlipForecast() {
      return this.slipForecasts[this.selectedSlipForecastId] || null;
    },
    // Every task whose slot the open panel assumes is lost, origin first.
    premiseIds() {
      if (!this.selectedSlipForecastId) return [];
      return [this.selectedSlipForecastId, ...this.comparisonSelection];
    },
    premiseTitles() {
      return this.premiseIds.map(
        (id) => this.taskList?.find((task) => task._id === id)?.title || "this task"
      );
    },
    // The panel is open, so each comparable task offers its add/remove control.
    selectionActive() {
      return !!this.selectedSlipForecastId;
    },
    // A combined result only describes the selection it was calculated for.
    selectionIsStale() {
      if (!this.comparisonForecast) return this.premiseIds.length > 1;
      const analyzed = [...this.comparisonForecast.selectedTaskIds].sort().join(",");
      return analyzed !== [...this.premiseIds].sort().join(",");
    },
    canAnalyzeSelection() {
      return this.premiseIds.length > 1 && this.selectionIsStale;
    },
    forecastMode() {
      if (!this.activeForecast) return "pending";
      return this.premiseIds.length > 1 ? "combined" : "single";
    },
    /**
     * The forecast whose numbers and cascade are shown. Null while several slots are
     * selected but not yet analyzed: showing the single-slot cascade under a multi-slot
     * heading would answer a question the user did not ask.
     */
    activeForecast() {
      if (this.comparisonForecast && !this.selectionIsStale) return this.comparisonForecast;
      if (this.premiseIds.length > 1) return null;
      return this.selectedSlipForecast;
    },
    // Where the blocked tasks themselves land. Absent on forecasts cached before this existed.
    premiseImpacts() {
      return this.activeForecast?.selectedImpacts || [];
    },
    movedPremiseCount() {
      return this.premiseImpacts.filter((impact) => impact.moved).length;
    },
    latePremiseCount() {
      return this.premiseImpacts.filter((impact) => impact.newlyLate).length;
    },
    forecastHeading() {
      const count = this.premiseIds.length;
      if (count > 1) {
        return this.activeForecast
          ? `These ${count} slots are all lost`
          : `What if these ${count} slots are all lost?`;
      }
      return `“${this.selectedSlipForecastTitle}” misses its planned slot`;
    },
    // The heading truncates a long title, so hovering it reveals every premise in full.
    forecastHeadingTooltip() {
      return this.premiseTitles.join("\n");
    },
    selectedSlipForecastTitle() {
      return this.taskList?.find((task) => task._id === this.selectedSlipForecastId)?.title || "this task";
    },
    taskGroupedByDate() {
      const groupedTasks = {};
      if (this.taskList) {
        // Keep ordinary unscheduled work visible, but hide unplaced recurring occurrences
        // and recurring occurrences beyond the shorter sidebar window. Intentions are
        // never scheduled, so they get their own group rather than reading as unscheduled.
        const visibleTasks = this.taskList.filter(
          (task) => !isIntention(task) && this.isInSidebarWindow(task)
        );

        visibleTasks.forEach((task) => {
          const date = this.getTaskDate(task);
          if (!groupedTasks[date]) {
            groupedTasks[date] = [];
          }
          groupedTasks[date].push(task);
        });

        // For each date, sort the tasks by scheduled time
        Object.keys(groupedTasks).forEach((date) => {
          groupedTasks[date].sort(function (a, b) {
            return new Date(a.scheduledDate) - new Date(b.scheduledDate);
          });
        });
        return groupedTasks;
      } else {
        return null;
      }
    },
    /**
     * This week's unfinished intentions.
     *
     * Scoped to the current Monday-Sunday so the heading is true, and counted as
     * outstanding rather than "N of M": the task list omits completed work, so a done/total
     * ratio here would always understate what you have actually finished.
     */
    sidebarIntentions() {
      // The saved timezone, like every other date on this page -- not the browser clock.
      const today = dateOnlyInTimeZone(this.$store.state.user?.timeZone);
      return intentionsForWeek(this.taskList || [], mondayWeekBounds(today));
    },
    tasksDatesArray() {
      if (this.taskGroupedByDate) {
        let taskDateArray = Object.keys(this.taskGroupedByDate);
        taskDateArray.sort(function (a, b) {
          if (a === b) return 0;
          if (a === "Unscheduled" || b === "Unscheduled") {
            return a === "Unscheduled" ? -1 : 1;
          }
          if (a === "Backlog" || b === "Backlog") {
            return a === "Backlog" ? 1 : -1;
          }
          return new Date(a) - new Date(b);
        });
        return taskDateArray;
      } else {
        return null;
      }
    },
  },
  mounted() {
    this.loadData();

    // The per-cell callback handles minute precision and browser/user timezone differences.

    // Call the highlightCurrentTimeCell method initially
    this.highlightCurrentTimeCell();

    // Set an interval to call the highlightCurrentTimeCell method every 30 minutes
    this.highlightInterval = setInterval(() => {
      this.highlightCurrentTimeCell();
    }, 1 * 5 * 1000); // 1 minutes in milliseconds
  },
  beforeUnmount() {
    clearInterval(this.highlightInterval);
    clearTimeout(this.schedulingErrorTimer);
    this.disarmCompletion();
  },
};
</script>

<style scoped>
.calendar-page {
  padding: 20px;
  max-width: 1800px;
  margin: 0 auto;
}

.page-header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 0px;
}

.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--fs-2xl);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 500;
}

.btn-icon {
  display: inline-flex;
  font-size: 15px;
  line-height: 1;
}

.btn-icon svg {
  width: 16px;
  height: 16px;
}

.main-calendar {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
}

/* DayPilot theme: transparent grid with hairlines, so events carry the colour. */
#dp {
  color: var(--text-primary) !important;
}

:deep(.calendar_default_main) {
  border: 0 !important;
  font-family: inherit !important;
  background: transparent !important;
}

:deep(.calendar_default_cell_inner) {
  background: rgba(255, 255, 255, 0.012) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.05) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.035) !important;
}

/* Only the hour lines are strong enough to read as a grid. */
:deep(.calendar_default_cell:nth-child(4n) .calendar_default_cell_inner) {
  border-bottom-color: rgba(255, 255, 255, 0.07) !important;
}

:deep(.calendar_default_cell_business .calendar_default_cell_inner) {
  background: rgba(255, 255, 255, 0.04) !important;
}

:deep(.calendar_default_rowheader_inner),
:deep(.calendar_default_cornerright_inner),
:deep(.calendar_default_corner_inner),
:deep(.calendar_default_colheader_inner),
:deep(.calendar_default_alldayheader_inner) {
  background: var(--surface-1) !important;
  color: var(--text-muted) !important;
  font-size: 12px !important;
  font-weight: 500;
  border-right: 1px solid var(--border-subtle) !important;
  border-bottom: 1px solid var(--border-subtle) !important;
}

:deep(.calendar_default_colheader_inner) {
  color: var(--text-primary) !important;
  font-size: 13px !important;
  font-weight: 600;
}

:deep(.calendar_default_rowheader_minutes) {
  color: var(--text-faint);
}

:deep(.calendar_default_rowheader),
:deep(.calendar_default_colheader) {
  border-color: var(--border-subtle) !important;
}

/* Events: rounded card, white text, a lighter stripe on the left for edge contrast. */
:deep(.calendar_default_event_inner),
:deep(.calendar_transparent_event_inner) {
  color: #fff !important;
  border-radius: var(--radius-sm) !important;
  opacity: 1 !important;
  border: 0 !important;
  box-shadow: inset 3px 0 0 rgba(255, 255, 255, 0.35), 0 1px 2px rgba(0, 0, 0, 0.35) !important;
  padding: 5px 8px 5px 10px !important;
  font-weight: 500 !important;
  font-size: 12.5px !important;
  line-height: 1.3 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

:deep(.calendar_default_event) {
  padding: 1px 2px;
}

:deep(.calendar_default_event:hover .calendar_default_event_inner) {
  filter: brightness(1.1);
}

:deep(.calendar_default_event_bar) {
  display: none;
}

.calendar-box {
  display: flex;
  gap: 20px;
  min-height: 600px;
  transition: opacity 0.2s ease;
}

/* Dim the calendar while scheduling so it reads as stale, not current. */
.calendar-box.is-busy {
  opacity: 0.55;
  pointer-events: none;
}

.task-controls {
  min-width: 320px;
  max-width: 320px;
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 18px 14px 18px 18px;
  text-align: left;
}

.sidebar-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--text-primary);
}

.sidebar-title:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--warning-text);
  outline-offset: 3px;
}

.task-list {
  overflow-y: auto;
  max-height: calc(100vh - 200px);
  padding-right: 4px;
}

.task-group {
  margin-bottom: 20px;
}

.task-date-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.task-items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.task-item {
  display: flex;
  align-items: stretch;
  flex-direction: column;
  padding: 10px 12px;
  margin-bottom: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--motion) var(--ease), border-color var(--motion) var(--ease);
  border-left: 3px solid transparent;
}

.task-item:hover {
  background: var(--surface-3);
  border-top-color: var(--border);
  border-right-color: var(--border);
  border-bottom-color: var(--border);
}

.task-primary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-width: 0;
}

.task-title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  color: var(--text-primary);
}

.task-row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 8px;
}

/* Secondary line: present, readable, never competing with the title. */
.task-project {
  display: block;
  max-width: 100%;
  margin-top: 3px;
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-complete-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(110, 231, 183, 0.45);
  border-radius: 50%;
  background: transparent;
  color: var(--success-text);
  cursor: pointer;
  /* Stays out of the way until the row is hovered, so it is hard to hit by accident. */
  opacity: 0;
  transition: opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.task-item:hover .quick-complete-button,
.task-item:focus-within .quick-complete-button {
  opacity: 0.55;
}

.quick-complete-button:hover,
.quick-complete-button:focus-visible {
  border-color: var(--success-text);
  background: rgba(16, 185, 129, 0.14);
  opacity: 1;
}

/* Armed: same box, filled solid green with a ring. Nothing here affects layout. */
.task-item .quick-complete-button.armed {
  border-color: var(--success);
  background: var(--success);
  color: #06281d;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
  opacity: 1;
}

.quick-complete-button:focus-visible {
  outline: 2px solid var(--success-text);
  outline-offset: 2px;
}

.quick-complete-button:disabled {
  cursor: progress;
  opacity: 0.4;
}

/* Touch devices have no hover, so the button is always at resting strength. */
@media (hover: none) {
  .quick-complete-button {
    opacity: 0.55;
  }
}

/* Collapsed by default: context, not a to-do list competing with scheduled work. */
.intention-group {
  margin-top: 14px;
  border-top: 1px solid rgba(118, 134, 168, 0.25);
  padding-top: 10px;
}

.intention-group > summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  opacity: 0.85;
  list-style: revert;
}

.intention-group-title {
  font-weight: 600;
}

.intention-group-count {
  opacity: 0.75;
}

/* No deadline colouring: an intention has no schedule to be early or late against. */
.task-item.intention-task {
  border-left-color: rgba(118, 134, 168, 0.5);
}

.intention-badge {
  background: rgba(118, 134, 168, 0.25);
}

.quick-complete-error {
  margin: -8px 0 14px;
  color: var(--danger-text);
  font-size: 13px;
}

.forecast-selection-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 13px;
  padding-top: 11px;
  border-top: 1px solid rgba(251, 191, 36, 0.2);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
}

.forecast-selection-hint {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.forecast-analyze {
  padding: 6px 12px;
  border: 1px solid rgba(251, 191, 36, 0.55);
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.18);
  color: var(--warning-text);
  font-size: 11px;
  font-weight: 700;
}

.forecast-analyze:hover:not(:disabled),
.forecast-analyze:focus-visible {
  border-color: var(--warning-text);
  outline: none;
  background: rgba(251, 191, 36, 0.28);
  color: #fef3c7;
}

.forecast-analyze:disabled {
  cursor: progress;
  opacity: 0.55;
}

/* Shares the chip slot, so it matches .slip-impact-chip's size and shape. */
.slot-select-chip {
  padding: 4px 9px;
  border: 1px dashed rgba(156, 163, 175, 0.5);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.slot-select-chip:hover:not(:disabled),
.slot-select-chip:focus-visible {
  border-color: var(--warning-text);
  outline: none;
  background: rgba(251, 191, 36, 0.12);
  color: var(--warning-text);
}

.slot-select-chip.selected {
  border-style: solid;
  border-color: rgba(251, 191, 36, 0.75);
  background: rgba(251, 191, 36, 0.2);
  color: var(--warning-text);
}

.slot-select-chip:disabled {
  cursor: default;
  opacity: 0.75;
}

.forecast-premises {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: baseline;
  margin: 5px 0 0;
  color: var(--warning-text);
  font-size: 11px;
  line-height: 1.4;
}

/* Long titles truncate here, so the hover tooltip is what reveals the full name. */
.premise-title {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.premise-separator {
  opacity: 0.6;
}

.slip-forecast-panel {
  position: relative;
  margin: -8px 0 20px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.38);
  border-radius: 12px;
  background:
    radial-gradient(circle at 100% 0, rgba(239, 68, 68, 0.16), transparent 160px),
    rgba(38, 31, 35, 0.96);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.slip-forecast-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.what-if-label {
  color: var(--warning-text);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.slip-forecast-heading h4 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 1.3;
}

.forecast-close {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.12);
  color: var(--text-secondary);
  font-size: 19px;
  line-height: 1;
}

.forecast-close:hover,
.forecast-close:focus-visible {
  border-color: var(--warning-text);
  outline: none;
  color: #fef3c7;
}

.forecast-close:focus-visible {
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.28);
}

.forecast-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 12px 0 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.forecast-summary .danger {
  color: var(--danger-text);
}

.forecast-assumption {
  margin: 0 0 13px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.forecast-section {
  margin: 0 0 14px;
}

.forecast-section:last-child {
  margin-bottom: 0;
}

.forecast-section-title {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.forecast-selected-summary {
  margin-top: -4px;
}

/* Premise rows are the question, not the collateral, so they read as outlines. */
.premise-cascade .cascade-marker {
  border-style: dashed;
  background: var(--surface-2);
}

.premise-cascade li:not(:last-child)::after {
  background: rgba(251, 191, 36, 0.18);
}

.forecast-cascade {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.forecast-cascade li {
  position: relative;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
  min-height: 31px;
  color: var(--text-secondary);
  font-size: 11px;
}

.forecast-cascade li:not(:last-child)::after {
  position: absolute;
  top: 20px;
  bottom: -11px;
  left: 4px;
  width: 2px;
  background: rgba(251, 191, 36, 0.32);
  content: "";
}

.cascade-marker {
  z-index: 1;
  width: 10px;
  height: 10px;
  border: 2px solid var(--warning-text);
  border-radius: 50%;
  background: #262026;
}

.cascade-task {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cascade-dates {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--warning-text);
  white-space: nowrap;
}

.cascade-dates strong {
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.22);
  color: var(--danger-text);
  font-size: 9px;
  text-transform: uppercase;
}

.forecast-cascade .newly-late .cascade-marker {
  border-color: var(--danger);
  background: #7f1d1d;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.13);
}

.slip-impact-row {
  display: flex;
  justify-content: flex-end;
  width: 100%;
  margin-top: 8px;
}

.slip-impact-chip {
  padding: 4px 7px;
  border: 1px solid rgba(156, 163, 175, 0.35);
  border-radius: 999px;
  background: rgba(107, 114, 128, 0.13);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  text-align: left;
}

.slip-impact-chip.risk {
  border-color: rgba(248, 113, 113, 0.55);
  background: rgba(239, 68, 68, 0.17);
  color: var(--danger-text);
}

.slip-impact-chip.safe {
  border-color: transparent;
  background: transparent;
  color: var(--text-faint);
  font-weight: 500;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.slip-impact-chip.safe:hover,
.slip-impact-chip.safe:focus-visible,
.slip-impact-chip.safe[aria-expanded="true"] {
  opacity: 1;
}

.slip-impact-chip:hover,
.slip-impact-chip:focus-visible,
.slip-impact-chip[aria-expanded="true"] {
  border-color: var(--warning-text);
  outline: none;
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.18);
}

.task-item.forecast-moved-task {
  background: rgba(245, 158, 11, 0.12);
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.22);
}

.task-item.forecast-selected-task {
  background: rgba(245, 158, 11, 0.2);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.48);
}

.task-item.forecast-newly-late-task {
  background: rgba(239, 68, 68, 0.14);
  border-left-color: var(--danger);
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.26);
}

.dependency-icon,
.recurring-icon {
  margin-right: 6px;
  font-size: 14px;
  opacity: 0.8;
}

.task-badge,
.task-days {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.unscheduled-badge {
  background: rgba(245, 158, 11, 0.2);
  color: var(--warning-text);
}

.late-task {
  border-left-color: var(--danger);
}

.late-task .task-title {
  color: var(--danger-text);
}

.late-task .task-days {
  background: rgba(239, 68, 68, 0.2);
  color: var(--danger-text);
}

.due-that-day-task {
  border-left-color: var(--warning);
}

.due-that-day-task .task-title {
  color: var(--warning-text);
}

.due-that-day-task .task-days {
  background: rgba(245, 158, 11, 0.2);
  color: var(--warning-text);
}

.on-track-task {
  border-left-color: var(--success);
}

.on-track-task .task-days {
  background: rgba(16, 185, 129, 0.2);
  color: var(--success-text);
}

.backlog-task {
  border-left-color: var(--text-faint);
  opacity: 0.7;
}

.backlog-task .task-title {
  color: var(--text-muted);
  font-style: italic;
}

.backlog-task .task-badge {
  background: rgba(107, 114, 128, 0.2);
  color: var(--text-muted);
}

.calendar-controls {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}

.nav-btn {
  padding: 6px 12px;
  font-size: 13px;
  background: var(--surface-2);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--motion) var(--ease), color var(--motion) var(--ease),
    border-color var(--motion) var(--ease);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}

.nav-btn:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.nav-icon {
  display: inline-flex;
}

.nav-icon svg {
  width: 14px;
  height: 14px;
}

.calendar-container {
  flex: 1;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.all-day-events {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  margin-bottom: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 13px;
}

.all-day-label {
  font-weight: 600;
  color: var(--text-muted);
}

.all-day-event {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 3px 8px;
  border-radius: var(--radius-sm);
  background: #3a4560;
  color: #fff;
}

.all-day-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.all-day-delete:hover,
.all-day-delete:focus-visible {
  background: rgba(0, 0, 0, 0.4);
}

.all-day-delete:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 1px;
}

@media (max-width: 900px) {
  .page-header-section,
  .calendar-box {
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions {
    flex-wrap: wrap;
  }

  .task-controls {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .task-list {
    max-height: none;
  }
}

@media (max-width: 480px) {
  .calendar-page {
    padding: 12px;
  }

  .action-btn {
    flex: 1 1 calc(50% - 6px);
    justify-content: center;
  }

  .forecast-cascade li {
    grid-template-columns: 12px minmax(0, 1fr);
  }

  .cascade-dates {
    grid-column: 2;
    white-space: normal;
  }

  .task-primary-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .task-row-meta {
    flex-wrap: wrap;
    margin: 7px 0 0;
  }

  .slip-impact-row {
    justify-content: flex-start;
  }
}

</style>
