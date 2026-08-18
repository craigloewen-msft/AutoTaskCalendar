<template>
  <div class="pageContent">
    <BContainer>
      <div class="user-profile-header">
        <div class="user-avatar">
          <div class="avatar-circle">
            <i class="user-icon">👤</i>
          </div>
        </div>
        <h1 class="user-title">{{ user.username }}</h1>
        <p class="user-subtitle">Manage your profile and working hours</p>
      </div>

      <BRow>
        <BCol lg="8" class="mx-auto">
          <!-- Working Hours Section -->
          <BCard class="modern-card mb-4">
            <h3 class="section-title">
              <span class="title-icon">⏰</span>
              Working Hours
            </h3>
            <p class="section-description">Configure your available working time</p>

            <BRow>
              <BCol md="6" class="mb-3">
                <BFormGroup
                  label="Start Time"
                  label-for="startTime"
                  description="When does your workday begin?"
                >
                  <BFormInput
                    id="startTime"
                    v-model="input.startTime"
                    type="time"
                    class="modern-input"
                  />
                </BFormGroup>
              </BCol>

              <BCol md="6" class="mb-3">
                <BFormGroup
                  label="End Time"
                  label-for="endTime"
                  description="When does your workday end?"
                >
                  <BFormInput
                    id="endTime"
                    v-model="input.endTime"
                    type="time"
                    class="modern-input"
                  />
                </BFormGroup>
              </BCol>
            </BRow>

            <BFormGroup
              label="Timezone"
              label-for="timeZone"
              description="Scheduling stays in this timezone until you change it."
              class="mb-3"
            >
              <BFormInput
                id="timeZone"
                v-model="input.timeZone"
                type="text"
                class="modern-input"
              />
            </BFormGroup>

            <BFormGroup
              label="Working Days"
              label-for="weekdays"
              description="Select the days you're available to work"
              class="mb-0"
            >
              <div class="weekday-selector">
                <BFormCheckbox
                  v-for="day in weekdays"
                  :key="day"
                  v-model="input.selectedWeekdays"
                  :value="day"
                  class="weekday-checkbox"
                  button
                  button-variant="outline-primary"
                >
                  {{ day.substring(0, 3) }}
                </BFormCheckbox>
              </div>
            </BFormGroup>
          </BCard>

          <!-- Google Calendar Integration Section -->
          <BCard class="modern-card mb-4">
            <h3 class="section-title">
              <span class="title-icon">📅</span>
              Calendar Integration
            </h3>
            <p class="section-description">Sync your tasks with Google Calendar</p>

            <div v-if="userCalendarList.length === 0" class="empty-state">
              <div class="empty-icon">📭</div>
              <p class="empty-text">No calendars connected yet</p>
              <BButton
                variant="primary"
                size="lg"
                @click="connectCalendar"
                class="connect-button"
              >
                <span class="button-icon">🔗</span>
                Connect Google Calendar
              </BButton>
            </div>

            <div v-else>
              <div class="calendar-list">
                <BFormCheckbox
                  v-for="calendar in userCalendarList"
                  :key="calendar.id"
                  v-model="input.selectedCalendars"
                  :value="calendar.id"
                  class="calendar-item"
                >
                  <div class="calendar-info">
                    <span class="calendar-name">{{ calendar.summary }}</span>
                  </div>
                </BFormCheckbox>
              </div>

              <BButton
                variant="outline-primary"
                @click="connectCalendar"
                class="mt-3"
              >
                <span class="button-icon">➕</span>
                Connect Another Calendar
              </BButton>
            </div>
          </BCard>

          <!-- Save Button -->
          <div class="text-center">
            <BButton
              variant="primary"
              size="lg"
              @click="submitUserUpdates"
              class="save-button"
            >
              <span class="button-icon">💾</span>
              Save Changes
            </BButton>
          </div>
        </BCol>
      </BRow>
    </BContainer>
  </div>
</template>

<script>
import router from "../router";
import { BContainer, BRow, BCol, BCard, BButton, BFormGroup, BFormCheckbox, BFormInput } from 'bootstrap-vue-next';

export default {
  name: "User",
  components: {
    BContainer,
    BRow,
    BCol,
    BCard,
    BButton,
    BFormGroup,
    BFormCheckbox,
    BFormInput
  },
  data() {
    return {
      user: this.$store.state.user,
      userCalendarList: [],
      weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      input: {
        startTime: null,
        endTime: null,
        selectedWeekdays: this.$store.state.user.workingDays || [],
        selectedCalendars: this.$store.state.user.selectedCalendars || [],
        timeZone:
          this.$store.state.user.timeZone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
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
        timeZone: this.input.timeZone,
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
    async connectCalendar() {
      try {
        const response = await this.$http.get("api/connectGoogle");
        window.location.href = response.data.authUrl;
      } catch (error) {
        console.error(error);
      }
    },
    async refreshCalendarData() {
      try {
        const response = await this.$http.get("api/getCalendars");
        if (response.data.success) {
          this.userCalendarList = response.data.calendars;
          // Add selected calendars to input
          this.input.selectedCalendars = this.userCalendarList.filter(obj => obj.selected).map(obj => obj.id);
        }
      } catch (error) {
        console.error(error);
      }
    },
  },
  created() {
    this.input.startTime = this.$store.state.user.workingStartTime || "09:00";
    this.input.endTime = this.$store.state.user.workingEndTime || "17:00";
  },
  mounted() {
    this.refreshCalendarData();
  },
  metaInfo() {
    return {
      title: `${this.input.username || 'User'} Profile - Settings & Configuration`,
      meta: [
        {
          name: "description",
          content: "Manage your AutoTaskCalendar profile settings, working hours, Google Calendar integration, and task scheduling preferences.",
        },
        {
          name: "keywords",
          content: "user profile, settings, working hours, calendar preferences, account management"
        },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
};
</script>

<style scoped>
.user-profile-header {
  text-align: center;
  padding: 40px 20px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  border-radius: 16px;
  margin-bottom: 40px;
}

.user-avatar {
  margin-bottom: 20px;
}

.avatar-circle {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
}

.user-icon {
  font-style: normal;
}

.user-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 8px;
}

.user-subtitle {
  font-size: 1.1rem;
  color: #a0a0a0;
  margin: 0;
}

.modern-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.modern-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.section-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-icon {
  font-size: 1.8rem;
  font-style: normal;
}

.section-description {
  color: #a0a0a0;
  margin-bottom: 24px;
  font-size: 0.95rem;
}

.modern-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #e0e0e0;
  padding: 12px 16px;
  font-size: 1rem;
  transition: all 0.3s ease;
}

.modern-input:focus {
  background: rgba(255, 255, 255, 0.08);
  border-color: #667eea;
  box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
  color: #e0e0e0;
}

.weekday-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.weekday-checkbox {
  flex: 0 0 auto;
}

.weekday-checkbox .btn {
  min-width: 70px;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 16px;
  opacity: 0.6;
}

.empty-text {
  color: #a0a0a0;
  font-size: 1.1rem;
  margin-bottom: 24px;
}

.connect-button {
  padding: 12px 32px;
  font-size: 1.1rem;
  border-radius: 12px;
  font-weight: 600;
}

.button-icon {
  margin-right: 8px;
  font-style: normal;
}

.calendar-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.calendar-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.3s ease;
}

.calendar-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(102, 126, 234, 0.5);
}

.calendar-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.calendar-name {
  font-size: 1rem;
  color: #e0e0e0;
  font-weight: 500;
}

.save-button {
  padding: 14px 48px;
  font-size: 1.2rem;
  border-radius: 12px;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3);
  transition: all 0.3s ease;
}

.save-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
}

/* Override Bootstrap Vue form group labels */
:deep(.form-group label) {
  color: #d0d0d0;
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 8px;
}

:deep(.form-group .form-text) {
  color: #909090;
  font-size: 0.85rem;
}

:deep(.custom-control-label) {
  color: #e0e0e0;
  cursor: pointer;
}

:deep(.custom-checkbox .custom-control-input:checked ~ .custom-control-label::before) {
  background-color: #667eea;
  border-color: #667eea;
}

:deep(.btn-outline-primary) {
  border-color: rgba(102, 126, 234, 0.5);
  color: #667eea;
}

:deep(.btn-outline-primary:hover) {
  background-color: #667eea;
  border-color: #667eea;
  color: white;
}

:deep(.btn-outline-primary.active) {
  background-color: #667eea;
  border-color: #667eea;
  color: white;
}
</style>