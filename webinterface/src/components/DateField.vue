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
/* Match the app's dark form controls; :root raises specificity over the library's sheet. */
:root .dp--theme-dark {
  --dp-background-color: var(--atc-surface);
  --dp-text-color: var(--atc-text);
  --dp-hover-color: var(--atc-surface-3);
  --dp-hover-text-color: var(--atc-text);
  --dp-primary-color: var(--atc-accent);
  --dp-primary-text-color: #fff;
  --dp-border-color: rgba(255, 255, 255, 0.1);
  --dp-border-color-hover: rgba(255, 255, 255, 0.18);
  --dp-border-color-focus: var(--atc-accent);
  --dp-highlight-color: var(--atc-accent-soft);
  --dp-scroll-bar-background: var(--atc-surface);
  --dp-scroll-bar-color: var(--atc-surface-3);
  --dp-menu-border-color: var(--atc-border-strong);
  --dp-secondary-color: var(--atc-text-subtle);
  --dp-icon-color: var(--atc-text-muted);
  --dp-border-radius: var(--atc-radius-sm);
  --dp-font-family: var(--atc-font);
}
</style>
