<template>
  <VueDatePicker
    :model-value="modelValue || null"
    model-type="yyyy-MM-dd"
    :time-config="{ enableTimePicker: false }"
    :formats="{ input: 'dd MMM yyyy' }"
    :auto-apply="true"
    :text-input="{ format: ['dd MMM yyyy', 'yyyy-MM-dd'] }"
    :dark="true"
    :disabled="disabled"
    :min-date="minDate || undefined"
    :max-date="maxDate || undefined"
    teleport="body"
    :ui="{ input: 'form-control date-input' }"
    :input-attrs="{ id, required, clearable: !required }"
    @update:model-value="onUpdate"
  />
</template>

<script>
import { VueDatePicker } from "@vuepic/vue-datepicker";
import "@vuepic/vue-datepicker/dist/main.css";

// The one date picker used by every date field in the app. Values stay plain
// YYYY-MM-DD civil-date strings, exactly what the API exchanges.
export default {
  name: "DateField",
  components: { VueDatePicker },
  props: {
    modelValue: { type: String, default: "" },
    id: { type: String, default: undefined },
    minDate: { type: String, default: "" },
    maxDate: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    required: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  methods: {
    onUpdate(value) {
      this.$emit("update:modelValue", value || "");
    },
  },
};
</script>

<style>
/* The one date picker, themed from the app's tokens. The menu is teleported to
   <body>, so these must be global and keyed on .dp--theme-dark (the class this
   version of vue-datepicker actually emits). See docs/DESIGN_SYSTEM.md. */
.dp--theme-dark {
  --dp-background-color: var(--surface-2);
  --dp-text-color: var(--text-primary);
  --dp-hover-color: var(--surface-3);
  --dp-hover-text-color: var(--text-primary);
  --dp-primary-color: var(--accent);
  --dp-primary-text-color: #fff;
  --dp-secondary-color: var(--text-muted);
  --dp-border-color: var(--border);
  --dp-menu-border-color: var(--border);
  --dp-border-color-hover: var(--border-strong);
  --dp-icon-color: var(--text-muted);
  --dp-disabled-color: var(--surface-1);
  --dp-scroll-bar-background: var(--surface-1);
  --dp-scroll-bar-color: var(--border-strong);
  --dp-border-radius: var(--radius-sm);
}

.dp--menu {
  box-shadow: var(--elev-3);
}
</style>
