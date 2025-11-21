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
                <span class="task-title">{{ task.title }}</span>
                <span class="task-badge" v-if="task.isBacklog">BACKLOG</span>
                <span class="task-days" v-else>{{ getTaskDaysBetweenDeadlineAndSchedule(task) }}</span>
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
        <div class="calendar-container">
          <DayPilotCalendar :config="config" ref="calendar" id="dp" />
        </div>
      </div>
      </div>
    </div>
    <BModal
      id="task-modal"
      ref="addtaskmodal"
      @ok="resolveTaskModal"
      @hidden="resetTaskModal"
      :title="this.selectedTask ? 'Edit Task' : 'Add Task'"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-body">
            <div v-if="input.error">{{ input.error }}</div>
            <form ref="form" @submit.stop.prevent="handleSubmit">
              <div class="form-group">
                <label for="task-title">Task Title*</label>
                <input
                  type="text"
                  v-model="input.taskTitle"
                  class="form-control"
                  id="task-title"
                  placeholder="Enter task title"
                />
              </div>
              <div class="form-group">
                <BFormCheckbox
                  v-model="input.taskIsBacklog"
                  class="form-control"
                  id="task-is-backlog"
                  >Mark as Backlog Task</BFormCheckbox
                >
              </div>
              <div v-if="!input.taskIsBacklog" class="form-group">
                <label for="task-due-date">Due Date*</label>
                <BCalendar
                  v-model="input.taskDueDate"
                  class="mb-2"
                ></BCalendar>
              </div>
              <div class="form-group">
                <label for="task-duration">Duration*</label>
                <input
                  type="number"
                  v-model="input.taskDuration"
                  class="form-control"
                  id="task-duration"
                />
              </div>
              <div class="form-group">
                <BFormCheckbox
                  type="number"
                  v-model="input.taskBreakUpTask"
                  class="form-control"
                  id="task-break-up-task"
                  >Break Up Task Into Chunks</BFormCheckbox
                >
              </div>
              <div v-if="input.taskBreakUpTask" class="form-group">
                <label for="task-break-up-task-chunk-duration"
                  >Chunk Duration</label
                >
                <input
                  type="number"
                  v-model="input.taskBreakUpTaskChunkDuration"
                  class="form-control"
                  id="task-break-up-task-chunk-duration"
                />
              </div>
              <div class="form-group">
                <label for="task-start-date">Start Date</label>
                <BFormDatepicker
                  v-model="input.taskStartDate"
                  class="mb-2"
                ></BFormDatepicker>
              </div>
              <div class="form-group">
                <label for="task-repeat">Repeat</label>
                <select
                  v-model="input.repeat"
                  class="form-control"
                  id="task-repeat"
                >
                  <option disabled value="">Please select one</option>
                  <option value="">None</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div class="form-group">
                <label for="task-notes">Notes</label>
                <input
                  type="text"
                  v-model="input.taskNotes"
                  class="form-control"
                  id="task-notes"
                  placeholder="Enter task notes"
                />
              </div>
              <div v-if="this.selectedTask" class="task-controls-buttons">
                <button
                  class="btn btn-secondary"
                  v-on:click="toggleBacklog(selectedTask)"
                >
                  {{ selectedTask.isBacklog ? 'Remove from Backlog' : 'Move to Backlog' }}
                </button>
                <button
                  class="btn btn-primary"
                  v-on:click="openFollowUpModal(selectedTask)"
                >
                  Set Follow Up
                </button>
                <button
                  class="btn btn-primary"
                  v-on:click="completeTask(selectedTask._id)"
                >
                  Complete
                </button>
                <button
                  class="btn btn-danger"
                  v-on:click="deleteTask(selectedTask._id)"
                >
                  Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </BModal>
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
import { BButton, BModal, BFormCheckbox, BCalendar, BFormDatepicker } from 'bootstrap-vue-next';

export default {
  name: "Calendar",
  components: {
    DayPilotCalendar,
    BButton,
    BModal,
    BFormCheckbox,
    BCalendar,
    BFormDatepicker
  },
  data() {
    return {
      config: {
        viewType: "Week",
        dayBeginsHour: 9,
        businessBeginsHour: 10,
        businessEndsHour: 18,
        cellDuration: 15,
        startDate: new DayPilot.Date().firstDayOfWeek(),
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
              startDate: new Date(args.start),
              endDate: new Date(args.end),
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
              console.error(response.data.error);
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
                startDate: new Date(args.newStart.toString()),
                endDate: new Date(args.newEnd.toString()),
              });
              if (!response.data.success) {
                console.error(response.data.error);
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
              startDate: new Date(args.newStart.toString()),
              endDate: new Date(args.newEnd.toString()),
            });
            if (!response.data.success) {
              console.error(response.data.error);
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
        onEventDeleted: async (args) => {
          try {
            const response = await this.$http.post("/api/deleteEvent", {
              eventId: args.e.data.id,
            });
            if (!response.data.success) {
              console.error(response.data.error);
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
        taskDueDate: null,
        taskDuration: null,
        taskNotes: null,
        taskStartDate: this.changeDateToShortCalendarFormat(new Date()),
        taskBreakUpTask: false,
        taskBreakUpTaskChunkDuration: 30,
        error: null,
        repeat: null,
        followUpDays: null,
        taskIsBacklog: false,
      },
      showModal: false,
      currentDate: new Date(),
      selectedTask: null,
      selectedEvent: null,
      taskModalShow: false,
    };
  },
  methods: {
    async loadTasks() {
      const taskDataResponse = await this.$http.get("/api/getUserTasks/");
      this.taskList = taskDataResponse.data.taskList;
      if (!taskDataResponse.data.success) {
        console.error("Task retrieval error");
      }
    },
    async loadCalendarEvents() {
      const eventDataResponse = await this.$http.get(
        `/api/getUserEvents/${this.currentDate}`
      );

      if (!eventDataResponse.data.success) {
        console.error("Event retrieval error");
      }

      const events = eventDataResponse.data.events;
      // use map function to transform the events
      const eventsToAdd = events.map((event) => {
        let eventStartDate = new Date(event.startDate);
        let inputStartDate =
          eventStartDate.getFullYear() +
          "-" +
          ("0" + (eventStartDate.getMonth() + 1)).slice(-2) +
          "-" +
          ("0" + eventStartDate.getDate()).slice(-2) +
          "T" +
          ("0" + eventStartDate.getHours()).slice(-2) +
          ":" +
          ("0" + eventStartDate.getMinutes()).slice(-2) +
          ":" +
          ("0" + eventStartDate.getSeconds()).slice(-2) +
          "Z";

        let eventEndDate = new Date(event.endDate);
        let inputEndDate =
          eventEndDate.getFullYear() +
          "-" +
          ("0" + (eventEndDate.getMonth() + 1)).slice(-2) +
          "-" +
          ("0" + eventEndDate.getDate()).slice(-2) +
          "T" +
          ("0" + eventEndDate.getHours()).slice(-2) +
          ":" +
          ("0" + eventEndDate.getMinutes()).slice(-2) +
          ":" +
          ("0" + eventEndDate.getSeconds()).slice(-2) +
          "Z";

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
        };
      });
      this.calendar.update({ events: eventsToAdd });
    },
    async loadData() {
      this.loadTasks();
      this.loadCalendarEvents();
    },
    async syncCalendar() {
      const taskDataResponse = await this.$http.get("/api/synccalendar/");
      this.loadCalendarEvents();
    },
    async addTask(bvModalEvent) {
      // Prevent modal from closing
      bvModalEvent.preventDefault();

      this.input.error = "";

      if (!this.input.taskTitle) {
        this.input.error = "Need task title";
      } else if (!this.input.taskIsBacklog && !this.input.taskDueDate) {
        this.input.error = "Need task due date for non-backlog tasks";
      } else if (!this.input.taskDuration) {
        this.input.error = "Need duration";
      }

      if (this.input.error) {
        return;
      }

      this.$nextTick(() => {
        this.$refs.addtaskmodal.hide();
      });

      // this.input.taskDueDate comes in format '2023-03-01', convert that to start of the day in this timezone
      let inputDueDate = null;
      if (this.input.taskDueDate) {
        inputDueDate = this.changeShortCalendarFormatToDate(
          this.input.taskDueDate
        );
        // Make taskDueDate at the end of the day by adding 23 hours, 59 minutes, 59 seconds
        inputDueDate = new Date(
          new Date(inputDueDate).getTime() + 86399000
        ).toISOString();
      }

      // Do same for startDate
      let inputStartDate = this.changeShortCalendarFormatToDate(
        this.input.taskStartDate ||
          this.changeDateToShortCalendarFormat(new Date())
      );

      try {
        const response = await this.$http.post("/api/createTask/", {
          title: this.input.taskTitle,
          dueDate: inputDueDate,
          duration: this.input.taskDuration,
          startDate: inputStartDate,
          notes: this.input.taskNotes,
          breakUpTask: this.input.taskBreakUpTask,
          breakUpTaskChunkDuration: this.input.taskBreakUpTaskChunkDuration,
          repeat: this.input.repeat,
          isBacklog: this.input.taskIsBacklog,
        });
        this.taskList = response.data.taskList;

        Object.keys(this.input).forEach((i) => (this.input[i] = null));
      } catch (error) {
        console.error(error);
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

      if (this.input.error) {
        return;
      }

      // Get follow up date
      let followUpDate = new Date();
      followUpDate.setDate(
        followUpDate.getDate() + parseInt(this.input.followUpDays, 10)
      );

      // Set time to 12 AM for that date
      followUpDate.setHours(0, 0, 0, 0);

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
    async editTask(bvModalEvent) {
      bvModalEvent.preventDefault();

      // Set all of the input to the current task
      this.selectedTask.title = this.input.taskTitle;
      this.selectedTask.dueDate = this.input.taskDueDate ? this.changeShortCalendarFormatToDate(
        this.input.taskDueDate
      ) : null;
      this.selectedTask.duration = this.input.taskDuration;
      this.selectedTask.notes = this.input.taskNotes;
      this.selectedTask.startDate = this.changeShortCalendarFormatToDate(
        this.input.taskStartDate
      );
      this.selectedTask.breakUpTask = this.input.taskBreakUpTask;
      this.selectedTask.breakUpTaskChunkDuration =
        this.input.taskBreakUpTaskChunkDuration;

      this.selectedTask.repeat = this.input.repeat;
      this.selectedTask.isBacklog = this.input.taskIsBacklog;

      try {
        const response = await this.$http.post("/api/editTask/", {
          task: this.selectedTask,
        });
        this.$nextTick(() => {
          this.$refs.addtaskmodal.hide();
        });
      } catch (error) {
        console.error(error);
      }
    },
    async deleteTask(taskId) {
      try {
        const response = await this.$http.post(`/api/deleteTask`, { taskId });
        // refresh task list after deletion
        this.taskList = response.data.taskList;
        this.$refs.addtaskmodal.hide();
      } catch (error) {
        console.error(error);
      }
    },
    async completeTask(taskId) {
      try {
        let response;
        if (this.selectedEvent?.tags.type === "task-chunk") {
          const chunkDuration =
            (this.selectedEvent.end.getTime() -
              this.selectedEvent.start.getTime()) /
            60000; // convert milliseconds to minutes
          response = await this.$http.post(`/api/completeTaskChunk`, {
            taskId,
            chunkDuration,
          });
        } else {
          response = await this.$http.post(`/api/completeTask`, { taskId });
        }
        // refresh task list after deletion
        this.taskList = response.data.taskList;
        this.$refs.addtaskmodal.hide();
      } catch (error) {
        console.error(error);
      }
    },
    async toggleBacklog(task) {
      try {
        // Toggle the isBacklog status
        task.isBacklog = !task.isBacklog;
        
        // Update the input to reflect the change
        this.input.taskIsBacklog = task.isBacklog;
        
        // If moving to backlog, clear the due date
        if (task.isBacklog) {
          task.dueDate = null;
          this.input.taskDueDate = null;
        }
        
        // Save the updated task
        const response = await this.$http.post("/api/editTask/", {
          task: task,
        });
        
        // Refresh the task list
        this.loadTasks();
      } catch (error) {
        console.error(error);
      }
    },
    addDays(date, days) {
      var result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
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
    changeShortCalendarFormatToDate(inString) {
      let returnDate = new Date(inString + "T00:00:00").toISOString();
      return returnDate;
    },
    changeDateToShortCalendarFormat(inDate) {
      let returnDate =
        inDate.getFullYear() +
        "-" +
        ("0" + (inDate.getMonth() + 1)).slice(-2) +
        "-" +
        ("0" + inDate.getDate()).slice(-2);

      return returnDate;
    },
    openAddTaskModal() {
      this.selectedTask = null;

      // Make all of this.input null
      Object.keys(this.input).forEach((i) => (this.input[i] = null));
      this.$refs.addtaskmodal.show();
    },
    openFollowUpModal(inputTask) {
      this.selectedTask = inputTask;

      // Make all of this.input null
      Object.keys(this.input).forEach((i) => (this.input[i] = null));

      if (inputTask) {
        this.input.taskTitle = inputTask.title;
      }

      this.$nextTick(() => {
        this.$refs.addtaskmodal.hide();
      });
      
      this.$refs.followupmodal.show();
    },
    openEditTaskModal(inputTask) {
      this.selectedTask = inputTask;

      // Make all this input be that of the task's
      this.input.taskTitle = inputTask.title;
      this.input.taskDueDate = inputTask.dueDate ? this.changeDateToShortCalendarFormat(
        new Date(inputTask.dueDate)
      ) : null;
      this.input.taskDuration = inputTask.duration;
      this.input.taskStartDate = this.changeDateToShortCalendarFormat(
        new Date(inputTask.startDate)
      );
      this.input.taskNotes = inputTask.notes;
      this.input.taskBreakUpTask = inputTask.breakUpTask;
      this.input.taskBreakUpTaskChunkDuration =
        inputTask.breakUpTaskChunkDuration;

      this.input.repeat = inputTask.repeat;
      this.input.taskIsBacklog = inputTask.isBacklog || false;

      this.$refs.addtaskmodal.show();
    },
    openEditTaskModalFromEvent(eventDetails) {
      let inTaskId = eventDetails.tags.taskId;
      this.selectedEvent = eventDetails;
      // Find the task with the right Id
      let foundTask = this.taskList.find((object) => object._id == inTaskId);
      this.openEditTaskModal(foundTask);
    },
    resolveTaskModal(bvModalEvent) {
      if (this.selectedTask) {
        this.editTask(bvModalEvent);
      } else {
        this.addTask(bvModalEvent);
      }
    },
    resolveFollowUpModal(bvModalEvent) {
      this.createFollowUp(bvModalEvent);
    },
    resetTaskModal() {
      this.selectedEvent = null;
    },
    resetFollowUpModal() {
      this.selectedEvent = null;
    },
    getTaskDaysBetweenDeadlineAndSchedule(inTask) {
      let dueDate = new Date(inTask.dueDate);
      let scheduledDate = new Date(inTask.scheduledDate);

      if (dueDate && scheduledDate) {
        // Get the number of milliseconds per day:
        const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

        // Create new Date objects with zeroed out time values:
        const dueDateWithoutTime = new Date(
          dueDate.getFullYear(),
          dueDate.getMonth(),
          dueDate.getDate()
        );
        const scheduledDateWithoutTime = new Date(
          scheduledDate.getFullYear(),
          scheduledDate.getMonth(),
          scheduledDate.getDate()
        );

        // Calculate the difference in milliseconds ensuring to not include time:
        const differenceInMilliseconds =
          dueDateWithoutTime.getTime() - scheduledDateWithoutTime.getTime();

        // Convert the difference to days:
        return Math.floor(differenceInMilliseconds / MILLISECONDS_PER_DAY);
      } else {
        return null;
      }
    },
    handleSubmit() {
      // DO nothing on general modal submit
      return null;
    },
    getTaskDate(task) {
      if (task.isBacklog && !task.scheduledDate) {
        return "Backlog";
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
    taskGroupedByDate() {
      const groupedTasks = {};
      if (this.taskList) {
        this.taskList.forEach((task) => {
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
        // Sort taskDateArray by date
        taskDateArray.sort(function (a, b) {
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

    let startDate = new Date(this.$store.state.user.workingStartTime);
    // Add user working duration to startDate to get endDate with getTime
    let endDate = new Date();
    endDate.setTime(
      startDate.getTime() +
        this.$store.state.user.workingDuration * 60 * 60 * 1000
    );

    this.config.businessBeginsHour =
      this.getBusinessHourNumberFromDate(startDate);
    this.config.businessEndsHour = this.getBusinessHourNumberFromDate(endDate);

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
:deep(.calendar_default_cell) {
  border-right: 1px solid rgba(255, 255, 255, 0.4) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.4) !important;
}

:deep(.calendar_transparent_cell) {
  border-right: 1px solid rgba(255, 255, 255, 0.4) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.4) !important;
}

:deep(.calendar_default_cell_inner) {
  border: none !important;
}

:deep(.calendar_transparent_cell_inner) {
  border: none !important;
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
  font-weight: 500;
  color: #e0e0e0;
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

.task-controls-buttons * {
  margin-right: 5px;
  margin-top: 5px;
}
</style>