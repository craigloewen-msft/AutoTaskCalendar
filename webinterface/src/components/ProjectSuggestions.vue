<template>
  <div
    v-if="options.length"
    class="project-suggestions"
    data-test="project-recommendation"
    role="status"
  >
    <span><strong>Suggested:</strong></span>
    <button
      v-for="option in options"
      :key="option.projectId"
      class="btn btn-sm btn-outline-primary"
      data-test="project-recommendation-option"
      type="button"
      :title="`Use ${option.label}`"
      :aria-label="`Use ${option.label}`"
      @click="choose(option)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script>
// Debounce so a recommendation follows a pause in typing, not every keystroke.
const REQUEST_DELAY_MS = 1000;
const MIN_TITLE_LENGTH = 2;

/**
 * The shared "Suggested:" row for every task-creation form.
 *
 * It owns the debounce, request cancellation, and stale-response handling so each
 * creation surface only supplies the draft text and applies the chosen project.
 */
export default {
  name: "ProjectSuggestions",
  props: {
    title: { type: String, default: "" },
    notes: { type: String, default: "" },
    projectGroups: { type: Array, default: () => [] },
    // False once the user has chosen a project, or when the form cannot use suggestions.
    active: { type: Boolean, default: false },
  },
  emits: ["select"],
  data() {
    return { suggestions: [], timer: null, request: 0 };
  },
  computed: {
    options() {
      if (!this.active) return [];
      // Drop anything this form's picker cannot show; the label is the visible Compass path.
      return this.suggestions.reduce((options, suggestion) => {
        for (const group of this.projectGroups) {
          const project = group.projects.find(({ _id }) => _id === suggestion.projectId);
          if (project) {
            options.push({
              projectId: suggestion.projectId,
              label: `${group.label} → ${project.title}`,
            });
            break;
          }
        }
        return options;
      }, []);
    },
  },
  watch: {
    title() {
      this.schedule();
    },
    notes() {
      this.schedule();
    },
    active() {
      this.schedule();
    },
    projectGroups(next, previous) {
      if (next.length && !previous.length) this.schedule();
    },
  },
  beforeUnmount() {
    this.cancel();
  },
  methods: {
    cancel() {
      clearTimeout(this.timer);
      // Bumping the request id makes any in-flight response stale.
      this.request++;
      this.suggestions = [];
    },
    schedule() {
      this.cancel();
      if (!this.active || this.title.trim().length < MIN_TITLE_LENGTH) return;
      this.timer = setTimeout(() => this.load(), REQUEST_DELAY_MS);
    },
    async load() {
      const request = this.request;
      const title = this.title.trim();
      const candidateProjectIds = this.projectGroups.flatMap((group) => {
        return group.projects.map((project) => project._id);
      });
      if (!title || !candidateProjectIds.length) return;

      try {
        const response = await this.$http.post("/api/recommendTaskProject", {
          title,
          notes: this.notes,
          candidateProjectIds,
        });
        if (request !== this.request) return;
        this.suggestions = response.data.success
          ? response.data.recommendations.filter((suggestion) => suggestion?.projectId)
          : [];
      } catch (error) {
        // Suggestions are optional; the form keeps its ordinary project selector.
        if (request === this.request) this.suggestions = [];
      }
    },
    choose(option) {
      this.cancel();
      this.$emit("select", option.projectId);
    },
  },
};
</script>

<style scoped>
.project-suggestions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid rgba(102, 126, 234, 0.42);
  border-radius: 8px;
  background: rgba(102, 126, 234, 0.1);
  color: #d7dde4;
  font-size: 0.86rem;
}
.project-suggestions span {
  min-width: 0;
}
.project-suggestions button {
  flex: 0 0 auto;
}
</style>
