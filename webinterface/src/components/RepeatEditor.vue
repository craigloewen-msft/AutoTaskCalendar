<template>
  <div class="repeat-editor">
    <div class="form-group">
      <label for="task-repeat">Repeat</label>
      <select
        :value="modelValue ? modelValue.freq : ''"
        @change="onFreqChange($event.target.value)"
        class="form-control"
        id="task-repeat"
      >
        <option value="">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
    </div>

    <div v-if="modelValue" class="repeat-details">
      <div class="form-group interval-row">
        <label for="repeat-interval">Every</label>
        <input
          type="number"
          min="1"
          id="repeat-interval"
          class="form-control interval-input"
          :value="modelValue.interval"
          @input="update({ interval: Math.max(1, parseInt($event.target.value, 10) || 1) })"
        />
        <span class="interval-unit">{{ unitLabel }}</span>
      </div>

      <div v-if="modelValue.freq === 'weekly'" class="form-group">
        <label>On</label>
        <div class="weekday-pills">
          <button
            v-for="day in weekdays"
            :key="day.value"
            type="button"
            class="weekday-pill"
            :class="{
              selected: isWeekdaySelected(day.value),
              'non-working': !isWorkingDay(day.value),
            }"
            :title="isWorkingDay(day.value) ? day.name : day.name + ' is not one of your working days'"
            :aria-pressed="isWeekdaySelected(day.value)"
            :data-day="day.name"
            @click="toggleWeekday(day.value)"
          >
            {{ day.short }}
          </button>
        </div>
      </div>

      <div v-if="modelValue.freq === 'monthly'" class="form-group">
        <label for="repeat-monthday">On day of the month</label>
        <div class="monthday-row">
          <input
            type="number"
            min="1"
            max="31"
            id="repeat-monthday"
            class="form-control monthday-input"
            :disabled="usesLastDay"
            :value="usesLastDay ? '' : (modelValue.byMonthDay[0] || '')"
            @input="setMonthDay($event.target.value)"
          />
          <label class="checkbox-inline">
            <input
              type="checkbox"
              id="repeat-last-day"
              :checked="usesLastDay"
              @change="toggleLastDay($event.target.checked)"
            />
            Last day of the month
          </label>
        </div>
      </div>

      <div class="form-group">
        <label>If this task cannot fit on its occurrence day</label>
        <div class="availability-options">
          <label class="radio-inline">
            <input
              type="radio"
              id="repeat-unavailable-skip"
              name="repeat-unavailable-behavior"
              :checked="unavailableBehavior === 'skip'"
              @change="update({ unavailableBehavior: 'skip' })"
            />
            Skip that occurrence
          </label>
          <label class="radio-inline">
            <input
              type="radio"
              id="repeat-unavailable-next"
              name="repeat-unavailable-behavior"
              :checked="unavailableBehavior === 'next-available'"
              @change="update({ unavailableBehavior: 'next-available' })"
            />
            Schedule it at the next available time
          </label>
        </div>
      </div>

      <div class="form-group">
        <label>Ends</label>
        <div class="ends-options">
          <label class="radio-inline">
            <input
              type="radio"
              id="repeat-ends-never"
              name="repeat-ends"
              :checked="endsMode === 'never'"
              @change="setEndsMode('never')"
            />
            Never
          </label>
          <label class="radio-inline">
            <input
              type="radio"
              id="repeat-ends-on"
              name="repeat-ends"
              :checked="endsMode === 'on'"
              @change="setEndsMode('on')"
            />
            On
            <input
              type="date"
              class="form-control date-input ends-input"
              id="repeat-ends-on-date"
              :disabled="endsMode !== 'on'"
              :value="endsOnValue"
              @input="update({ endsOn: $event.target.value || null })"
            />
          </label>
          <label class="radio-inline">
            <input
              type="radio"
              id="repeat-ends-after"
              name="repeat-ends"
              :checked="endsMode === 'after'"
              @change="setEndsMode('after')"
            />
            After
            <input
              type="number"
              min="1"
              class="form-control ends-input"
              id="repeat-ends-after-count"
              :disabled="endsMode !== 'after'"
              :value="modelValue.endsAfter || ''"
              @input="update({ endsAfter: parseInt($event.target.value, 10) || null })"
            />
            occurrences
          </label>
        </div>
      </div>

      <p class="repeat-summary" data-test="repeat-summary">
        <span aria-hidden="true">&#9432;</span> {{ summary }}
      </p>

      <p v-if="nonWorkingWarning" class="repeat-warning" data-test="repeat-warning">
        <span aria-hidden="true">&#9888;</span> {{ nonWorkingWarning }}
      </p>
    </div>
  </div>
</template>

<script>
import { describeRecurrence, WEEKDAY_NAMES } from "../utils/recurrence";

// Mirrors controllers/recurrence.js so the UI and the API agree about a rule.
export default {
  name: "RepeatEditor",
  props: {
    // A recurrence rule object, or null for "does not repeat".
    modelValue: { type: Object, default: null },
    // Day names from the user profile, e.g. ['Monday', 'Tuesday'].
    workingDays: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  computed: {
    weekdays() {
      return WEEKDAY_NAMES.map((name, value) => ({
        value,
        name,
        short: name.slice(0, 1),
      }));
    },
    unitLabel() {
      const plural = this.modelValue.interval > 1;
      const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[
        this.modelValue.freq
      ];
      return plural ? `${unit}s` : unit;
    },
    usesLastDay() {
      return (this.modelValue.byMonthDay || []).includes(-1);
    },
    endsMode() {
      if (this.modelValue.endsOn) return "on";
      if (this.modelValue.endsAfter) return "after";
      return "never";
    },
    endsOnValue() {
      if (!this.modelValue.endsOn) return "";
      return String(this.modelValue.endsOn).slice(0, 10);
    },
    unavailableBehavior() {
      return this.modelValue?.unavailableBehavior === "next-available"
        ? "next-available"
        : "skip";
    },
    summary() {
      return describeRecurrence(this.modelValue);
    },
    // Named so the warning reads naturally for one day or several.
    nonWorkingWarning() {
      if (this.modelValue.freq !== "weekly") return null;

      const offenders = (this.modelValue.byWeekday || [])
        .filter((d) => !this.isWorkingDay(d))
        .map((d) => WEEKDAY_NAMES[d]);

      if (offenders.length === 0) return null;

      const list =
        offenders.length === 1
          ? offenders[0]
          : `${offenders.slice(0, -1).join(", ")} and ${offenders[offenders.length - 1]}`;
      const verb = offenders.length === 1 ? "is" : "are";

      const outcome = this.unavailableBehavior === "next-available"
        ? "will be scheduled at a later available time"
        : "will be skipped rather than moved later";
      return `${list} ${verb} not among your working days, so those occurrences ${outcome}. You can change your working days on your profile.`;
    },
  },
  methods: {
    isWorkingDay(dayValue) {
      // No configured days yet: do not cry wolf.
      if (!this.workingDays || this.workingDays.length === 0) return true;
      return this.workingDays.includes(WEEKDAY_NAMES[dayValue]);
    },
    isWeekdaySelected(dayValue) {
      return (this.modelValue.byWeekday || []).includes(dayValue);
    },
    update(changes) {
      this.$emit("update:modelValue", { ...this.modelValue, ...changes });
    },
    onFreqChange(freq) {
      if (!freq) {
        this.$emit("update:modelValue", null);
        return;
      }

      const existing = (this.modelValue && this.modelValue.byWeekday) || [];
      const byWeekday =
        freq === "weekly" && existing.length === 0 ? [this.defaultWeekday()] : existing;

      this.$emit("update:modelValue", {
        freq,
        interval: (this.modelValue && this.modelValue.interval) || 1,
        byWeekday,
        byMonthDay: (this.modelValue && this.modelValue.byMonthDay) || [],
        endsOn: (this.modelValue && this.modelValue.endsOn) || null,
        endsAfter: (this.modelValue && this.modelValue.endsAfter) || null,
        unavailableBehavior: this.unavailableBehavior,
      });
    },
    // Today, unless today is not a working day: defaulting to one would warn about a rule
    // the user has not configured yet.
    defaultWeekday() {
      const today = new Date().getDay();
      if (this.isWorkingDay(today)) return today;

      const firstWorking = this.weekdays.find((d) => this.isWorkingDay(d.value));
      return firstWorking ? firstWorking.value : today;
    },
    toggleWeekday(dayValue) {
      const current = [...(this.modelValue.byWeekday || [])];
      const index = current.indexOf(dayValue);

      if (index >= 0) {
        // Never leave a weekly rule with no days: it would generate nothing.
        if (current.length === 1) return;
        current.splice(index, 1);
      } else {
        current.push(dayValue);
      }

      this.update({ byWeekday: current.sort((a, b) => a - b) });
    },
    setMonthDay(value) {
      const day = parseInt(value, 10);
      this.update({ byMonthDay: day >= 1 && day <= 31 ? [day] : [] });
    },
    toggleLastDay(checked) {
      this.update({ byMonthDay: checked ? [-1] : [] });
    },
    setEndsMode(mode) {
      if (mode === "never") this.update({ endsOn: null, endsAfter: null });
      if (mode === "on") this.update({ endsAfter: null, endsOn: this.endsOnValue || todayIso() });
      if (mode === "after") this.update({ endsOn: null, endsAfter: this.modelValue.endsAfter || 10 });
    },
  },
};

function todayIso() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    ("0" + (d.getMonth() + 1)).slice(-2) +
    "-" +
    ("0" + d.getDate()).slice(-2)
  );
}
</script>

<style scoped>
.repeat-details {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid rgba(255, 255, 255, 0.1);
}

.interval-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.interval-input {
  width: 80px;
}

.interval-unit {
  color: #b0b0c0;
}

.weekday-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.weekday-pill {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.06);
  color: #d0d0d8;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.weekday-pill:hover {
  background: rgba(255, 255, 255, 0.14);
}

.weekday-pill.selected {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: transparent;
  color: #fff;
}

/* Non-working days stay pickable, but say so before you pick them. */
.weekday-pill.non-working {
  border-style: dashed;
  opacity: 0.55;
}

.monthday-row,
.availability-options,
.ends-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monthday-row {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.monthday-input {
  width: 90px;
}

.radio-inline,
.checkbox-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #d0d0d8;
}

.ends-input {
  width: 150px;
}

.repeat-summary {
  margin: 10px 0 0;
  font-size: 13px;
  color: #9fb4e8;
}

.repeat-warning {
  margin: 6px 0 0;
  font-size: 13px;
  color: #fcd34d;
}

.date-input {
  color-scheme: dark;
}
</style>
