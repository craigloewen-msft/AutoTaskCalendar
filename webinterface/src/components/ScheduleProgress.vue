<template>
  <div v-if="visible" class="schedule-progress-strip">
    <div
      v-if="busy"
      class="progress-line busy"
      data-test="schedule-progress"
      role="status"
      aria-live="polite"
    >
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      <span>{{ phase }}</span>
    </div>
    <div
      v-else-if="error"
      class="progress-line error"
      data-test="schedule-error"
      role="alert"
    >
      <span aria-hidden="true">!</span>
      <span>{{ error }}</span>
    </div>
    <div
      v-else-if="done"
      class="progress-line done"
      data-test="schedule-done"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">&#10003;</span>
      <span>{{ done }}</span>
    </div>
  </div>
</template>

<script>
// Status strip above the calendar: busy phase, success confirmation, or error.
export default {
  name: "ScheduleProgress",
  props: {
    busy: { type: Boolean, default: false },
    phase: { type: String, default: "" },
    done: { type: String, default: "" },
    error: { type: String, default: "" },
  },
  computed: {
    visible() {
      return this.busy || Boolean(this.error) || Boolean(this.done);
    },
  },
};
</script>

<style scoped>
.schedule-progress-strip {
  margin-bottom: 12px;
}

.progress-line {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 0.9rem;
  background: rgba(30, 30, 35, 0.6);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.progress-line.busy {
  color: #cfe4ff;
  border: 1px solid rgba(120, 170, 255, 0.4);
}

.progress-line.done {
  color: #b7f0c8;
  border: 1px solid rgba(80, 200, 120, 0.45);
}

.progress-line.error {
  color: #ffc4c4;
  border: 1px solid rgba(255, 120, 120, 0.45);
}
</style>
