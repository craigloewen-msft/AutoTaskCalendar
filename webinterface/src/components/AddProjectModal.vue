<template>
  <b-modal
    id="project-modal"
    ref="addprojectmodal"
    @ok="resolveProjectModal"
    :title="this.selectedProject ? 'Edit Project' : 'Add Project'"
  >
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-body">
          <div v-if="input.error">{{ input.error }}</div>
          <form ref="form" @submit.stop.prevent="handleSubmit">
            <div class="form-group">
              <label for="project-name">Project Name</label>
              <input
                type="text"
                v-model="input.projectName"
                class="form-control"
                id="project-name"
                placeholder="Enter Project Name"
              />
            </div>
            <div v-if="this.selectedProject">
              <button
                class="btn btn-danger"
                v-on:click="deleteProject(selectedProject._id)"
              >
                Delete
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </b-modal>
</template>

<script>
import { helperFunctions } from "../js/helperFunctions.js";

export default {
  name: "AddProjectModal",
  data: function () {
    return {
      input: {
        projectName: "",
        error: "",
      },
      selectedProject: null,
    };
  },
  props: {
    projectList: {
      type: Array,
      required: false,
    },
  },
  methods: {
    openAddProjectModal() {
      this.selectedProject = null;

      // Make all of this.input null
      Object.keys(this.input).forEach((i) => (this.input[i] = null));
      this.$bvModal.show("project-modal");
    },
    openEditProjectModal(inputProject) {
      if (inputProject._id != null) {
        this.selectedProject = inputProject;

        // Make all this.input be that of the project's
        this.input.projectName = inputProject.name;

        this.$bvModal.show("project-modal");
      }
    },
    openEditProjectModalById(inProjectId) {
      // Find the project with the right Id
      let foundProject = this.projectList.find(
        (object) => object._id == inProjectId
      );
      this.openEditProjectModal(foundProject);
    },
    resolveProjectModal(bvModalEvent) {
      if (this.selectedProject) {
        this.editProject(bvModalEvent);
      } else {
        this.addProject(bvModalEvent);
      }
    },
    async addProject(bvModalEvent) {
      // Prevent modal from closing
      bvModalEvent.preventDefault();

      this.input.error = "";

      if (!this.input.projectName) {
        this.input.error = "Need project name";
      }

      if (this.input.error) {
        return;
      }

      this.$nextTick(() => {
        this.$refs.addprojectmodal.hide();
      });

      try {
        const response = await this.$http.post("/api/createProject/", {
          name: this.input.projectName,
        });
        this.$emit("refreshProjectList", response.data.projectList);

        Object.keys(this.input).forEach((i) => (this.input[i] = null));
      } catch (error) {
        console.error(error);
      }
    },
    async editProject(bvModalEvent) {
      bvModalEvent.preventDefault();

      // Set the name of the project to the input value
      this.selectedProject.name = this.input.projectName;

      try {
        const response = await this.$http.post("/api/editProject/", {
          project: this.selectedProject,
        });
        // Refresh project list after edit on success
        if (response.data.success) {
          // Change the project name in the project list
          let foundProject = this.projectList.find(
            (object) => object._id == this.selectedProject._id
          );
          foundProject.name = this.selectedProject.name;
        } else {
          console.error(response.data.error);
        }
        this.$nextTick(() => {
          this.$refs.addprojectmodal.hide();
        });
      } catch (error) {
        console.error(error);
      }
    },
    async deleteProject(projectId) {
      try {
        const response = await this.$http.post(`/api/deleteProject`, {
          projectId,
        });
        // refresh project list after deletion
        this.$emit("refreshProjectList", response.data.projectList);
        this.$bvModal.hide("project-modal");
      } catch (error) {
        console.error(error);
      }
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