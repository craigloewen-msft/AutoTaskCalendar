<template>
  <div>
    <h1>Calendar</h1>
    <div class="calendar-box">
      <div class="task-controls">
        <h2>Controls</h2>
        <b-button v-on:click="$refs.addTaskModal.openAddTaskModal()"
          >Add Task</b-button
        >
        <b-button v-on:click="scheduleTasks">Schedule</b-button>
        <b-button v-on:click="syncCalendar">Sync Calendar</b-button>
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
                v-on:click="$refs.addTaskModal.openEditTaskModal(task)"
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
    <AddTaskModal
      :taskList="taskList"
      :projectList="projectList"
      ref="addTaskModal"
      @refreshTaskList="refreshTaskList"
      @refreshProjectList="refreshProjectList"
    />
  </div>
</template>

<script>
import { DayPilot, DayPilotCalendar } from "@daypilot/daypilot-lite-vue";
import AddTaskModal from "../components/AddTaskModal.vue";
import { helperFunctions } from "../js/helperFunctions.js";

export default {
  name: "Calendar",
  components: {
    DayPilotCalendar,
    AddTaskModal,
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
            this.$refs.addTaskModal.openEditTaskModalById(
              eventDetails.tags.taskId
            );
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
            this.$refs.addTaskModal.openEditTaskModalById(
              eventDetails.tags.taskId
            );
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
      projectList: null,
      showModal: false,
      currentDate: new Date(),
      selectedTask: null,
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
    async loadProjects() {
      const projectDataResponse = await this.$http.get("/api/getUserProjects/");
      this.projectList = projectDataResponse.data.projectList;
      if (!projectDataResponse.data.success) {
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
      this.loadProjects();
      this.loadCalendarEvents();
    },
    async syncCalendar() {
      const taskDataResponse = await this.$http.get("/api/synccalendar/");
      this.loadCalendarEvents();
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
    refreshTaskList(inputList) {
      this.taskList = inputList;
    },
    refreshProjectList(inputList) {
      this.projectList = inputList;
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
</style>