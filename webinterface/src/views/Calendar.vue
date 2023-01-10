<template>
  <div>
    <h1>Calendar</h1>
    <div class="calendar-box">
      <div class="task-controls">
        <h2>Controls</h2>
        <button class="btn btn-primary">Add Task</button>
      </div>
      <div class="main-calendar">
        <div class="calendar">
          <DayPilotCalendar :config="config" ref="calendar" id="dp" />
        </div>
      </div>
    </div>
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
          dp.events.add({
            start: args.start,
            end: args.end,
            id: DayPilot.guid(),
            text: modal.result,
          });
        },
      },
    };
  },
  methods: {
    loadEvents() {
      // placeholder for an AJAX call
      const events = [
        {
          id: 1,
          start: "2023-01-09T10:00:00",
          end: "2023-01-09T11:00:00",
          text: "Event 1",
        },
        {
          id: 2,
          start: "2023-01-10T13:00:00",
          end: "2023-01-10T16:00:00",
          text: "Event 2",
        },
      ];
      this.calendar.update({ events });
    },
  },
  computed: {
    calendar() {
      return this.$refs.calendar.control;
    },
  },
  mounted() {
    this.$gtag.pageview(this.$route);
    this.loadEvents();
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