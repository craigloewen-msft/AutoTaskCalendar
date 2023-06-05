<template>
  <div>
    <b-modal
      id="task-modal"
      ref="addtaskmodal"
      @ok="resolveTaskModal"
      :title="this.selectedTask ? 'Edit Task' : 'Add Task'"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-body">
            <div v-if="input.error">{{ input.error }}</div>
            <form ref="form" @submit.stop.prevent="handleSubmit">
              <div class="form-group">
                <label for="task-title">Task Title</label>
                <input
                  type="text"
                  v-model="input.taskTitle"
                  class="form-control"
                  id="task-title"
                  placeholder="Enter task title"
                />
              </div>
              <div class="form-group">
                <label for="task-due-date">Due Date</label>
                <b-calendar
                  v-model="input.taskDueDate"
                  class="mb-2"
                ></b-calendar>
              </div>
              <div class="form-group">
                <label for="task-duration">Duration</label>
                <input
                  type="number"
                  v-model="input.taskDuration"
                  class="form-control"
                  id="task-duration"
                />
              </div>
              <div class="form-group">
                <b-form-checkbox
                  type="number"
                  v-model="input.taskBreakUpTask"
                  class="form-control"
                  id="task-break-up-task"
                  >Break Up Task Into Chunks</b-form-checkbox
                >
              </div>
              <div v-if="input.taskBreakUpTask" class="form-group">
                <label for="task-break-up-task-chunk-duration"
                  >Chunk Duration</label
                >
                <input
                  type="number"
                  v-model="input.taskBreakUpTaskChunkDuration"
                  class="form-control"
                  id="task-break-up-task-chunk-duration"
                />
              </div>
              <div class="form-group">
                <label for="task-start-date">Start Date</label>
                <b-form-datepicker
                  v-model="input.taskStartDate"
                  class="mb-2"
                ></b-form-datepicker>
              </div>
              <div class="form-group">
                <label for="task-notes">Notes</label>
                <input
                  type="text"
                  v-model="input.taskNotes"
                  class="form-control"
                  id="task-notes"
                  placeholder="Enter task notes"
                />
              </div>
              <div class="form-group">
                <label for="task-project">Project</label>
                <div class="d-flex align-items-center">
                  <span v-if="input.selectedProject" style="margin-right: 10px;">
                    {{ input.selectedProject.name }}</span
                  >
                  <b-dropdown id="task-project" v-model="input.selectedProject">
                    <b-dropdown-item
                      v-for="project in projectList"
                      :key="project._id"
                      :value="project"
                      @click="input.selectedProject = project"
                    >
                      {{ project.name }}
                    </b-dropdown-item>
                    <b-dropdown-item
                      :value="noneProject"
                      @click="input.selectedProject = noneProject"
                      >{{ noneProject.name }}</b-dropdown-item
                    >
                    <b-dropdown-item
                      @click="$refs.addProjectModal.openAddProjectModal()"
                    >
                      Add new...
                    </b-dropdown-item>
                  </b-dropdown>
                </div>
              </div>
              <div v-if="this.selectedTask">
                <button
                  class="btn btn-primary"
                  v-on:click="completeTask(selectedTask._id)"
                >
                  Complete
                </button>
                <button
                  class="btn btn-danger"
                  v-on:click="deleteTask(selectedTask._id)"
                >
                  Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </b-modal>
    <AddProjectModal
      :projectList="projectList"
      ref="addProjectModal"
      @refreshProjectList="refreshProjectList"
    />
  </div>
</template>

<script>
import { helperFunctions } from "../js/helperFunctions.js";
import AddProjectModal from "./AddProjectModal.vue";

export default {
  name: "AddTaskModal",
  components: {
    AddProjectModal,
  },
  data: function () {
    return {
      input: {
        taskTitle: "",
        taskDueDate: "",
        taskDuration: "",
        taskBreakUpTask: false,
        taskBreakUpTaskChunkDuration: "",
        taskStartDate: "",
        taskNotes: "",
        selectedProject: null,
        error: "",
      },
      selectedTask: null,
      noneProject: { name: "None", _id: null },
    };
  },
  props: {
    taskList: {
      type: Array,
      required: false,
    },
    projectList: {
      type: Array,
      required: false,
    },
  },
  methods: {
    openAddTaskModal() {
      this.selectedTask = null;

      // Make all of this.input null
      Object.keys(this.input).forEach((i) => (this.input[i] = null));
      this.$bvModal.show("task-modal");
    },
    openEditTaskModal(inputTask) {
      this.selectedTask = inputTask;

      // Make all this.input be that of the task's
      this.input.taskTitle = inputTask.title;
      this.input.taskDueDate = helperFunctions.changeDateToShortCalendarFormat(
        new Date(inputTask.dueDate)
      );
      this.input.taskDuration = inputTask.duration;
      this.input.taskStartDate =
        helperFunctions.changeDateToShortCalendarFormat(
          new Date(inputTask.startDate)
        );
      this.input.taskNotes = inputTask.notes;
      this.input.taskBreakUpTask = inputTask.breakUpTask;
      this.input.taskBreakUpTaskChunkDuration =
        inputTask.breakUpTaskChunkDuration;
      // Get the project from the project list
      this.input.selectedProject = this.projectList.find(
        (project) => project._id == inputTask.projectRef
      );
      // If the project is null, then set it to noneProject
      if (!this.input.selectedProject) {
        this.input.selectedProject = this.noneProject;
      }

      this.$bvModal.show("task-modal");
    },
    openEditTaskModalById(inTaskId) {
      // Find the task with the right Id
      let foundTask = this.taskList.find((object) => object._id == inTaskId);
      this.openEditTaskModal(foundTask);
    },
    resolveTaskModal(bvModalEvent) {
      if (this.selectedTask) {
        this.editTask(bvModalEvent);
      } else {
        this.addTask(bvModalEvent);
      }
    },
    async addTask(bvModalEvent) {
      // Prevent modal from closing
      bvModalEvent.preventDefault();

      this.input.error = "";

      if (!this.input.taskTitle) {
        this.input.error = "Need task title";
      } else if (!this.input.taskDueDate) {
        this.input.error = "Need task due date";
      } else if (!this.input.taskDuration) {
        this.input.error = "Need duration";
      }

      if (this.input.error) {
        return;
      }

      this.$nextTick(() => {
        this.$refs.addtaskmodal.hide();
      });

      // this.input.taskDueDate comes in format '2023-03-01', convert that to start of the day in this timezone
      let inputDueDate = helperFunctions.changeShortCalendarFormatToDate(
        this.input.taskDueDate
      );

      // Do same for startDate
      let inputStartDate = helperFunctions.changeShortCalendarFormatToDate(
        this.input.taskStartDate ||
          helperFunctions.changeDateToShortCalendarFormat(new Date())
      );

      // Make taskDueDate at the end of the day by adding 23 hours, 59 minutes, 59 seconds
      inputDueDate = new Date(
        new Date(inputDueDate).getTime() + 86399000
      ).toISOString();

      try {
        const response = await this.$http.post("/api/createTask/", {
          title: this.input.taskTitle,
          dueDate: inputDueDate,
          duration: this.input.taskDuration,
          startDate: inputStartDate,
          notes: this.input.taskNotes,
          breakUpTask: this.input.taskBreakUpTask,
          breakUpTaskChunkDuration: this.input.taskBreakUpTaskChunkDuration,
        });
        this.$emit("refreshTaskList", response.data.taskList);

        Object.keys(this.input).forEach((i) => (this.input[i] = null));
      } catch (error) {
        console.error(error);
      }
    },
    async editTask(bvModalEvent) {
      bvModalEvent.preventDefault();

      // Set all of the input to the current task
      this.selectedTask.title = this.input.taskTitle;
      this.selectedTask.dueDate =
        helperFunctions.changeShortCalendarFormatToDate(this.input.taskDueDate);
      this.selectedTask.duration = this.input.taskDuration;
      this.selectedTask.notes = this.input.taskNotes;
      this.selectedTask.startDate =
        helperFunctions.changeShortCalendarFormatToDate(
          this.input.taskStartDate
        );
      this.selectedTask.breakUpTask = this.input.taskBreakUpTask;
      this.selectedTask.breakUpTaskChunkDuration =
        this.input.taskBreakUpTaskChunkDuration;
      this.$set(
        this.selectedTask,
        "projectRef",
        this.input.selectedProject._id
      );

      try {
        const response = await this.$http.post("/api/editTask/", {
          task: this.selectedTask,
        });
        this.$nextTick(() => {
          this.$refs.addtaskmodal.hide();
        });
      } catch (error) {
        console.error(error);
      }
    },
    async deleteTask(taskId) {
      try {
        const response = await this.$http.post(`/api/deleteTask`, { taskId });
        // refresh task list after deletion
        this.$emit("refreshTaskList", response.data.taskList);
        this.$bvModal.hide("task-modal");
      } catch (error) {
        console.error(error);
      }
    },
    async completeTask(taskId) {
      try {
        const response = await this.$http.post(`/api/completeTask`, { taskId });
        // refresh task list after deletion
        this.$emit("refreshTaskList", response.data.taskList);
        this.$bvModal.hide("task-modal");
      } catch (error) {
        console.error(error);
      }
    },
    async openEditProjectModal(project) {
      this.$refs.addProjectModal.openEditProjectModal(project);
    },
    async openAddProjectModal() {
      this.$refs.addProjectModal.openAddProjectModal();
    },
    async refreshProjectList(newProjectList) {
      this.$emit("refreshProjectList", newProjectList);
    },
    handleSubmit() {
      // DO nothing on general modal submit
      return null;
    },
  },
};
</script>

<style>
</style>