<template>
  <!-- One remembered All/Work/Personal choice, shared by Compass and Weekly Plan. -->
  <div class="context-filter" role="radiogroup" aria-label="Context" data-test="context-filter">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      role="radio"
      class="context-option"
      :class="{ active: option.id === modelValue }"
      :aria-checked="option.id === modelValue"
      :data-test="'context-filter-' + option.id"
      @click="select(option.id)"
    >
      <span v-if="option.icon" aria-hidden="true">{{ option.icon }}</span>
      {{ option.label }}
    </button>
  </div>
</template>

<script>
import { CONTEXT_FILTERS, writeContextFilter } from "../utils/roleContext";

export default {
  name: "ContextFilter",
  props: {
    modelValue: { type: String, default: "all" },
  },
  emits: ["update:modelValue"],
  data() {
    return { options: CONTEXT_FILTERS };
  },
  methods: {
    select(id) {
      if (id === this.modelValue) return;
      writeContextFilter(id);
      this.$emit("update:modelValue", id);
    },
  },
};
</script>

<style scoped>
.context-filter {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
}

.context-option {
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  font-size: 0.85rem;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.context-option:hover {
  opacity: 1;
}

.context-option.active {
  background: rgba(102, 126, 234, 0.35);
  opacity: 1;
}
</style>
