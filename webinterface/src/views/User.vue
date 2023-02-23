<template>
  <div>
    <h1>User info</h1>
    <p>{{ user }}</p>

    <div>
      <label for="startTime">Start Time:</label>
      <input id="startTime" v-model="input.startTime" type="time" />
    </div>

    <div>
      <label for="endTime">End Time:</label>
      <input id="endTime" v-model="input.endTime" type="time" />
    </div>

    <div>
      <label for="weekdays">Weekdays:</label>
      <select id="weekdays" v-model="input.selectedWeekdays" multiple>
        <option value="Monday">Monday</option>
        <option value="Tuesday">Tuesday</option>
        <option value="Wednesday">Wednesday</option>
        <option value="Thursday">Thursday</option>
        <option value="Friday">Friday</option>
        <option value="Saturday">Saturday</option>
        <option value="Sunday">Sunday</option>
      </select>
    </div>

    <div v-if="userCalendarList.length > 0">
      <h2>Connected Calendars</h2>
      <ul>
        <li v-for="calendar in userCalendarList" :key="calendar.id">
          <label :for="'calendar-' + calendar.id">{{ calendar.summary }}</label>
          <input
            :id="'calendar-' + calendar.id"
            v-model="input.selectedCalendars"
            :value="calendar.id"
            type="checkbox"
          />
        </li>
      </ul>
    </div>

    <button @click="submitUserUpdates">Submit</button>
    <b-button v-on:click="connectCalendar">Connect Calendar</b-button>
  </div>
</template>

<script>
import router from "../router";

export default {
  name: "User",
  components: {},
  data() {
    return {
      user: this.$store.state.user,
      userCalendarList: [],
      input: {
        startTime: null,
        endTime: null,
        selectedWeekdays: this.$store.state.user.workingDays || [],
        selectedCalendars: this.$store.state.user.selectedCalendars || [],
      },
    };
  },
  methods: {
    async submitUserUpdates() {
      const workingHours = {
        workingStartTime: this.input.startTime,
        workingEndTime: this.input.endTime,
        workingDays: this.input.selectedWeekdays,
        selectedCalendars: this.input.selectedCalendars,
        timeZoneOffset: new Date().getTimezoneOffset(),
      };

      try {
        const response = await this.$http.post(
          "/api/updateuserinfo/",
          workingHours
        );

        if (!response.data.success) {
          throw "Failure on loading data";
        } else {
          this.$store.dispatch("refreshUserInfo", response.data.user);
        }
      } catch (error) {
        console.error(error);
      }
    },
    convertDateToHourString(inDate) {
      let inputDate = new Date(inDate);
      let returnValue =
        inputDate.getHours().toString().padStart(2, "0") +
        ":" +
        inputDate.getMinutes().toString().padStart(2, "0");
      return returnValue;
    },
    async connectCalendar() {
      try {
        const response = await this.$http.get("api/connectGoogle");
        console.log(response.data.authUrl);
        window.location.href = response.data.authUrl;
      } catch (error) {
        console.error(error);
      }
    },
    async refreshCalendarData() {
      try {
        const response = await this.$http.get("api/getCalendars");
        this.userCalendarList = response.data.calendars;
      } catch (error) {
        console.error(error);
      }
    },
  },
  created() {
    this.input.startTime = this.convertDateToHourString(
      this.$store.state.user.workingStartTime
    );
    this.input.endTime = this.convertDateToHourString(
      this.$store.state.user.workingEndTime
    );
  },
  mounted() {
    this.refreshCalendarData();
  },
};
</script>

<style>
</style>