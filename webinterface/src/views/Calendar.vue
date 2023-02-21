<template>
  <div>
    <h1>Calendar</h1>
    <div class="calendar-box">
      <div class="task-controls">
        <h2>Controls</h2>
        <b-button v-b-modal.modal-1>Add Task</b-button>
        <div class="task-list">
          <h2>Task List</h2>
          <ul>
            <li v-for="task in taskList" :key="task._id">
              {{ task.title }} - {{ task.dueDate }}
              <button @click="deleteTask(task._id)">Delete</button>
            </li>
          </ul>
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
      id="modal-1"
      ref="addtaskmodal"
      @ok="addSampleTask"
      title="Add Task"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-body">
            <div v-if="input.error">{{ input.error }}</div>
            <form ref="form" @submit.stop.prevent="handleSubmit">
              <div class="form-group">
                <label for="task-title">Task Title</label>
                <input
                  type="text"
                  v-model="input.taskTitle"
                  class="form-control"
                  id="task-title"
                  placeholder="Enter task title"
                />
              </div>
              <div class="form-group">
                <label for="task-due-date">Due Date</label>
                <b-calendar
                  v-model="input.taskDueDate"
                  class="mb-2"
                ></b-calendar>
              </div>
              <div class="form-group">
                <label for="task-duration">Duration</label>
                <input
                  type="number"
                  v-model="input.taskDuration"
                  class="form-control"
                  id="task-duration"
                />
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
            </form>
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
        businessBeginsHour: 10,
        businessEndsHour: 18,
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
              startDate: args.start,
              endDate: args.end,
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
              console.log("Error here");
              console.error(response.data.error);
            }
          } catch (error) {
              console.log("Error here2");
            console.error(error);
          }
        },
        onEventMove: async (args) => {
          try {
            const response = await this.$http.post("/api/updateEvent", {
              eventId: args.e.data.id,
              startDate: args.newStart.toString(),
              endDate: args.newEnd.toString(),
            });
            if (!response.data.success) {
              console.error(response.data.error);
            }
          } catch (error) {
            console.error(error);
          }
        },
        onEventResize: async (args) => {
          try {
            const response = await this.$http.post("/api/updateEvent", {
              eventId: args.e.data.id,
              startDate: args.newStart.toString(),
              endDate: args.newEnd.toString(),
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
        error: null,
      },
      showModal: false,
      currentDate: new Date(),
    };
  },
  methods: {
    async loadData() {
      const taskDataResponse = await this.$http.get("/api/getUserTasks/");
      this.taskList = taskDataResponse.data.taskList;
      if (!taskDataResponse.data.success) {
        console.error("Task retrieval error");
      }

      const eventDataResponse = await this.$http.get(
        `/api/getUserEvents/${this.currentDate}`
      );

      if (!eventDataResponse.data.success) {
        console.error("Event retrieval error");
      }
      
      const events = eventDataResponse.data.events;
      // use map function to transform the events
      const eventsToAdd = events.map((event) => {
        return {
          id: event._id,
          start: event.startDate,
          end: event.endDate,
          text: event.title,
        };
      });
      this.calendar.update({ events: eventsToAdd });
    },
    async addSampleTask(bvModalEvent) {
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

      try {
        const response = await this.$http.post("/api/createTask/", {
          title: this.input.taskTitle,
          dueDate: this.input.taskDueDate,
          duration: this.input.taskDuration,
          notes: this.input.taskNotes,
        });
        this.taskList = response.data.taskList;

        Object.keys(this.input).forEach((i) => (this.input[i] = null));
      } catch (error) {
        console.error(error);
      }
    },
    async deleteTask(taskId) {
      try {
        const response = await this.$http.post(`/api/deleteTask`, { taskId });
        // refresh task list after deletion
        this.taskList = response.data.taskList;
      } catch (error) {
        console.error(error);
      }
    },
    prevWeek() {
      this.config.startDate = this.config.startDate.addDays(-7);
    },
    nextWeek() {
      this.config.startDate = this.config.startDate.addDays(7);
    }
  },
  computed: {
    calendar() {
      return this.$refs.calendar.control;
    },
  },
  mounted() {
    this.$gtag.pageview(this.$route);
    this.loadData();
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
  color: white;
  border-radius: 5px;
  opacity: 0.9;
}

.calendar_default_rowheader_inner,
.calendar_default_cornerright_inner,
.calendar_default_corner_inner,
.calendar_default_colheader_inner,
.calendar_default_alldayheader_inner {
  background: rgb(38, 38, 39);
  color: rgb(211, 211, 212);
}

.calendar_default_cell_inner {
  background: rgb(71, 71, 72);
}

.calendar_default_cell_business .calendar_default_cell_inner {
  background: rgb(111, 111, 112);
}

.calendar-box {
  display: flex;
  flex-direction: row;
}

.task-controls {
  min-width: 280px;
  padding: 0 5;
}
</style>