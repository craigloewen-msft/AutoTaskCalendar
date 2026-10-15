<template>
  <div id="app">
    <BNavbar toggleable="lg" variant="dark" class="atc-navbar">
      <router-link class="navbar-brand" to="/">
        <span class="brand-mark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M6 10l1.5 1.5L10.5 8.5"/></svg>
        </span>
        AutoTaskCalendar
      </router-link>

      <BNavbarToggle target="nav-collapse"></BNavbarToggle>

      <BCollapse id="nav-collapse" is-nav>
        <BNavbarNav>
          <!--- Left-aligned navigation items --->
          <Bootstrapnavlinkcustom v-if="isLoggedIn" to="/calendar">Calendar</Bootstrapnavlinkcustom>
          <Bootstrapnavlinkcustom v-if="isLoggedIn" to="/weekly-plan">Weekly Plan</Bootstrapnavlinkcustom>
          <Bootstrapnavlinkcustom v-if="isLoggedIn" to="/compass">Compass</Bootstrapnavlinkcustom>
          <Bootstrapnavlinkcustom v-if="isAdmin" to="/admin">Admin</Bootstrapnavlinkcustom>
          <Bootstrapnavlinkcustom to="/about">About</Bootstrapnavlinkcustom>
        </BNavbarNav>
        <BNavbarNav class="ms-auto">
          <!--- Right-aligned navigation items --->
          <template v-if="isLoggedIn">
            <Bootstrapnavlinkcustom class="nav-user-link" :to="'/user/' + user.username">
              <span class="nav-avatar" aria-hidden="true">{{ user.username.charAt(0) }}</span>{{ user.username }}
            </Bootstrapnavlinkcustom>
            <Bootstrapnavlinkcustom to="/logout">Logout</Bootstrapnavlinkcustom>
          </template>
          <template v-else>
            <Bootstrapnavlinkcustom to="/login">Login</Bootstrapnavlinkcustom>
            <Bootstrapnavlinkcustom to="/register">Register</Bootstrapnavlinkcustom>
          </template>
        </BNavbarNav>
      </BCollapse>
    </BNavbar>

    <router-view />
  </div>
</template>

<script>
import Bootstrapnavlinkcustom from "./components/BootstrapNavlinkCustom.vue";
import { BNavbar, BNavbarToggle, BCollapse, BNavbarNav } from 'bootstrap-vue-next';
import { useHead } from '@vueuse/head';

export default {
  name: "App",
  components: {
    Bootstrapnavlinkcustom,
    BNavbar,
    BNavbarToggle,
    BCollapse,
    BNavbarNav
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
    isAdmin: function () {
      return this.$store.getters.isAdmin;
    },
    user: function () {
      return this.$store.state.user;
    },
  },
  created: function () {
    const storeRef = this.$store;
    const routerRef = this.$router;

    this.$http.interceptors.response.use(undefined, async function (error) {
      if (error.response?.status === 401) {
        await storeRef.dispatch('clearSession');
        if (routerRef.currentRoute.value.meta.requiresAuth) {
          await routerRef.push('/login');
        }
      }
      return Promise.reject(error);
    });
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
/* App shell: sticky translucent navbar. Global styles live in style/base.scss. */
.atc-navbar {
  position: sticky;
  top: 0;
  z-index: 1030;
  padding: 10px 20px;
  background: rgba(11, 13, 18, 0.78) !important;
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--atc-border);
  --bs-navbar-color: var(--atc-text-muted);
  --bs-navbar-hover-color: var(--atc-text);
  --bs-navbar-active-color: var(--atc-text);
  --bs-navbar-brand-color: var(--atc-text);
  --bs-navbar-brand-hover-color: #fff;
}

.atc-navbar .navbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
  font-size: 1.05rem;
  letter-spacing: -0.01em;
  color: var(--atc-text);
  margin-right: 24px;
}

.atc-navbar .navbar-brand:hover {
  color: #fff;
}

.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--atc-accent);
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 0 1px rgba(99, 102, 241, 0.5);
}

.atc-navbar .navbar-nav {
  gap: 2px;
}

.atc-navbar .nav-link {
  color: var(--atc-text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  padding: 6px 12px !important;
  border-radius: var(--atc-radius-sm);
  transition: color var(--atc-transition), background-color var(--atc-transition);
}

.atc-navbar .nav-link:hover {
  color: var(--atc-text);
  background: var(--atc-hover);
}

.atc-navbar .nav-link.active,
.atc-navbar .nav-link.router-link-active {
  color: var(--atc-text) !important;
  background: rgba(255, 255, 255, 0.07);
}

.atc-navbar .navbar-toggler {
  border-color: var(--atc-border-strong);
  padding: 4px 8px;
}

.atc-navbar .navbar-toggler:focus {
  box-shadow: var(--atc-focus-ring);
}

.nav-user-link .nav-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.nav-avatar {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--atc-accent-soft);
  color: var(--atc-accent-text);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

@media (max-width: 991.98px) {
  .atc-navbar .navbar-collapse {
    padding-top: 10px;
  }
}
</style>
