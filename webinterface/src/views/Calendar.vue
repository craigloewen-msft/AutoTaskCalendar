<template>
  <div>
    <h1>Calendar</h1>
    <div class="calendar-box">
      <div class="task-controls">
        <h2>Controls</h2>
        <div class="task-controls-buttons">
        <b-button v-on:click="openAddTaskModal">Add Task</b-button>
        <b-button v-on:click="openFollowUpModal(null)">Add Follow Up</b-button>
        <b-button v-on:click="scheduleTasks">Schedule</b-button>
        <b-button v-on:click="syncCalendar">Sync Calendar</b-button>
        </div>
        <div class="task-list">
          <h2>Task List</h2>
          <div v-for="date in tasksDatesArray" :key="date">
            <h4>{{ date }}</h4>
            <ul>
              <li
                v-for="task in taskGroupedByDate[date]"
                :key="task._id"
                v-bind:class="{
                  'late-task': getTaskDaysBetweenDeadlineAndSchedule(task) < 0,
                  'on-track-task':
                    getTaskDaysBetweenDeadlineAndSchedule(task) > 0,
                  'due-that-day-task':
                    getTaskDaysBetweenDeadlineAndSchedule(task) == 0,
                }"
                v-on:click="openEditTaskModal(task)"
              >
                {{ task.title }} :
                {{ getTaskDaysBetweenDeadlineAndSchedule(task) }}
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div class="main-calendar">
        <div class="calendar-controls">
          <button v-on:click="nextWeek">N</button>
          <button v-on:click="prevWeek">P</button>
        </div>
        <div class="calendar">
          <DayPilotCalendar :config="config" ref="calendar" id="dp" />
        </div>
      </div>
    </div>
    <b-modal
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
                <label for="task-due-date">Due Date*</label>
                <b-calendar
                  v-model="input.taskDueDate"
                  class="mb-2"
                ></b-calendar>
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
                <b-form-checkbox
                  type="number"
                  v-model="input.taskBreakUpTask"
                  class="form-control"
                  id="task-break-up-task"
                  >Break Up Task Into Chunks</b-form-checkbox
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
                <b-form-datepicker
                  v-model="input.taskStartDate"
                  class="mb-2"
                ></b-form-datepicker>
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
    </b-modal>
    <b-modal
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
    </b-modal>
  </div>
</template>

<script>
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-vue";

export default {
  name: "Calendar",
  components: {
    DayPilotCalendar,
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

        let eventColor = "green";
        let eventTags = null;
        if (event.type.includes("task")) {
          eventColor = "#333";
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
      } else if (!this.input.taskDueDate) {
        this.input.error = "Need task due date";
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
      let inputDueDate = this.changeShortCalendarFormatToDate(
        this.input.taskDueDate
      );

      // Do same for startDate
      let inputStartDate = this.changeShortCalendarFormatToDate(
        this.input.taskStartDate ||
          this.changeDateToShortCalendarFormat(new Date())
      );

      // Make taskDueDate at the end of the day by adding 23 hours, 59 minutes, 59 seconds
      inputDueDate = new Date(
        new Date(inputDueDate).getTime() + 86399000
      ).toISOString();

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
      this.selectedTask.dueDate = this.changeShortCalendarFormatToDate(
        this.input.taskDueDate
      );
      this.selectedTask.duration = this.input.taskDuration;
      this.selectedTask.notes = this.input.taskNotes;
      this.selectedTask.startDate = this.changeShortCalendarFormatToDate(
        this.input.taskStartDate
      );
      this.selectedTask.breakUpTask = this.input.taskBreakUpTask;
      this.selectedTask.breakUpTaskChunkDuration =
        this.input.taskBreakUpTaskChunkDuration;

      this.selectedTask.repeat = this.input.repeat;

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
        this.$bvModal.hide("task-modal");
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
        this.$bvModal.hide("task-modal");
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
      this.$bvModal.show("task-modal");
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
      
      this.$bvModal.show("followup-modal");
    },
    openEditTaskModal(inputTask) {
      this.selectedTask = inputTask;

      // Make all this input be that of the task's
      this.input.taskTitle = inputTask.title;
      this.input.taskDueDate = this.changeDateToShortCalendarFormat(
        new Date(inputTask.dueDate)
      );
      this.input.taskDuration = inputTask.duration;
      this.input.taskStartDate = this.changeDateToShortCalendarFormat(
        new Date(inputTask.startDate)
      );
      this.input.taskNotes = inputTask.notes;
      this.input.taskBreakUpTask = inputTask.breakUpTask;
      this.input.taskBreakUpTaskChunkDuration =
        inputTask.breakUpTaskChunkDuration;

      this.input.repeat = inputTask.repeat;

      this.$bvModal.show("task-modal");
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
};
</script>

<style>
.main-calendar {
  /* Flex box style */
  display: flex;
  flex-direction: row;
}

.calendar_default_event_inner {
  background: #2e78d6;
  color: white !important;
  border-radius: 5px !important;
  opacity: 0.9;
}

.calendar_default_rowheader_inner,
.calendar_default_cornerright_inner,
.calendar_default_corner_inner,
.calendar_default_colheader_inner,
.calendar_default_alldayheader_inner {
  background: rgb(38, 38, 39) !important;
  color: rgb(211, 211, 212) !important;
}

.calendar_default_cell_inner {
  background: rgb(71, 71, 72) !important;
}

.calendar_default_cell_business .calendar_default_cell_inner {
  background: rgb(111, 111, 112) !important;
}

.calendar-box {
  display: flex;
  flex-direction: row;
}

.task-controls {
  min-width: 280px;
  padding: 0 5;
}

.late-task {
  color: rgb(255, 25, 0);
}

.due-that-day-task {
  color: rgb(255, 255, 199);
}

.task-controls-buttons * {
  margin-right: 5px;
  margin-top: 5px;
}
</style>