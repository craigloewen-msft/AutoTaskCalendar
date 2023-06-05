<template>
  <div>
    <h1>Manage Tasks</h1>
    <b-button v-on:click="$refs.addTaskModal.openAddTaskModal()" style="margin-right: 10px;"
      >Add Task</b-button
    >
    <b-button v-on:click="$refs.addTaskModal.openAddProjectModal()"
      >Add Project</b-button
    >
    <p>Here you can manage your tasks.</p>
    <div v-if="!loading">
      <div v-for="project in combinedProjectList" :key="project._id">
        <h2 v-on:click="$refs.addTaskModal.openEditProjectModal(project)">
          {{ project.name }}
        </h2>
        <ul>
          <li
            v-for="task in project.taskList"
            :key="task._id"
            v-on:click="$refs.addTaskModal.openEditTaskModal(task)"
          >
            {{ task.title }}
          </li>
        </ul>
      </div>
    </div>
    <div v-else>
      <b-card>
        <b-skeleton width="85%"></b-skeleton>
        <b-skeleton width="55%"></b-skeleton>
        <b-skeleton width="70%"></b-skeleton>
      </b-card>
    </div>

    <AddTaskModal
      :taskList="taskList"
      :projectList="projectList"
      ref="addTaskModal"
      @refreshProjectList="refreshProjectList"
    />
  </div>
</template>

<script>
import AddTaskModal from "../components/AddTaskModal.vue";

export default {
  name: "ManageTasks",
  components: {
    AddTaskModal,
  },
  data: function () {
    return {
      taskList: [],
      projectList: [],
      loading: true,
    };
  },
  computed: {
    combinedProjectList() {
      const projectMap = new Map();
      projectMap.set("unassigned", {
        _id: null,
        name: "Unassigned Projects",
        taskList: [],
      });
      for (const project of this.projectList) {
        projectMap.set(project._id, { ...project, taskList: [] });
      }
      for (const task of this.taskList) {
        const project =
          projectMap.get(task.projectRef) || projectMap.get("unassigned");
        project.taskList.push(task);
      }
      let returnArray = Array.from(projectMap.values());
      // Put unassigned projects at the end
      returnArray.sort((a, b) => {
        if (a._id === null) {
          return 1;
        } else if (b._id === null) {
          return -1;
        } else {
          return 0;
        }
      });
      return returnArray;
    },
  },
  methods: {
    async loadTasks() {
      const taskDataResponse = await this.$http.get("/api/getUserTasks/");
      this.taskList = taskDataResponse.data.taskList;
      if (!taskDataResponse.data.success) {
        console.error("Task retrieval error");
      }
    },
    async loadProjects() {
      const projectDataResponse = await this.$http.get("/api/getUserProjects/");
      this.projectList = projectDataResponse.data.projectList;
      if (!projectDataResponse.data.success) {
        console.error("Task retrieval error");
      }
    },
    async loadData() {
      // Wait for these two tasks
      let loadTasks = this.loadTasks();
      let loadProjects = this.loadProjects();
      await Promise.all([loadTasks, loadProjects]);
      this.loading = false;
    },
    refreshProjectList(inputList) {
      this.projectList = inputList;
    },
  },

  mounted: function () {
    this.loadData();
  },
};
</script>

<style>
</style>