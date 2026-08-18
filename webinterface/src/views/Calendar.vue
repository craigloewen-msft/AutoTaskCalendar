<template>
  <div>
    <div class="calendar-page">
      <div class="page-header-section">
        <h1 class="page-title">My Calendar</h1>
        <div class="header-actions">
          <BButton variant="primary" v-on:click="openAddTaskModal" class="action-btn" aria-label="Add new task">
            <span class="btn-icon" aria-hidden="true">+</span> Add Task
          </BButton>
          <BButton variant="outline-primary" v-on:click="openFollowUpModal(null)" class="action-btn" aria-label="Add follow up">
            <span class="btn-icon" aria-hidden="true">↻</span> Follow Up
          </BButton>
          <BButton variant="success" v-on:click="scheduleTasks" class="action-btn" aria-label="Schedule tasks">
            <span class="btn-icon" aria-hidden="true">📅</span> Schedule Tasks
          </BButton>
          <BButton variant="info" v-on:click="syncCalendar" class="action-btn" aria-label="Sync calendar with Google">
            <span class="btn-icon" aria-hidden="true">⟳</span> Sync Calendar
          </BButton>
        </div>
      </div>
      <div class="calendar-box">
        <div class="task-controls">
          <div class="task-list">
            <h3 class="sidebar-title">Tasks</h3>
            <p
              v-if="quickCompleteError"
              class="quick-complete-error"
              role="alert"
              data-test="quick-complete-error"
            >
              {{ quickCompleteError }}
            </p>
            <section
              v-if="selectedSlipForecast"
              class="slip-forecast-panel"
              data-test="slip-forecast-panel"
              aria-labelledby="slip-forecast-title"
            >
              <div class="slip-forecast-heading">
                <div>
                  <span class="what-if-label">What if?</span>
                  <h4 id="slip-forecast-title">Let “{{ selectedSlipForecastTitle }}” slip one day</h4>
                </div>
                <button
                  class="forecast-close"
                  type="button"
                  aria-label="Close one-day slip forecast"
                  @click="closeSlipForecast"
                >
                  ×
                </button>
              </div>
              <p class="forecast-summary" data-test="slip-forecast-summary">
                <strong>{{ selectedSlipForecast.movedCount }} tasks move later</strong>
                <span>·</span>
                <strong :class="{ danger: selectedSlipForecast.newlyLateCount }">
                  {{ selectedSlipForecast.newlyLateCount }} newly miss deadlines
                </strong>
              </p>
              <p class="forecast-assumption">
                Work before this task stays fixed. This task and everything after it restart
                at the same time tomorrow. Nothing is saved.
              </p>
              <ol class="forecast-cascade">
                <li
                  v-for="impact in selectedSlipForecast.affected"
                  :key="impact.taskId"
                  :class="{ 'newly-late': impact.newlyLate }"
                  :data-test="`slip-impact-${impact.taskId}`"
                  :data-baseline-date="impact.baselineDate"
                  :data-forecast-date="impact.forecastDate || 'unscheduled'"
                >
                  <span class="cascade-marker" aria-hidden="true"></span>
                  <span class="cascade-task">{{ impact.title }}</span>
                  <span class="cascade-dates">
                    {{ forecastDateLabel(impact.baselineDate) }}
                    <span aria-hidden="true">→</span>
                    {{ forecastDateLabel(impact.forecastDate) || "Unscheduled" }}
                    <strong v-if="impact.newlyLate">Late</strong>
                  </span>
                </li>
              </ol>
            </section>
            <div v-for="date in tasksDatesArray" :key="date" class="task-group">
              <h4 class="task-date-header">{{ date }}</h4>
              <ul class="task-items">
                <li
                  v-for="task in taskGroupedByDate[date]"
                  :key="task._id"
                  v-bind:class="{
                    'task-item': true,
                    'late-task': !task.isBacklog && getTaskDaysBetweenDeadlineAndSchedule(task) < 0,
                    'on-track-task': !task.isBacklog &&
                      getTaskDaysBetweenDeadlineAndSchedule(task) > 0,
                    'due-that-day-task': !task.isBacklog &&
                      getTaskDaysBetweenDeadlineAndSchedule(task) == 0,
                    'backlog-task': task.isBacklog,
                    'forecast-selected-task': selectedSlipForecastId === task._id,
                    'forecast-moved-task': selectedImpactForTask(task)?.moved,
                    'forecast-newly-late-task': selectedImpactForTask(task)?.newlyLate
                  }"
                  v-on:click="openEditTaskModal(task)"
                >
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
                    <button
                      v-if="slipForecastFor(task)"
                      class="slip-impact-chip"
                      :class="{ risk: slipForecastFor(task).newlyLateCount > 0, safe: !slipForecastFor(task).newlyLateCount }"
                      type="button"
                      :data-test="`slip-impact-chip-${task._id}`"
                      :aria-expanded="selectedSlipForecastId === task._id"
                      :aria-label="slipForecastAriaLabel(task)"
                      @click.stop="toggleSlipForecast(task)"
                    >
                      <span aria-hidden="true">+1 day →</span>
                      {{ slipForecastFor(task).newlyLateCount ? `${slipForecastFor(task).newlyLateCount} late` : "safe" }}
                    </button>
                    <button
                      v-if="isRecurringTask(task)"
                      class="quick-complete-button"
                      type="button"
                      :aria-label="`Complete recurring task: ${task.title}`"
                      :aria-busy="isQuickCompleting(task)"
                      title="Complete this occurrence"
                      :disabled="isQuickCompleting(task)"
                      @click.stop="quickCompleteTask(task)"
                    >
                      <span aria-hidden="true">{{ isQuickCompleting(task) ? "…" : "✓" }}</span>
                    </button>
                  </span>
                </li>
              </ul>
            </div>
          </div>
      </div>
        <div class="main-calendar">
        <div class="calendar-controls">
          <button class="nav-btn" v-on:click="prevWeek" title="Previous Week">
            <span class="nav-icon">◀</span> Previous
          </button>
          <button class="nav-btn" v-on:click="nextWeek" title="Next Week">
            Next <span class="nav-icon">▶</span>
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
      @follow-up="openFollowUpModal"
    />
    <BModal
      id="followup-modal"
      ref="followupmodal"
      @ok="resolveFollowUpModal"
      @hidden="resetFollowUpModal"
      :ok-disabled="followUpSaving"
      :title="this.selectedTask ? 'Set follow up' : 'Add follow up'"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-body">
            <div v-if="input.error" role="alert">{{ input.error }}</div>
            <label for="task-title">Task Title*</label>
            <input
              type="text"
              v-model="input.taskTitle"
              class="form-control"
              id="task-title"
              placeholder="Enter task title"
              @input="scheduleFollowUpRecommendation"
            />
            <template v-if="!selectedTask">
              <label for="followup-project">Project*</label>
              <select
                id="followup-project"
                v-model="input.projectRef"
                ref="followUpProjectSelect"
                class="form-control"
                @change="chooseFollowUpProject"
              >
                <option disabled value="">Choose a project or Unassigned…</option>
                <option :value="null">Unassigned</option>
                <optgroup v-for="group in projectOptionGroups" :key="group.label" :label="group.label">
                  <option v-for="project in group.projects" :key="project._id" :value="project._id">
                    {{ project.title }}
                  </option>
                </optgroup>
              </select>
              <div
                v-if="followUpRecommendationLabel"
                class="followup-recommendation"
                data-test="followup-project-recommendation"
                role="status"
              >
                <span><strong>Suggested:</strong> {{ followUpRecommendationLabel }}</span>
                <button
                  class="btn btn-sm btn-outline-primary"
                  type="button"
                  @click="useFollowUpRecommendation"
                >
                  Use suggestion
                </button>
              </div>
            </template>
            <label for="task-duration">Follow up after these many days:</label>
            <input
              type="number"
              v-model="input.followUpDays"
              class="form-control"
              id="task-duration"
            />
          </div>
        </div>
      </div>
    </BModal>
  </div>
</template>

<script>
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-vue";
import { BButton, BModal } from 'bootstrap-vue-next';
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
} from "../utils/temporal";

// The sidebar shows this far ahead; the scheduler materialises 60 days of occurrences.
const SIDEBAR_WINDOW_DAYS = 14;

export default {
  name: "Calendar",
  components: {
    DayPilotCalendar,
    BButton,
    BModal,
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
      input: {
        taskTitle: null,
        followUpDays: null,
        projectRef: "",
        error: null,
      },
      followUpRecommendation: null,
      followUpRecommendationTimer: null,
      followUpRecommendationRequest: 0,
      followUpProjectChoiceMade: false,
      followUpSaving: false,
      highlightInterval: null,
      taskEditorOpen: false,
      currentDate: dateOnlyInTimeZone(this.$store.state.user?.timeZone),
      selectedTask: null,
      selectedEvent: null,
      allDayEvents: [],
      quickCompletingTaskIds: [],
      quickCompleteError: "",
      slipForecasts: {},
      selectedSlipForecastId: null,
      // Compass roles, nested with their goals and projects.
      compassRoles: [],
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
      if (this.selectedSlipForecastId && !this.slipForecasts[this.selectedSlipForecastId]) {
        this.selectedSlipForecastId = null;
      }
    },
    hasValidScheduledDate(task) {
      if (!task?.scheduledDate) return false;
      return !Number.isNaN(new Date(task.scheduledDate).getTime());
    },
    isInSidebarWindow(task) {
      if (!task?.seriesRef || !this.hasValidScheduledDate(task)) return true;
      const scheduled = new Date(task.scheduledDate);
      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + SIDEBAR_WINDOW_DAYS);
      windowEnd.setHours(23, 59, 59, 999);
      return scheduled <= windowEnd;
    },
    slipForecastFor(task) {
      return this.slipForecasts[task?._id] || null;
    },
    selectedImpactForTask(task) {
      return this.selectedSlipForecast?.affected.find((impact) => impact.taskId === task?._id) || null;
    },
    toggleSlipForecast(task) {
      this.selectedSlipForecastId = this.selectedSlipForecastId === task._id ? null : task._id;
    },
    closeSlipForecast() {
      const taskId = this.selectedSlipForecastId;
      this.selectedSlipForecastId = null;
      this.$nextTick(() => {
        document.querySelector(`[data-test="slip-impact-chip-${taskId}"]`)?.focus();
      });
    },
    slipForecastAriaLabel(task) {
      const forecast = this.slipForecastFor(task);
      if (!forecast) return "";
      const result = forecast.newlyLateCount
        ? `${forecast.newlyLateCount} newly missed ${forecast.newlyLateCount === 1 ? "deadline" : "deadlines"}`
        : "no newly missed deadlines";
      return `If ${task.title} slips one day: ${result}. Show cascade.`;
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
        if (this.projectOptionGroups.length) this.scheduleFollowUpRecommendation();
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

        let eventColor = "#A27CF9";
        let eventTags = null;
        if (event.type.includes("task")) {
          eventColor = "#3D217C";
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
      await this.$http.get("/api/synccalendar/");
      this.loadCalendarEvents();
    },
    chooseFollowUpProject() {
      this.followUpProjectChoiceMade = this.input.projectRef !== "";
      this.followUpRecommendation = null;
      clearTimeout(this.followUpRecommendationTimer);
      this.followUpRecommendationRequest++;
    },
    useFollowUpRecommendation() {
      if (!this.followUpRecommendationLabel) return;
      this.input.projectRef = this.followUpRecommendation.projectId;
      this.followUpProjectChoiceMade = true;
      this.followUpRecommendation = null;
      clearTimeout(this.followUpRecommendationTimer);
      this.followUpRecommendationRequest++;
    },
    scheduleFollowUpRecommendation() {
      clearTimeout(this.followUpRecommendationTimer);
      this.followUpRecommendationRequest++;
      this.followUpRecommendation = null;
      if (
        this.selectedTask
        || this.followUpProjectChoiceMade
        || String(this.input.taskTitle || "").trim().length < 2
      ) {
        this.followUpRecommendation = null;
        return;
      }
      this.followUpRecommendationTimer = setTimeout(
        () => this.loadFollowUpRecommendation(),
        350
      );
    },
    async loadFollowUpRecommendation() {
      const request = this.followUpRecommendationRequest;
      const title = String(this.input.taskTitle || "").trim();
      const candidateProjectIds = this.projectOptionGroups.flatMap((group) => {
        return group.projects.map((project) => project._id);
      });
      if (!title || !candidateProjectIds.length) return;

      try {
        const response = await this.$http.post("/api/recommendTaskProject", {
          title,
          candidateProjectIds,
        });
        if (request !== this.followUpRecommendationRequest || this.followUpProjectChoiceMade) return;
        this.followUpRecommendation = response.data.success
          ? response.data.recommendation
          : null;
      } catch (error) {
        if (request === this.followUpRecommendationRequest) this.followUpRecommendation = null;
      }
    },
    async createFollowUp(bvModalEvent) {
      // Prevent modal from closing
      bvModalEvent.preventDefault();

      this.input.error = "";

      if (!this.input.taskTitle) {
        this.input.error = "Need task title";
      } else if (!this.input.followUpDays) {
        this.input.error = "Need follow up days";
      }
      if (!this.selectedTask && this.input.projectRef === "") {
        this.input.error = "Choose a project or Unassigned.";
      }

      if (this.input.error) {
        if (this.input.error === "Choose a project or Unassigned.") {
          this.$nextTick(() => this.$refs.followUpProjectSelect?.focus());
        }
        return;
      }

      const followUpDate = addCalendarDays(
        dateOnlyInTimeZone(this.$store.state.user.timeZone),
        parseInt(this.input.followUpDays, 10)
      );

      if (this.followUpSaving) return;
      this.followUpSaving = true;

      try {
        const response = await this.$http.post("/api/setFollowUp/", {
          title: this.input.taskTitle,
          followUpDate: followUpDate,
          taskID: this.selectedTask?._id,
          projectRef: this.selectedTask ? undefined : this.input.projectRef,
        });
        if (!response.data.success) {
          this.input.error = response.data.log || "Follow up could not be created.";
          this.followUpSaving = false;
          return;
        }
        this.taskList = response.data.taskList;
        await this.loadSlipForecasts();

        Object.keys(this.input).forEach((i) => (this.input[i] = null));
      } catch (error) {
        this.input.error = "Follow up could not be created.";
        this.followUpSaving = false;
        return;
      }

      this.followUpSaving = false;
      this.$nextTick(() => {
        this.$refs.followupmodal.hide();
      });
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
      try {
        await this.$http.get("api/scheduletasks");
        await this.loadData();
      } catch (error) {
        console.error(error);
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
    openFollowUpModal(inputTask) {
      this.taskEditorOpen = false;
      this.selectedTask = inputTask;
      this.input = {
        taskTitle: inputTask?.title || null,
        followUpDays: null,
        projectRef: inputTask ? (inputTask.projectRef || null) : "",
        error: null,
      };
      this.followUpProjectChoiceMade = !!inputTask;
      this.followUpSaving = false;
      this.followUpRecommendation = null;
      clearTimeout(this.followUpRecommendationTimer);
      this.followUpRecommendationRequest++;
      this.$nextTick(() => this.$refs.followupmodal.show());
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
    resolveFollowUpModal(bvModalEvent) {
      this.createFollowUp(bvModalEvent);
    },
    resetFollowUpModal() {
      this.selectedTask = null;
      this.selectedEvent = null;
      this.followUpRecommendation = null;
      this.followUpProjectChoiceMade = false;
      this.followUpSaving = false;
      clearTimeout(this.followUpRecommendationTimer);
      this.followUpRecommendationRequest++;
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
          "rgb(64,65,112)",
          "important"
        );
      }
    },
  },
  computed: {
    calendar() {
      return this.$refs.calendar.control;
    },
    // Flatten the Compass tree into "Role -> Goal" groups for the project picker.
    projectOptionGroups() {
      const groups = [];

      for (const role of this.compassRoles || []) {
        for (const goal of role.goalList || []) {
          const projects = goal.projectList || [];
          if (projects.length) {
            groups.push({ label: `${role.title} \u2192 ${goal.title}`, projects });
          }
        }
      }

      return groups;
    },
    followUpRecommendationLabel() {
      if (this.selectedTask || this.followUpProjectChoiceMade || !this.followUpRecommendation) {
        return "";
      }
      for (const group of this.projectOptionGroups) {
        const project = group.projects.find(({ _id }) => {
          return _id === this.followUpRecommendation.projectId;
        });
        if (project) return `${group.label} → ${project.title}`;
      }
      return "";
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
    selectedSlipForecastTitle() {
      return this.taskList?.find((task) => task._id === this.selectedSlipForecastId)?.title || "this task";
    },
    taskGroupedByDate() {
      const groupedTasks = {};
      if (this.taskList) {
        // 60 days of occurrences would bury the list, so the sidebar keeps a shorter
        // window. Backlog and unscheduled tasks have no date, so they are always kept.
        const visibleTasks = this.taskList.filter((task) => this.isInSidebarWindow(task));

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
    clearTimeout(this.followUpRecommendationTimer);
    clearInterval(this.highlightInterval);
    this.followUpRecommendationRequest++;
  },
  metaInfo: {
    title: "My Calendar - Manage Your Tasks",
    meta: [
      {
        name: "description",
        content: "View and manage your automatically scheduled tasks in your calendar. Add tasks, sync with Google Calendar, and track your productivity.",
      },
      { 
        name: "keywords", 
        content: "my calendar, task view, scheduled tasks, manage tasks, calendar sync" 
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
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
  font-size: 32px;
  font-weight: 600;
  margin: 0;
  color: #764ba2;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.btn-icon {
  font-size: 18px;
}

.main-calendar {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(30, 30, 35, 0.6);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.calendar_default_rowheader_inner,
.calendar_default_cornerright_inner,
.calendar_default_corner_inner,
.calendar_default_colheader_inner,
.calendar_default_alldayheader_inner {
  background: rgba(45, 45, 55, 0.9) !important;
  color: rgb(220, 220, 225) !important;
  font-weight: 600;
  border-right: 1px solid rgba(255, 255, 255, 0.3) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3) !important;
}

.calendar_default_cell_inner {
  background: rgba(55, 55, 65, 0.5) !important;
}

.calendar_default_cell_business .calendar_default_cell_inner {
  background: rgba(75, 75, 85, 0.6) !important;
}

/* Comprehensive dark mode overrides for DayPilot calendar */
#dp {
  color: rgb(220, 220, 225) !important;
  /* Override DayPilot CSS variables for dark theme */
  --dp-calendar-cell-bg-color: rgba(55, 55, 65, 0.5);
  --dp-calendar-cell-business-bg-color: rgba(75, 75, 85, 0.6);
  --dp-calendar-header-bg-color: rgba(45, 45, 55, 0.9);
  --dp-calendar-border-color: rgba(255, 255, 255, 0.3);
  --dp-calendar-bg-color: rgba(40, 40, 50, 0.9);
  --dp-calendar-event-bar-bg-color: rgb(68, 0, 85);
  --dp-calendar-event-bar-color: rgb(120, 0, 163);
}

:deep(.calendar_default_event_inner),
:deep(.calendar_transparent_event_inner) {
  color: white !important;
  border-radius: 6px 6px 0 0 !important;
  opacity: 1 !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  padding: 6px 8px !important;
  font-weight: 500 !important;
  font-size: 13px !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

/* Headers dark theme */
:deep(.calendar_default_rowheader_inner),
:deep(.calendar_default_cornerright_inner),
:deep(.calendar_default_corner_inner),
:deep(.calendar_default_colheader_inner),
:deep(.calendar_default_alldayheader_inner) {
  background: rgba(45, 45, 55, 0.9) !important;
  color: rgb(220, 220, 225) !important;
  font-weight: 600;
  border-right: 1px solid rgba(255, 255, 255, 0.3) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3) !important;
}

/* Force grid lines with deep selectors */
:deep(.calendar_default_cell_inner) {
  border-right: 1px solid rgba(255, 255, 255, 0.4) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.4) !important;
}

:deep(.calendar_transparent_cell_inner) {
  border-right: 1px solid rgba(255, 255, 255, 0.4) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.4) !important;
}

:deep(.calendar_default_rowheader),
:deep(.calendar_transparent_rowheader) {
  border-right: 1px solid rgba(255, 255, 255, 0.4) !important;
}

:deep(.calendar_default_colheader),
:deep(.calendar_transparent_colheader) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.4) !important;
}

.calendar-box {
  display: flex;
  gap: 20px;
  min-height: 600px;
}

.task-controls {
  min-width: 320px;
  max-width: 320px;
  background: rgba(30, 30, 35, 0.6);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
}

.sidebar-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 20px 0;
  color: #e0e0e0;
}

.task-list {
  overflow-y: auto;
  max-height: calc(100vh - 200px);
}

.task-list::-webkit-scrollbar {
  width: 6px;
}

.task-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.task-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.task-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.task-group {
  margin-bottom: 24px;
}

.task-date-header {
  font-size: 14px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.task-items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.task-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.task-item:hover {
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  border-left-width: 4px;
}

.task-title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  color: #e0e0e0;
}

.task-row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 8px;
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
  color: #6ee7b7;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.quick-complete-button:hover,
.quick-complete-button:focus-visible {
  border-color: #6ee7b7;
  background: rgba(16, 185, 129, 0.14);
  opacity: 1;
}

.quick-complete-button:focus-visible {
  outline: 2px solid #a7f3d0;
  outline-offset: 2px;
}

.quick-complete-button:disabled {
  cursor: progress;
  opacity: 0.4;
}

.quick-complete-error {
  margin: -8px 0 14px;
  color: #fca5a5;
  font-size: 13px;
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
  color: #fbbf24;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.slip-forecast-heading h4 {
  margin: 3px 0 0;
  color: #f9fafb;
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
  color: #d1d5db;
  font-size: 19px;
  line-height: 1;
}

.forecast-close:hover,
.forecast-close:focus-visible {
  border-color: #fbbf24;
  outline: none;
  color: #fef3c7;
}

.forecast-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 12px 0 8px;
  color: #d1d5db;
  font-size: 12px;
}

.forecast-summary .danger {
  color: #fca5a5;
}

.forecast-assumption {
  margin: 0 0 13px;
  color: #9ca3af;
  font-size: 11px;
  line-height: 1.45;
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
  color: #d1d5db;
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
  border: 2px solid #fbbf24;
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
  color: #fcd34d;
  white-space: nowrap;
}

.cascade-dates strong {
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.22);
  color: #fca5a5;
  font-size: 9px;
  text-transform: uppercase;
}

.forecast-cascade .newly-late .cascade-marker {
  border-color: #ef4444;
  background: #7f1d1d;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.13);
}

.slip-impact-chip {
  padding: 4px 7px;
  border: 1px solid rgba(156, 163, 175, 0.35);
  border-radius: 999px;
  background: rgba(107, 114, 128, 0.13);
  color: #d1d5db;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.slip-impact-chip.risk {
  border-color: rgba(248, 113, 113, 0.55);
  background: rgba(239, 68, 68, 0.17);
  color: #fca5a5;
}

.slip-impact-chip.safe {
  border-color: transparent;
  background: transparent;
  color: #7d8590;
  font-weight: 500;
  opacity: 0.62;
}

.task-item:hover .slip-impact-chip.safe,
.slip-impact-chip.safe:focus-visible,
.slip-impact-chip.safe[aria-expanded="true"] {
  opacity: 1;
}

.slip-impact-chip:hover,
.slip-impact-chip:focus-visible,
.slip-impact-chip[aria-expanded="true"] {
  border-color: #fbbf24;
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
  border-left-color: #ef4444;
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
  padding: 4px 10px;
  border-radius: 12px;
  white-space: nowrap;
}

.unscheduled-badge {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}

.late-task {
  border-left-color: #ef4444;
}

.late-task .task-title {
  color: #fca5a5;
}

.late-task .task-days {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.due-that-day-task {
  border-left-color: #f59e0b;
}

.due-that-day-task .task-title {
  color: #fcd34d;
}

.due-that-day-task .task-days {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}

.on-track-task {
  border-left-color: #10b981;
}

.on-track-task .task-days {
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}

.backlog-task {
  border-left-color: #6b7280;
  opacity: 0.7;
}

.backlog-task .task-title {
  color: #9ca3af;
  font-style: italic;
}

.backlog-task .task-badge {
  background: rgba(107, 114, 128, 0.2);
  color: #9ca3af;
}

.calendar-controls {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}

.nav-btn {
  flex: 1;
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.nav-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
}

.nav-btn:active {
  transform: translateY(0);
}

.nav-icon {
  font-size: 14px;
}

.calendar-container {
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.all-day-events {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.all-day-label {
  font-weight: 600;
}

.all-day-event {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 3px 8px;
  border-radius: 4px;
  background: #a27cf9;
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

  .task-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .task-row-meta {
    flex-wrap: wrap;
    margin: 7px 0 0;
  }
}

.followup-recommendation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid rgba(102, 126, 234, 0.42);
  border-radius: 8px;
  background: rgba(102, 126, 234, 0.1);
}

.followup-recommendation button {
  flex: 0 0 auto;
}
</style>
