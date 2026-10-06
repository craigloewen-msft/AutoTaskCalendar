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
/* Match the app's dark form controls. */
.dp__theme_dark {
  --dp-background-color: #1f2937;
  --dp-text-color: #e5e7eb;
  --dp-hover-color: #374151;
  --dp-primary-color: #3b82f6;
  --dp-border-color: #374151;
  --dp-menu-border-color: #374151;
}
</style>
