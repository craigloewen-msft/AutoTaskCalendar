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
                    'backlog-task': task.isBacklog
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
                    <span class="task-days" v-else>{{ getTaskDaysBetweenDeadlineAndSchedule(task) }}</span>
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
      :title="this.selectedTask ? 'Set follow up' : 'Add follow up'"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-body">
            <div v-if="input.error">{{ input.error }}</div>
            <label for="task-title">Task Title*</label>
            <input
              type="text"
              v-model="input.taskTitle"
              class="form-control"
              id="task-title"
              placeholder="Enter task title"
            />
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
        error: null,
      },
      taskEditorOpen: false,
      currentDate: dateOnlyInTimeZone(this.$store.state.user?.timeZone),
      selectedTask: null,
      selectedEvent: null,
      allDayEvents: [],
      quickCompletingTaskIds: [],
      quickCompleteError: "",
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
        await this.loadCalendarEvents();
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
      this.taskList = taskDataResponse.data.taskList;
      if (!taskDataResponse.data.success) {
        console.error("Task retrieval error");
      }
    },
    async loadCompass() {
      try {
        const response = await this.$http.get("/api/getCompass");
        this.compassRoles = response.data.success ? response.data.roles : [];
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
      this.loadTasks();
      this.loadCalendarEvents();
      this.loadCompass();
    },
    async syncCalendar() {
      const taskDataResponse = await this.$http.get("/api/synccalendar/");
      this.loadCalendarEvents();
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

      if (this.input.error) {
        return;
      }

      const followUpDate = addCalendarDays(
        dateOnlyInTimeZone(this.$store.state.user.timeZone),
        parseInt(this.input.followUpDays, 10)
      );

      try {
        const response = await this.$http.post("/api/setFollowUp/", {
          title: this.input.taskTitle,
          followUpDate: followUpDate,
          taskID: this.selectedTask?._id,
        });
        this.taskList = response.data.taskList;

        Object.keys(this.input).forEach((i) => (this.input[i] = null));
      } catch (error) {
        console.error(error);
      }

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
        const response = await this.$http.get("api/scheduletasks");
        this.loadData();
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
      this.loadCalendarEvents();
    },
    openFollowUpModal(inputTask) {
      this.taskEditorOpen = false;
      this.selectedTask = inputTask;
      this.input = {
        taskTitle: inputTask?.title || null,
        followUpDays: null,
        error: null,
      };
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
    },
    getTaskDaysBetweenDeadlineAndSchedule(inTask) {
      if (!inTask.dueDate || !inTask.scheduledDate) return null;
      return calendarDayDifference(inTask.dueDate, inTask.scheduledDate);
    },
    getTaskDate(task) {
      if (task.isBacklog && !task.scheduledDate) {
        return "Backlog";
      }
      // Anything the scheduler could not place has no scheduledDate; formatting it would
      // produce the literal string "Invalid Date" as a group header.
      if (!task.scheduledDate) {
        return "Unscheduled";
      }
      const taskDate = new Date(task.scheduledDate);
      if (Number.isNaN(taskDate.getTime())) {
        return "Unscheduled";
      }
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
    taskGroupedByDate() {
      const groupedTasks = {};
      if (this.taskList) {
        // 60 days of occurrences would bury the list, so the sidebar keeps a shorter
        // window. Backlog and unscheduled tasks have no date, so they are always kept.
        const windowEnd = new Date();
        windowEnd.setDate(windowEnd.getDate() + SIDEBAR_WINDOW_DAYS);
        windowEnd.setHours(23, 59, 59, 999);

        const visibleTasks = this.taskList.filter((task) => {
          if (!task.scheduledDate) return true;
          const scheduled = new Date(task.scheduledDate);
          if (Number.isNaN(scheduled.getTime())) return true;
          return scheduled <= windowEnd;
        });

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
        // "Backlog" and "Unscheduled" are labels, not dates, so they sort to the end.
        const labels = ["Backlog", "Unscheduled"];
        taskDateArray.sort(function (a, b) {
          const aIsLabel = labels.includes(a);
          const bIsLabel = labels.includes(b);
          if (aIsLabel || bIsLabel) {
            if (aIsLabel && bIsLabel) return a.localeCompare(b);
            return aIsLabel ? 1 : -1;
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
    setInterval(() => {
      this.highlightCurrentTimeCell();
    }, 1 * 5 * 1000); // 1 minutes in milliseconds
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
</style>