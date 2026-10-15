<template>
  <!-- Decorative by default: the adjacent heading already carries the meaning. -->
  <svg
    class="feature-icon-svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>

<script>
// One small, consistent line-icon set, drawn on a 24x24 grid and inheriting currentColor.
// Keeps the marketing pages free of emoji and of an icon-font dependency.
const ICONS = {
  calendar: [
    'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
    'M4 9h16',
    'M8 4V2',
    'M16 4V2',
  ],
  bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  repeat: [
    'M17 2l3 3-3 3',
    'M4 11V9a4 4 0 0 1 4-4h12',
    'M7 22l-3-3 3-3',
    'M20 13v2a4 4 0 0 1-4 4H4',
  ],
  link: [
    'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1',
    'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  ],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M15.5 8.5l-2 5-5 2 2-5z'],
  scales: [
    'M12 3v18',
    'M7 21h10',
    'M5 7h14',
    'M5 7l-2.5 5a3 3 0 0 0 5 0z',
    'M19 7l2.5 5a3 3 0 0 1-5 0z',
  ],
  layers: ['M12 3 3 8l9 5 9-5z', 'M3 13l9 5 9-5', 'M3 18l9 5 9-5'],
  shield: ['M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z'],
  check: ['M20 6 9 17l-5-5'],
};

export default {
  name: 'FeatureIcon',
  props: {
    name: { type: String, required: true },
    size: { type: [Number, String], default: 24 },
    // Set only when the icon is the sole carrier of meaning.
    label: { type: String, default: '' },
  },
  computed: {
    paths() {
      return ICONS[this.name] || [];
    },
  },
};
</script>

<style scoped>
.feature-icon-svg {
  display: block;
  flex-shrink: 0;
}
</style>
