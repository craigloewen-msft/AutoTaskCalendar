<template>
  <div id="app">
    <BNavbar toggleable="lg" variant="dark">
      <BContainer>
        <router-link class="navbar-brand" to="/">AutoTaskCalendar</router-link>

        <BNavbarToggle target="nav-collapse"></BNavbarToggle>

        <BCollapse id="nav-collapse" is-nav>
          <BNavbarNav>
            <!--- Left-aligned navigation items --->
            <Bootstrapnavlinkcustom v-if="isLoggedIn" to="/calendar">Calendar</Bootstrapnavlinkcustom>
            <Bootstrapnavlinkcustom to="/about">About</Bootstrapnavlinkcustom>
          </BNavbarNav>
          <BNavbarNav
            class="ms-auto"
            is-nav
          >
            <!--- Right-aligned navigation items --->
            <template v-if="isLoggedIn">
              <Bootstrapnavlinkcustom :to="'/user/' + user.username">{{
                user.username
              }}</Bootstrapnavlinkcustom>
              <Bootstrapnavlinkcustom to="/logout">Logout</Bootstrapnavlinkcustom>
            </template>
            <template v-else>
              <Bootstrapnavlinkcustom to="/login">Login</Bootstrapnavlinkcustom>
              <Bootstrapnavlinkcustom to="/register">Register</Bootstrapnavlinkcustom>
            </template>
          </BNavbarNav>
        </BCollapse>
      </BContainer>
    </BNavbar>

    <router-view />
  </div>
</template>

<script>
import Bootstrapnavlinkcustom from "./components/BootstrapNavlinkCustom.vue";
import { BNavbar, BNavbarToggle, BCollapse, BNavbarNav, BContainer } from 'bootstrap-vue-next';
import { useHead } from '@vueuse/head';

export default {
  name: "App",
  components: {
    Bootstrapnavlinkcustom,
    BNavbar,
    BNavbarToggle,
    BCollapse,
    BNavbarNav,
    BContainer
  },
  setup() {
    useHead({
      meta: [
        {
          name: "description",
          content:
            "Easily manage your Github issues using this tool. This is a great way to never lose track of a Github issue again.",
        },
        { name: "keywords", content: "manage, github, issues" },
      ],
    });
  },
  computed: {
    isLoggedIn: function () {
      return this.$store.getters.isLoggedIn;
    },
    user: function () {
      return this.$store.state.user;
    },
  },
  created: function () {
    // Handle expired tokens case
    const storeRef = this.$store;
    const routerRef = this.$router;
    this.$http.defaults.headers.common["Authorization"] =
      this.$store.state.token;

    var errorResponseFunc = function (err) {
      var returnPromiseFunc = function (storeRef, routerRef) {
        return new Promise(function (resolve, reject) {
          if (err.response.status === 401) {
            storeRef.dispatch("logout");
            routerRef.push("/");
          }
        });
      };

      return returnPromiseFunc(storeRef, routerRef);
    };

    this.$http.interceptors.response.use(
      undefined,
      errorResponseFunc.bind(this)
    );
  },
  metaInfo: {
    title: "AutoTaskCalendar - Intelligent Task Scheduling & Management",
    titleTemplate: "%s | AutoTaskCalendar",
    meta: [
      {
        name: "description",
        content:
          "AutoTaskCalendar automatically schedules your tasks into your calendar. Smart task management with Google Calendar integration, automatic scheduling, and intelligent planning for optimal productivity.",
      },
      { 
        name: "keywords", 
        content: "task management, calendar, auto schedule, productivity, task scheduler, Google Calendar, time management, task planner, automatic scheduling, work organization" 
      },
      { name: "author", content: "AutoTaskCalendar" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { charset: "utf-8" },
      // Open Graph / Facebook
      { property: "og:type", content: "website" },
      { property: "og:title", content: "AutoTaskCalendar - Intelligent Task Scheduling & Management" },
      { 
        property: "og:description", 
        content: "Automatically schedule your tasks into your calendar with smart planning and Google Calendar integration." 
      },
      { property: "og:site_name", content: "AutoTaskCalendar" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AutoTaskCalendar - Intelligent Task Scheduling & Management" },
      { 
        name: "twitter:description", 
        content: "Automatically schedule your tasks into your calendar with smart planning and Google Calendar integration." 
      },
      // Additional SEO
      { name: "robots", content: "index, follow" },
      { name: "googlebot", content: "index, follow" },
      { name: "theme-color", content: "#667eea" },
    ],
    link: [
      { rel: "canonical", href: "https://autotaskcalendar.com" }
    ]
  },
};
</script>


<style>
@import "./style/controlButtons.scss";

#app {
  /* font-family: "Nunito", sans-serif; */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
}

/* Enhanced navbar styling */
.navbar {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  background: rgba(33, 37, 41, 0.95) !important;
}

.navbar-brand {
  font-weight: 700;
  font-size: 1.5rem;
  color: #764ba2;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Nav link styling for dark navbar */
.navbar .nav-link {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
  transition: color 0.3s ease;
}

.navbar .nav-link:hover {
  color: rgba(255, 255, 255, 1);
}

.navbar .nav-link.router-link-active {
  color: #667eea;
}

/* Enhanced button styling */
.btn {
  border-radius: 8px;
  font-weight: 500;
  padding: 8px 16px;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.btn-primary:hover {
  background: linear-gradient(135deg, #5568d3 0%, #6a3f8f 100%);
}

.btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: none;
}

.btn-info {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
}

.btn-outline-primary {
  border: 2px solid #667eea;
  color: #667eea;
  background: transparent;
}

.btn-outline-primary:hover {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

/* Enhanced form styling */
.form-control {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
  padding: 10px 14px;
  transition: all 0.3s ease;
}

.form-control:focus {
  border-color: #667eea;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
  color: #e0e0e0;
}

.form-group label {
  font-weight: 500;
  color: #d0d0d0;
  margin-bottom: 8px;
}

/* Modal enhancements */
.modal-content {
  border-radius: 12px;
  background: rgba(30, 30, 35, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}

.modal-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
}

.modal-title {
  font-weight: 600;
  color: #e0e0e0;
}

.modal-body {
  padding: 24px;
}

.modal-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
}

a {
  color: #c9d1d9;
}

a:hover {
  color: #58a6ff;
}

body {
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.pageContent {
  margin-top: 20px;
}

.topNavigateBackContainer {
  display: flex;
  margin-bottom: 5px;
}

.footer {
  margin-top: auto;
  bottom: 0;
  width: 100%;
  height: 60px;
  line-height: 60px;
  background-color: #212529;
}

.img-responsive {
  display: block;
  width: 100%;
  height: auto;
}

.centered-info-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 15px;
}

.max-width-form {
  max-width: 400px;
}

.buttonSelect {
  display: flex;
  justify-content: center;
}

.buttonSelect a {
  margin-left: 5px;
  margin-right: 5px;
}

.buttonSelect button {
  margin-left: 5px;
  margin-right: 5px;
}

.Link--primary:hover {
  color: #58a6ff !important;
}

.Link--muted:hover {
  color: #58a6ff !important;
}

.custom-tag-box {
  margin-left: 2px;
  background-color: #454749;
  border-radius: 2em;
  padding: 0 7px;
  font-size: 14px;
  display: inline-block;
  text-decoration: none;
}

.custom-tag-collection {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.custom-tag-box a:hover {
  font-weight: 900;
  color: #58a6ff;
}

.custom-tag-box a {
  text-decoration: none;
}

.small-input-form-box {
  width: 100px;
}

.issues-container {
  text-align: left;
}

.page-header {
  display: flex;
  justify-content: space-between;
}

.user-form-box {
  max-width: 450px !important;
}

.btn-block {
  width: 100%;
}

@keyframes placeholderColorChanges {
  0% {
    background: rgb(200, 200, 200);
  }
  100% {
    background: rgb(50, 50, 50);
  }
}

.placeholder {
  animation-name: placeholderColorChanges;
  animation-duration: 5s;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  height: 20px;
}

.footer-box-right {
  text-align: right;
}
</style>
