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

    <button @click="submitWorkingHours">Submit</button>
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
      input: { startTime: this.$store.state.user.workingStartTime, endTime: this.$store.state.user.workingEndTime, selectedWeekdays: this.$store.state.user.workingDays? this.$store.state.user.workingDays:[]  },
    };
  },
  methods: {
    async submitWorkingHours() {
      const workingHours = {
        workingStartTime: this.input.startTime,
        workingEndTime: this.input.endTime,
        workingDays: this.input.selectedWeekdays,
      };

    try {
      const response = await this.$http.post("/api/setuserworkinghours/", workingHours);

      if (!response.data.success) {
        throw "Failure on loading data"
      } else {
        this.$store.dispatch('refreshUserInfo', response.data.user);
      }

    } catch (error) {
      console.error(error);
    }
    },
  },
  mounted() {

  },
};
</script>

<style>
</style>