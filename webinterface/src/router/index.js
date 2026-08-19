import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue'
import store from "../store.js"

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/about',
    name: 'About',
    // route level code-splitting
    // this generates a separate chunk (about.[hash].js) for this route
    // which is lazy-loaded when the route is visited.
    component: () => import(/* webpackChunkName: "about" */ '../views/About.vue')
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import(/* webpackChunkName: "about" */ '../views/Login.vue'),
    meta: {
      guestonly: true
    }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/Register.vue'),
    meta: {
      guestonly: true
    }
  },
  {
    path: '/logout',
    name: 'Logout',
    component: () => import('../views/Logout.vue'),
    meta: {
      requiresAuth: true
    }
  },
  {
    path: '/user/:username',
    name: 'User',
    component: () => import(/* webpackChunkName: "about" */ '../views/User.vue'),
    meta: {
      requiresAuth: true
    }
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: () => import(/* webpackChunkName: "about" */ '../views/Calendar.vue'),
    meta: {
      requiresAuth: true
    }
  },
  {
    path: '/weekly-plan',
    name: 'WeeklyPlan',
    component: () => import('../views/WeeklyPlan.vue'),
    meta: {
      requiresAuth: true
    }
  },
  {
    path: '/compass',
    name: 'Compass',
    component: () => import(/* webpackChunkName: "about" */ '../views/Compass.vue'),
    meta: {
      requiresAuth: true
    }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../views/Admin.vue'),
    meta: {
      requiresAuth: true,
      requiresAdmin: true
    }
  }
]

const router = createRouter({
  history: createWebHashHistory(process.env.BASE_URL),
  linkActiveClass: "active",
  routes
})

router.beforeEach(async (to) => {
  await store.dispatch('initializeSession')

  if (to.matched.some(record => record.meta.requiresAuth) && !store.getters.isLoggedIn) {
    return { path: '/login', query: { next: to.fullPath } }
  }
  // Convenience only; the server is the real boundary and answers 403 regardless.
  if (to.matched.some(record => record.meta.requiresAdmin) && !store.getters.isAdmin) {
    return { name: 'Home' }
  }
  if (to.matched.some(record => record.meta.guestonly) && store.getters.isLoggedIn) {
    return { name: 'Home' }
  }
  return true
})


export default router
