<template>
  <div id="app">
    <BNavbar toggleable="lg" variant="dark" class="app-navbar" data-bs-theme="dark">
      <router-link class="navbar-brand" to="/">AutoTaskCalendar</router-link>

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
    </BNavbar>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script>
import Bootstrapnavlinkcustom from "./components/BootstrapNavlinkCustom.vue";
import { BNavbar, BNavbarToggle, BCollapse, BNavbarNav } from 'bootstrap-vue-next';
import { useHead } from '@vueuse/head';
import {
  SITE_NAME,
  SITE_TAGLINE,
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
} from './seo/siteConfig';

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
    // Site-wide defaults. Each view sets its own title/description via useSeo();
    // @vueuse/head dedupes by name/property so the page's value wins.
    useHead({
      // A template rather than a literal title: a literal here would compete with the
      // page's own title and whichever resolved last would win.
      titleTemplate: (pageTitle) => (
        pageTitle ? `${pageTitle} | ${SITE_NAME}` : `${SITE_NAME} - ${SITE_TAGLINE}`
      ),
      meta: [
        { name: "description", content: DEFAULT_DESCRIPTION },
        { name: "author", content: SITE_NAME },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: SITE_NAME },
        { property: "og:image", content: DEFAULT_OG_IMAGE },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: `${SITE_NAME} - ${SITE_TAGLINE}` },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: DEFAULT_OG_IMAGE },
        { name: "theme-color", content: "#667eea" },
      ],
      htmlAttrs: { lang: 'en' },
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
};
</script>


<style>
/* App shell only. Everything global lives in style/base.scss. */

#app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-navbar {
  position: sticky;
  top: 0;
  z-index: 1030;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(13, 16, 23, 0.85);
  backdrop-filter: blur(12px);
  box-shadow: var(--elev-1);
}

.navbar-brand {
  margin-right: var(--space-6);
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.navbar-brand:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 4px;
  border-radius: var(--radius-xs);
}

/* Nav links: a quiet pill that fills in on hover, and an accent underline when active. */
.app-navbar .nav-link {
  position: relative;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--fs-md);
  font-weight: 500;
  transition: color var(--motion) var(--ease), background-color var(--motion) var(--ease);
}

.app-navbar .nav-link:hover {
  color: var(--text-primary);
  background: var(--surface-2);
}

.app-navbar .nav-link.router-link-active,
.app-navbar .nav-link.active {
  color: var(--accent-300);
}

.app-navbar .nav-link.router-link-active::after,
.app-navbar .nav-link.active::after {
  content: "";
  position: absolute;
  left: var(--space-3);
  right: var(--space-3);
  bottom: 0;
  height: 2px;
  border-radius: var(--radius-pill);
  background: var(--accent-400);
}

.app-main {
  flex: 1;
}

/* The footer is static markup in public/index.html, outside #app. */
.footer {
  margin-top: auto;
  padding: var(--space-5) 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-1);
  color: var(--text-muted);
  font-size: var(--fs-sm);
}

.footer a {
  color: var(--text-secondary);
}

.footer a:hover {
  color: var(--accent-300);
}

.footer-box-right {
  text-align: right;
}
</style>
